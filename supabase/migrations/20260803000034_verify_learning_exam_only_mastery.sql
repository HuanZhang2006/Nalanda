-- Purpose: fail the release if vocabulary mastery can be projected without
-- both owner-scoped exam facts, or if review/content-edit boundaries regress.

do $$
declare
  v_apply regprocedure := to_regprocedure(
    'public._learning_apply_passed_exam_progress()'
  );
  v_advance regprocedure := to_regprocedure(
    'public._learning_advance_session(uuid)'
  );
  v_reset regprocedure := to_regprocedure(
    'public._learning_reset_exam_mastery_on_word_edit()'
  );
  v_snapshot regprocedure := to_regprocedure(
    'public.learning_get_session_snapshot(uuid,uuid)'
  );
  v_apply_source text;
  v_advance_source text;
  v_reset_source text;
  v_snapshot_source text;
begin
  if v_apply is null or v_advance is null or v_reset is null or v_snapshot is null then
    raise exception 'exam-only mastery functions are missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'learning_word_progress'
      and column_name = 'spelling_exam_passed_at'
      and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'learning_word_progress'
      and column_name = 'pronunciation_exam_passed_at'
      and data_type = 'timestamp with time zone'
  ) then
    raise exception 'exam pass facts are missing from learning_word_progress';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.learning_word_progress'::regclass
      and conname = 'learning_word_progress_exam_only_mastery'
      and contype = 'c'
      and convalidated
  ) then
    raise exception 'exam-only learned_at constraint is missing';
  end if;

  if exists (
    select 1 from public.learning_word_progress
    where learned_at is not null
      and (spelling_exam_passed_at is null or pronunciation_exam_passed_at is null)
  ) then
    raise exception 'learned word exists without both exam facts';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.learning_course_words'::regclass
      and tgname = 'learning_word_exam_mastery_reset'
      and not tgisinternal
  ) then
    raise exception 'content-edit exam mastery reset trigger is missing';
  end if;

  select pg_get_functiondef(v_apply) into v_apply_source;
  select pg_get_functiondef(v_advance) into v_advance_source;
  select pg_get_functiondef(v_reset) into v_reset_source;
  select pg_get_functiondef(v_snapshot) into v_snapshot_source;

  if position('p.spelling_exam_passed_at is not null' in v_apply_source) = 0
     or position('p.pronunciation_exam_passed_at is not null' in v_apply_source) = 0
     or position('examPassed' in v_apply_source) = 0 then
    raise exception 'exam completion does not require both exam facts';
  end if;
  if position('set learned_at' in lower(v_advance_source)) > 0 then
    raise exception 'review/initial session advancement can still write learned_at';
  end if;
  if position('spelling_exam_passed_at' in v_reset_source) = 0
     or position('pronunciation_exam_passed_at' in v_reset_source) = 0
     or position('learned_at = null' in v_reset_source) = 0 then
    raise exception 'content edits do not invalidate exam-only mastery';
  end if;
  if position('spelling_exam_passed_at' in v_snapshot_source) = 0
     or position('pronunciation_exam_passed_at' in v_snapshot_source) = 0 then
    raise exception 'session snapshot omits exam mastery facts';
  end if;

  if has_function_privilege('public', v_apply, 'EXECUTE')
     or has_function_privilege('anon', v_apply, 'EXECUTE')
     or has_function_privilege('authenticated', v_apply, 'EXECUTE')
     or has_function_privilege('public', v_advance, 'EXECUTE')
     or has_function_privilege('anon', v_advance, 'EXECUTE')
     or has_function_privilege('authenticated', v_advance, 'EXECUTE')
     or has_function_privilege('public', v_reset, 'EXECUTE')
     or has_function_privilege('anon', v_reset, 'EXECUTE')
     or has_function_privilege('authenticated', v_reset, 'EXECUTE')
     or has_function_privilege('public', v_snapshot, 'EXECUTE')
     or has_function_privilege('anon', v_snapshot, 'EXECUTE')
     or has_function_privilege('authenticated', v_snapshot, 'EXECUTE') then
    raise exception 'exam-only mastery functions must remain service-role only';
  end if;

  if not has_function_privilege('service_role', v_snapshot, 'EXECUTE') then
    raise exception 'service_role cannot read the session mastery snapshot';
  end if;
end;
$$;
