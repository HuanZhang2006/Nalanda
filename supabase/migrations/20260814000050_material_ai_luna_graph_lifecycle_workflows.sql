-- Nalanda · 0050 service-only workflows for dual AI pipelines, durable job
-- cleanup, provider provenance, and optimistic graph-layout persistence.

begin;

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
  v_model := case when p_pipeline = 'luna_native_file_v1'
    then 'openai/gpt-5.6-luna' else 'deepseek/deepseek-v4-flash-0731' end;
  insert into public.generation_jobs (
    user_id, material_id, course_id, material_name, kind, settings,
    idempotency_key, request_fingerprint, consent_version, quota_local_date,
    prompt_version, pipeline, audit_model, vision_model, generation_model
  ) values (
    p_user_id, v_material.id, v_material.course_id, v_material.name, p_kind, p_settings,
    p_idempotency_key, p_request_fingerprint, p_consent_version, v_date,
    case
      when p_pipeline = 'luna_native_file_v1' and p_kind = 'exam' then 'exam-native-file.v1'
      when p_pipeline = 'luna_native_file_v1' then 'knowledge-graph-native-file.v1'
      when p_kind = 'exam' then 'exam-generate.v2'
      else 'knowledge-graph.v1'
    end,
    p_pipeline, v_model,
    case when p_pipeline = 'luna_native_file_v1' then v_model else 'xiaomi/mimo-v2.5' end,
    v_model
  ) returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'queued', 0, 'JOB_CREATED_' || upper(p_pipeline));
  return next v_job;
end;
$$;

-- Keep the pre-pipeline application contract executable during an immutable
-- release rollback, while routing all behavior through the lifecycle-aware
-- implementation above. Existing callers remain explicitly Document IR.
create or replace function public.ai_create_generation_job(
  p_user_id uuid,
  p_material_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text,
  p_kind text,
  p_settings jsonb,
  p_consent_version integer
)
returns setof public.generation_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from public.ai_create_generation_job(
    p_user_id, p_material_id, p_idempotency_key, p_request_fingerprint,
    p_kind, p_settings, p_consent_version, 'document_ir_v1'
  );
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
  if (v_job.pipeline = 'luna_native_file_v1' and p_stage not in
        ('native_audited', 'native_artifact_ready', 'answer_ready'))
      or (v_job.pipeline = 'document_ir_v1' and p_stage in
        ('native_audited', 'native_artifact_ready'))
      or (v_job.kind = 'knowledge_question' and p_stage not in ('answer_ready', 'native_artifact_ready'))
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

