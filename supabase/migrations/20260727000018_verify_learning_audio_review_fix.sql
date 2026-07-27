-- Nalanda · verify intent-scoped session resume and retained security boundary

do $$
declare
  v_index_definition text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'learning_sessions'
      and column_name = 'resume_key'
      and is_nullable = 'NO'
  ) then
    raise exception 'learning session resume key is missing';
  end if;

  if to_regclass('public.learning_sessions_one_active_course_idx') is not null then
    raise exception 'course-wide active session index must be removed';
  end if;

  select pg_get_indexdef('public.learning_sessions_one_active_intent_idx'::regclass)
  into v_index_definition;
  if v_index_definition not like '%(user_id, resume_key)%WHERE active%' then
    raise exception 'active session intent index is invalid';
  end if;

  if exists (
    select 1
    from public.learning_sessions
    where active
    group by user_id, resume_key
    having count(*) > 1
  ) then
    raise exception 'duplicate active learning session intents exist';
  end if;

  if to_regprocedure(
       'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid)'
     ) is null
     or has_function_privilege(
       'anon',
       'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid)',
       'EXECUTE'
     ) then
    raise exception 'learning start session RPC grants are unsafe'
      using errcode = '42501';
  end if;
end;
$$;
