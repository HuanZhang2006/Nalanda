-- Nalanda · 0042 Materials AI service-role workflows
-- Quota reservation/commit, idempotent generation, progress, notes, and
-- revisioned online exam attempts. Client roles cannot execute these RPCs.

create or replace function public._ai_user_timezone(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (
      select 1 from pg_catalog.pg_timezone_names z
      where z.name = coalesce((select p.timezone from public.profiles p where p.id = p_user_id), 'UTC')
    ) then coalesce((select p.timezone from public.profiles p where p.id = p_user_id), 'UTC')
    else 'UTC'
  end;
$$;

create or replace function public.ai_get_quota_summary(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_timezone text := public._ai_user_timezone(p_user_id);
  v_date date;
  v_plan public.ai_plans%rowtype;
  v_generation public.ai_daily_usage%rowtype;
  v_grading public.ai_daily_usage%rowtype;
  v_reset timestamptz;
begin
  if p_user_id is null then raise exception 'INVALID_USER' using errcode = '22023'; end if;
  v_date := timezone(v_timezone, now())::date;

  insert into public.ai_user_plans (user_id, plan_code)
  values (p_user_id, 'free') on conflict (user_id) do nothing;

  select p.* into strict v_plan
  from public.ai_plans p
  join public.ai_user_plans up on up.plan_code = p.code
  where up.user_id = p_user_id and p.active;

  insert into public.ai_daily_usage
    (user_id, local_date, kind, plan_code, limit_count, timezone)
  values
    (p_user_id, v_date, 'generation', v_plan.code, v_plan.generation_daily_limit, v_timezone),
    (p_user_id, v_date, 'grading', v_plan.code, v_plan.grading_daily_limit, v_timezone)
  on conflict (user_id, local_date, kind) do update
  set limit_count = excluded.limit_count,
      plan_code = excluded.plan_code,
      updated_at = now();

  select * into strict v_generation from public.ai_daily_usage
  where user_id = p_user_id and local_date = v_date and kind = 'generation';
  select * into strict v_grading from public.ai_daily_usage
  where user_id = p_user_id and local_date = v_date and kind = 'grading';
  v_reset := ((v_date + 1)::timestamp at time zone v_timezone);

  return jsonb_build_object(
    'plan', v_plan.code,
    'localDate', v_date,
    'timezone', v_timezone,
    'resetsAt', v_reset,
    'generation', jsonb_build_object(
      'limit', v_generation.limit_count,
      'consumed', v_generation.consumed_count,
      'reserved', v_generation.reserved_count,
      'remaining', greatest(0, v_generation.limit_count - v_generation.consumed_count - v_generation.reserved_count)
    ),
    'grading', jsonb_build_object(
      'limit', v_grading.limit_count,
      'consumed', v_grading.consumed_count,
      'reserved', v_grading.reserved_count,
      'remaining', greatest(0, v_grading.limit_count - v_grading.consumed_count - v_grading.reserved_count)
    )
  );
end;
$$;

create or replace function public.ai_get_monthly_provider_cost()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(cost_micro_usd), 0)::bigint
  from public.ai_provider_usage_events
  where created_at >= date_trunc('month', now());
$$;

create or replace function public.ai_create_generation_job(
  p_user_id uuid,
  p_material_id uuid,
  p_idempotency_key uuid,
  p_request_fingerprint text,
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
  v_timezone text := public._ai_user_timezone(p_user_id);
  v_date date;
  v_plan public.ai_plans%rowtype;
  v_usage public.ai_daily_usage%rowtype;
  v_job public.generation_jobs%rowtype;
begin
  if p_user_id is null or p_material_id is null or p_idempotency_key is null then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if p_request_fingerprint !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'INVALID_REQUEST' using errcode = '22023';
  end if;
  if p_consent_version < 1 then
    raise exception 'AI_PROCESSING_CONSENT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Serialize one user's create requests so the idempotency replay check and
  -- one-active-job invariant remain deterministic under concurrent retries.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_existing from public.generation_jobs
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint <> p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return next v_existing;
    return;
  end if;

  select * into v_material from public.materials
  where id = p_material_id and user_id = p_user_id;
  if not found then raise exception 'MATERIAL_NOT_FOUND' using errcode = 'P0002'; end if;

  if exists (
    select 1 from public.generation_jobs
    where user_id = p_user_id and status in ('queued', 'processing')
  ) then
    raise exception 'AI_JOB_ACTIVE' using errcode = 'P0001';
  end if;

  insert into public.ai_user_plans (user_id, plan_code, consent_version, consented_at)
  values (p_user_id, 'free', p_consent_version, now())
  on conflict (user_id) do update
  set consent_version = greatest(public.ai_user_plans.consent_version, excluded.consent_version),
      consented_at = case when excluded.consent_version > public.ai_user_plans.consent_version
        then excluded.consented_at else public.ai_user_plans.consented_at end,
      updated_at = now();

  select p.* into strict v_plan
  from public.ai_plans p
  join public.ai_user_plans up on up.plan_code = p.code
  where up.user_id = p_user_id and p.active;
  v_date := timezone(v_timezone, now())::date;

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
  update public.ai_daily_usage set reserved_count = reserved_count + 1, updated_at = now()
  where user_id = p_user_id and local_date = v_date and kind = 'generation';

  insert into public.generation_jobs (
    user_id, material_id, course_id, material_name, settings,
    idempotency_key, request_fingerprint, consent_version, quota_local_date
  ) values (
    p_user_id, v_material.id, v_material.course_id, v_material.name, p_settings,
    p_idempotency_key, p_request_fingerprint, p_consent_version, v_date
  ) returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'queued', 0, 'JOB_CREATED');
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
  if v_job.attempt_count >= 3 then
    if v_job.quota_reserved then
      update public.ai_daily_usage
      set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
      where user_id = v_job.user_id and local_date = v_job.quota_local_date and kind = 'generation';
    end if;
    update public.generation_jobs
    set status = 'failed', stage = 'failed', error_code = 'AI_WORKER_RETRY_EXHAUSTED',
        error_message = 'AI processing could not recover after repeated worker restarts',
        quota_reserved = false, lease_token = null, lease_expires_at = null,
        finished_at = now(), updated_at = now()
    where id = p_job_id;
    insert into public.generation_job_events (job_id, stage, progress, event_code)
    values (p_job_id, 'failed', v_job.progress, 'AI_WORKER_RETRY_EXHAUSTED');
    return;
  end if;
  update public.generation_jobs
  set status = 'processing', stage = 'validating', progress = greatest(progress, 2),
      lease_token = p_lease_token, lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1, started_at = coalesce(started_at, now()), updated_at = now()
  where id = p_job_id returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, v_job.stage, v_job.progress, 'JOB_CLAIMED');
  return next v_job;
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
      'generating', 'reviewing', 'saving') or p_progress < 0 or p_progress > 99 then
    raise exception 'INVALID_PROGRESS' using errcode = '22023';
  end if;
  update public.generation_jobs
  set stage = p_stage, progress = greatest(progress, p_progress),
      lease_expires_at = now() + interval '15 minutes', updated_at = now()
  where id = p_job_id and status = 'processing' and lease_token = p_lease_token;
  if not found then raise exception 'JOB_LEASE_LOST' using errcode = 'P0001'; end if;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (p_job_id, p_stage, p_progress, p_event_code);
