-- Purpose: fail the release if custom review/exam selection or the
-- failed-but-remediated completion boundary becomes client-writable.

do $$
declare
  v_review regprocedure := to_regprocedure(
    'public.learning_start_selected_review_session(uuid,uuid,uuid,text[],text,uuid,jsonb,uuid[])'
  );
  v_exam regprocedure := to_regprocedure(
    'public.learning_start_selected_exam_session(uuid,uuid,uuid,jsonb,integer,text,uuid[])'
  );
  v_history regprocedure := to_regprocedure(
    'public.learning_list_exam_history(uuid,uuid)'
  );
  v_detail regprocedure := to_regprocedure(
    'public.learning_get_exam_history_detail(uuid,uuid)'
  );
  v_attempt_snapshot regprocedure := to_regprocedure(
    'public._learning_capture_exam_attempt_snapshot()'
  );
  v_word_snapshot regprocedure := to_regprocedure(
    'public._learning_capture_exam_word_snapshot()'
  );
  v_progress_source text;
begin
  if v_review is null or v_exam is null or v_history is null or v_detail is null
     or v_attempt_snapshot is null or v_word_snapshot is null then
    raise exception 'selected session or exam history RPCs are missing';
  end if;
  if to_regclass('public.learning_exam_word_snapshots') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'learning_attempts'
         and column_name = 'word_id_snapshot'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'learning_attempts'
         and column_name = 'term_snapshot'
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.learning_attempts'::regclass
         and tgname = 'learning_exam_attempt_snapshot'
         and not tgisinternal
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.learning_session_items'::regclass
         and tgname = 'learning_exam_word_snapshot'
         and not tgisinternal
     ) then
    raise exception 'immutable exam history snapshot storage is missing';
  end if;
  if has_function_privilege('public', v_review, 'EXECUTE')
     or has_function_privilege('anon', v_review, 'EXECUTE')
     or has_function_privilege('authenticated', v_review, 'EXECUTE')
     or has_function_privilege('public', v_exam, 'EXECUTE')
     or has_function_privilege('anon', v_exam, 'EXECUTE')
     or has_function_privilege('authenticated', v_exam, 'EXECUTE')
     or has_function_privilege('public', v_history, 'EXECUTE')
     or has_function_privilege('anon', v_history, 'EXECUTE')
     or has_function_privilege('authenticated', v_history, 'EXECUTE')
     or has_function_privilege('public', v_detail, 'EXECUTE')
     or has_function_privilege('anon', v_detail, 'EXECUTE')
     or has_function_privilege('authenticated', v_detail, 'EXECUTE')
     or has_function_privilege('public', v_attempt_snapshot, 'EXECUTE')
     or has_function_privilege('anon', v_attempt_snapshot, 'EXECUTE')
     or has_function_privilege('authenticated', v_attempt_snapshot, 'EXECUTE')
     or has_function_privilege('public', v_word_snapshot, 'EXECUTE')
     or has_function_privilege('anon', v_word_snapshot, 'EXECUTE')
     or has_function_privilege('authenticated', v_word_snapshot, 'EXECUTE')
     or has_table_privilege('public', 'public.learning_exam_word_snapshots', 'SELECT')
     or has_table_privilege('anon', 'public.learning_exam_word_snapshots', 'SELECT')
     or has_table_privilege('authenticated', 'public.learning_exam_word_snapshots', 'SELECT') then
    raise exception 'selected session/history RPCs must remain service-role only';
  end if;
  if not has_function_privilege('service_role', v_review, 'EXECUTE')
     or not has_function_privilege('service_role', v_exam, 'EXECUTE')
     or not has_function_privilege('service_role', v_history, 'EXECUTE')
     or not has_function_privilege('service_role', v_detail, 'EXECUTE') then
    raise exception 'service_role cannot use selected session/history RPCs';
  end if;
  if position(
    'selected word is outside the requested review scope'
    in pg_get_functiondef(v_review)
  ) = 0 or position(
    'selected word is outside the requested exam unit'
    in pg_get_functiondef(v_exam)
  ) = 0 then
    raise exception 'selected word ownership/unit validation is missing';
  end if;

  select pg_get_functiondef(
    'public._learning_apply_passed_exam_progress()'::regprocedure
  ) into v_progress_source;
  if position('''practiceCompleted'', true' in v_progress_source) = 0 then
    raise exception 'exam remediation completion is not persisted';
  end if;
  if position(
    'if coalesce((new.state ->> ''examPassed'')::boolean, false) then'
    in v_progress_source
  ) = 0 then
    raise exception 'failed exams could project learned progress';
  end if;
  if position('learning_exam_word_snapshots' in v_progress_source) = 0 then
    raise exception 'final exam word results are not preserved in history snapshots';
  end if;
end;
$$;
