-- Nalanda · 0056 retire Ox Alpha and move Luna to GPT-6 Luna on Azure ZDR.
-- Ox Alpha was never enabled in production and the model has left the
-- OpenRouter catalog, so its pipeline value is removed from every constraint
-- and workflow. Luna now creates jobs with `openai/gpt-6-luna` and its
-- completion gates require the Azure upstream, the only provider that offers
-- a Zero Data Retention endpoint for that model. RPC signatures are unchanged,
-- so the previous immutable application remains compatible.

begin;

alter table public.generation_jobs
  drop constraint if exists generation_jobs_pipeline_check;
alter table public.generation_jobs
  add constraint generation_jobs_pipeline_check
  check (pipeline in ('document_ir_v1', 'luna_native_file_v1'));

alter table public.notes
  drop constraint if exists notes_pipeline_check;
alter table public.notes
  add constraint notes_pipeline_check
  check (pipeline in ('document_ir_v1', 'luna_native_file_v1'));

alter table public.ai_provider_usage_events
  drop constraint if exists ai_provider_usage_events_pipeline_check;
alter table public.ai_provider_usage_events
  add constraint ai_provider_usage_events_pipeline_check
  check (pipeline in ('document_ir_v1', 'luna_native_file_v1'));

create or replace function public._ai_inherit_job_pipeline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_note public.notes%rowtype;
begin
  if new.kind = 'knowledge_question' and new.note_id is not null then
    select * into v_note from public.notes where id = new.note_id;
    if found then
      new.pipeline := v_note.pipeline;
      if v_note.pipeline = 'luna_native_file_v1' then
        new.audit_model := v_note.generation_model;
        new.vision_model := v_note.generation_model;
      end if;
      new.generation_model := v_note.generation_model;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.ai_create_generation_job(
  p_user_id uuid,
  p_material_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_kind text,
  p_settings jsonb,
  p_consent_version integer,
  p_pipeline text
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.generation_jobs%rowtype;
  v_material public.materials%rowtype;
  v_date date;
  v_job public.generation_jobs%rowtype;
  v_model text;
begin
  if p_user_id is null or p_material_id is null or p_idempotency_key is null
      or p_kind not in ('exam', 'knowledge_graph')
      or p_pipeline not in ('document_ir_v1', 'luna_native_file_v1') then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$'
      or p_settings is null or jsonb_typeof(p_settings) is distinct from 'object' then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if p_consent_version is null or p_consent_version < 1 then
    raise exception 'AI_PROCESSING_CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_existing from public.generation_jobs
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint
        or v_existing.kind <> p_kind or v_existing.pipeline <> p_pipeline then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return next v_existing;
    return;
  end if;

  select * into v_material from public.materials
  where id = p_material_id and user_id = p_user_id;
  if not found then raise exception 'MATERIAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.generation_jobs
      where user_id = p_user_id and (
        status in ('queued', 'processing')
        or (status = 'deleting' and deletion_previous_status in ('queued', 'processing'))
      )) then
    raise exception 'AI_JOB_ACTIVE' using errcode = 'P0001';
  end if;

  insert into public.ai_user_plans (user_id, plan_code, consent_version, consented_at)
  values (p_user_id, 'free', p_consent_version, now())
  on conflict (user_id) do update
  set consent_version = greatest(public.ai_user_plans.consent_version, excluded.consent_version),
      consented_at = case when excluded.consent_version > public.ai_user_plans.consent_version
        then excluded.consented_at else public.ai_user_plans.consented_at end,
      updated_at = now();

  v_date := public._ai_reserve_generation_quota(p_user_id);
  v_model := case p_pipeline
    when 'luna_native_file_v1' then 'openai/gpt-6-luna'
    else 'deepseek/deepseek-v4-flash-0731'
  end;
  insert into public.generation_jobs (
    user_id, material_id, course_id, material_name, kind, settings,
    idempotency_key, request_fingerprint, consent_version, quota_local_date,
    prompt_version, pipeline, audit_model, vision_model, generation_model
  ) values (
    p_user_id, v_material.id, v_material.course_id, v_material.name, p_kind, p_settings,
    p_idempotency_key, p_request_fingerprint, p_consent_version, v_date,
    case
      when p_pipeline = 'luna_native_file_v1'
        and p_kind = 'exam' then 'exam-native-file.v2'
      when p_pipeline = 'luna_native_file_v1'
        then 'knowledge-graph-native-file.v2'
      when p_kind = 'exam' then 'exam-generate.v4'
      else 'knowledge-graph.v2'
    end,
    p_pipeline, v_model,
    case when p_pipeline = 'luna_native_file_v1'
      then v_model else 'xiaomi/mimo-v2.5' end,
    v_model
  ) returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'queued', 0, 'JOB_CREATED_' || upper(p_pipeline));
  return next v_job;