end;
$$;

create or replace function public._ai_record_usage_events(
  p_user_id uuid,
  p_job_id uuid,
  p_attempt_id uuid,
  p_events jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_event jsonb;
begin
  if p_events is null then return; end if;
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'INVALID_USAGE_EVENTS' using errcode = '22023';
  end if;
  for v_event in select value from jsonb_array_elements(p_events) loop
    insert into public.ai_provider_usage_events (
      user_id, job_id, attempt_id, purpose, model, provider_request_id,
      prompt_tokens, completion_tokens, total_tokens, cost_micro_usd,
      duration_ms, zdr_enforced, status, error_code
    ) values (
      p_user_id, p_job_id, p_attempt_id,
      v_event->>'purpose', v_event->>'model', nullif(v_event->>'requestId', ''),
      nullif(v_event->>'promptTokens', '')::bigint,
      nullif(v_event->>'completionTokens', '')::bigint,
      nullif(v_event->>'totalTokens', '')::bigint,
      nullif(v_event->>'costMicroUsd', '')::bigint,
      coalesce((v_event->>'durationMs')::integer, 0),
      coalesce((v_event->>'zdrEnforced')::boolean, true),
      coalesce(v_event->>'status', 'succeeded'), nullif(v_event->>'errorCode', '')
    );
  end loop;
end;
$$;

create or replace function public.ai_complete_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_source_sha256 text,
  p_parser_version text,
  p_audit_version text,
  p_canonical_document jsonb,
  p_block_count integer,
  p_visual_region_count integer,
  p_title text,
  p_exam jsonb,
  p_question_count integer,
  p_total_marks integer,
  p_usage_events jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.generation_jobs%rowtype;
  v_note_id uuid;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found then raise exception 'JOB_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_job.status = 'succeeded' and v_job.note_id is not null then return v_job.note_id; end if;
  if v_job.status <> 'processing' or v_job.lease_token <> p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if p_source_sha256 !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_exam) <> 'object'
      or jsonb_typeof(p_canonical_document) <> 'object' then
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

  insert into public.notes (
    user_id, course_id, generation_job_id, title, material_name
  ) values (
    v_job.user_id, v_job.course_id, v_job.id, p_title, v_job.material_name
  ) returning id into v_note_id;
  insert into public.note_materials (note_id, material_id, material_name, source_sha256)
  values (v_note_id, v_job.material_id, v_job.material_name, p_source_sha256);
  insert into public.note_artifacts (
    note_id, schema_version, content, question_count, total_marks
  ) values (v_note_id, 'generated-exam.v1', p_exam, p_question_count, p_total_marks);

  if v_job.quota_reserved then
    update public.ai_daily_usage
    set reserved_count = greatest(0, reserved_count - 1),
        consumed_count = consumed_count + 1, updated_at = now()
    where user_id = v_job.user_id and local_date = v_job.quota_local_date
      and kind = 'generation';
  end if;
  perform public._ai_record_usage_events(v_job.user_id, v_job.id, null, p_usage_events);
  update public.generation_jobs
  set status = 'succeeded', stage = 'succeeded', progress = 100,
      source_sha256 = p_source_sha256, parser_version = p_parser_version,
      note_id = v_note_id, quota_reserved = false, lease_token = null,
      lease_expires_at = null, finished_at = now(), updated_at = now()
  where id = v_job.id;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'succeeded', 100, 'JOB_SUCCEEDED');
  return v_note_id;
