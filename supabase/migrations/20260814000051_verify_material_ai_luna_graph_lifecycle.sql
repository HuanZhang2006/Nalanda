-- Nalanda · 0051 structural and privilege assertions for 0049-0050.

do $$
declare v_name text;
begin
  foreach v_name in array array[
    'knowledge_graph_layouts'
  ] loop
    if to_regclass('public.' || v_name) is null then
      raise exception 'required table missing: %', v_name;
    end if;
  end loop;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'generation_jobs'
      and column_name = 'pipeline' and is_nullable = 'NO'
  ) then raise exception 'generation job pipeline missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notes'
      and column_name = 'pipeline' and is_nullable = 'NO'
  ) then raise exception 'note pipeline missing'; end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_provider_usage_events'
      and column_name = 'upstream_provider'
  ) then raise exception 'provider provenance missing'; end if;
  if not exists (
    select 1
    from pg_index index_row
    join pg_class index_class on index_class.oid = index_row.indexrelid
    join pg_namespace namespace on namespace.oid = index_class.relnamespace
    where namespace.nspname = 'public'
      and index_class.relname = 'generation_jobs_one_active_per_user_idx'
      and index_row.indisunique
      and pg_get_expr(index_row.indpred, index_row.indrelid) like '%deleting%'
      and pg_get_expr(index_row.indpred, index_row.indrelid) like '%deletion_previous_status%'
  ) then raise exception 'deleting jobs are missing from the one-active-job guard'; end if;

  perform 'public.ai_create_generation_job(uuid,uuid,uuid,text,text,jsonb,integer)'::regprocedure;
  perform 'public.ai_create_generation_job(uuid,uuid,uuid,text,text,jsonb,integer,text)'::regprocedure;
  perform 'public.ai_checkpoint_generation_job_v2(uuid,uuid,text,jsonb,integer)'::regprocedure;
  perform 'public.ai_record_generation_usage_v2(uuid,uuid,jsonb)'::regprocedure;
  perform 'public.ai_record_grading_usage_v2(uuid,uuid,jsonb)'::regprocedure;
  perform 'public.ai_complete_material_generation_job_v2(uuid,uuid,text,text,text,text,text,jsonb,integer,integer,text,text,jsonb,integer,integer)'::regprocedure;
  perform 'public.ai_complete_knowledge_question_job_v2(uuid,uuid,jsonb)'::regprocedure;
  perform 'public.ai_complete_exam_grading_v2(uuid,uuid,numeric,jsonb,jsonb)'::regprocedure;
  perform 'public.ai_delete_generation_job(uuid,uuid)'::regprocedure;
  perform 'public.ai_cancel_generation_job(uuid,uuid)'::regprocedure;
  perform 'public.ai_clear_generation_history(uuid)'::regprocedure;
  perform 'public.ai_finalize_generation_job_cleanup(uuid)'::regprocedure;
  perform 'public.ai_get_knowledge_graph_layout(uuid,uuid)'::regprocedure;
  perform 'public.ai_save_knowledge_graph_layout(uuid,uuid,text,bigint,jsonb,jsonb)'::regprocedure;

  if has_table_privilege('authenticated', 'public.knowledge_graph_layouts', 'INSERT')
      or has_table_privilege('authenticated', 'public.knowledge_graph_layouts', 'UPDATE')
      or has_table_privilege('authenticated', 'public.knowledge_graph_layouts', 'DELETE') then
    raise exception 'authenticated can mutate graph layouts directly';
  end if;
  if not has_table_privilege('authenticated', 'public.knowledge_graph_layouts', 'SELECT') then
    raise exception 'authenticated cannot read owner graph layouts';
  end if;
  if has_table_privilege('authenticated', 'public.ai_provider_usage_events', 'SELECT')
      or has_table_privilege('authenticated', 'public.ai_provider_usage_events', 'INSERT')
      or has_table_privilege('authenticated', 'public.ai_provider_usage_events', 'UPDATE')
      or has_table_privilege('authenticated', 'public.ai_provider_usage_events', 'DELETE') then
    raise exception 'provider usage ledger is exposed';
  end if;

  if has_function_privilege('authenticated',
      'public.ai_delete_generation_job(uuid,uuid)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_clear_generation_history(uuid)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_save_knowledge_graph_layout(uuid,uuid,text,bigint,jsonb,jsonb)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_record_generation_usage_v2(uuid,uuid,jsonb)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_checkpoint_generation_job_v2(uuid,uuid,text,jsonb,integer)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_complete_material_generation_job_v2(uuid,uuid,text,text,text,text,text,jsonb,integer,integer,text,text,jsonb,integer,integer)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_complete_knowledge_question_job_v2(uuid,uuid,jsonb)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_complete_exam_grading_v2(uuid,uuid,numeric,jsonb,jsonb)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_finalize_generation_job_cleanup(uuid)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_record_generation_cleanup_failure(uuid,text)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_fail_generation_job_v3(uuid,uuid,text,text,boolean,integer)', 'EXECUTE')
      or has_function_privilege('authenticated',
      'public.ai_get_knowledge_graph_layout(uuid,uuid)', 'EXECUTE') then
    raise exception 'service-only AI workflow is client executable';
  end if;
end;
$$;