end;
$$;

create or replace function public.ai_checkpoint_generation_job_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_stage text,
  p_payload jsonb,
  p_ttl_seconds integer default 86400
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_existing_stage text;
  v_new_rank integer;
  v_existing_rank integer;
  v_expires timestamptz;
begin
  if p_stage not in ('parsed', 'audited', 'document_ready', 'artifact_ready',
      'answer_ready', 'native_audited', 'native_artifact_ready')
      or jsonb_typeof(p_payload) is distinct from 'object'
      or p_ttl_seconds < 300 or p_ttl_seconds > 604800 then
    raise exception 'INVALID_CHECKPOINT' using errcode = '22023';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if (v_job.pipeline = 'luna_native_file_v1'
        and p_stage not in ('native_audited', 'native_artifact_ready', 'answer_ready'))
      or (v_job.pipeline = 'document_ir_v1'
        and p_stage in ('native_audited', 'native_artifact_ready'))
      or (v_job.kind = 'knowledge_question'
        and p_stage not in ('answer_ready', 'native_artifact_ready'))
      or (v_job.kind <> 'knowledge_question' and p_stage = 'answer_ready') then
    raise exception 'INVALID_CHECKPOINT' using errcode = '22023';
  end if;
  v_new_rank := case p_stage
    when 'parsed' then 1 when 'audited' then 2 when 'native_audited' then 2
    when 'document_ready' then 3 when 'artifact_ready' then 4
    when 'native_artifact_ready' then 4 when 'answer_ready' then 4 else 0 end;
  select stage into v_existing_stage from public.generation_job_checkpoints where job_id = v_job.id;
  v_existing_rank := case v_existing_stage
    when 'parsed' then 1 when 'audited' then 2 when 'native_audited' then 2
    when 'document_ready' then 3 when 'artifact_ready' then 4
    when 'native_artifact_ready' then 4 when 'answer_ready' then 4 else 0 end;
  v_expires := now() + make_interval(secs => p_ttl_seconds);
  if v_existing_stage is null or v_new_rank >= v_existing_rank then
    insert into public.generation_job_checkpoints
      (job_id, user_id, stage, payload, expires_at)
    values (v_job.id, v_job.user_id, p_stage, p_payload, v_expires)
    on conflict (job_id) do update
    set stage = excluded.stage, payload = excluded.payload,
        expires_at = excluded.expires_at, updated_at = now();
  end if;
  select stage, expires_at into v_existing_stage, v_expires
  from public.generation_job_checkpoints where job_id = v_job.id;
  update public.generation_jobs
  set checkpoint_stage = v_existing_stage, resume_until = v_expires,
      lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = v_job.id;
end;
$$;

