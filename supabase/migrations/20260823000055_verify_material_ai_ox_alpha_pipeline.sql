-- Nalanda · 0055 structural, routing and privilege assertions for 0054.

do $$
declare
  v_constraint text;
  v_definition text;
begin
  foreach v_constraint in array array[
    'generation_jobs_pipeline_check',
    'notes_pipeline_check',
    'ai_provider_usage_events_pipeline_check'
  ] loop
    if not exists (
      select 1
      from pg_constraint constraint_row
      join pg_namespace namespace on namespace.oid = constraint_row.connamespace
      where namespace.nspname = 'public'
        and constraint_row.conname = v_constraint
        and pg_get_constraintdef(constraint_row.oid) like '%ox_alpha_native_file_v1%'
    ) then
      raise exception 'Ox Alpha pipeline constraint missing: %', v_constraint;
    end if;
  end loop;

  select pg_get_functiondef(
    'public.ai_create_generation_job(uuid,uuid,uuid,text,text,jsonb,integer,text)'::regprocedure
  ) into v_definition;
  if v_definition not like '%ox_alpha_native_file_v1%'
      or v_definition not like '%stealth/ox-alpha%' then
    raise exception 'Ox Alpha create-job model mapping is missing';
  end if;

  select pg_get_functiondef(
    'public.ai_complete_material_generation_job_v2(uuid,uuid,text,text,text,text,text,jsonb,integer,integer,text,text,jsonb,integer,integer)'::regprocedure
  ) into v_definition;
  if v_definition not like '%ox_alpha_native_file_v1%'
      or v_definition not like '%Stealth%'
      or v_definition not like '%AI_PROVIDER_ROUTING_VIOLATION%' then
    raise exception 'Ox Alpha artifact routing gate is missing';
  end if;

  select pg_get_functiondef(
    'public.ai_complete_knowledge_question_job_v2(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;
  if v_definition not like '%ox_alpha_native_file_v1%'
      or v_definition not like '%Stealth%' then
    raise exception 'Ox Alpha knowledge question routing gate is missing';
  end if;

  select pg_get_functiondef(
    'public.ai_complete_exam_grading_v2(uuid,uuid,numeric,jsonb,jsonb)'::regprocedure
  ) into v_definition;
  if v_definition not like '%ox_alpha_native_file_v1%'
      or v_definition not like '%Stealth%' then
    raise exception 'Ox Alpha grading routing gate is missing';
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
    raise exception 'Ox Alpha service workflows are client executable';
  end if;
end;
$$;
