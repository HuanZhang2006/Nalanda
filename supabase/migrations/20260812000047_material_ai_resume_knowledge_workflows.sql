-- Service-only workflows for resumable Materials AI and knowledge graphs.

begin;

create or replace function public._ai_reserve_generation_quota(p_user_id uuid)
returns date
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text := public._ai_user_timezone(p_user_id);
  v_date date := timezone(v_timezone, now())::date;
  v_plan public.ai_plans%rowtype;
  v_usage public.ai_daily_usage%rowtype;
begin
  insert into public.ai_user_plans (user_id, plan_code)
  values (p_user_id, 'free')
  on conflict (user_id) do nothing;

  select p.* into strict v_plan
  from public.ai_plans p
  join public.ai_user_plans up on up.plan_code = p.code
  where up.user_id = p_user_id and p.active;

  insert into public.ai_daily_usage
    (user_id, local_date, kind, plan_code, limit_count, timezone)
  values (p_user_id, v_date, 'generation', v_plan.code, v_plan.generation_daily_limit, v_timezone)
  on conflict (user_id, local_date, kind) do update
  set limit_count = excluded.limit_count,
      plan_code = excluded.plan_code,
      updated_at = now();

  select * into strict v_usage from public.ai_daily_usage
  where user_id = p_user_id and local_date = v_date and kind = 'generation'
  for update;
  if v_usage.consumed_count + v_usage.reserved_count >= v_usage.limit_count then
    raise exception 'AI_GENERATION_DAILY_LIMIT' using errcode = 'P0001';
  end if;
  update public.ai_daily_usage
  set reserved_count = reserved_count + 1, updated_at = now()
  where user_id = p_user_id and local_date = v_date and kind = 'generation';
  return v_date;
end;
$$;

create or replace function public._ai_release_generation_quota(
  p_user_id uuid,
  p_local_date date
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.ai_daily_usage
  set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
  where user_id = p_user_id and local_date = p_local_date and kind = 'generation';
$$;

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
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.generation_jobs%rowtype;
  v_material public.materials%rowtype;
  v_date date;
  v_job public.generation_jobs%rowtype;
begin
  if p_user_id is null or p_material_id is null or p_idempotency_key is null
      or p_kind not in ('exam', 'knowledge_graph') then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$'
      or p_settings is null or jsonb_typeof(p_settings) <> 'object' then
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
        or v_existing.kind <> p_kind then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return next v_existing;
    return;
  end if;

  select * into v_material from public.materials
  where id = p_material_id and user_id = p_user_id;
  if not found then raise exception 'MATERIAL_NOT_FOUND' using errcode = 'P0002'; end if;
  if exists (select 1 from public.generation_jobs
      where user_id = p_user_id and status in ('queued', 'processing')) then
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
  insert into public.generation_jobs (
    user_id, material_id, course_id, material_name, kind, settings,
    idempotency_key, request_fingerprint, consent_version, quota_local_date,
    prompt_version
  ) values (
    p_user_id, v_material.id, v_material.course_id, v_material.name, p_kind, p_settings,
    p_idempotency_key, p_request_fingerprint, p_consent_version, v_date,
    case when p_kind = 'exam' then 'exam-generate.v2' else 'knowledge-graph.v1' end
  ) returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'queued', 0, 'JOB_CREATED');
  return next v_job;
end;
$$;