create or replace function public.ai_complete_material_generation_job_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_source_sha256 text,
  p_parser_version text,
  p_audit_version text,
  p_prompt_version text,
  p_source_mode text,
  p_canonical_document jsonb,
  p_block_count integer,
  p_visual_region_count integer,
  p_title text,
  p_schema_version text,
  p_artifact jsonb,
  p_primary_count integer,
  p_secondary_count integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_note_id uuid;
  v_note_kind text;
  v_actual_primary integer;
  v_actual_secondary integer;
  v_expected_provider text;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status = 'succeeded' and v_job.note_id is not null then return v_job.note_id; end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if v_job.kind not in ('exam', 'knowledge_graph')
      or p_source_sha256 is null or p_source_sha256 !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_artifact) is distinct from 'object'
      or p_source_mode is null or p_source_mode not in ('document_ir', 'native_file')
      or p_parser_version is null or char_length(p_parser_version) not between 1 and 100
      or p_audit_version is null or char_length(p_audit_version) not between 1 and 100
      or p_prompt_version is null or char_length(p_prompt_version) not between 1 and 100
      or p_title is null or char_length(p_title) not between 1 and 160
      or p_schema_version is null
      or p_primary_count is null or p_secondary_count is null
      or (v_job.pipeline = 'document_ir_v1' and
        (p_source_mode <> 'document_ir' or jsonb_typeof(p_canonical_document) is distinct from 'object'))
      or (v_job.pipeline = 'luna_native_file_v1' and
        (p_source_mode <> 'native_file' or p_canonical_document is not null))
      or (v_job.kind = 'exam' and p_schema_version <> 'generated-exam.v1')
      or (v_job.kind = 'knowledge_graph' and p_schema_version <> 'generated-knowledge-graph.v1')
      or p_artifact->>'schemaVersion' is distinct from p_schema_version
      or p_artifact->>'sourceMode' is distinct from p_source_mode then
    raise exception 'INVALID_AI_RESULT' using errcode = '22023';
  end if;
  if v_job.kind = 'exam' then
    if jsonb_typeof(p_artifact->'sections') is distinct from 'array'
        or jsonb_typeof(p_artifact->'totalMarks') is distinct from 'number'
        or p_primary_count not between 1 and 100
        or p_secondary_count not between 1 and 1000 then
      raise exception 'INVALID_AI_RESULT' using errcode = '22023';
    end if;
    if (p_artifact->>'totalMarks')::integer <> p_secondary_count
        or exists (
          select 1 from jsonb_array_elements(p_artifact->'sections') section
          where jsonb_typeof(section->'questions') is distinct from 'array'
        ) then
      raise exception 'INVALID_AI_RESULT' using errcode = '22023';
    end if;
    select count(*)::integer into v_actual_primary
    from jsonb_array_elements(p_artifact->'sections') section
    cross join lateral jsonb_array_elements(section->'questions') question;
    if v_actual_primary <> p_primary_count then
      raise exception 'INVALID_AI_RESULT' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(p_artifact->'nodes') is distinct from 'array'
        or jsonb_typeof(p_artifact->'edges') is distinct from 'array'
        or p_primary_count not between 1 and 250
        or p_secondary_count not between 0 and 1000 then
      raise exception 'INVALID_AI_RESULT' using errcode = '22023';
    end if;
    select jsonb_array_length(p_artifact->'nodes'), jsonb_array_length(p_artifact->'edges')
      into v_actual_primary, v_actual_secondary;
    if v_actual_primary <> p_primary_count or v_actual_secondary <> p_secondary_count
        or (select count(*) from jsonb_array_elements(p_artifact->'nodes'))
          <> (select count(distinct node->>'id') from jsonb_array_elements(p_artifact->'nodes') node)
        or (select count(*) from jsonb_array_elements(p_artifact->'edges'))
          <> (select count(distinct edge->>'id') from jsonb_array_elements(p_artifact->'edges') edge)
        or not exists (
          select 1 from jsonb_array_elements(p_artifact->'nodes') node
          where node->'level' = '0'::jsonb
        )
        or exists (
          select 1 from jsonb_array_elements(p_artifact->'edges') edge
          where coalesce(edge->>'from', '') = coalesce(edge->>'to', '')
            or not exists (select 1 from jsonb_array_elements(p_artifact->'nodes') node where node->>'id' = edge->>'from')
            or not exists (select 1 from jsonb_array_elements(p_artifact->'nodes') node where node->>'id' = edge->>'to')
        ) then
      raise exception 'INVALID_AI_RESULT' using errcode = '22023';
    end if;
  end if;

  if v_job.pipeline = 'luna_native_file_v1' then
    -- GPT-6 Luna's only Zero Data Retention endpoints are Azure-hosted.
    v_expected_provider := 'Azure';
    if exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and (usage.model <> v_job.generation_model
            or usage.upstream_provider is distinct from v_expected_provider)
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and usage.purpose = 'safety_audit'
          and usage.model = v_job.generation_model
          and usage.upstream_provider = v_expected_provider
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and usage.purpose = case when v_job.kind = 'exam'
            then 'exam_generation' else 'knowledge_graph_generation' end
          and usage.model = v_job.generation_model
          and usage.upstream_provider = v_expected_provider
      ) then
      raise exception 'AI_PROVIDER_ROUTING_VIOLATION' using errcode = 'P0001';
    end if;
  end if;

  if v_job.pipeline = 'document_ir_v1' and v_job.material_id is not null then
    insert into public.ai_material_parse_cache (
      user_id, material_id, source_sha256, parser_version, audit_version,
      vision_model, canonical_document, block_count, visual_region_count
    ) values (
      v_job.user_id, v_job.material_id, p_source_sha256, p_parser_version,
      p_audit_version, v_job.vision_model, p_canonical_document,
      p_block_count, p_visual_region_count
    ) on conflict (material_id, source_sha256, parser_version, audit_version, vision_model)
    do update set canonical_document = excluded.canonical_document,
      block_count = excluded.block_count,
      visual_region_count = excluded.visual_region_count,
      updated_at = now();
  end if;

  v_note_kind := case when v_job.kind = 'exam' then 'ai_exam' else 'ai_knowledge_graph' end;
  insert into public.notes (
    user_id, course_id, generation_job_id, title, kind, material_name,
    pipeline, generation_model
  ) values (
    v_job.user_id, v_job.course_id, v_job.id, p_title, v_note_kind,
    v_job.material_name, v_job.pipeline, v_job.generation_model
  ) returning id into v_note_id;
  insert into public.note_materials (note_id, material_id, material_name, source_sha256)
  values (v_note_id, v_job.material_id, v_job.material_name, p_source_sha256);
  insert into public.note_artifacts (
    note_id, schema_version, content, question_count, total_marks, node_count, edge_count
  ) values (
    v_note_id, p_schema_version, p_artifact,
    case when v_job.kind = 'exam' then p_primary_count else 0 end,
    case when v_job.kind = 'exam' then p_secondary_count else 0 end,
    case when v_job.kind = 'knowledge_graph' then p_primary_count else 0 end,
    case when v_job.kind = 'knowledge_graph' then p_secondary_count else 0 end
  );
  if v_job.quota_reserved then
    update public.ai_daily_usage
    set reserved_count = greatest(0, reserved_count - 1),
        consumed_count = consumed_count + 1, updated_at = now()
    where user_id = v_job.user_id and local_date = v_job.quota_local_date
      and kind = 'generation';
  end if;
  update public.generation_jobs
  set status = 'succeeded', stage = 'succeeded', progress = 100,
      source_sha256 = p_source_sha256, parser_version = p_parser_version,
      prompt_version = p_prompt_version, note_id = v_note_id,
      quota_reserved = false, retryable = false, resume_until = null,
      checkpoint_stage = null, lease_token = null, lease_expires_at = null,
      finished_at = now(), updated_at = now()
  where id = v_job.id;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'succeeded', 100, 'JOB_SUCCEEDED');
  return v_note_id;