end;
$$;

create or replace function public.ai_fail_generation_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_usage_events jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_job public.generation_jobs%rowtype;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if not found or v_job.status in ('succeeded', 'failed', 'cancelled') then return; end if;
  if p_lease_token is not null and v_job.lease_token is distinct from p_lease_token then
    raise exception 'JOB_LEASE_LOST' using errcode = 'P0001';
  end if;
  if v_job.quota_reserved then
    update public.ai_daily_usage set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
    where user_id = v_job.user_id and local_date = v_job.quota_local_date and kind = 'generation';
  end if;
  perform public._ai_record_usage_events(v_job.user_id, v_job.id, null, p_usage_events);
  update public.generation_jobs
  set status = 'failed', stage = 'failed', error_code = left(p_error_code, 80),
      error_message = left(p_error_message, 500), quota_reserved = false,
      lease_token = null, lease_expires_at = null, finished_at = now(), updated_at = now()
  where id = v_job.id;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'failed', v_job.progress, left(p_error_code, 80));
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
    update public.ai_daily_usage set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
    where user_id = v_job.user_id and local_date = v_job.quota_local_date and kind = 'generation';
  end if;
  update public.generation_jobs
  set status = 'cancelled', stage = 'cancelled', quota_reserved = false,
      lease_token = null, lease_expires_at = null, finished_at = now(), updated_at = now()
  where id = v_job.id returning * into v_job;
  insert into public.generation_job_events (job_id, stage, progress, event_code)
  values (v_job.id, 'cancelled', v_job.progress, 'JOB_CANCELLED');
  return next v_job;