create or replace function public.ai_record_generation_usage_v2(
  p_job_id uuid,
  p_lease_token uuid,
  p_event jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_existing public.ai_provider_usage_events%rowtype;
  v_upstream text := nullif(p_event->>'upstreamProvider', '');
  v_endpoint text := nullif(p_event->>'upstreamEndpoint', '');
begin
  if jsonb_typeof(p_event) is distinct from 'object'
      or coalesce(p_event->>'eventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_USAGE_EVENT' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event->>'eventId', 0));
  select * into v_job from public.generation_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if (v_job.kind = 'exam' and coalesce(p_event->>'purpose', '') not in
      ('parse_audit', 'visual_recovery', 'safety_audit', 'exam_generation', 'exam_repair', 'exam_review'))
      or (v_job.kind = 'knowledge_graph' and coalesce(p_event->>'purpose', '') not in
      ('parse_audit', 'visual_recovery', 'safety_audit', 'knowledge_graph_generation',
       'knowledge_graph_review', 'knowledge_graph_repair'))
      or (v_job.kind = 'knowledge_question' and coalesce(p_event->>'purpose', '') <> 'knowledge_node_question') then
    raise exception 'INVALID_USAGE_EVENT' using errcode = '22023';
  end if;
  -- Persist the provider's accounting fact even when it proves a routing
  -- violation. Completion functions below fail closed; rolling back this
  -- insert would erase the exact cost/provenance evidence we need to audit.
  select * into v_existing from public.ai_provider_usage_events
  where event_id = (p_event->>'eventId')::uuid;
  if found then
    if v_existing.job_id is distinct from v_job.id
        or v_existing.model is distinct from p_event->>'model'
        or v_existing.upstream_provider is distinct from v_upstream
        or v_existing.upstream_endpoint is distinct from v_endpoint
        or v_existing.pipeline is distinct from v_job.pipeline then
      raise exception 'USAGE_EVENT_CONFLICT' using errcode = '23505';
    end if;
    return;
  end if;
  if v_job.status not in ('processing', 'deleting') or v_job.lease_token <> p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  insert into public.ai_provider_usage_events (
    event_id, user_id, job_id, attempt_id, purpose, provider, model,
    provider_request_id, prompt_tokens, completion_tokens, total_tokens,
    cost_micro_usd, duration_ms, zdr_enforced, status, error_code,
    pipeline, upstream_provider, upstream_endpoint
  ) values (
    (p_event->>'eventId')::uuid, v_job.user_id, v_job.id, null,
    p_event->>'purpose', 'openrouter', p_event->>'model', nullif(p_event->>'requestId', ''),
    nullif(p_event->>'promptTokens', '')::bigint,
    nullif(p_event->>'completionTokens', '')::bigint,
    nullif(p_event->>'totalTokens', '')::bigint,
    nullif(p_event->>'costMicroUsd', '')::bigint,
    coalesce((p_event->>'durationMs')::integer, 0),
    coalesce((p_event->>'zdrEnforced')::boolean, true),
    coalesce(p_event->>'status', 'succeeded'), nullif(p_event->>'errorCode', ''),
    v_job.pipeline, v_upstream, v_endpoint
  );
  if v_job.status = 'processing' then
    update public.generation_jobs
    set lease_expires_at = now() + interval '15 minutes', updated_at = now()
    where id = v_job.id and status = 'processing' and lease_token = p_lease_token;
  end if;
end;
$$;