end;
$$;

create or replace function public.ai_complete_knowledge_question_job_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_answer jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_expected_provider text;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status = 'succeeded' then return; end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token
      or v_job.kind <> 'knowledge_question' then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if v_job.pipeline = 'luna_native_file_v1' then
    -- GPT-6 Luna's only Zero Data Retention endpoints are Azure-hosted.
    v_expected_provider := 'Azure';
    if exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and (usage.model <> v_job.generation_model
            or usage.upstream_provider is distinct from v_expected_provider)
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and usage.purpose = 'knowledge_node_question'
          and usage.model = v_job.generation_model
          and usage.upstream_provider = v_expected_provider
      ) then
      raise exception 'AI_PROVIDER_ROUTING_VIOLATION' using errcode = 'P0001';
    end if;
  end if;
  perform public.ai_complete_knowledge_question_job(p_job_id, p_lease_token, p_answer);
end;
$$;

create or replace function public.ai_complete_exam_grading_v2(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_subjective_score numeric,
  p_results jsonb,
  p_usage_events jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_note public.notes%rowtype;
  v_expected_provider text;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_attempt.status = 'completed' then return; end if;
  if v_attempt.status <> 'grading' or v_attempt.grading_lease_token <> p_lease_token then
    raise exception 'GRADING_LEASE_LOST' using errcode = 'P0001';
  end if;
  select * into strict v_note from public.notes where id = v_attempt.note_id;
  if v_note.pipeline = 'luna_native_file_v1' then
    -- GPT-6 Luna's only Zero Data Retention endpoints are Azure-hosted.
    v_expected_provider := 'Azure';
    if exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.attempt_id = v_attempt.id and usage.status = 'succeeded'
          and (usage.model <> v_note.generation_model
            or usage.upstream_provider is distinct from v_expected_provider)
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.attempt_id = v_attempt.id and usage.status = 'succeeded'
          and usage.purpose = 'exam_grading'
          and usage.model = v_note.generation_model
          and usage.upstream_provider = v_expected_provider
      ) then
      raise exception 'AI_PROVIDER_ROUTING_VIOLATION' using errcode = 'P0001';
    end if;
  end if;
  perform public.ai_complete_exam_grading(
    p_attempt_id, p_lease_token, p_subjective_score, p_results, p_usage_events
  );