create or replace function public.ai_create_knowledge_question_job(
  p_user_id uuid,
  p_note_id uuid,
  p_node_id text,
  p_question text,
  p_idempotency_key uuid,
  p_request_fingerprint text
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.generation_jobs%rowtype;
  v_note public.notes%rowtype;
  v_artifact public.note_artifacts%rowtype;
  v_date date;
  v_job public.generation_jobs%rowtype;
begin
  if p_user_id is null or p_note_id is null or p_idempotency_key is null
      or p_node_id is null or p_question is null
      or char_length(trim(p_node_id)) not between 1 and 80
      or char_length(trim(p_question)) not between 1 and 2000
      or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_existing from public.generation_jobs
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint
        or v_existing.kind <> 'knowledge_question' then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return next v_existing;
    return;
  end if;

  select * into v_note from public.notes
  where id = p_note_id and user_id = p_user_id and kind = 'ai_knowledge_graph';
  if not found then raise exception 'KNOWLEDGE_NOTE_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into strict v_artifact from public.note_artifacts where note_id = v_note.id;
  if not exists (
    select 1 from jsonb_array_elements(v_artifact.content->'nodes') node
    where node->>'id' = p_node_id
  ) then
    raise exception 'KNOWLEDGE_NODE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.generation_jobs
      where user_id = p_user_id and status in ('queued', 'processing')) then
    raise exception 'AI_JOB_ACTIVE' using errcode = 'P0001';
  end if;

  v_date := public._ai_reserve_generation_quota(p_user_id);
  insert into public.generation_jobs (
    user_id, material_id, course_id, material_name, kind, settings,
    idempotency_key, request_fingerprint, consent_version, quota_local_date,
    prompt_version, note_id
  ) values (
    p_user_id, null, v_note.course_id, v_note.material_name, 'knowledge_question',
    jsonb_build_object('nodeId', p_node_id, 'question', trim(p_question)),
    p_idempotency_key, p_request_fingerprint, 1, v_date,
    'knowledge-question.v1', v_note.id
  ) returning * into v_job;
  insert into public.knowledge_node_questions (id, user_id, note_id, node_id, question)
  values (v_job.id, p_user_id, v_note.id, p_node_id, trim(p_question));
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'queued', 0, 'KNOWLEDGE_QUESTION_CREATED');
  return next v_job;
end;
$$;

create or replace function public.ai_claim_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 900
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_job public.generation_jobs%rowtype;
begin
  if p_lease_token is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'INVALID_LEASE' using errcode = '22023';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then return; end if;
  if v_job.status not in ('queued', 'processing') then return; end if;
  if v_job.status = 'processing' and v_job.lease_expires_at > now() then return; end if;

  if v_job.resume_until is not null and v_job.resume_until <= now() then
    delete from public.generation_job_checkpoints where job_id = v_job.id;
    if v_job.quota_reserved then
      perform public._ai_release_generation_quota(v_job.user_id, v_job.quota_local_date);
    end if;
    update public.generation_jobs
    set status = 'failed', stage = 'failed', quota_reserved = false,
        retryable = false, resume_until = null, checkpoint_stage = null,
        error_code = 'AI_RESUME_EXPIRED',
        error_message = 'The saved AI progress expired before the worker could resume it',
        lease_token = null, lease_expires_at = null,
        finished_at = coalesce(finished_at, now()), updated_at = now()
    where id = v_job.id;
    insert into public.generation_job_events (job_id, stage, progress, event_code)
    values (v_job.id, 'failed', v_job.progress, 'AI_RESUME_EXPIRED');
    return;
  end if;
  if v_job.attempt_count >= 5 then
    if v_job.quota_reserved then
      perform public._ai_release_generation_quota(v_job.user_id, v_job.quota_local_date);
    end if;
    update public.generation_jobs
    set status = 'failed', stage = 'failed', error_code = 'AI_WORKER_RETRY_EXHAUSTED',
        error_message = 'AI processing could not recover after repeated worker restarts',
        quota_reserved = false, retryable = false, resume_until = null,
        checkpoint_stage = null, lease_token = null, lease_expires_at = null,
        finished_at = now(), updated_at = now()
    where id = p_job_id;
    insert into public.generation_job_events (job_id, stage, progress, event_code)
    values (p_job_id, 'failed', v_job.progress, 'AI_WORKER_RETRY_EXHAUSTED');
    return;
  end if;

  update public.generation_jobs
  set status = 'processing',
      stage = case when checkpoint_stage is null then 'validating' else stage end,
      progress = case when checkpoint_stage is null then greatest(progress, 2) else progress end,
      retryable = false,
      lease_token = p_lease_token,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      accepted_at = null,
      started_at = coalesce(started_at, now()), updated_at = now()
  where id = p_job_id returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, v_job.stage, v_job.progress,
    case when v_job.checkpoint_stage is null then 'JOB_CLAIMED' else 'JOB_RESUME_CLAIMED' end);
  return next v_job;
end;
$$;