create or replace function public.ai_record_grading_usage_v2(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_event jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_note public.notes%rowtype;
  v_existing public.ai_provider_usage_events%rowtype;
  v_upstream text := nullif(p_event->>'upstreamProvider', '');
  v_endpoint text := nullif(p_event->>'upstreamEndpoint', '');
begin
  if jsonb_typeof(p_event) is distinct from 'object'
      or coalesce(p_event->>'eventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_event->>'purpose' <> 'exam_grading' then
    raise exception 'INVALID_USAGE_EVENT' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event->>'eventId', 0));
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into strict v_note from public.notes where id = v_attempt.note_id;
  -- Keep non-compliant usage as immutable cost evidence. The grading
  -- completion gate validates the requested model and actual provider.
  select * into v_existing from public.ai_provider_usage_events
  where event_id = (p_event->>'eventId')::uuid;
  if found then
    if v_existing.attempt_id is distinct from v_attempt.id
        or v_existing.model is distinct from p_event->>'model'
        or v_existing.upstream_provider is distinct from v_upstream
        or v_existing.upstream_endpoint is distinct from v_endpoint
        or v_existing.pipeline is distinct from v_note.pipeline then
      raise exception 'USAGE_EVENT_CONFLICT' using errcode = '23505';
    end if;
    return;
  end if;
  if v_attempt.status <> 'grading' or v_attempt.grading_lease_token <> p_lease_token then
    raise exception 'GRADING_LEASE_LOST' using errcode = 'P0001';
  end if;
  insert into public.ai_provider_usage_events (
    event_id, user_id, job_id, attempt_id, purpose, provider, model,
    provider_request_id, prompt_tokens, completion_tokens, total_tokens,
    cost_micro_usd, duration_ms, zdr_enforced, status, error_code,
    pipeline, upstream_provider, upstream_endpoint
  ) values (
    (p_event->>'eventId')::uuid, v_attempt.user_id, null, v_attempt.id,
    'exam_grading', 'openrouter', p_event->>'model', nullif(p_event->>'requestId', ''),
    nullif(p_event->>'promptTokens', '')::bigint,
    nullif(p_event->>'completionTokens', '')::bigint,
    nullif(p_event->>'totalTokens', '')::bigint,
    nullif(p_event->>'costMicroUsd', '')::bigint,
    coalesce((p_event->>'durationMs')::integer, 0),
    coalesce((p_event->>'zdrEnforced')::boolean, true),
    coalesce(p_event->>'status', 'succeeded'), nullif(p_event->>'errorCode', ''),
    v_note.pipeline, v_upstream, v_endpoint
  );
  update public.exam_attempts
  set grading_lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = v_attempt.id and status = 'grading' and grading_lease_token = p_lease_token;
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
  if v_job.pipeline = 'luna_native_file_v1' and (
      exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and (usage.model <> 'openai/gpt-5.6-luna'
            or usage.upstream_provider is distinct from 'OpenAI')
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and usage.purpose = 'safety_audit'
          and usage.model = 'openai/gpt-5.6-luna'
          and usage.upstream_provider = 'OpenAI'
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and usage.purpose = case when v_job.kind = 'exam'
            then 'exam_generation' else 'knowledge_graph_generation' end
          and usage.model = 'openai/gpt-5.6-luna'
          and usage.upstream_provider = 'OpenAI'
      )
    ) then
    raise exception 'AI_PROVIDER_ROUTING_VIOLATION' using errcode = 'P0001';
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
declare v_job public.generation_jobs%rowtype;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status = 'succeeded' then return; end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token
      or v_job.kind <> 'knowledge_question' then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if v_job.pipeline = 'luna_native_file_v1' and (
      exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and (usage.model <> 'openai/gpt-5.6-luna'
            or usage.upstream_provider is distinct from 'OpenAI')
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.job_id = v_job.id and usage.status = 'succeeded'
          and usage.purpose = 'knowledge_node_question'
          and usage.model = 'openai/gpt-5.6-luna'
          and usage.upstream_provider = 'OpenAI'
      )
    ) then
    raise exception 'AI_PROVIDER_ROUTING_VIOLATION' using errcode = 'P0001';
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
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_attempt.status = 'completed' then return; end if;
  if v_attempt.status <> 'grading' or v_attempt.grading_lease_token <> p_lease_token then
    raise exception 'GRADING_LEASE_LOST' using errcode = 'P0001';
  end if;
  select * into strict v_note from public.notes where id = v_attempt.note_id;
  if v_note.pipeline = 'luna_native_file_v1' and (
      exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.attempt_id = v_attempt.id and usage.status = 'succeeded'
          and (usage.model <> 'openai/gpt-5.6-luna'
            or usage.upstream_provider is distinct from 'OpenAI')
      )
      or not exists (
        select 1 from public.ai_provider_usage_events usage
        where usage.attempt_id = v_attempt.id and usage.status = 'succeeded'
          and usage.purpose = 'exam_grading'
          and usage.model = 'openai/gpt-5.6-luna'
          and usage.upstream_provider = 'OpenAI'
      )
    ) then
    raise exception 'AI_PROVIDER_ROUTING_VIOLATION' using errcode = 'P0001';
  end if;
  perform public.ai_complete_exam_grading(
    p_attempt_id, p_lease_token, p_subjective_score, p_results, p_usage_events
  );
end;
$$;

create or replace function public._ai_begin_generation_job_cleanup(
  p_user_id uuid,
  p_job_id uuid,
  p_delete_after_cleanup boolean
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_consumed boolean := false;
begin
  select * into v_job from public.generation_jobs
  where id = p_job_id and user_id = p_user_id for update;
  if not found then raise exception 'AI_JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status = 'deleting' then
    if p_delete_after_cleanup and not v_job.delete_after_cleanup then
      update public.generation_jobs set delete_after_cleanup = true, updated_at = now()
      where id = v_job.id returning * into v_job;
    end if;
    return next v_job;
    return;
  end if;
  if v_job.quota_reserved then
    if v_job.status = 'processing' and v_job.accepted_at is not null then
      update public.ai_daily_usage
      set reserved_count = greatest(0, reserved_count - 1),
          consumed_count = consumed_count + 1, updated_at = now()
      where user_id = v_job.user_id and local_date = v_job.quota_local_date
        and kind = 'generation';
      v_consumed := true;
    else
      perform public._ai_release_generation_quota(v_job.user_id, v_job.quota_local_date);
    end if;
  end if;
  update public.generation_jobs
  set status = 'deleting', stage = 'cleaning', quota_reserved = false,
      retryable = false, resume_until = null,
      deletion_requested_at = now(), deletion_previous_status = v_job.status,
      deletion_quota_consumed = v_job.deletion_quota_consumed or v_consumed,
      delete_after_cleanup = p_delete_after_cleanup,
      cleanup_error = null, updated_at = now()
  where id = v_job.id returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'cleaning', v_job.progress,
    case when p_delete_after_cleanup then 'JOB_DELETE_REQUESTED' else 'JOB_CANCEL_REQUESTED' end);
  return next v_job;
