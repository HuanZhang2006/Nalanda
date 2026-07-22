-- Nalanda · 0013 release assertions for learning courses
-- Read-only checks: fail deployment if the private-write boundary or seeded
-- growth rules do not match the Courses v1 contract.

do $$
declare
  v_table text;
  v_function text;
begin
  foreach v_table in array array[
    'learning_courses', 'learning_course_units', 'learning_course_words',
    'learning_sessions', 'learning_session_items', 'learning_attempts',
    'learning_speech_usage',
    'learning_word_progress', 'learning_review_schedules',
    'learning_course_shares', 'learning_course_publications',
    'learning_course_reports', 'learning_course_moderation_actions',
    'badge_definitions',
    'user_badge_awards'
  ] loop
    if not (select c.relrowsecurity from pg_catalog.pg_class c
            join pg_catalog.pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = v_table) then
      raise exception 'RLS is disabled for public.%', v_table using errcode = '42501';
    end if;
    if has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') then
      raise exception 'authenticated can write server-managed table public.%', v_table
        using errcode = '42501';
    end if;
  end loop;

  foreach v_function in array array[
    'public.learning_upsert_course(uuid,jsonb)',
    'public.learning_start_session(uuid,uuid,uuid,text,text[],text,uuid)',
    'public.learning_mark_recognition(uuid,uuid,uuid)',
    'public.learning_record_attempt(uuid,uuid,uuid,text,jsonb)',
    'public.learning_schedule_reviews(uuid,uuid,uuid,integer[])',
    'public.learning_profile_summary(uuid)',
    'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)',
    'public.learning_reserve_speech_quota(uuid,text,integer,integer,integer,bigint)',
    'public.learning_clone_course(uuid,jsonb,uuid,text)',
    'public.learning_rename_course(uuid,uuid,text)',
    'public.learning_delete_course(uuid,uuid)',
    'public.learning_cancel_review_schedule(uuid,uuid)',
    'public.learning_create_share(uuid,uuid,text,text)',
    'public.learning_revoke_share(uuid,uuid)',
    'public.learning_clone_share(uuid,jsonb,text)',
    'public.learning_publish_course(uuid,uuid,text,text,boolean,integer)',
    'public.learning_create_report(uuid,uuid,uuid,text,text,integer,integer)',
    'public.learning_moderate_publication(uuid,uuid,text,text)',
    'public._learning_course_snapshot(uuid)'
  ] loop
    if has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE') then
      raise exception 'learning workflow is client executable: %', v_function
        using errcode = '42501';
    end if;
    if not has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'learning workflow is unavailable to service_role: %', v_function
        using errcode = '42501';
    end if;
  end loop;

  if (select count(*) from public.badge_definitions
      where family in ('vocab_words', 'vocab_courses', 'vocab_review_days')) <> 9 then
    raise exception 'learning badge catalogue must contain exactly nine v1 tiers'
      using errcode = '23514';
  end if;

  if has_function_privilege('anon', 'public._guard_learning_publication_snapshot()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._guard_learning_publication_snapshot()', 'EXECUTE') then
    raise exception 'publication immutability trigger helper is client executable'
      using errcode = '42501';
  end if;

  if has_table_privilege('service_role', 'public.learning_attempts', 'UPDATE')
     or has_table_privilege('service_role', 'public.learning_attempts', 'DELETE') then
    raise exception 'learning_attempts must remain append-only for service_role'
      using errcode = '42501';
  end if;

  if exists (
    select 1 from public.profiles p
    where not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p.timezone)
  ) then
    raise exception 'profile contains an invalid IANA timezone' using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.learning_course_units u
    join public.learning_courses c on c.id = u.course_id
    where u.user_id <> c.user_id
  ) or exists (
    select 1
    from public.learning_course_words w
    join public.learning_course_units u on u.id = w.unit_id
    where w.user_id <> u.user_id or w.course_id <> u.course_id
  ) or exists (
    select 1
    from public.learning_sessions s
    join public.learning_courses c on c.id = s.course_id
    where s.user_id <> c.user_id
  ) or exists (
    select 1
    from public.learning_sessions s
    join public.learning_course_units u on u.id = s.unit_id
    where s.user_id <> u.user_id or s.course_id <> u.course_id
  ) or exists (
    select 1
    from public.learning_attempts a
    join public.learning_sessions s on s.id = a.session_id
    where a.user_id <> s.user_id or a.course_id <> s.course_id
  ) or exists (
    select 1
    from public.learning_attempts a
    join public.learning_course_words w on w.id = a.word_id
    where a.user_id <> w.user_id or a.course_id <> w.course_id
  ) then
    raise exception 'learning course ownership chain is inconsistent' using errcode = '23514';
  end if;
end;
$$;

-- Post-release validation:
-- select version from supabase_migrations.schema_migrations order by version;
-- select count(*) from public.badge_definitions;
-- select public.learning_profile_summary('<smoke-user-id>'::uuid);
