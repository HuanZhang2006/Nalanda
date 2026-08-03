-- Purpose: fail the release if learned_at is no longer the exact projection
-- of both exam facts, if review regains a mastery write, or if clients can
-- bypass the server-owned progress boundary.

do $$
declare
  v_projection regprocedure := to_regprocedure(
    'public._learning_project_exam_only_mastery()'
  );
  v_apply regprocedure := to_regprocedure(
    'public._learning_apply_passed_exam_progress()'
  );
  v_advance regprocedure := to_regprocedure(
    'public._learning_advance_session(uuid)'
  );
  v_projection_source text;
  v_apply_source text;
  v_advance_source text;
  v_constraint_source text;
begin
  if v_projection is null or v_apply is null or v_advance is null then
    raise exception 'exam-only mastery projection functions are missing';
  end if;

  select pg_get_constraintdef(oid)
  into v_constraint_source
  from pg_constraint
  where conrelid = 'public.learning_word_progress'::regclass
    and conname = 'learning_word_progress_exam_only_mastery'
    and contype = 'c'
    and convalidated;

  if v_constraint_source is null
     or position('spelling_exam_passed_at' in v_constraint_source) = 0
     or position('pronunciation_exam_passed_at' in v_constraint_source) = 0
     or position('GREATEST' in upper(v_constraint_source)) = 0 then
    raise exception 'exact exam-only learned_at constraint is missing';
  end if;

  if exists (
    select 1
    from public.learning_word_progress
    where learned_at is distinct from case
      when spelling_exam_passed_at is not null
       and pronunciation_exam_passed_at is not null
        then greatest(spelling_exam_passed_at, pronunciation_exam_passed_at)
      else null
    end
  ) then
    raise exception 'learned_at is not the exact projection of both exam facts';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.learning_word_progress'::regclass
      and tgname = 'learning_word_exam_only_mastery_projection'
      and tgenabled <> 'D'
      and not tgisinternal
  ) then
    raise exception 'exam-only mastery projection trigger is missing';
  end if;

  select pg_get_functiondef(v_projection) into v_projection_source;
  select pg_get_functiondef(v_apply) into v_apply_source;
  select pg_get_functiondef(v_advance) into v_advance_source;

  if position('new.spelling_exam_passed_at is not null' in v_projection_source) = 0
     or position('new.pronunciation_exam_passed_at is not null' in v_projection_source) = 0
     or position('greatest' in lower(v_projection_source)) = 0 then
    raise exception 'mastery projection does not require both exam facts';
  end if;
  if position('examPassed' in v_apply_source) = 0
     or position('new.mode = ''exam''' in v_apply_source) = 0
     or position('spelling_exam_passed_at' in v_apply_source) = 0
     or position('pronunciation_exam_passed_at' in v_apply_source) = 0 then
    raise exception 'exam completion no longer owns both exam pass facts';
  end if;
  if position('set learned_at' in lower(v_advance_source)) > 0 then
    raise exception 'review or initial learning can still assign learned_at';
  end if;

  if has_table_privilege('anon', 'public.learning_word_progress', 'INSERT')
     or has_table_privilege('anon', 'public.learning_word_progress', 'UPDATE')
     or has_table_privilege('anon', 'public.learning_word_progress', 'DELETE')
     or has_table_privilege('authenticated', 'public.learning_word_progress', 'INSERT')
     or has_table_privilege('authenticated', 'public.learning_word_progress', 'UPDATE')
     or has_table_privilege('authenticated', 'public.learning_word_progress', 'DELETE') then
    raise exception 'clients can mutate learning_word_progress directly';
  end if;
  if has_function_privilege('public', v_projection, 'EXECUTE')
     or has_function_privilege('anon', v_projection, 'EXECUTE')
     or has_function_privilege('authenticated', v_projection, 'EXECUTE')
     or not has_function_privilege('service_role', v_projection, 'EXECUTE') then
    raise exception 'mastery projection function permissions are unsafe';
  end if;
end;
$$;