end;
$$;

revoke execute on function public._ai_inherit_job_pipeline()
  from public, anon, authenticated;
revoke execute on function public.ai_create_generation_job(
  uuid, uuid, uuid, text, text, jsonb, integer, text
) from public, anon, authenticated;
revoke execute on function public.ai_checkpoint_generation_job_v2(
  uuid, uuid, text, jsonb, integer
) from public, anon, authenticated;
revoke execute on function public.ai_complete_material_generation_job_v2(
  uuid, uuid, text, text, text, text, text, jsonb,
  integer, integer, text, text, jsonb, integer, integer
) from public, anon, authenticated;
revoke execute on function public.ai_complete_knowledge_question_job_v2(
  uuid, uuid, jsonb
) from public, anon, authenticated;
revoke execute on function public.ai_complete_exam_grading_v2(
  uuid, uuid, numeric, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public._ai_inherit_job_pipeline() to service_role;
grant execute on function public.ai_create_generation_job(
  uuid, uuid, uuid, text, text, jsonb, integer, text
) to service_role;
grant execute on function public.ai_checkpoint_generation_job_v2(
  uuid, uuid, text, jsonb, integer
) to service_role;
grant execute on function public.ai_complete_material_generation_job_v2(
  uuid, uuid, text, text, text, text, text, jsonb,
  integer, integer, text, text, jsonb, integer, integer
) to service_role;
grant execute on function public.ai_complete_knowledge_question_job_v2(
  uuid, uuid, jsonb
) to service_role;
grant execute on function public.ai_complete_exam_grading_v2(
  uuid, uuid, numeric, jsonb, jsonb
) to service_role;

commit;
