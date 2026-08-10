-- Purpose: fail the expand-phase release if a client can mutate trusted
-- snapshots, workflow status, owner relationships, points decisions or abuse
-- audit data. Compatibility grants for posts.updated_at and
-- study_tasks.done_at are expected until migration 0041.

do $$
declare
  v_missing text;
  v_before_midnight record;
  v_after_midnight record;
  v_timezone_shift record;
begin
  -- Posts: only authored content plus the two media fields are writable. The
  -- compatibility timestamp is deliberately present but trigger-managed.
  if not has_column_privilege('authenticated', 'public.posts', 'title', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'body', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'kind', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'subject', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'tags', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'image_url', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'audio_url', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'updated_at', 'UPDATE') then
    raise exception 'post content compatibility grants are incomplete';
  end if;
  if has_column_privilege('authenticated', 'public.posts', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'author_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'author_university', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'author_major', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'like_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'comment_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'favorite_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'repost_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'repost_of', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'points_business_key', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'created_at', 'UPDATE') then
    raise exception 'a trusted post column is client-writable';
  end if;
  if has_column_privilege('authenticated', 'public.posts', 'user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'author_name', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'like_count', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'updated_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'points_business_key', 'INSERT') then
    raise exception 'a trusted post insert column is client-writable';
  end if;

  -- Feedback is append/read-only for its owner.
  if not has_table_privilege('authenticated', 'public.feedback', 'SELECT')
     or has_table_privilege('authenticated', 'public.feedback', 'UPDATE')
     or has_table_privilege('authenticated', 'public.feedback', 'DELETE')
     or has_column_privilege('authenticated', 'public.feedback', 'status', 'INSERT')
     or has_column_privilege('authenticated', 'public.feedback', 'user_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.feedback', 'created_at', 'INSERT')
     or not has_column_privilege('authenticated', 'public.feedback', 'summary', 'INSERT') then
    raise exception 'feedback grants are unsafe';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feedback'
      and cmd in ('UPDATE', 'DELETE', 'ALL')
      and 'authenticated' = any(roles)
  ) then
    raise exception 'feedback still has a client update/delete policy';
  end if;

  -- Schedule keeps the legacy done_at column during expand, but no identity,
  -- points key or creation timestamp may be written by clients.
  if not has_column_privilege('authenticated', 'public.study_tasks', 'done', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.study_tasks', 'done_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_tasks', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_tasks', 'points_business_key', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_tasks', 'created_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_goals', 'user_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.study_goals', 'created_at', 'UPDATE') then
    raise exception 'schedule grants are unsafe';
  end if;

  select string_agg(required.name, ', ' order by required.name)
  into v_missing
  from (values
    ('posts_00_guard_integrity'),
    ('feedback_guard_insert'),
    ('study_goals_guard_integrity'),
    ('study_tasks_guard_integrity')
  ) required(name)
  where not exists (
    select 1 from pg_trigger t
    where t.tgrelid in (
      'public.posts'::regclass, 'public.feedback'::regclass,
      'public.study_goals'::regclass, 'public.study_tasks'::regclass
    ) and t.tgname = required.name and not t.tgisinternal
  );
  if v_missing is not null then
    raise exception 'integrity triggers missing: %', v_missing;
  end if;

  -- Daily decisions and moderation state are complete for every historical key.
  if exists (
    select 1 from public.point_event_states s
    left join public.point_daily_award_claims c using (business_key)
    where c.business_key is null
       or s.source_active is null
       or s.moderation_suppressed is null
       or s.awarded_amount is null
       or s.decision_rule_version is null
       or s.awarded_amount is distinct from c.awarded_amount
       or s.decision_rule_version is distinct from c.rule_version
       or (s.awarded_amount = 0 and s.is_active)
       or (s.moderation_suppressed and s.suppressed_reason is distinct from 'moderation')
       or (not s.moderation_suppressed and s.suppressed_reason is distinct from c.suppressed_reason)
       or s.is_active is distinct from (
         s.source_active and not s.moderation_suppressed and s.awarded_amount > 0
       )
  ) then
    raise exception 'point state is missing an immutable award decision';
  end if;
  if exists (
    select 1 from public.point_daily_award_claims c
    where (c.awarded_amount > 0 and c.suppressed_reason is not null)
       or (
         c.awarded_amount = 0
         and not (
           (
             c.daily_limit is not null
             and c.daily_window_id is not null
             and c.suppressed_reason = 'daily_cap'
           )
           or (
             c.rule_version = 'grandfather-v1'
             and c.daily_limit is null
             and c.daily_window_id is null
             and c.suppressed_reason is null
           )
         )
       )
  ) then
    raise exception 'point award decision suppression is inconsistent';
  end if;
  if exists (
    select 1
    from public.point_event_states s
    where s.decision_rule_version = 'grandfather-v1'
      and (
        exists (
          select 1 from public.point_entries e
          where e.business_key = s.business_key
            and e.transition_no = 1
            and e.amount > 0
        )
      ) is distinct from (s.awarded_amount = s.reward_amount)
  ) then
    raise exception 'grandfather award amount does not match provable ledger history';
  end if;
  if exists (
    select 1
    from public.point_event_states s
    left join public.point_entries e on e.business_key = s.business_key
    group by s.business_key, s.is_active, s.awarded_amount
    having coalesce(sum(e.amount), 0) <> case when s.is_active then s.awarded_amount else 0 end
  ) then
    raise exception 'point business ledger does not match its effective state';
  end if;
  if exists (
    select 1
    from public.profiles p
    left join lateral (
      select greatest(
               0::bigint,
               least(2147483647::bigint, coalesce(sum(e.amount), 0::bigint))
             )::integer as points
      from public.point_entries e where e.user_id = p.id
    ) ledger on true
    where row(p.points, p.level, p.level_name) is distinct from row(
      ledger.points,
      case
        when ledger.points >= 1200 then 6
        when ledger.points >= 700 then 5
        when ledger.points >= 350 then 4
        when ledger.points >= 150 then 3
        when ledger.points >= 50 then 2
        else 1
      end,
      case
        when ledger.points >= 1200 then 'Luminary'
        when ledger.points >= 700 then 'Sage'
        when ledger.points >= 350 then 'Mentor'
        when ledger.points >= 150 then 'Scholar'
        when ledger.points >= 50 then 'Learner'
        else 'Novice'
      end
    )
  ) then
    raise exception 'profile points projection does not match the append-only ledger';
  end if;
  if public._point_daily_limit('post_created') <> 3
     or public._point_daily_limit('repost_created') <> 10
     or public._point_daily_limit('comment_created') <> 10
     or public._point_daily_limit('like_created') <> 20
     or public._point_daily_limit('task_completed') <> 10
     or public._point_daily_limit('learning_course_completed') is not null then
    raise exception 'point daily cap rules drifted';
  end if;

  -- Fixed-time boundary checks exercise the same helper used by the award
  -- transaction. Shanghai midnight must create adjacent windows, and a later
  -- timezone change must never overlap the previously frozen UTC end.
  select * into v_before_midnight
  from public._point_daily_bounds('Asia/Shanghai', '2026-08-10 15:59:59+00', null);
  select * into v_after_midnight
  from public._point_daily_bounds('Asia/Shanghai', '2026-08-10 16:00:01+00', null);
  select * into v_timezone_shift
  from public._point_daily_bounds(
    'Pacific/Kiritimati',
    '2026-08-10 16:00:01+00',
    '2026-08-10 16:00:00+00'
  );
  if v_before_midnight.local_date <> date '2026-08-10'
     or v_after_midnight.local_date <> date '2026-08-11'
     or v_before_midnight.ends_at <> v_after_midnight.starts_at
     or v_timezone_shift.starts_at < timestamptz '2026-08-10 16:00:00+00'
     or v_timezone_shift.ends_at <= v_timezone_shift.starts_at then
    raise exception 'point daily window midnight/timezone bounds are unsafe';
  end if;

  if has_table_privilege('anon', 'public.point_daily_windows', 'SELECT')
     or has_table_privilege('authenticated', 'public.point_daily_windows', 'SELECT')
     or has_table_privilege('authenticated', 'public.point_daily_award_claims', 'SELECT')
     or has_table_privilege('authenticated', 'public.point_moderation_actions', 'SELECT')
     or has_table_privilege('authenticated', 'public.point_abuse_signals', 'SELECT')
     or has_table_privilege('authenticated', 'public.api_abuse_events', 'SELECT')
     or not has_table_privilege('service_role', 'public.point_abuse_signals', 'SELECT')
     or not has_table_privilege('service_role', 'public.api_abuse_events', 'SELECT')
     or has_table_privilege('service_role', 'public.point_daily_windows', 'INSERT')
     or has_table_privilege('service_role', 'public.point_daily_award_claims', 'UPDATE')
     or has_table_privilege('service_role', 'public.point_moderation_actions', 'DELETE')
     or has_table_privilege('service_role', 'public.point_abuse_signals', 'UPDATE')
     or has_table_privilege('service_role', 'public.api_abuse_events', 'INSERT') then
    raise exception 'internal points or abuse tables are exposed';
  end if;
  if exists (
    select 1
    from (values
      ('public.point_daily_windows'),
      ('public.point_daily_award_claims'),
      ('public.point_daily_cap_notifications'),
      ('public.point_moderation_actions'),
      ('public.point_abuse_signals'),
      ('public.api_abuse_events')
    ) as internal_tables(name)
    where has_table_privilege('service_role', internal_tables.name, 'INSERT')
       or has_table_privilege('service_role', internal_tables.name, 'UPDATE')
       or has_table_privilege('service_role', internal_tables.name, 'DELETE')
       or has_table_privilege('service_role', internal_tables.name, 'TRUNCATE')
       or has_table_privilege('service_role', internal_tables.name, 'REFERENCES')
       or has_table_privilege('service_role', internal_tables.name, 'TRIGGER')
  ) then
    raise exception 'service role can bypass a controlled points mutation workflow';
  end if;
  if has_sequence_privilege('service_role', 'public.point_moderation_actions_id_seq', 'USAGE')
     or has_sequence_privilege('service_role', 'public.point_moderation_actions_id_seq', 'UPDATE')
     or has_sequence_privilege('service_role', 'public.api_abuse_events_id_seq', 'USAGE')
     or has_sequence_privilege('service_role', 'public.api_abuse_events_id_seq', 'UPDATE') then
    raise exception 'service role can allocate internal audit identities directly';
  end if;

  if has_function_privilege('public', 'public.get_point_reward_receipt(text,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_point_reward_receipt(text,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_point_reward_receipt(text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.moderate_point_rewards(uuid,text,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.moderate_point_rewards(uuid,text,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.review_point_abuse_signal(uuid,uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.review_point_abuse_signal(uuid,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_api_abuse_event(text,uuid,text,text,timestamptz,bigint,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.scan_point_abuse_signals()', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.scan_point_abuse_signals()', 'EXECUTE') then
    raise exception 'new RPC grants are unsafe';
  end if;

  if has_function_privilege('authenticated', 'public._guard_post_integrity()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._point_daily_bounds(text,timestamptz,timestamptz)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._point_daily_window(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._refresh_point_projection(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._root_post_owner(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._set_point_event(uuid,text,text,integer,boolean,uuid,jsonb)', 'EXECUTE') then
    raise exception 'an internal helper is client executable';
  end if;
end;
$$;
