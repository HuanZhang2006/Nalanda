-- Purpose: fail the release if translation STT can bypass the active-session
-- boundary, if clients can execute its cost reservation, or if raw-audio usage
-- facts become client-readable.

do $$
declare
  v_function regprocedure := to_regprocedure(
    'public.learning_reserve_translation_stt(uuid,uuid,uuid,bigint,integer,integer,integer,bigint)'
  );
  v_source text;
  v_constraint text;
begin
  if v_function is null then
    raise exception 'translation STT reservation function is missing';
  end if;

  select pg_get_constraintdef(oid)
  into v_constraint
  from pg_constraint
  where conrelid = 'public.learning_speech_usage'::regclass
    and conname = 'learning_speech_usage_kind_check'
    and contype = 'c'
    and convalidated;
  if v_constraint is null
     or position('translation_stt' in v_constraint) = 0 then
    raise exception 'translation STT usage kind is not constrained';
  end if;

  select pg_get_functiondef(v_function) into v_source;
  if position('v_session.revision <> p_expected_revision' in v_source) = 0
     or position('translationFirst' in v_source) = 0
     or position('v_current_word is distinct from p_word_id' in v_source) = 0
     or position('w.user_id = p_user_id' in v_source) = 0 then
    raise exception 'translation STT reservation lost an owner or active-item guard';
  end if;

  if has_function_privilege('public', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('authenticated', v_function, 'EXECUTE')
     or not has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception 'translation STT function permissions are unsafe';
  end if;

  if has_table_privilege('anon', 'public.learning_speech_usage', 'SELECT')
     or has_table_privilege('authenticated', 'public.learning_speech_usage', 'SELECT')
     or has_table_privilege('anon', 'public.learning_speech_usage', 'INSERT')
     or has_table_privilege('authenticated', 'public.learning_speech_usage', 'INSERT') then
    raise exception 'translation STT usage facts are exposed to clients';
  end if;
end;
$$;
