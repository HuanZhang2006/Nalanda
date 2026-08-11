-- Nalanda · 0043 Materials AI release assertions
-- Fails migration application if client roles can forge jobs, quota, results,
-- provider usage, parse cache, or server-only workflow execution.

do $$
declare
  v_table text;
  v_function regprocedure;
begin
  foreach v_table in array array[
    'ai_user_plans', 'ai_daily_usage', 'generation_jobs',
    'generation_job_events', 'ai_material_parse_cache', 'notes',
    'note_materials', 'note_artifacts', 'exam_attempts',
    'exam_attempt_answers', 'exam_attempt_operations',
    'ai_provider_usage_events'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = v_table
        and c.relrowsecurity
    ) then
      raise exception 'Materials AI table % is missing RLS', v_table;
    end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT,UPDATE,DELETE') then
      raise exception 'Materials AI table % is client writable', v_table;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.materials', 'DELETE')
     or has_table_privilege('authenticated', 'public.courses', 'DELETE') then
    raise exception 'Materials deletion must remain service mediated';
  end if;

  -- Cost/budget facts outlive user-selected Notes and attempts. Their subject
  -- UUIDs must therefore remain immutable audit identifiers, not FKs that are
  -- nulled (breaking XOR) or cascaded (allowing cost history to disappear).
  if exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.ai_provider_usage_events'::regclass
      and c.contype = 'f'
      and pg_catalog.pg_get_constraintdef(c.oid) ~ 'FOREIGN KEY \((job_id|attempt_id)\)'
  ) then
    raise exception 'Provider usage subject identifiers must not follow content deletion';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.ai_provider_usage_events'::regclass
      and c.conname = 'ai_provider_usage_event_subject_check'
  ) then
    raise exception 'Provider usage exact-one-subject constraint is missing';
  end if;

  foreach v_function in array array[
    'public._ai_create_user_plan()'::regprocedure,
    'public._ai_user_timezone(uuid)'::regprocedure,
    'public.ai_get_quota_summary(uuid)'::regprocedure,
    'public.ai_get_monthly_provider_cost()'::regprocedure,
    'public.ai_create_generation_job(uuid,uuid,uuid,text,jsonb,integer)'::regprocedure,
    'public.ai_claim_generation_job(uuid,uuid,integer)'::regprocedure,
    'public.ai_update_generation_job(uuid,uuid,text,integer,text)'::regprocedure,
    'public._ai_record_usage_events(uuid,uuid,uuid,jsonb)'::regprocedure,
    'public.ai_complete_generation_job(uuid,uuid,text,text,text,jsonb,integer,integer,text,jsonb,integer,integer,jsonb)'::regprocedure,
    'public.ai_fail_generation_job(uuid,uuid,text,text,jsonb)'::regprocedure,
    'public.ai_cancel_generation_job(uuid,uuid)'::regprocedure,
    'public.ai_create_exam_attempt(uuid,uuid)'::regprocedure,
    'public.ai_save_exam_answers(uuid,uuid,uuid,bigint,jsonb)'::regprocedure,
    'public.ai_submit_exam_attempt(uuid,uuid,uuid,bigint,jsonb,numeric,integer,boolean)'::regprocedure,
    'public.ai_claim_exam_grading(uuid,uuid,integer)'::regprocedure,
    'public.ai_request_exam_grading(uuid,uuid,uuid,bigint)'::regprocedure,
    'public.ai_complete_exam_grading(uuid,uuid,numeric,jsonb,jsonb)'::regprocedure,
    'public.ai_fail_exam_grading(uuid,uuid,jsonb)'::regprocedure,
    'public.ai_delete_note(uuid,uuid)'::regprocedure,
    'public.ai_delete_material(uuid,uuid,boolean)'::regprocedure,
    'public.ai_delete_material_course(uuid,uuid,boolean)'::regprocedure
  ] loop
    if has_function_privilege('public', v_function, 'EXECUTE')
       or has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'Materials AI RPC % is client executable', v_function;
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Materials AI RPC % is unavailable to service_role', v_function;
    end if;
  end loop;

  if not exists (
    select 1 from public.ai_plans
    where code = 'free' and generation_daily_limit = 10
      and grading_daily_limit = 10 and active
  ) then
    raise exception 'Materials AI free plan is not configured as 10/10';
  end if;

  if exists (
    select 1 from auth.users u
    left join public.ai_user_plans p on p.user_id = u.id
    where p.user_id is null or p.plan_code <> 'free'
  ) then
    raise exception 'Existing user is missing the default free AI plan';
  end if;
end;
$$;
