-- Nalanda · 0053 verify security integrity time-column contract
-- Fail closed unless authenticated clients have exactly the final content and
-- Schedule UPDATE surface while service-role and server-maintained triggers
-- remain available to existing application and operational workflows.

do $$
declare
  v_missing text;
begin
  -- Posts: authored content remains editable, but both creation and edit time
  -- are now server-only. has_column_privilege includes inherited PUBLIC grants,
  -- so these checks also reject an accidental broad grant.
  if not has_column_privilege('authenticated', 'public.posts', 'title', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'body', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'kind', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'subject', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'tags', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'image_url', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'audio_url', 'UPDATE') then
    raise exception 'post content update grants are incomplete';
  end if;
  if has_column_privilege('authenticated', 'public.posts', 'updated_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'created_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'author_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'author_university', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'author_major', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'like_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'comment_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'favorite_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'repost_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'repost_of', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'points_business_key', 'UPDATE') then
    raise exception 'a trusted post update column is client-writable';
  end if;

  -- Schedule: clients may edit task content and the boolean completion fact.
  -- done_at remains derived from done by the integrity trigger.
  if not has_column_privilege('authenticated', 'public.study_tasks', 'title', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.study_tasks', 'due_date', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.study_tasks', 'done', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.study_tasks', 'course_id', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.study_tasks', 'material_id', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.study_tasks', 'goal_id', 'UPDATE') then
    raise exception 'study task content update grants are incomplete';
  end if;
  if has_column_privilege('authenticated', 'public.study_tasks', 'done_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_tasks', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_tasks', 'points_business_key', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_tasks', 'created_at', 'UPDATE') then
    raise exception 'a trusted study task update column is client-writable';
  end if;

  -- Application rollback and support workflows still use service-role. The
  -- contract narrows only authenticated PostgREST clients.
  if not has_column_privilege('service_role', 'public.posts', 'updated_at', 'UPDATE')
     or not has_column_privilege('service_role', 'public.study_tasks', 'done_at', 'UPDATE') then
    raise exception 'service-role time-column maintenance privilege is missing';
  end if;

  select string_agg(required.trigger_name, ', ' order by required.trigger_name)
  into v_missing
  from (values
    ('public.posts'::regclass, 'posts_00_guard_integrity'),
    ('public.study_tasks'::regclass, 'study_tasks_guard_integrity')
  ) required(relation_id, trigger_name)
  where not exists (
    select 1
    from pg_trigger t
    where t.tgrelid = required.relation_id
      and t.tgname = required.trigger_name
      and not t.tgisinternal
      and t.tgenabled <> 'D'
  );
  if v_missing is not null then
    raise exception 'server time-maintenance triggers missing or disabled: %', v_missing;
  end if;

  if position('new.updated_at := clock_timestamp()' in
       pg_get_functiondef('public._guard_post_integrity()'::regprocedure)) = 0 then
    raise exception 'post updated_at is no longer server-maintained';
  end if;
  if position('new.done_at := case when new.done then clock_timestamp() else null end' in
       pg_get_functiondef('public._guard_study_task_integrity()'::regprocedure)) = 0 then
    raise exception 'study task done_at is no longer server-maintained';
  end if;
end;
$$;
