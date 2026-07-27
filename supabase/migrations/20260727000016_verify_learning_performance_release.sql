-- Nalanda · verify the Courses performance/offline-audio security boundary

do $$
declare
  v_public boolean;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learning_sessions'
      and column_name = 'revision' and is_nullable = 'NO'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'learning_attempts'
      and column_name = 'attempt_id'
  ) or to_regclass('public.learning_audio_assets') is null
     or to_regclass('public.learning_attempts_idempotency_idx') is null then
    raise exception 'learning performance schema is incomplete';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.learning_attempts'::regclass
      and tgname = 'learning_attempt_revision'
      and not tgisinternal
  ) then
    raise exception 'learning attempt revision trigger is missing';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.learning_audio_assets'::regclass)
     or has_table_privilege('anon', 'public.learning_audio_assets', 'SELECT')
     or has_table_privilege('authenticated', 'public.learning_audio_assets', 'SELECT')
     or has_table_privilege('authenticated', 'public.learning_audio_assets', 'INSERT')
     or has_table_privilege('authenticated', 'public.learning_audio_assets', 'UPDATE') then
    raise exception 'learning audio asset RLS/grants are unsafe' using errcode = '42501';
  end if;

  if to_regprocedure('public.learning_get_session_snapshot(uuid,uuid)') is null
     or to_regprocedure('public._learning_increment_session_revision()') is null
     or to_regprocedure('public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)') is null
     or to_regprocedure('public.learning_prepare_unit_audio(uuid,uuid,text,text,text,text,integer)') is null
     or to_regprocedure('public.learning_prepare_word_audio(uuid,uuid,text,text,text,text,integer)') is null
     or to_regprocedure('public.learning_claim_audio_asset(uuid,integer,integer)') is null
     or to_regprocedure('public.learning_reserve_tts_quota(integer,integer,integer,bigint,bigint)') is null then
    raise exception 'learning performance RPCs are incomplete';
  end if;

  if has_function_privilege(
       'anon',
       'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_get_session_snapshot(uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_prepare_unit_audio(uuid,uuid,text,text,text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_prepare_word_audio(uuid,uuid,text,text,text,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public._learning_increment_session_revision()',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_get_session_snapshot(uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_prepare_unit_audio(uuid,uuid,text,text,text,text,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_prepare_word_audio(uuid,uuid,text,text,text,text,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_claim_audio_asset(uuid,integer,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_finish_audio_asset(uuid,text,boolean,text,text,integer)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_reserve_tts_quota(integer,integer,integer,bigint,bigint)',
       'EXECUTE'
     ) then
    raise exception 'learning performance RPC grants are unsafe' using errcode = '42501';
  end if;

  select public into v_public from storage.buckets where id = 'vocabulary-audio';
  if v_public is distinct from false then
    raise exception 'vocabulary audio bucket must remain private' using errcode = '42501';
  end if;
end;
$$;