end;
$$;

create or replace function public.ai_delete_generation_job(p_user_id uuid, p_job_id uuid)
returns setof public.generation_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from public._ai_begin_generation_job_cleanup(p_user_id, p_job_id, true);
$$;

create or replace function public.ai_cancel_generation_job(p_user_id uuid, p_job_id uuid)
returns setof public.generation_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from public._ai_begin_generation_job_cleanup(p_user_id, p_job_id, false);
$$;

create or replace function public.ai_clear_generation_history(p_user_id uuid)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_job public.generation_jobs%rowtype;
begin
  for v_job in select * from public.generation_jobs
    where user_id = p_user_id
      and status in ('succeeded', 'failed', 'cancelled')
    order by created_at for update
  loop
    return query select * from public._ai_begin_generation_job_cleanup(
      p_user_id, v_job.id, true
    );
  end loop;
end;
$$;

create or replace function public.ai_record_generation_cleanup_failure(
  p_job_id uuid,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.generation_jobs
  set cleanup_attempt_count = cleanup_attempt_count + 1,
      cleanup_error = left(p_error_message, 500), updated_at = now()
  where id = p_job_id and status = 'deleting';
end;
$$;

create or replace function public.ai_finalize_generation_job_cleanup(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_delete boolean;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then return jsonb_build_object('status', 'deleted'); end if;
  if v_job.status <> 'deleting' then
    raise exception 'AI_JOB_NOT_CLEANING' using errcode = 'P0001';
  end if;
  v_delete := v_job.delete_after_cleanup;
  delete from public.generation_job_checkpoints where job_id = v_job.id;
  if v_delete then
    delete from public.generation_jobs where id = v_job.id;
    return jsonb_build_object('status', 'deleted');
  end if;
  update public.generation_jobs
  set status = 'cancelled', stage = 'cancelled', progress = least(progress, 99),
      lease_token = null, lease_expires_at = null, checkpoint_stage = null,
      cleanup_error = null, finished_at = coalesce(finished_at, now()), updated_at = now()
  where id = v_job.id;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'cancelled', least(v_job.progress, 99), 'JOB_CLEANUP_CONFIRMED');
  return jsonb_build_object('status', 'cancelled');
end;
$$;

create or replace function public.ai_fail_generation_job_v3(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default false,
  p_resume_seconds integer default 86400
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_status text;
begin
  -- Serialize with delete/finalize. Without this lock, a fail callback could
  -- observe processing, wait behind a delete, then let the legacy v2 function
  -- turn the newly deleting row back into failed.
  select status into v_status from public.generation_jobs
  where id = p_job_id for update;
  if v_status = 'deleting' then return; end if;
  perform public.ai_fail_generation_job_v2(
    p_job_id, p_lease_token, p_error_code, p_error_message, p_retryable, p_resume_seconds
  );
end;
$$;

create or replace function public.ai_get_knowledge_graph_layout(
  p_user_id uuid,
  p_note_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artifact public.note_artifacts%rowtype;
  v_layout public.knowledge_graph_layouts%rowtype;
  v_version text;
begin
  select artifact.* into v_artifact
  from public.notes note join public.note_artifacts artifact on artifact.note_id = note.id
  where note.id = p_note_id and note.user_id = p_user_id
    and note.kind = 'ai_knowledge_graph';
  if not found then raise exception 'KNOWLEDGE_NOTE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_version := encode(extensions.digest(v_artifact.content::text, 'sha256'), 'hex');
  -- Return prior coordinates across artifact versions. The client keeps only
  -- positions for node IDs that still exist and auto-lays out new nodes.
  select * into v_layout from public.knowledge_graph_layouts
  where note_id = p_note_id;
  if not found then
    return jsonb_build_object(
      'noteId', p_note_id, 'artifactVersion', v_version, 'revision', 0,
      'positions', '[]'::jsonb,
      'viewport', jsonb_build_object('x', 0, 'y', 0, 'zoom', 1),
      'updatedAt', null
    );
  end if;
  return jsonb_build_object(
    'noteId', v_layout.note_id, 'artifactVersion', v_version,
    'revision', case when v_layout.artifact_version = v_version then v_layout.revision else 0 end,
    'positions', v_layout.positions,
    'viewport', v_layout.viewport, 'updatedAt', v_layout.updated_at
  );
end;
$$;

create or replace function public.ai_save_knowledge_graph_layout(
  p_user_id uuid,
  p_note_id uuid,
  p_artifact_version text,
  p_expected_revision bigint,
  p_positions jsonb,
  p_viewport jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artifact public.note_artifacts%rowtype;
  v_layout public.knowledge_graph_layouts%rowtype;
  v_version text;
  v_position jsonb;
  v_node_ids text[] := '{}';
begin
  if p_artifact_version !~ '^[0-9a-f]{64}$' or p_expected_revision < 0
      or jsonb_typeof(p_positions) is distinct from 'array' or jsonb_array_length(p_positions) > 250
      or jsonb_typeof(p_viewport) is distinct from 'object'
      or jsonb_typeof(p_viewport->'x') is distinct from 'number'
      or jsonb_typeof(p_viewport->'y') is distinct from 'number'
      or jsonb_typeof(p_viewport->'zoom') is distinct from 'number'
      or abs((p_viewport->>'x')::numeric) > 100000
      or abs((p_viewport->>'y')::numeric) > 100000
      or (p_viewport->>'zoom')::numeric not between 0.1 and 4 then
    raise exception 'INVALID_GRAPH_LAYOUT' using errcode = '22023';
  end if;
  select artifact.* into v_artifact
  from public.notes note join public.note_artifacts artifact on artifact.note_id = note.id
  where note.id = p_note_id and note.user_id = p_user_id
    and note.kind = 'ai_knowledge_graph' for update of note;
  if not found then raise exception 'KNOWLEDGE_NOTE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_version := encode(extensions.digest(v_artifact.content::text, 'sha256'), 'hex');
  if v_version <> p_artifact_version then
    raise exception 'GRAPH_ARTIFACT_CHANGED' using errcode = 'P0001';
  end if;
  for v_position in select value from jsonb_array_elements(p_positions) loop
    if jsonb_typeof(v_position) is distinct from 'object'
        or coalesce(v_position->>'nodeId', '') = ''
        or char_length(v_position->>'nodeId') > 80
        or jsonb_typeof(v_position->'x') is distinct from 'number'
        or jsonb_typeof(v_position->'y') is distinct from 'number'
        or abs((v_position->>'x')::numeric) > 100000
        or abs((v_position->>'y')::numeric) > 100000
        or (v_position->>'nodeId') = any(v_node_ids)
        or not exists (
          select 1 from jsonb_array_elements(v_artifact.content->'nodes') node
          where node->>'id' = v_position->>'nodeId'
        ) then
      raise exception 'INVALID_GRAPH_LAYOUT' using errcode = '22023';
    end if;
    v_node_ids := array_append(v_node_ids, v_position->>'nodeId');
  end loop;

  select * into v_layout from public.knowledge_graph_layouts where note_id = p_note_id for update;
  if found and v_layout.artifact_version = v_version and v_layout.revision <> p_expected_revision then
    raise exception 'GRAPH_LAYOUT_REVISION_CONFLICT' using errcode = 'P0001';
  end if;
  if found then
    update public.knowledge_graph_layouts
    set artifact_version = v_version,
        revision = case when v_layout.artifact_version = v_version then v_layout.revision + 1 else 1 end,
        positions = p_positions, viewport = p_viewport, updated_at = now()
    where note_id = p_note_id returning * into v_layout;
  else
    if p_expected_revision <> 0 then
      raise exception 'GRAPH_LAYOUT_REVISION_CONFLICT' using errcode = 'P0001';
    end if;
    insert into public.knowledge_graph_layouts
      (note_id, user_id, artifact_version, revision, positions, viewport)
    values (p_note_id, p_user_id, v_version, 1, p_positions, p_viewport)
    returning * into v_layout;
  end if;
  return jsonb_build_object(
    'noteId', v_layout.note_id, 'artifactVersion', v_layout.artifact_version,
    'revision', v_layout.revision, 'positions', v_layout.positions,
    'viewport', v_layout.viewport, 'updatedAt', v_layout.updated_at
  );
end;
$$;

revoke execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, text, jsonb, integer, text)
  from public, anon, authenticated;
revoke execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, text, jsonb, integer)
  from public, anon, authenticated;
revoke execute on function public.ai_checkpoint_generation_job_v2(uuid, uuid, text, jsonb, integer)
  from public, anon, authenticated;
revoke execute on function public.ai_record_generation_usage_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.ai_record_grading_usage_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.ai_complete_material_generation_job_v2(uuid, uuid, text, text, text, text, text, jsonb, integer, integer, text, text, jsonb, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.ai_complete_knowledge_question_job_v2(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke execute on function public.ai_complete_exam_grading_v2(uuid, uuid, numeric, jsonb, jsonb)
  from public, anon, authenticated;
revoke execute on function public._ai_begin_generation_job_cleanup(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.ai_delete_generation_job(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.ai_cancel_generation_job(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.ai_clear_generation_history(uuid)
  from public, anon, authenticated;
revoke execute on function public.ai_record_generation_cleanup_failure(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.ai_finalize_generation_job_cleanup(uuid)
  from public, anon, authenticated;
revoke execute on function public.ai_fail_generation_job_v3(uuid, uuid, text, text, boolean, integer)
  from public, anon, authenticated;
revoke execute on function public.ai_get_knowledge_graph_layout(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.ai_save_knowledge_graph_layout(uuid, uuid, text, bigint, jsonb, jsonb)
  from public, anon, authenticated;

grant execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, text, jsonb, integer, text)
  to service_role;
grant execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, text, jsonb, integer)
  to service_role;
grant execute on function public.ai_checkpoint_generation_job_v2(uuid, uuid, text, jsonb, integer)
  to service_role;
grant execute on function public.ai_record_generation_usage_v2(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.ai_record_grading_usage_v2(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.ai_complete_material_generation_job_v2(uuid, uuid, text, text, text, text, text, jsonb, integer, integer, text, text, jsonb, integer, integer)
  to service_role;
grant execute on function public.ai_complete_knowledge_question_job_v2(uuid, uuid, jsonb)
  to service_role;
grant execute on function public.ai_complete_exam_grading_v2(uuid, uuid, numeric, jsonb, jsonb)
  to service_role;
grant execute on function public._ai_begin_generation_job_cleanup(uuid, uuid, boolean)
  to service_role;
grant execute on function public.ai_delete_generation_job(uuid, uuid) to service_role;
grant execute on function public.ai_cancel_generation_job(uuid, uuid) to service_role;
grant execute on function public.ai_clear_generation_history(uuid) to service_role;
grant execute on function public.ai_record_generation_cleanup_failure(uuid, text) to service_role;
grant execute on function public.ai_finalize_generation_job_cleanup(uuid) to service_role;
grant execute on function public.ai_fail_generation_job_v3(uuid, uuid, text, text, boolean, integer)
  to service_role;
grant execute on function public.ai_get_knowledge_graph_layout(uuid, uuid) to service_role;
grant execute on function public.ai_save_knowledge_graph_layout(uuid, uuid, text, bigint, jsonb, jsonb)
  to service_role;

commit;
