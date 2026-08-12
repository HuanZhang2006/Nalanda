-- Fail-closed structural and privilege assertions for 0046-0047.

do $$
declare
  v_name text;
  v_proc regprocedure;
begin
  foreach v_name in array array[
    'generation_job_checkpoints', 'exam_grading_checkpoints', 'knowledge_node_questions'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'missing Materials AI resume table: %', v_name;
    end if;
    if not (select relrowsecurity from pg_class where oid = to_regclass('public.' || v_name)) then
      raise exception 'RLS disabled on %', v_name;
    end if;
  end loop;

  foreach v_name in array array[
    'retryable', 'resume_until', 'checkpoint_stage', 'resume_count', 'accepted_at'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'generation_jobs' and column_name = v_name
    ) then raise exception 'generation_jobs missing %', v_name; end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_provider_usage_events'
      and column_name = 'event_id' and is_nullable = 'NO'
  ) then raise exception 'provider usage event_id is not required'; end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'ai_provider_usage_events'
      and indexname = 'ai_provider_usage_events_event_id_idx'
  ) then raise exception 'provider usage event idempotency index missing'; end if;

  foreach v_proc in array array[
    'public.ai_create_generation_job(uuid,uuid,uuid,text,text,jsonb,integer)'::regprocedure,
    'public.ai_create_knowledge_question_job(uuid,uuid,text,text,uuid,text)'::regprocedure,
    'public.ai_mark_generation_job_accepted(uuid,uuid)'::regprocedure,
    'public.ai_record_generation_usage(uuid,uuid,jsonb)'::regprocedure,
    'public.ai_record_grading_usage(uuid,uuid,jsonb)'::regprocedure,
    'public.ai_checkpoint_generation_job(uuid,uuid,text,jsonb,integer)'::regprocedure,
    'public.ai_checkpoint_exam_grading(uuid,uuid,jsonb,integer)'::regprocedure,
    'public.ai_complete_material_generation_job(uuid,uuid,text,text,text,text,jsonb,integer,integer,text,text,jsonb,integer,integer)'::regprocedure,
    'public.ai_complete_knowledge_question_job(uuid,uuid,jsonb)'::regprocedure,
    'public.ai_fail_generation_job_v2(uuid,uuid,text,text,boolean,integer)'::regprocedure,
    'public.ai_retry_generation_job(uuid,uuid)'::regprocedure,
    'public.ai_expire_generation_checkpoints()'::regprocedure
  ] loop
    if has_function_privilege('public', v_proc, 'EXECUTE')
        or has_function_privilege('anon', v_proc, 'EXECUTE')
        or has_function_privilege('authenticated', v_proc, 'EXECUTE') then
      raise exception 'client can execute internal Materials AI function %', v_proc;
    end if;
    if not has_function_privilege('service_role', v_proc, 'EXECUTE') then
      raise exception 'service_role cannot execute Materials AI function %', v_proc;
    end if;
  end loop;

  if has_table_privilege('authenticated', 'public.generation_job_checkpoints', 'SELECT')
      or has_table_privilege('authenticated', 'public.generation_job_checkpoints', 'INSERT')
      or has_table_privilege('authenticated', 'public.generation_job_checkpoints', 'UPDATE')
      or has_table_privilege('authenticated', 'public.generation_job_checkpoints', 'DELETE') then
    raise exception 'authenticated can access private generation checkpoints';
  end if;
  if has_table_privilege('authenticated', 'public.exam_grading_checkpoints', 'SELECT')
      or has_table_privilege('authenticated', 'public.exam_grading_checkpoints', 'INSERT')
      or has_table_privilege('authenticated', 'public.exam_grading_checkpoints', 'UPDATE')
      or has_table_privilege('authenticated', 'public.exam_grading_checkpoints', 'DELETE') then
    raise exception 'authenticated can access private grading checkpoints';
  end if;
  if has_table_privilege('authenticated', 'public.knowledge_node_questions', 'INSERT')
      or has_table_privilege('authenticated', 'public.knowledge_node_questions', 'UPDATE')
      or has_table_privilege('authenticated', 'public.knowledge_node_questions', 'DELETE') then
    raise exception 'authenticated can mutate knowledge questions';
  end if;
  if not has_table_privilege('authenticated', 'public.knowledge_node_questions', 'SELECT') then
    raise exception 'authenticated cannot read owner knowledge questions';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.generation_jobs'::regclass
      and tgname = 'generation_jobs_cleanup_checkpoint' and not tgisinternal
  ) then raise exception 'terminal checkpoint cleanup trigger missing'; end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.exam_attempts'::regclass
      and tgname = 'exam_attempts_cleanup_grading_checkpoint' and not tgisinternal
  ) then raise exception 'terminal grading checkpoint cleanup trigger missing'; end if;
end;
$$;