end;
$$;

create or replace function public.ai_create_exam_attempt(p_user_id uuid, p_note_id uuid)
returns setof public.exam_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_artifact public.note_artifacts%rowtype;
  v_attempt public.exam_attempts%rowtype;
  v_number integer;
  v_duration integer;
begin
  perform 1 from public.notes where id = p_note_id and user_id = p_user_id for update;
  if not found then raise exception 'NOTE_NOT_FOUND' using errcode = 'P0002'; end if;
  select a.* into v_artifact from public.note_artifacts a
  join public.notes n on n.id = a.note_id
  where a.note_id = p_note_id and n.user_id = p_user_id;
  if not found then raise exception 'NOTE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_duration := greatest(15, least(240, coalesce((v_artifact.content->>'durationMinutes')::integer, 60)));
  select coalesce(max(attempt_number), 0) + 1 into v_number
  from public.exam_attempts where user_id = p_user_id and note_id = p_note_id;
  insert into public.exam_attempts (
    user_id, note_id, attempt_number, deadline_at, total_marks
  ) values (
    p_user_id, p_note_id, v_number, now() + make_interval(mins => v_duration),
    v_artifact.total_marks
  ) returning * into v_attempt;
  return next v_attempt;
end;
$$;

create or replace function public.ai_save_exam_answers(
  p_user_id uuid,
  p_attempt_id uuid,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_replay jsonb;
  v_answer jsonb;
  v_response jsonb;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and user_id = p_user_id for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  select response_payload into v_replay from public.exam_attempt_operations
  where attempt_id = p_attempt_id and operation_id = p_operation_id;
  if found then return v_replay; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'EXAM_ATTEMPT_CLOSED' using errcode = 'P0001'; end if;
  if v_attempt.deadline_at <= now() then raise exception 'EXAM_ATTEMPT_EXPIRED' using errcode = 'P0001'; end if;
  if v_attempt.revision <> p_expected_revision then raise exception 'EXAM_REVISION_CONFLICT' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) > 100 then
    raise exception 'INVALID_EXAM_ANSWERS' using errcode = '22023';
  end if;
  for v_answer in select value from jsonb_array_elements(p_answers) loop
    if not exists (
      select 1 from public.note_artifacts na,
        jsonb_array_elements(na.content->'sections') s,
        jsonb_array_elements(s->'questions') q
      where na.note_id = v_attempt.note_id and q->>'id' = v_answer->>'questionId'
    ) then raise exception 'INVALID_EXAM_QUESTION' using errcode = '22023'; end if;
    insert into public.exam_attempt_answers (attempt_id, question_id, answer)
    values (v_attempt.id, v_answer->>'questionId', coalesce(v_answer->'value', 'null'::jsonb))
    on conflict (attempt_id, question_id) do update
    set answer = excluded.answer, updated_at = now();
  end loop;
  update public.exam_attempts set revision = revision + 1, updated_at = now()
  where id = v_attempt.id returning * into v_attempt;
  v_response := jsonb_build_object('attemptId', v_attempt.id, 'revision', v_attempt.revision,
    'status', v_attempt.status, 'savedAt', now());
  insert into public.exam_attempt_operations (attempt_id, operation_id, operation_kind, response_payload)
  values (v_attempt.id, p_operation_id, 'save', v_response);
  return v_response;
end;
$$;