create or replace function public.ai_mark_generation_job_accepted(
  p_job_id uuid,
  p_lease_token uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.generation_jobs
  set accepted_at = now(), lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and status = 'processing' and lease_token = p_lease_token;
  if not found then raise exception 'JOB_LEASE_LOST' using errcode = 'P0001'; end if;
end;
$$;

create or replace function public.ai_update_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_stage text,
  p_progress integer,
  p_event_code text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_stage not in ('validating', 'extracting', 'auditing', 'visualRecovery',
      'generating', 'organizing', 'answering', 'reviewing', 'saving')
      or p_progress < 0 or p_progress > 99 then
    raise exception 'INVALID_PROGRESS' using errcode = '22023';
  end if;
  update public.generation_jobs
  set stage = case when p_progress >= progress then p_stage else stage end,
      progress = greatest(progress, p_progress),
      lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and status = 'processing' and lease_token = p_lease_token;
  if not found then raise exception 'JOB_LEASE_LOST' using errcode = 'P0001'; end if;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (p_job_id, p_stage, p_progress, p_event_code);
end;
$$;

create or replace function public.ai_record_generation_usage(
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
begin
  if jsonb_typeof(p_event) <> 'object'
      or coalesce(p_event->>'eventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'INVALID_USAGE_EVENT' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event->>'eventId', 0));
  select * into v_job from public.generation_jobs where id = p_job_id;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if (v_job.kind = 'exam' and coalesce(p_event->>'purpose', '') not in (
        'parse_audit', 'visual_recovery', 'safety_audit',
        'exam_generation', 'exam_repair', 'exam_review'
      ))
      or (v_job.kind = 'knowledge_graph' and coalesce(p_event->>'purpose', '') not in (
        'parse_audit', 'visual_recovery', 'safety_audit',
        'knowledge_graph_generation', 'knowledge_graph_review', 'knowledge_graph_repair'
      ))
      or (v_job.kind = 'knowledge_question'
        and coalesce(p_event->>'purpose', '') <> 'knowledge_node_question') then
    raise exception 'INVALID_USAGE_EVENT' using errcode = '22023';
  end if;
  select * into v_existing from public.ai_provider_usage_events
  where event_id = (p_event->>'eventId')::uuid;
  if found then
    if v_existing.job_id is distinct from v_job.id
        or v_existing.attempt_id is not null
        or v_existing.user_id is distinct from v_job.user_id
        or v_existing.purpose is distinct from p_event->>'purpose'
        or v_existing.model is distinct from p_event->>'model'
        or v_existing.provider_request_id is distinct from nullif(p_event->>'requestId', '')
        or v_existing.prompt_tokens is distinct from nullif(p_event->>'promptTokens', '')::bigint
        or v_existing.completion_tokens is distinct from nullif(p_event->>'completionTokens', '')::bigint
        or v_existing.total_tokens is distinct from nullif(p_event->>'totalTokens', '')::bigint
        or v_existing.cost_micro_usd is distinct from nullif(p_event->>'costMicroUsd', '')::bigint
        or v_existing.duration_ms is distinct from coalesce((p_event->>'durationMs')::integer, 0)
        or v_existing.zdr_enforced is distinct from coalesce((p_event->>'zdrEnforced')::boolean, true)
        or v_existing.status is distinct from coalesce(p_event->>'status', 'succeeded')
        or v_existing.error_code is distinct from nullif(p_event->>'errorCode', '') then
      raise exception 'USAGE_EVENT_CONFLICT' using errcode = '23505';
    end if;
    return;
  end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  insert into public.ai_provider_usage_events (
    event_id, user_id, job_id, attempt_id, purpose, model, provider_request_id,
    prompt_tokens, completion_tokens, total_tokens, cost_micro_usd,
    duration_ms, zdr_enforced, status, error_code
  ) values (
    (p_event->>'eventId')::uuid, v_job.user_id, v_job.id, null,
    p_event->>'purpose', p_event->>'model', nullif(p_event->>'requestId', ''),
    nullif(p_event->>'promptTokens', '')::bigint,
    nullif(p_event->>'completionTokens', '')::bigint,
    nullif(p_event->>'totalTokens', '')::bigint,
    nullif(p_event->>'costMicroUsd', '')::bigint,
    coalesce((p_event->>'durationMs')::integer, 0),
    coalesce((p_event->>'zdrEnforced')::boolean, true),
    coalesce(p_event->>'status', 'succeeded'), nullif(p_event->>'errorCode', '')
  ) on conflict (event_id) do nothing;

  update public.generation_jobs
  set lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = v_job.id and status = 'processing' and lease_token = p_lease_token;
end;
$$;

create or replace function public.ai_record_grading_usage(
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
  v_existing public.ai_provider_usage_events%rowtype;
begin
  if jsonb_typeof(p_event) <> 'object'
      or coalesce(p_event->>'eventId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or p_event->>'purpose' <> 'exam_grading' then
    raise exception 'INVALID_USAGE_EVENT' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_event->>'eventId', 0));
  select * into v_attempt from public.exam_attempts where id = p_attempt_id;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  select * into v_existing from public.ai_provider_usage_events
  where event_id = (p_event->>'eventId')::uuid;
  if found then
    if v_existing.attempt_id is distinct from v_attempt.id
        or v_existing.job_id is not null
        or v_existing.user_id is distinct from v_attempt.user_id
        or v_existing.purpose is distinct from 'exam_grading'
        or v_existing.model is distinct from p_event->>'model'
        or v_existing.provider_request_id is distinct from nullif(p_event->>'requestId', '')
        or v_existing.prompt_tokens is distinct from nullif(p_event->>'promptTokens', '')::bigint
        or v_existing.completion_tokens is distinct from nullif(p_event->>'completionTokens', '')::bigint
        or v_existing.total_tokens is distinct from nullif(p_event->>'totalTokens', '')::bigint
        or v_existing.cost_micro_usd is distinct from nullif(p_event->>'costMicroUsd', '')::bigint
        or v_existing.duration_ms is distinct from coalesce((p_event->>'durationMs')::integer, 0)
        or v_existing.zdr_enforced is distinct from coalesce((p_event->>'zdrEnforced')::boolean, true)
        or v_existing.status is distinct from coalesce(p_event->>'status', 'succeeded')
        or v_existing.error_code is distinct from nullif(p_event->>'errorCode', '') then
      raise exception 'USAGE_EVENT_CONFLICT' using errcode = '23505';
    end if;
    return;
  end if;
  if v_attempt.status <> 'grading' or v_attempt.grading_lease_token <> p_lease_token then
    raise exception 'GRADING_LEASE_LOST' using errcode = 'P0001';
  end if;

  insert into public.ai_provider_usage_events (
    event_id, user_id, job_id, attempt_id, purpose, model, provider_request_id,
    prompt_tokens, completion_tokens, total_tokens, cost_micro_usd,
    duration_ms, zdr_enforced, status, error_code
  ) values (
    (p_event->>'eventId')::uuid, v_attempt.user_id, null, v_attempt.id,
    'exam_grading', p_event->>'model', nullif(p_event->>'requestId', ''),
    nullif(p_event->>'promptTokens', '')::bigint,
    nullif(p_event->>'completionTokens', '')::bigint,
    nullif(p_event->>'totalTokens', '')::bigint,
    nullif(p_event->>'costMicroUsd', '')::bigint,
    coalesce((p_event->>'durationMs')::integer, 0),
    coalesce((p_event->>'zdrEnforced')::boolean, true),
    coalesce(p_event->>'status', 'succeeded'), nullif(p_event->>'errorCode', '')
  ) on conflict (event_id) do nothing;

  update public.exam_attempts
  set grading_lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = v_attempt.id and status = 'grading'
    and grading_lease_token = p_lease_token;
end;
$$;

create or replace function public.ai_checkpoint_generation_job(
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
  v_checkpoint_stage text;
  v_checkpoint_expires_at timestamptz;
begin
  if p_stage not in ('parsed', 'audited', 'document_ready', 'artifact_ready', 'answer_ready')
      or jsonb_typeof(p_payload) <> 'object'
      or p_ttl_seconds < 300 or p_ttl_seconds > 604800 then
    raise exception 'INVALID_CHECKPOINT' using errcode = '22023';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if (v_job.kind = 'knowledge_question' and p_stage <> 'answer_ready')
      or (v_job.kind <> 'knowledge_question' and p_stage = 'answer_ready') then
    raise exception 'INVALID_CHECKPOINT' using errcode = '22023';
  end if;
  insert into public.generation_job_checkpoints
    (job_id, user_id, stage, payload, expires_at)
  values (v_job.id, v_job.user_id, p_stage, p_payload,
    now() + make_interval(secs => p_ttl_seconds))
  on conflict (job_id) do update
  set stage = excluded.stage, payload = excluded.payload,
      expires_at = excluded.expires_at, updated_at = now()
  where
    case excluded.stage
      when 'parsed' then 1 when 'audited' then 2 when 'document_ready' then 3
      when 'artifact_ready' then 4 when 'answer_ready' then 4 else 0
    end >=
    case generation_job_checkpoints.stage
      when 'parsed' then 1 when 'audited' then 2 when 'document_ready' then 3
      when 'artifact_ready' then 4 when 'answer_ready' then 4 else 0
    end;
  select stage, expires_at into v_checkpoint_stage, v_checkpoint_expires_at
  from public.generation_job_checkpoints where job_id = v_job.id;
  update public.generation_jobs
  set checkpoint_stage = v_checkpoint_stage,
      resume_until = v_checkpoint_expires_at,
      lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = v_job.id;
end;
$$;

create or replace function public.ai_checkpoint_exam_grading(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_payload jsonb,
  p_ttl_seconds integer default 86400
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_attempt public.exam_attempts%rowtype;
begin
  if jsonb_typeof(p_payload) <> 'object'
      or jsonb_typeof(p_payload->'result') <> 'object'
      or p_ttl_seconds < 300 or p_ttl_seconds > 604800 then
    raise exception 'INVALID_GRADING_CHECKPOINT' using errcode = '22023';
  end if;
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_attempt.status <> 'grading' or v_attempt.grading_lease_token <> p_lease_token then
    raise exception 'GRADING_LEASE_LOST' using errcode = 'P0001';
  end if;
  insert into public.exam_grading_checkpoints
    (attempt_id, user_id, payload, expires_at)
  values (
    v_attempt.id, v_attempt.user_id, p_payload,
    now() + make_interval(secs => p_ttl_seconds)
  )
  on conflict (attempt_id) do update
  set payload = excluded.payload, expires_at = excluded.expires_at, updated_at = now();
  update public.exam_attempts
  set grading_lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = v_attempt.id;
end;
$$;

create or replace function public.ai_complete_material_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_source_sha256 text,
  p_parser_version text,
  p_audit_version text,
  p_prompt_version text,
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
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status = 'succeeded' and v_job.note_id is not null then return v_job.note_id; end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if v_job.kind not in ('exam', 'knowledge_graph')
      or p_source_sha256 !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(p_artifact) <> 'object'
      or jsonb_typeof(p_canonical_document) <> 'object'
      or (v_job.kind = 'exam' and p_schema_version <> 'generated-exam.v1')
      or (v_job.kind = 'knowledge_graph' and p_schema_version <> 'generated-knowledge-graph.v1') then
    raise exception 'INVALID_AI_RESULT' using errcode = '22023';
  end if;

  if v_job.material_id is not null then
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
  insert into public.notes (user_id, course_id, generation_job_id, title, kind, material_name)
  values (v_job.user_id, v_job.course_id, v_job.id, p_title, v_note_kind, v_job.material_name)
  returning id into v_note_id;
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

create or replace function public.ai_complete_knowledge_question_job(
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
  if v_job.kind <> 'knowledge_question' or v_job.status <> 'processing'
      or v_job.lease_token <> p_lease_token or jsonb_typeof(p_answer) <> 'object' then
    raise exception 'INVALID_AI_RESULT' using errcode = '22023';
  end if;
  update public.knowledge_node_questions
  set answer = p_answer, answered_at = now()
  where id = v_job.id;
  if not found then raise exception 'KNOWLEDGE_QUESTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.quota_reserved then
    update public.ai_daily_usage
    set reserved_count = greatest(0, reserved_count - 1),
        consumed_count = consumed_count + 1, updated_at = now()
    where user_id = v_job.user_id and local_date = v_job.quota_local_date
      and kind = 'generation';
  end if;
  update public.generation_jobs
  set status = 'succeeded', stage = 'succeeded', progress = 100,
      quota_reserved = false, retryable = false, resume_until = null,
      checkpoint_stage = null, lease_token = null, lease_expires_at = null,
      finished_at = now(), updated_at = now()
  where id = v_job.id;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'succeeded', 100, 'KNOWLEDGE_QUESTION_SUCCEEDED');
end;
$$;

create or replace function public.ai_fail_generation_job_v2(
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
declare
  v_job public.generation_jobs%rowtype;
  v_can_resume boolean;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found or v_job.status in ('succeeded', 'failed', 'cancelled') then return; end if;
  if p_lease_token is not null and v_job.lease_token is distinct from p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if p_resume_seconds < 300 or p_resume_seconds > 604800 then
    raise exception 'INVALID_RESUME_TTL' using errcode = '22023';
  end if;
  if v_job.quota_reserved then
    perform public._ai_release_generation_quota(v_job.user_id, v_job.quota_local_date);
  end if;
  v_can_resume := p_retryable and v_job.attempt_count < 5;
  update public.generation_jobs
  set status = 'failed', stage = 'failed', error_code = left(p_error_code, 80),
      error_message = left(p_error_message, 500), quota_reserved = false,
      retryable = v_can_resume,
      resume_until = case when v_can_resume then now() + make_interval(secs => p_resume_seconds) else null end,
      checkpoint_stage = case when v_can_resume then checkpoint_stage else null end,
      lease_token = null, lease_expires_at = null, finished_at = now(), updated_at = now()
  where id = v_job.id;
  if v_can_resume then
    update public.generation_job_checkpoints
    set expires_at = now() + make_interval(secs => p_resume_seconds), updated_at = now()
    where job_id = v_job.id;
  end if;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'failed', v_job.progress,
    case when v_can_resume then 'RETRYABLE_' || left(p_error_code, 64) else left(p_error_code, 80) end);
end;
$$;

create or replace function public.ai_retry_generation_job(
  p_user_id uuid,
  p_job_id uuid
)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_date date;
  v_resume_interval interval;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  select * into v_job from public.generation_jobs
  where id = p_job_id and user_id = p_user_id for update;
  if not found then raise exception 'AI_JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status <> 'failed' or not v_job.retryable then
    raise exception 'AI_JOB_NOT_RESUMABLE' using errcode = 'P0001';
  end if;
  if v_job.resume_until is null or v_job.resume_until <= now() then
    update public.generation_jobs
    set retryable = false, resume_until = null, checkpoint_stage = null,
        error_code = 'AI_RESUME_EXPIRED',
        error_message = 'The saved AI progress expired', updated_at = now()
    where id = v_job.id returning * into v_job;
    return next v_job;
    return;
  end if;
  if v_job.attempt_count >= 5 or v_job.resume_count >= 3 then
    update public.generation_jobs
    set retryable = false, resume_until = null, checkpoint_stage = null,
        error_code = 'AI_WORKER_RETRY_EXHAUSTED',
        error_message = 'AI processing exhausted its safe retry limit', updated_at = now()
    where id = v_job.id returning * into v_job;
    return next v_job;
    return;
  end if;
  if exists (select 1 from public.generation_jobs
      where user_id = p_user_id and id <> p_job_id
        and status in ('queued', 'processing')) then
    raise exception 'AI_JOB_ACTIVE' using errcode = 'P0001';
  end if;
  v_resume_interval := greatest(
    interval '5 minutes',
    least(interval '7 days', v_job.resume_until - coalesce(v_job.finished_at, v_job.updated_at))
  );
  v_date := public._ai_reserve_generation_quota(p_user_id);
  update public.generation_jobs
  set status = 'queued', quota_local_date = v_date, quota_reserved = true,
      retryable = false, resume_count = resume_count + 1,
      stage = case v_job.checkpoint_stage
        when 'parsed' then 'auditing'
        when 'audited' then 'visualRecovery'
        when 'document_ready' then case when v_job.kind = 'exam' then 'generating' else 'organizing' end
        when 'artifact_ready' then 'saving'
        when 'answer_ready' then 'saving'
        else 'validating'
      end,
      resume_until = now() + v_resume_interval,
      error_code = null, error_message = null, finished_at = null,
      lease_token = null, lease_expires_at = null, accepted_at = null, updated_at = now()
  where id = v_job.id returning * into v_job;
  update public.generation_job_checkpoints
  set expires_at = v_job.resume_until, updated_at = now()
  where job_id = v_job.id;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, v_job.stage, v_job.progress, 'JOB_RESUME_QUEUED');
  return next v_job;
end;
$$;

create or replace function public.ai_expire_generation_checkpoints()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_grading_count integer;
begin
  delete from public.generation_job_checkpoints checkpoint
  using public.generation_jobs job
  where checkpoint.job_id = job.id and checkpoint.expires_at <= now()
    and job.status <> 'processing';
  get diagnostics v_count = row_count;
  delete from public.exam_grading_checkpoints checkpoint
  using public.exam_attempts attempt
  where checkpoint.attempt_id = attempt.id and checkpoint.expires_at <= now()
    and attempt.status <> 'grading';
  get diagnostics v_grading_count = row_count;
  update public.generation_jobs
  set retryable = false, resume_until = null, checkpoint_stage = null,
      error_code = 'AI_RESUME_EXPIRED',
      error_message = 'The saved AI progress expired', updated_at = now()
  where status = 'failed' and retryable and resume_until <= now();
  return v_count + v_grading_count;
end;
$$;

create or replace function public.ai_cancel_generation_job(p_user_id uuid, p_job_id uuid)
returns setof public.generation_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_job public.generation_jobs%rowtype;
begin
  select * into v_job from public.generation_jobs
  where id = p_job_id and user_id = p_user_id for update;
  if not found then raise exception 'AI_JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status in ('succeeded', 'failed', 'cancelled') then return next v_job; return; end if;
  if v_job.quota_reserved then
    perform public._ai_release_generation_quota(v_job.user_id, v_job.quota_local_date);
  end if;
  update public.generation_jobs
  set status = 'cancelled', stage = 'cancelled', quota_reserved = false,
      retryable = false, resume_until = null, checkpoint_stage = null,
      lease_token = null, lease_expires_at = null, finished_at = now(), updated_at = now()
  where id = v_job.id returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'cancelled', v_job.progress, 'JOB_CANCELLED');
  return next v_job;
end;
$$;

revoke execute on function public._ai_reserve_generation_quota(uuid) from public, anon, authenticated;
revoke execute on function public._ai_release_generation_quota(uuid, date) from public, anon, authenticated;
revoke execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, text, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.ai_create_knowledge_question_job(uuid, uuid, text, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.ai_claim_generation_job(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.ai_mark_generation_job_accepted(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ai_update_generation_job(uuid, uuid, text, integer, text) from public, anon, authenticated;
revoke execute on function public.ai_record_generation_usage(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_record_grading_usage(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_checkpoint_generation_job(uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.ai_checkpoint_exam_grading(uuid, uuid, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.ai_complete_material_generation_job(uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, jsonb, integer, integer) from public, anon, authenticated;
revoke execute on function public.ai_complete_knowledge_question_job(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_fail_generation_job_v2(uuid, uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.ai_retry_generation_job(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ai_expire_generation_checkpoints() from public, anon, authenticated;
revoke execute on function public.ai_cancel_generation_job(uuid, uuid) from public, anon, authenticated;

grant execute on function public._ai_reserve_generation_quota(uuid) to service_role;
grant execute on function public._ai_release_generation_quota(uuid, date) to service_role;
grant execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, text, jsonb, integer) to service_role;
grant execute on function public.ai_create_knowledge_question_job(uuid, uuid, text, text, uuid, text) to service_role;
grant execute on function public.ai_claim_generation_job(uuid, uuid, integer) to service_role;
grant execute on function public.ai_mark_generation_job_accepted(uuid, uuid) to service_role;
grant execute on function public.ai_update_generation_job(uuid, uuid, text, integer, text) to service_role;
grant execute on function public.ai_record_generation_usage(uuid, uuid, jsonb) to service_role;
grant execute on function public.ai_record_grading_usage(uuid, uuid, jsonb) to service_role;
grant execute on function public.ai_checkpoint_generation_job(uuid, uuid, text, jsonb, integer) to service_role;
grant execute on function public.ai_checkpoint_exam_grading(uuid, uuid, jsonb, integer) to service_role;
grant execute on function public.ai_complete_material_generation_job(uuid, uuid, text, text, text, text, jsonb, integer, integer, text, text, jsonb, integer, integer) to service_role;
grant execute on function public.ai_complete_knowledge_question_job(uuid, uuid, jsonb) to service_role;
grant execute on function public.ai_fail_generation_job_v2(uuid, uuid, text, text, boolean, integer) to service_role;
grant execute on function public.ai_retry_generation_job(uuid, uuid) to service_role;
grant execute on function public.ai_expire_generation_checkpoints() to service_role;
grant execute on function public.ai_cancel_generation_job(uuid, uuid) to service_role;

commit;
