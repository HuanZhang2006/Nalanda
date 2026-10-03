-- Nalanda · 0057 structural, routing and privilege assertions for 0056.

do $$
declare
  v_constraint text;
  v_definition text;
  v_function text;
begin
  foreach v_constraint in array array[
    'generation_jobs_pipeline_check',
    'notes_pipeline_check',
    'ai_provider_usage_events_pipeline_check'
  ] loop
    select pg_get_constraintdef(constraint_row.oid) into v_definition
    from pg_constraint constraint_row
    join pg_namespace namespace on namespace.oid = constraint_row.connamespace
    where namespace.nspname = 'public'
      and constraint_row.conname = v_constraint;
    if v_definition is null
        or v_definition not like '%luna_native_file_v1%'
        or v_definition like '%ox_alpha_native_file_v1%' then
      raise exception 'Pipeline constraint is not Luna-only: %', v_constraint;
    end if;
  end loop;

  select pg_get_functiondef(
    'public.ai_create_generation_job(uuid,uuid,uuid,text,text,jsonb,integer,text)'::regprocedure
  ) into v_definition;
  if v_definition not like '%openai/gpt-6-luna%'
      or v_definition like '%gpt-5.6-luna%'
      or v_definition like '%ox_alpha_native_file_v1%'
      or v_definition like '%stealth/ox-alpha%' then
    raise exception 'Luna create-job model mapping is not GPT-6 Luna only';
  end if;

  foreach v_function in array array[
    'public.ai_complete_material_generation_job_v2(uuid,uuid,text,text,text,text,text,jsonb,integer,integer,text,text,jsonb,integer,integer)',
    'public.ai_complete_knowledge_question_job_v2(uuid,uuid,jsonb)',
    'public.ai_complete_exam_grading_v2(uuid,uuid,numeric,jsonb,jsonb)'
  ] loop
    select pg_get_functiondef(v_function::regprocedure) into v_definition;
    if v_definition not like '%''Azure''%'
        or v_definition not like '%AI_PROVIDER_ROUTING_VIOLATION%'
        or v_definition like '%ox_alpha_native_file_v1%'
        or v_definition like '%Stealth%'
        or v_definition like '%''OpenAI''%' then
      raise exception 'Luna Azure routing gate is missing: %', v_function;
    end if;
  end loop;

  select pg_get_functiondef('public._ai_inherit_job_pipeline()'::regprocedure)
    into v_definition;
  if v_definition like '%ox_alpha_native_file_v1%' then
    raise exception 'Knowledge question pipeline inheritance still references Ox Alpha';
  end if;

  select pg_get_functiondef(
    'public.ai_checkpoint_generation_job_v2(uuid,uuid,text,jsonb,integer)'::regprocedure
  ) into v_definition;
  if v_definition like '%ox_alpha_native_file_v1%' then
    raise exception 'Checkpoint workflow still references Ox Alpha';
  end if;

  if has_function_privilege(
      'authenticated',
      'public.ai_create_generation_job(uuid,uuid,uuid,text,text,jsonb,integer,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.ai_checkpoint_generation_job_v2(uuid,uuid,text,jsonb,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.ai_complete_material_generation_job_v2(uuid,uuid,text,text,text,text,text,jsonb,integer,integer,text,text,jsonb,integer,integer)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.ai_complete_knowledge_question_job_v2(uuid,uuid,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.ai_complete_exam_grading_v2(uuid,uuid,numeric,jsonb,jsonb)',
      'EXECUTE'
    ) then
    raise exception 'Luna service workflows are client executable';
  end if;
end;
$$;