create or replace function public.ai_submit_exam_attempt(
  p_user_id uuid,
  p_attempt_id uuid,
  p_operation_id uuid,
  p_expected_revision bigint,
  p_results jsonb,
  p_objective_score numeric,
  p_objective_marks integer,
  p_needs_grading boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_replay jsonb;
  v_result jsonb;
  v_timezone text := public._ai_user_timezone(p_user_id);
  v_date date;
  v_plan public.ai_plans%rowtype;
  v_usage public.ai_daily_usage%rowtype;
  v_reserved boolean := false;
  v_response jsonb;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and user_id = p_user_id for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  select response_payload into v_replay from public.exam_attempt_operations
  where attempt_id = p_attempt_id and operation_id = p_operation_id;
  if found then return v_replay; end if;
  if v_attempt.status <> 'in_progress' then raise exception 'EXAM_ATTEMPT_CLOSED' using errcode = 'P0001'; end if;
  if v_attempt.revision <> p_expected_revision then raise exception 'EXAM_REVISION_CONFLICT' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_results) <> 'array' or p_objective_score < 0 or p_objective_marks < 0 then
    raise exception 'INVALID_EXAM_RESULT' using errcode = '22023';
  end if;
  for v_result in select value from jsonb_array_elements(p_results) loop
    update public.exam_attempt_answers
    set awarded_marks = nullif(v_result->>'awardedMarks', '')::numeric,
        correct = nullif(v_result->>'correct', '')::boolean,
        feedback = left(nullif(v_result->>'feedback', ''), 1000), updated_at = now()
    where attempt_id = v_attempt.id and question_id = v_result->>'questionId';
  end loop;

  if p_needs_grading then
    v_date := timezone(v_timezone, now())::date;
    select p.* into strict v_plan from public.ai_plans p
    join public.ai_user_plans up on up.plan_code = p.code
    where up.user_id = p_user_id and p.active;
    insert into public.ai_daily_usage
      (user_id, local_date, kind, plan_code, limit_count, timezone)
    values (p_user_id, v_date, 'grading', v_plan.code, v_plan.grading_daily_limit, v_timezone)
    on conflict (user_id, local_date, kind) do update
    set limit_count = excluded.limit_count, plan_code = excluded.plan_code, updated_at = now();
    select * into strict v_usage from public.ai_daily_usage
    where user_id = p_user_id and local_date = v_date and kind = 'grading' for update;
    if v_usage.consumed_count + v_usage.reserved_count < v_usage.limit_count then
      update public.ai_daily_usage set reserved_count = reserved_count + 1, updated_at = now()
      where user_id = p_user_id and local_date = v_date and kind = 'grading';
      v_reserved := true;
    end if;
  end if;

  update public.exam_attempts
  set status = case when p_needs_grading and v_reserved then 'grading'
                    when p_needs_grading then 'submitted_ungraded' else 'completed' end,
      revision = revision + 1, objective_score = p_objective_score,
      objective_marks = p_objective_marks,
      total_score = case when p_needs_grading then null else p_objective_score end,
      grading_quota_local_date = case when v_reserved then v_date else null end,
      grading_quota_reserved = v_reserved,
      submitted_at = now(), completed_at = case when p_needs_grading then null else now() end,
      updated_at = now()
  where id = v_attempt.id returning * into v_attempt;
  v_response := jsonb_build_object('attemptId', v_attempt.id, 'revision', v_attempt.revision,
    'status', v_attempt.status, 'gradingReserved', v_reserved,
    'objectiveScore', v_attempt.objective_score, 'objectiveMarks', v_attempt.objective_marks);
  insert into public.exam_attempt_operations (attempt_id, operation_id, operation_kind, response_payload)
  values (v_attempt.id, p_operation_id, 'submit', v_response);
  return v_response;
end;
$$;

create or replace function public.ai_claim_exam_grading(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
)
returns setof public.exam_attempts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_attempt public.exam_attempts%rowtype;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'grading' or not v_attempt.grading_quota_reserved then return; end if;
  if v_attempt.grading_lease_expires_at > now() then return; end if;
  if v_attempt.grading_attempt_count >= 3 then
    update public.ai_daily_usage
    set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
    where user_id = v_attempt.user_id and local_date = v_attempt.grading_quota_local_date and kind = 'grading';
    update public.exam_attempts
    set status = 'submitted_ungraded', grading_quota_reserved = false,
        grading_lease_token = null, grading_lease_expires_at = null, updated_at = now()
    where id = p_attempt_id;
    return;
  end if;
  update public.exam_attempts
  set grading_lease_token = p_lease_token,
      grading_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      grading_attempt_count = grading_attempt_count + 1, updated_at = now()
  where id = p_attempt_id returning * into v_attempt;
  return next v_attempt;
