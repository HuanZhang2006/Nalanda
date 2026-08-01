-- Purpose: fail the release if exam, retry-round, or semantic-quota security
-- invariants drift from migration 0027.
-- Update this document only through a later forward migration.

do $$
declare
  v_default text;
  v_time_default text;
begin
  select pg_get_expr(d.adbin, d.adrelid)
  into v_default
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname = 'learning_spelling_translation_assessments'
    and a.attname = 'quota_counted'
    and a.attnotnull;
  if v_default is null or v_default not ilike '%true%' then
    raise exception 'quota_counted must remain NOT NULL with a conservative TRUE default';
  end if;

  select pg_get_expr(d.adbin, d.adrelid)
  into v_time_default
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname = 'public'
    and c.relname = 'learning_spelling_translation_assessments'
    and a.attname = 'quota_counted_at';
  if v_time_default is null or v_time_default not ilike '%now%' then
    raise exception 'quota_counted_at must keep a default for the rollback application';
  end if;
  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'learning_spelling_translation_assessments'
      and c.conname = 'learning_spelling_translation_quota_time_check'
  ) then
    raise exception 'translation quota count/time constraint is missing';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'learning_sessions'
      and c.conname = 'learning_sessions_mode_check'
      and pg_get_constraintdef(c.oid) like '%exam%'
  ) then
    raise exception 'learning_sessions exam mode constraint is missing';
  end if;
  if not exists (
    select 1
    from pg_constraint c
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where n.nspname = 'public'
      and r.relname = 'learning_attempts'
      and c.conname = 'learning_attempts_mode_check'
      and pg_get_constraintdef(c.oid) like '%exam%'
  ) then
    raise exception 'learning_attempts exam mode constraint is missing';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'learning_attempt_retry_round_guard' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'learning_assessment_retry_round_guard' and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname = 'learning_session_passed_exam_progress' and not tgisinternal
  ) then
    raise exception 'learning exam/retry trigger set is incomplete';
  end if;
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.learning_claim_spelling_translation_assessment_v2(uuid,uuid,uuid,uuid,bigint,text,uuid,integer)',
    'public.learning_reserve_spelling_translation_quota(uuid,uuid,uuid,integer,integer)',
    'public.learning_start_exam_session(uuid,uuid,uuid,jsonb,integer)',
    'public.learning_continue_spelling_retry_round(uuid,uuid)'
  ] loop
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'service_role cannot execute %', v_signature;
    end if;
    if has_function_privilege('public', v_signature, 'EXECUTE')
       or has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'client role can execute service-only function %', v_signature;
    end if;
  end loop;
end;
$$;

do $$
begin
  if position(
    'v_exam_correct * 100 >= v_exam_required * v_exam_total'
    in pg_get_functiondef(
      'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb,uuid,bigint)'::regprocedure
    )
  ) = 0 then
    raise exception 'exam pass/fail must use exact counts instead of rounded display accuracy';
  end if;
  if position(
    'quota_counted_at >= v_now'
    in pg_get_functiondef(
      'public.learning_reserve_spelling_translation_quota(uuid,uuid,uuid,integer,integer)'::regprocedure
    )
  ) = 0 then
    raise exception 'translation quota windows must use the provider reservation time';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('anon', 'public.learning_spelling_translation_assessments', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.learning_spelling_translation_assessments', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'translation assessment facts are exposed to a client role';
  end if;
end;
$$;
