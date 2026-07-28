-- Nalanda · verify timed spelling and semantic-translation security boundary

do $$
declare
  v_options_default text;
begin
  select column_default
  into v_options_default
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'learning_sessions'
    and column_name = 'spelling_options'
    and is_nullable = 'NO';
  if v_options_default is null then
    raise exception 'learning session spelling options are missing';
  end if;

  if to_regclass('public.learning_spelling_translation_assessments') is null
     or not (
       select c.relrowsecurity
       from pg_class c
       where c.oid = 'public.learning_spelling_translation_assessments'::regclass
     )
     or has_table_privilege(
       'anon',
       'public.learning_spelling_translation_assessments',
       'SELECT'
     )
     or has_table_privilege(
       'authenticated',
       'public.learning_spelling_translation_assessments',
       'INSERT'
     ) then
    raise exception 'translation assessment table is exposed to clients'
      using errcode = '42501';
  end if;

  if to_regprocedure(
       'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid,jsonb)'
     ) is null
     or to_regprocedure(
       'public.learning_record_spelling_attempt(uuid,uuid,uuid,jsonb,uuid,bigint)'
     ) is null
     or to_regprocedure(
       'public.learning_claim_spelling_translation_assessment(uuid,uuid,uuid,uuid,bigint,text,uuid,integer,integer,integer)'
     ) is null
     or to_regprocedure(
       'public.learning_complete_spelling_translation_assessment(uuid,uuid,uuid,uuid,bigint,text,uuid,boolean,text,text,text,jsonb)'
     ) is null then
    raise exception 'required spelling RPC is missing';
  end if;

  if has_function_privilege(
       'anon',
       'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid,jsonb)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_record_spelling_attempt(uuid,uuid,uuid,jsonb,uuid,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_claim_spelling_translation_assessment(uuid,uuid,uuid,uuid,bigint,text,uuid,integer,integer,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_complete_spelling_translation_assessment(uuid,uuid,uuid,uuid,bigint,text,uuid,boolean,text,text,text,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid,jsonb)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_record_spelling_attempt(uuid,uuid,uuid,jsonb,uuid,bigint)',
       'EXECUTE'
     ) then
    raise exception 'spelling RPC grants are unsafe' using errcode = '42501';
  end if;
end;
$$;