end;
$$;

create or replace function public.ai_request_exam_grading(
  p_user_id uuid,
  p_attempt_id uuid,
  p_operation_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_attempt public.exam_attempts%rowtype;
  v_replay jsonb;
  v_timezone text := public._ai_user_timezone(p_user_id);
  v_date date := timezone(v_timezone, now())::date;
  v_plan public.ai_plans%rowtype;
  v_usage public.ai_daily_usage%rowtype;
  v_response jsonb;
begin
  select * into v_attempt from public.exam_attempts
  where id = p_attempt_id and user_id = p_user_id for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  select response_payload into v_replay
  from public.exam_attempt_operations
  where attempt_id = p_attempt_id and operation_id = p_operation_id;
  if found then return v_replay; end if;
  if v_attempt.status <> 'submitted_ungraded' then
    raise exception 'EXAM_GRADING_NOT_AVAILABLE' using errcode = 'P0001';
  end if;
  if v_attempt.revision <> p_expected_revision then
    raise exception 'EXAM_REVISION_CONFLICT' using errcode = 'P0001';
  end if;

  select p.* into strict v_plan from public.ai_plans p
  join public.ai_user_plans up on up.plan_code = p.code
  where up.user_id = p_user_id and p.active;
  insert into public.ai_daily_usage
    (user_id, local_date, kind, plan_code, limit_count, timezone)
  values (p_user_id, v_date, 'grading', v_plan.code, v_plan.grading_daily_limit, v_timezone)
  on conflict (user_id, local_date, kind) do update
  set limit_count = excluded.limit_count, plan_code = excluded.plan_code, updated_at = now();
  select * into strict v_usage from public.ai_daily_usage
  where user_id = p_user_id and local_date = v_date and kind = 'grading' for update;
  if v_usage.consumed_count + v_usage.reserved_count >= v_usage.limit_count then
    raise exception 'AI_GRADING_QUOTA_EXCEEDED' using errcode = 'P0001';
  end if;

  update public.ai_daily_usage
  set reserved_count = reserved_count + 1, updated_at = now()
  where user_id = p_user_id and local_date = v_date and kind = 'grading';
  update public.exam_attempts
  set status = 'grading', revision = revision + 1,
      grading_quota_local_date = v_date, grading_quota_reserved = true,
      grading_lease_token = null, grading_lease_expires_at = null, updated_at = now()
  where id = v_attempt.id returning * into v_attempt;

  v_response := jsonb_build_object(
    'attemptId', v_attempt.id, 'revision', v_attempt.revision,
    'status', v_attempt.status, 'gradingReserved', true
  );
  insert into public.exam_attempt_operations
    (attempt_id, operation_id, operation_kind, response_payload)
  values (v_attempt.id, p_operation_id, 'grade', v_response);
  return v_response;
end;
$$;

create or replace function public.ai_complete_exam_grading(
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
  v_result jsonb;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found then raise exception 'EXAM_ATTEMPT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_attempt.status = 'completed' then return; end if;
  if v_attempt.status <> 'grading' or v_attempt.grading_lease_token <> p_lease_token then
    raise exception 'GRADING_LEASE_LOST' using errcode = 'P0001';
  end if;
  for v_result in select value from jsonb_array_elements(p_results) loop
    update public.exam_attempt_answers
    set awarded_marks = (v_result->>'awardedMarks')::numeric,
        correct = nullif(v_result->>'correct', '')::boolean,
        feedback = left(v_result->>'feedback', 1000), updated_at = now()
    where attempt_id = v_attempt.id and question_id = v_result->>'questionId';
  end loop;
  if v_attempt.grading_quota_reserved then
    update public.ai_daily_usage
    set reserved_count = greatest(0, reserved_count - 1), consumed_count = consumed_count + 1, updated_at = now()
    where user_id = v_attempt.user_id and local_date = v_attempt.grading_quota_local_date and kind = 'grading';
  end if;
  perform public._ai_record_usage_events(v_attempt.user_id, null, v_attempt.id, p_usage_events);
  update public.exam_attempts
  set status = 'completed', total_score = least(total_marks, greatest(0, objective_score + p_subjective_score)),
      grading_quota_reserved = false, grading_lease_token = null,
      grading_lease_expires_at = null, completed_at = now(), updated_at = now()
  where id = v_attempt.id;
end;
$$;

create or replace function public.ai_fail_exam_grading(
  p_attempt_id uuid,
  p_lease_token uuid,
  p_usage_events jsonb default '[]'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_attempt public.exam_attempts%rowtype;
begin
  select * into v_attempt from public.exam_attempts where id = p_attempt_id for update;
  if not found or v_attempt.status <> 'grading' then return; end if;
  if v_attempt.grading_lease_token <> p_lease_token then
    raise exception 'GRADING_LEASE_LOST' using errcode = 'P0001';
  end if;
  if v_attempt.grading_quota_reserved then
    update public.ai_daily_usage set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
    where user_id = v_attempt.user_id and local_date = v_attempt.grading_quota_local_date and kind = 'grading';
  end if;
  perform public._ai_record_usage_events(v_attempt.user_id, null, v_attempt.id, p_usage_events);
  update public.exam_attempts
  set status = 'submitted_ungraded', grading_quota_reserved = false,
      grading_lease_token = null, grading_lease_expires_at = null, updated_at = now()
  where id = v_attempt.id;
end;
$$;

create or replace function public.ai_delete_note(p_user_id uuid, p_note_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.notes where id = p_note_id and user_id = p_user_id;
  if not found then raise exception 'NOTE_NOT_FOUND' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.ai_delete_material(
  p_user_id uuid,
  p_material_id uuid,
  p_delete_results boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_material public.materials%rowtype;
  v_job public.generation_jobs%rowtype;
begin
  select * into v_material from public.materials
  where id = p_material_id and user_id = p_user_id for update;
  if not found then raise exception 'MATERIAL_NOT_FOUND' using errcode = 'P0002'; end if;

  for v_job in select * from public.generation_jobs
    where material_id = p_material_id and status in ('queued', 'processing') for update
  loop
    if v_job.quota_reserved then
      update public.ai_daily_usage
      set reserved_count = greatest(0, reserved_count - 1), updated_at = now()
      where user_id = v_job.user_id and local_date = v_job.quota_local_date and kind = 'generation';
    end if;
    update public.generation_jobs
    set status = 'cancelled', stage = 'cancelled', quota_reserved = false,
        lease_token = null, lease_expires_at = null, finished_at = now(), updated_at = now()
    where id = v_job.id;
    insert into public.generation_job_events (job_id, stage, progress, event_code)
    values (v_job.id, 'cancelled', v_job.progress, 'SOURCE_DELETED');
  end loop;

  if p_delete_results then
    delete from public.notes n where n.user_id = p_user_id and exists (
      select 1 from public.note_materials nm
      where nm.note_id = n.id and nm.material_id = p_material_id
    );
  else
    update public.notes n
    set course_id = null, updated_at = now()
    where n.user_id = p_user_id and exists (
      select 1 from public.note_materials nm
      where nm.note_id = n.id and nm.material_id = p_material_id
    );
  end if;
  delete from public.materials where id = p_material_id;
  return v_material.storage_path;
end;
$$;

create or replace function public.ai_delete_material_course(
  p_user_id uuid,
  p_course_id uuid,
  p_delete_results boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_material public.materials%rowtype;
  v_paths jsonb := '[]'::jsonb;
begin
  perform 1 from public.courses where id = p_course_id and user_id = p_user_id for update;
  if not found then raise exception 'COURSE_NOT_FOUND' using errcode = 'P0002'; end if;
  for v_material in select * from public.materials
    where course_id = p_course_id and user_id = p_user_id order by id
  loop
    v_paths := v_paths || jsonb_build_array(public.ai_delete_material(p_user_id, v_material.id, p_delete_results));
  end loop;
  if p_delete_results then
    delete from public.notes where user_id = p_user_id and course_id = p_course_id;
  end if;
  delete from public.courses where id = p_course_id and user_id = p_user_id;
  return v_paths;
end;
$$;

-- Deletion must pass through the service-role transaction above so unfinished
-- jobs cannot strand quota reservations. Existing client create/update/read
-- behavior remains unchanged.
revoke delete on table public.materials, public.courses from authenticated;

revoke execute on function public._ai_user_timezone(uuid) from public, anon, authenticated;
revoke execute on function public.ai_get_quota_summary(uuid) from public, anon, authenticated;
revoke execute on function public.ai_get_monthly_provider_cost() from public, anon, authenticated;
revoke execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, jsonb, integer) from public, anon, authenticated;
revoke execute on function public.ai_claim_generation_job(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.ai_update_generation_job(uuid, uuid, text, integer, text) from public, anon, authenticated;
revoke execute on function public._ai_record_usage_events(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_complete_generation_job(uuid, uuid, text, text, text, jsonb, integer, integer, text, jsonb, integer, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_fail_generation_job(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_cancel_generation_job(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ai_create_exam_attempt(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ai_save_exam_answers(uuid, uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_submit_exam_attempt(uuid, uuid, uuid, bigint, jsonb, numeric, integer, boolean) from public, anon, authenticated;
revoke execute on function public.ai_claim_exam_grading(uuid, uuid, integer) from public, anon, authenticated;
revoke execute on function public.ai_request_exam_grading(uuid, uuid, uuid, bigint) from public, anon, authenticated;
revoke execute on function public.ai_complete_exam_grading(uuid, uuid, numeric, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_fail_exam_grading(uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.ai_delete_note(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.ai_delete_material(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.ai_delete_material_course(uuid, uuid, boolean) from public, anon, authenticated;

grant execute on function public._ai_user_timezone(uuid) to service_role;
grant execute on function public.ai_get_quota_summary(uuid) to service_role;
grant execute on function public.ai_get_monthly_provider_cost() to service_role;
grant execute on function public.ai_create_generation_job(uuid, uuid, uuid, text, jsonb, integer) to service_role;
grant execute on function public.ai_claim_generation_job(uuid, uuid, integer) to service_role;
grant execute on function public.ai_update_generation_job(uuid, uuid, text, integer, text) to service_role;
grant execute on function public._ai_record_usage_events(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.ai_complete_generation_job(uuid, uuid, text, text, text, jsonb, integer, integer, text, jsonb, integer, integer, jsonb) to service_role;
grant execute on function public.ai_fail_generation_job(uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.ai_cancel_generation_job(uuid, uuid) to service_role;
grant execute on function public.ai_create_exam_attempt(uuid, uuid) to service_role;
grant execute on function public.ai_save_exam_answers(uuid, uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.ai_submit_exam_attempt(uuid, uuid, uuid, bigint, jsonb, numeric, integer, boolean) to service_role;
grant execute on function public.ai_claim_exam_grading(uuid, uuid, integer) to service_role;
grant execute on function public.ai_request_exam_grading(uuid, uuid, uuid, bigint) to service_role;
grant execute on function public.ai_complete_exam_grading(uuid, uuid, numeric, jsonb, jsonb) to service_role;
grant execute on function public.ai_fail_exam_grading(uuid, uuid, jsonb) to service_role;
grant execute on function public.ai_delete_note(uuid, uuid) to service_role;
grant execute on function public.ai_delete_material(uuid, uuid, boolean) to service_role;
grant execute on function public.ai_delete_material_course(uuid, uuid, boolean) to service_role;
