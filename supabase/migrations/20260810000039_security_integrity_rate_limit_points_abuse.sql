-- Nalanda · 0039 security, integrity, points caps and abuse audit (expand phase)
--
-- This migration is intentionally compatible with the immediately preceding
-- Web release. posts.updated_at and study_tasks.done_at remain writable columns
-- for one observation window, but defensive triggers ignore every client value.
-- Migration 0041 will revoke those two compatibility grants after the new Web
-- release has been observed in production for at least 24 hours.

-- ── Direct PostgREST writes: strict column surfaces + defensive triggers ─────

create or replace function public._guard_post_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_content_changed boolean;
  v_internal_counter_update boolean := pg_trigger_depth() > 1;
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.user_id := auth.uid();
    end if;
    if new.user_id is null then
      raise exception 'post owner is required' using errcode = '23502';
    end if;
    new.like_count := 0;
    new.comment_count := 0;
    new.favorite_count := 0;
    new.repost_count := 0;
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.repost_of is distinct from old.repost_of
     or new.points_business_key is distinct from old.points_business_key then
    raise exception 'post owner, repost source and points key are immutable'
      using errcode = '42501';
  end if;

  if row(new.author_name, new.author_university, new.author_major)
     is distinct from row(old.author_name, old.author_university, old.author_major) then
    raise exception 'post author snapshot is server-managed' using errcode = '42501';
  end if;

  if row(new.like_count, new.comment_count, new.favorite_count, new.repost_count)
     is distinct from row(old.like_count, old.comment_count, old.favorite_count, old.repost_count)
     and not v_internal_counter_update then
    raise exception 'post counters are server-managed' using errcode = '42501';
  end if;

  v_content_changed := row(
    new.title, new.body, new.kind, new.subject, new.tags, new.image_url, new.audio_url
  ) is distinct from row(
    old.title, old.body, old.kind, old.subject, old.tags, old.image_url, old.audio_url
  );
  new.created_at := old.created_at;
  if v_content_changed then
    new.updated_at := clock_timestamp();
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create or replace function public._post_author()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  select p.username, p.university, p.major
  into new.author_name, new.author_university, new.author_major
  from public.profiles p
  where p.id = new.user_id;
  return new;
end;
$$;

drop trigger if exists posts_00_guard_integrity on public.posts;
create trigger posts_00_guard_integrity
  before insert or update on public.posts
  for each row execute function public._guard_post_integrity();

revoke insert, update on table public.posts from public, anon, authenticated;
grant insert (title, body, kind, subject, tags, image_url, audio_url, repost_of)
  on table public.posts to authenticated;
-- Expand-phase compatibility: updated_at is accepted but overwritten.
grant update (title, body, kind, subject, tags, image_url, audio_url, updated_at)
  on table public.posts to authenticated;
grant all on table public.posts to service_role;

drop policy if exists feedback_all_own on public.feedback;
drop policy if exists feedback_select_own on public.feedback;
create policy feedback_select_own
  on public.feedback for select to authenticated
  using (user_id = auth.uid());
drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own
  on public.feedback for insert to authenticated
  with check (user_id = auth.uid());

create or replace function public._guard_feedback_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.status := 'open';
    new.created_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists feedback_guard_insert on public.feedback;
create trigger feedback_guard_insert
  before insert on public.feedback
  for each row execute function public._guard_feedback_insert();

revoke all on table public.feedback from public, anon, authenticated;
grant select on table public.feedback to authenticated;
grant insert (category, summary, body) on table public.feedback to authenticated;
grant all on table public.feedback to service_role;

create or replace function public._guard_study_goal_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.created_at := clock_timestamp();
  elsif new.user_id is distinct from old.user_id then
    raise exception 'study goal owner is immutable' using errcode = '42501';
  else
    new.created_at := old.created_at;
  end if;

  if new.user_id is null then
    raise exception 'study goal owner is required' using errcode = '23502';
  end if;
  if new.course_id is not null and not exists (
    select 1 from public.courses c
    where c.id = new.course_id and c.user_id = new.user_id
  ) then
    raise exception 'study goal course must belong to owner' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists study_goals_guard_integrity on public.study_goals;
create trigger study_goals_guard_integrity
  before insert or update on public.study_goals
  for each row execute function public._guard_study_goal_integrity();

drop policy if exists study_goals_own on public.study_goals;
create policy study_goals_own
  on public.study_goals for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (course_id is null or exists (
      select 1 from public.courses c
      where c.id = course_id and c.user_id = auth.uid()
    ))
  );

revoke insert, update on table public.study_goals from public, anon, authenticated;
grant insert (title, exam_date, course_id) on table public.study_goals to authenticated;
grant update (title, exam_date, course_id) on table public.study_goals to authenticated;
grant all on table public.study_goals to service_role;

create or replace function public._guard_study_task_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.user_id := auth.uid(); end if;
    new.created_at := clock_timestamp();
    new.done_at := case when new.done then clock_timestamp() else null end;
  else
    if new.user_id is distinct from old.user_id then
      raise exception 'study task owner is immutable' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    if new.done is distinct from old.done then
      new.done_at := case when new.done then clock_timestamp() else null end;
    else
      new.done_at := old.done_at;
    end if;
  end if;

  if new.user_id is null then
    raise exception 'study task owner is required' using errcode = '23502';
  end if;
  if new.course_id is not null and not exists (
    select 1 from public.courses c
    where c.id = new.course_id and c.user_id = new.user_id
  ) then
    raise exception 'study task course must belong to owner' using errcode = '23514';
  end if;
  if new.material_id is not null and not exists (
    select 1 from public.materials m
    where m.id = new.material_id and m.user_id = new.user_id
  ) then
    raise exception 'study task material must belong to owner' using errcode = '23514';
  end if;
  if new.goal_id is not null and not exists (
    select 1 from public.study_goals g
    where g.id = new.goal_id and g.user_id = new.user_id
  ) then
    raise exception 'study task goal must belong to owner' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists study_tasks_guard_integrity on public.study_tasks;
create trigger study_tasks_guard_integrity
  before insert or update on public.study_tasks
  for each row execute function public._guard_study_task_integrity();

revoke insert, update on table public.study_tasks from public, anon, authenticated;
grant insert (title, due_date, done, done_at, course_id, material_id, goal_id)
  on table public.study_tasks to authenticated;
-- Expand-phase compatibility: done_at is accepted but overwritten.
grant update (title, due_date, done, done_at, course_id, material_id, goal_id)
  on table public.study_tasks to authenticated;
grant all on table public.study_tasks to service_role;

-- ── Frozen daily reward windows and immutable award decisions ────────────────

create table public.point_daily_windows (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  local_date  date not null,
  timezone    text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (user_id, starts_at)
);
create index point_daily_windows_user_end_idx
  on public.point_daily_windows (user_id, ends_at desc);

create table public.point_daily_award_claims (
  business_key      text primary key,
  user_id           uuid not null references auth.users (id) on delete cascade,
  event_type        text not null,
  rule_version      text not null,
  daily_window_id   uuid references public.point_daily_windows (id) on delete restrict,
  daily_limit       integer check (daily_limit is null or daily_limit > 0),
  nominal_amount    integer not null check (nominal_amount > 0),
  awarded_amount    integer not null check (awarded_amount >= 0),
  suppressed_reason text check (suppressed_reason is null or suppressed_reason in ('daily_cap')),
  source_id         uuid,
  target_owner_id   uuid references auth.users (id) on delete set null,
  target_root_key   text,
  metadata          jsonb not null default '{}'::jsonb,
  decided_at        timestamptz not null default now(),
  check (awarded_amount <= nominal_amount),
  check (
    (awarded_amount = 0 and daily_limit is not null and suppressed_reason = 'daily_cap')
    or (awarded_amount > 0 and suppressed_reason is null)
    or (
      awarded_amount = 0
      and rule_version = 'grandfather-v1'
      and daily_window_id is null
      and daily_limit is null
      and suppressed_reason is null
    )
  )
);
create index point_daily_award_claims_window_type_idx
  on public.point_daily_award_claims (daily_window_id, event_type, awarded_amount);
create index point_daily_award_claims_target_idx
  on public.point_daily_award_claims (target_owner_id, decided_at desc);
create index point_daily_award_claims_root_idx
  on public.point_daily_award_claims (target_root_key, decided_at desc);

create table public.point_daily_cap_notifications (
  user_id       uuid not null references auth.users (id) on delete cascade,
  event_type    text not null,
  window_id     uuid not null references public.point_daily_windows (id) on delete cascade,
  notification_id uuid references public.notifications (id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (user_id, event_type, window_id)
);

alter table public.point_event_states
  add column if not exists source_active boolean,
  add column if not exists moderation_suppressed boolean,
  add column if not exists awarded_amount integer,
  add column if not exists decision_rule_version text,
  add column if not exists suppressed_reason text;

-- 0008 registered then-existing content as active without inventing one entry
-- per business key; 0009 subsequently offset its untrusted aggregate opening
-- balance. Such placeholder states must remain worth zero forever. Only a
-- transition-1 positive entry proves that this business key was actually
-- awarded after the ledger cutover and can therefore be reversed/restored.
with grandfathered as (
  select s.business_key,
         exists (
           select 1
           from public.point_entries e
           where e.business_key = s.business_key
             and e.transition_no = 1
             and e.amount > 0
         ) as actually_awarded
  from public.point_event_states s
  where s.source_active is null
     or s.moderation_suppressed is null
     or s.awarded_amount is null
     or s.decision_rule_version is null
)
update public.point_event_states s
set source_active = s.is_active,
    moderation_suppressed = false,
    awarded_amount = case when g.actually_awarded then s.reward_amount else 0 end,
    is_active = s.is_active and g.actually_awarded,
    decision_rule_version = 'grandfather-v1',
    suppressed_reason = null
from grandfathered g
where g.business_key = s.business_key;

-- A backfilled 0008 state could have been deleted before this release. The old
-- state machine then wrote a negative transition despite there never being a
-- per-business positive award; its clamped Profile looked like zero, but the
-- negative ledger balance would consume future legitimate points. Preserve
-- that history and append one explicit compensation so every untrusted
-- grandfather business key has a provable net zero.
with corrections as (
  select s.business_key,
         s.user_id,
         s.event_type,
         s.source_id,
         s.transition_no + 1 as transition_no,
         s.last_entry_id,
         (-sum(e.amount))::integer as amount
  from public.point_event_states s
  join public.point_entries e on e.business_key = s.business_key
  where s.decision_rule_version = 'grandfather-v1'
    and s.awarded_amount = 0
  group by s.business_key, s.user_id, s.event_type, s.source_id,
           s.transition_no, s.last_entry_id
  having sum(e.amount) < 0
), inserted as (
  insert into public.point_entries (
    user_id, event_type, business_key, amount, rule_version, source_id,
    transition_no, reversal_of, metadata
  )
  select c.user_id, c.event_type, c.business_key, c.amount,
         'grandfather-zero-reset-v1', c.source_id, c.transition_no,
         c.last_entry_id, jsonb_build_object(
           'migration', '20260810000039',
           'reason', 'untrusted backfill had no per-business positive award'
         )
  from corrections c
  returning id, business_key, transition_no
)
update public.point_event_states s
set transition_no = i.transition_no,
    last_entry_id = i.id,
    updated_at = now()
from inserted i
where i.business_key = s.business_key;

-- Re-project only users touched by the explicit grandfather correction. This
-- removes negative legacy debt while preserving every independently proven
-- post-ledger award and the existing level thresholds.
with affected as (
  select distinct e.user_id
  from public.point_entries e
  where e.rule_version = 'grandfather-zero-reset-v1'
    and e.metadata ->> 'migration' = '20260810000039'
), balances as (
  select a.user_id,
         greatest(
           0::bigint,
           least(2147483647::bigint, coalesce(sum(e.amount), 0::bigint))
         )::integer as points
  from affected a
  left join public.point_entries e on e.user_id = a.user_id
  group by a.user_id
), derived as (
  select b.user_id, b.points,
         case
           when b.points >= 1200 then 6
           when b.points >= 700 then 5
           when b.points >= 350 then 4
           when b.points >= 150 then 3
           when b.points >= 50 then 2
           else 1
         end as level
  from balances b
)
update public.profiles p
set points = d.points,
    level = d.level,
    level_name = case d.level
      when 6 then 'Luminary'
      when 5 then 'Sage'
      when 4 then 'Mentor'
      when 3 then 'Scholar'
      when 2 then 'Learner'
      else 'Novice'
    end
from derived d
where p.id = d.user_id;

alter table public.point_event_states
  alter column source_active set not null,
  alter column source_active set default false,
  alter column moderation_suppressed set not null,
  alter column moderation_suppressed set default false,
  alter column awarded_amount set not null,
  alter column decision_rule_version set not null,
  add constraint point_event_states_awarded_amount_check
    check (awarded_amount between 0 and reward_amount),
  add constraint point_event_states_suppressed_reason_check
    check (suppressed_reason is null or suppressed_reason in ('daily_cap', 'moderation'));

create or replace function public._root_post_owner(p_post_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive chain as (
    select p.id, p.user_id, p.repost_of from public.posts p where p.id = p_post_id
    union all
    select parent.id, parent.user_id, parent.repost_of
    from public.posts parent join chain child on parent.id = child.repost_of
  )
  select c.user_id from chain c where c.repost_of is null limit 1;
$$;

insert into public.point_daily_award_claims (
  business_key, user_id, event_type, rule_version, daily_window_id, daily_limit,
  nominal_amount, awarded_amount, suppressed_reason, source_id,
  target_owner_id, target_root_key, metadata, decided_at
)
select s.business_key, s.user_id, s.event_type, 'grandfather-v1', null, null,
       s.reward_amount, s.awarded_amount, null, s.source_id,
       nullif(s.metadata ->> 'target_owner_id', '')::uuid,
       nullif(s.metadata ->> 'root_business_key', ''),
       s.metadata || jsonb_build_object('grandfathered', true), s.created_at
from public.point_event_states s
on conflict (business_key) do nothing;

-- Enrich still-existing pre-migration community facts. Deleted historical
-- events remain grandfathered and idempotent, but cannot be falsely attached
-- to a root that can no longer be proven from relational data.
update public.point_daily_award_claims c
set target_owner_id = case when p.repost_of is null
                           then p.user_id else public._root_post_owner(p.repost_of) end,
    target_root_key = case when p.repost_of is null
                           then p.points_business_key else public._root_post_points_key(p.repost_of) end,
    metadata = c.metadata || jsonb_build_object(
      'target_owner_id', case when p.repost_of is null
                              then p.user_id else public._root_post_owner(p.repost_of) end,
      'root_business_key', case when p.repost_of is null
                                then p.points_business_key else public._root_post_points_key(p.repost_of) end
    )
from public.posts p
where c.business_key = p.points_business_key;

update public.point_daily_award_claims c
set target_owner_id = p.user_id,
    target_root_key = public._root_post_points_key(p.id),
    metadata = c.metadata || jsonb_build_object(
      'target_owner_id', p.user_id,
      'root_business_key', public._root_post_points_key(p.id)
    )
from public.post_likes l
join public.posts p on p.id = l.post_id
where c.business_key = l.points_business_key;

update public.point_daily_award_claims c
set target_owner_id = p.user_id,
    target_root_key = public._root_post_points_key(p.id),
    metadata = c.metadata || jsonb_build_object(
      'target_owner_id', p.user_id,
      'root_business_key', public._root_post_points_key(p.id)
    )
from public.comments x
join public.posts p on p.id = x.post_id
where c.business_key = x.points_business_key;

update public.point_event_states s
set metadata = s.metadata || jsonb_build_object(
  'target_owner_id', c.target_owner_id,
  'root_business_key', c.target_root_key
)
from public.point_daily_award_claims c
where c.business_key = s.business_key
  and c.target_root_key is not null;

create or replace function public._point_daily_limit(p_event_type text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_event_type
    when 'post_created' then 3
    when 'repost_created' then 10
    when 'comment_created' then 10
    when 'like_created' then 20
    when 'task_completed' then 10
    else null
  end;
$$;

create or replace function public._point_daily_bounds(
  p_timezone text,
  p_now timestamptz,
  p_previous_end timestamptz
)
returns table (
  resolved_timezone text,
  local_date date,
  starts_at timestamptz,
  ends_at timestamptz
)
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  v_timezone text := p_timezone;
  v_local_date date;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_now is null then
    raise exception 'point daily window time is required' using errcode = '22023';
  end if;
  if v_timezone is null or not exists (
    select 1 from pg_catalog.pg_timezone_names z where z.name = v_timezone
  ) then
    v_timezone := 'UTC';
  end if;
  v_local_date := (p_now at time zone v_timezone)::date;
  v_start := v_local_date::timestamp at time zone v_timezone;
  v_end := (v_local_date + 1)::timestamp at time zone v_timezone;
  if p_previous_end is not null and v_start < p_previous_end then
    v_start := p_previous_end;
  end if;
  if v_end <= v_start then
    v_end := v_start + interval '24 hours';
  end if;
  return query select v_timezone, v_local_date, v_start, v_end;
end;
$$;

create or replace function public._point_daily_window(p_user_id uuid)
returns public.point_daily_windows
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_window public.point_daily_windows%rowtype;
  v_previous public.point_daily_windows%rowtype;
  v_timezone text;
  v_local_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('point-daily-window:' || p_user_id::text, 408100039)
  );

  select * into v_previous
  from public.point_daily_windows
  where user_id = p_user_id
  order by ends_at desc
  limit 1
  for update;
  if found and v_previous.ends_at > v_now then
    return v_previous;
  end if;

  select p.timezone into v_timezone
  from public.profiles p
  where p.id = p_user_id;
  select b.resolved_timezone, b.local_date, b.starts_at, b.ends_at
  into v_timezone, v_local_date, v_start, v_end
  from public._point_daily_bounds(
    v_timezone,
    v_now,
    case when v_previous.id is null then null else v_previous.ends_at end
  ) b;

  insert into public.point_daily_windows (
    user_id, local_date, timezone, starts_at, ends_at
  ) values (
    p_user_id, v_local_date, v_timezone, v_start, v_end
  )
  on conflict (user_id, starts_at) do update set user_id = excluded.user_id
  returning * into v_window;
  return v_window;
end;
$$;

create or replace function public._refresh_point_projection(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_points integer;
  v_level integer;
begin
  select greatest(
           0::bigint,
           least(2147483647::bigint, coalesce(sum(e.amount), 0::bigint))
         )::integer
  into v_points
  from public.point_entries e
  where e.user_id = p_user_id;
  v_level := case
    when v_points >= 1200 then 6
    when v_points >= 700 then 5
    when v_points >= 350 then 4
    when v_points >= 150 then 3
    when v_points >= 50 then 2
    else 1
  end;
  update public.profiles
  set points = v_points,
      level = v_level,
      level_name = case v_level
        when 6 then 'Luminary'
        when 5 then 'Sage'
        when 4 then 'Mentor'
        when 3 then 'Scholar'
        when 2 then 'Learner'
        else 'Novice'
      end
  where id = p_user_id;
end;
$$;

-- Preserve the published seven-argument signature so the application and the
-- existing learning workflow remain rollback-compatible. The function now
-- freezes the first award decision and separates source state, moderation state
-- and effective ledger state.
create or replace function public._set_point_event(
  p_user_id uuid,
  p_event_type text,
  p_business_key text,
  p_reward_amount integer,
  p_active boolean,
  p_source_id uuid,
  p_metadata jsonb
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_state public.point_event_states%rowtype;
  v_claim public.point_daily_award_claims%rowtype;
  v_window public.point_daily_windows%rowtype;
  v_daily_limit integer;
  v_daily_used integer;
  v_awarded integer;
  v_effective boolean;
  v_transition integer;
  v_delta integer;
  v_entry_id bigint;
  v_target_owner uuid;
  v_target_root text;
  v_notification_id uuid;
begin
  if p_user_id is null or coalesce(p_event_type, '') = ''
     or coalesce(p_business_key, '') = '' or p_reward_amount <= 0 then
    raise exception 'invalid point event' using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id)
     or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    if not p_active then return 0; end if;
    raise exception 'profile not found for point event user %', p_user_id
      using errcode = '23503';
  end if;

  -- Ordinary reward transitions share this gate. The rare moderation workflow
  -- takes its exclusive form before locking profiles/states, eliminating the
  -- inverse state->profile lock order and its deadlock window without
  -- serializing unrelated reward traffic with each other.
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('point-moderation-gate', 408100039)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_key, 785407621)
  );
  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    if not p_active then return 0; end if;
    raise exception 'profile not found for point event user %', p_user_id
      using errcode = '23503';
  end if;

  -- An inactive call for a business key that never existed is a cleanup no-op;
  -- do not leave an internal state row without its immutable award claim.
  if not p_active and not exists (
    select 1 from public.point_event_states s where s.business_key = p_business_key
  ) then
    return 0;
  end if;

  insert into public.point_event_states (
    business_key, user_id, event_type, reward_amount, is_active, source_active,
    moderation_suppressed, awarded_amount, decision_rule_version,
    suppressed_reason, source_id, metadata
  ) values (
    p_business_key, p_user_id, p_event_type, p_reward_amount, false, false,
    false, 0, 'points-v2-daily-caps', null, p_source_id,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (business_key) do nothing;

  select * into v_state
  from public.point_event_states
  where business_key = p_business_key
  for update;
  if v_state.user_id is distinct from p_user_id
     or v_state.event_type is distinct from p_event_type
     or v_state.reward_amount is distinct from p_reward_amount then
    raise exception 'point business key collision: %', p_business_key
      using errcode = '23514';
  end if;

  select * into v_claim
  from public.point_daily_award_claims
  where business_key = p_business_key;

  if v_claim.business_key is null and p_active then
    v_daily_limit := public._point_daily_limit(p_event_type);
    v_target_owner := nullif(coalesce(p_metadata, '{}'::jsonb) ->> 'target_owner_id', '')::uuid;
    v_target_root := nullif(coalesce(p_metadata, '{}'::jsonb) ->> 'root_business_key', '');
    if v_daily_limit is null then
      v_awarded := p_reward_amount;
    else
      v_window := public._point_daily_window(p_user_id);
      select count(*)::integer into v_daily_used
      from public.point_daily_award_claims c
      where c.daily_window_id = v_window.id
        and c.event_type = p_event_type
        and c.awarded_amount > 0;
      v_awarded := case when v_daily_used < v_daily_limit then p_reward_amount else 0 end;
    end if;

    insert into public.point_daily_award_claims (
      business_key, user_id, event_type, rule_version, daily_window_id,
      daily_limit, nominal_amount, awarded_amount, suppressed_reason, source_id,
      target_owner_id, target_root_key, metadata
    ) values (
      p_business_key, p_user_id, p_event_type, 'points-v2-daily-caps',
      v_window.id, v_daily_limit, p_reward_amount, v_awarded,
      case when v_awarded = 0 and v_daily_limit is not null then 'daily_cap' else null end,
      p_source_id, v_target_owner, v_target_root, coalesce(p_metadata, '{}'::jsonb)
    )
    returning * into v_claim;

    -- The business write and its first cap notification are one authoritative
    -- transaction. A slow/offline client may never fetch the optional receipt,
    -- so notification durability cannot depend on that follow-up request.
    if v_claim.suppressed_reason = 'daily_cap' then
      insert into public.point_daily_cap_notifications (user_id, event_type, window_id)
      values (p_user_id, v_claim.event_type, v_claim.daily_window_id)
      on conflict do nothing;
      if found then
        insert into public.notifications (user_id, type, title, body)
        values (
          p_user_id,
          'points_daily_cap',
          'Daily points limit reached / 今日积分已达上限',
          'This action succeeded but did not award points. / 本次操作已成功，但不再奖励积分。'
        ) returning id into v_notification_id;
        update public.point_daily_cap_notifications
        set notification_id = v_notification_id
        where user_id = p_user_id
          and event_type = v_claim.event_type
          and window_id = v_claim.daily_window_id;
      end if;
    end if;
  end if;

  if v_claim.business_key is null then
    update public.point_event_states
    set source_active = false,
        source_id = p_source_id,
        metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
        updated_at = now()
    where business_key = p_business_key;
    return 0;
  end if;

  v_awarded := v_claim.awarded_amount;
  v_effective := p_active and not v_state.moderation_suppressed and v_awarded > 0;

  update public.point_event_states
  set source_active = p_active,
      awarded_amount = v_awarded,
      decision_rule_version = v_claim.rule_version,
      suppressed_reason = case
        when moderation_suppressed then 'moderation'
        when v_claim.suppressed_reason = 'daily_cap' then 'daily_cap'
        else null
      end,
      source_id = p_source_id,
      metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  where business_key = p_business_key;

  if v_state.is_active = v_effective then return 0; end if;

  v_transition := v_state.transition_no + 1;
  v_delta := case when v_effective then v_awarded else -v_awarded end;
  insert into public.point_entries (
    user_id, event_type, business_key, amount, rule_version, source_id,
    transition_no, reversal_of, metadata
  ) values (
    p_user_id, p_event_type, p_business_key, v_delta, v_claim.rule_version,
    p_source_id, v_transition, v_state.last_entry_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'active', v_effective,
      'sourceActive', p_active,
      'moderationSuppressed', v_state.moderation_suppressed
    )
  ) returning id into v_entry_id;

  update public.point_event_states
  set is_active = v_effective,
      transition_no = v_transition,
      last_entry_id = v_entry_id,
      updated_at = now()
  where business_key = p_business_key;
  perform public._refresh_point_projection(p_user_id);
  return case when v_effective then v_transition else -v_transition end;
end;
$$;

-- ── Enrich community reward facts for moderation and collusion detection ────

create or replace function public._root_post_owner(p_post_id uuid)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive chain as (
    select p.id, p.user_id, p.repost_of from public.posts p where p.id = p_post_id
    union all
    select parent.id, parent.user_id, parent.repost_of
    from public.posts parent join chain child on parent.id = child.repost_of
  )
  select c.user_id from chain c where c.repost_of is null limit 1;
$$;

create or replace function public._on_like()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_who text;
  v_title text;
  v_key text;
  v_root text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then return null; end if;
    v_key := old.points_business_key;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 785407621));
    if not exists (select 1 from public.post_likes l where l.points_business_key = v_key) then
      perform public._set_point_event(old.user_id, 'like_created', v_key, 1, false, old.post_id,
        jsonb_build_object('post_id', old.post_id));
    end if;
    return null;
  end if;
  select p.user_id, p.title, public._root_post_points_key(p.id)
  into v_owner, v_title, v_root from public.posts p where p.id = new.post_id;
  if v_owner is not null and v_owner <> new.user_id then
    perform public._set_point_event(new.user_id, 'like_created', new.points_business_key, 1, true, new.post_id,
      jsonb_build_object('post_id', new.post_id, 'target_owner_id', v_owner,
                         'root_business_key', v_root));
    select username into v_who from public.profiles where id = new.user_id;
    perform public._notify(v_owner, 'like', '收到一个赞',
      coalesce(v_who, '有人') || ' 赞了你的帖子' || coalesce(' 《' || v_title || '》', ''));
  end if;
  return null;
end;
$$;

create or replace function public._on_comment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_who text;
  v_title text;
  v_key text;
  v_root text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then return null; end if;
    v_key := old.points_business_key;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 785407621));
    if not exists (select 1 from public.comments c where c.points_business_key = v_key) then
      perform public._set_point_event(old.user_id, 'comment_created', v_key, 2, false, old.id,
        jsonb_build_object('post_id', old.post_id));
    end if;
    return null;
  end if;
  select p.user_id, p.title, public._root_post_points_key(p.id)
  into v_owner, v_title, v_root from public.posts p where p.id = new.post_id;
  if v_owner is not null and v_owner <> new.user_id then
    perform public._set_point_event(new.user_id, 'comment_created', new.points_business_key, 2, true, new.id,
      jsonb_build_object('post_id', new.post_id, 'target_owner_id', v_owner,
                         'root_business_key', v_root));
    select username into v_who from public.profiles where id = new.user_id;
    perform public._notify(v_owner, 'comment', '收到新评论',
      coalesce(v_who, '有人') || ' 评论了你的帖子' || coalesce(' 《' || v_title || '》', ''));
  end if;
  return null;
end;
$$;

create or replace function public._on_post()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_root_owner uuid;
  v_root text;
  v_who text;
  v_event_type text;
  v_reward integer;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then return null; end if;
    v_event_type := case when old.repost_of is null then 'post_created' else 'repost_created' end;
    v_reward := case when old.repost_of is null then 10 else 3 end;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(old.points_business_key, 785407621));
    if not exists (select 1 from public.posts p where p.points_business_key = old.points_business_key) then
      perform public._set_point_event(old.user_id, v_event_type, old.points_business_key,
        v_reward, false, old.id, jsonb_build_object('repost_of', old.repost_of));
    end if;
    return null;
  end if;

  v_event_type := case when new.repost_of is null then 'post_created' else 'repost_created' end;
  v_reward := case when new.repost_of is null then 10 else 3 end;
  if new.repost_of is null then
    v_root := new.points_business_key;
    v_root_owner := new.user_id;
  else
    v_root := public._root_post_points_key(new.repost_of);
    v_root_owner := public._root_post_owner(new.repost_of);
  end if;
  perform public._set_point_event(new.user_id, v_event_type, new.points_business_key,
    v_reward, true, new.id, jsonb_build_object(
      'repost_of', new.repost_of,
      'target_owner_id', v_root_owner,
      'root_business_key', v_root
    ));

  if new.repost_of is not null then
    select user_id into v_owner from public.posts where id = new.repost_of;
    if v_owner is not null and v_owner <> new.user_id then
      select username into v_who from public.profiles where id = new.user_id;
      perform public._notify(v_owner, 'repost', '帖子被转发',
        coalesce(v_who, '有人') || ' 转发了你的帖子');
    end if;
  end if;
  return null;
end;
$$;

-- ── Owner reward receipt (the only authenticated RPC added here) ────────────

create or replace function public.get_point_reward_receipt(
  p_event_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_user_id uuid := auth.uid();
  v_state public.point_event_states%rowtype;
  v_claim public.point_daily_award_claims%rowtype;
  v_used integer;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_state
  from public.point_event_states s
  where s.user_id = v_user_id
    and s.event_type = p_event_type
    and s.source_id = p_source_id
  order by s.updated_at desc
  limit 1;
  if not found then
    raise exception 'point reward receipt not found' using errcode = 'P0002';
  end if;
  select * into strict v_claim
  from public.point_daily_award_claims c
  where c.business_key = v_state.business_key;
  if v_claim.daily_window_id is not null then
    select count(*)::integer into v_used
    from public.point_daily_award_claims c
    where c.daily_window_id = v_claim.daily_window_id
      and c.event_type = v_claim.event_type
      and c.awarded_amount > 0;
  end if;

  return jsonb_build_object(
    'awardedAmount', v_claim.awarded_amount,
    'dailyUsed', case when v_claim.daily_window_id is null then null else v_used end,
    'dailyLimit', v_claim.daily_limit,
    'localDate', (select w.local_date from public.point_daily_windows w where w.id = v_claim.daily_window_id),
    'suppressedReason', case
      when v_state.moderation_suppressed then 'moderation'
      else v_claim.suppressed_reason
    end
  );
end;
$$;

-- ── Moderation audit and server-only reward suppression/restoration ─────────

create table public.point_moderation_actions (
  id                   bigint generated always as identity primary key,
  -- Retain the actor UUID in the immutable audit even if that admin account is
  -- later deleted; an FK would either erase attribution or block Auth deletion.
  admin_user_id        uuid not null,
  action               text not null check (action in ('suppress', 'restore')),
  target_type          text not null check (target_type in ('business_key', 'post_root')),
  target_key           text not null,
  reason               text not null check (char_length(btrim(reason)) between 3 and 1000),
  case_reference       text check (case_reference is null or char_length(case_reference) <= 200),
  affected_event_count integer not null default 0 check (affected_event_count >= 0),
  affected_amount      integer not null default 0 check (affected_amount >= 0),
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now()
);
create index point_moderation_actions_target_idx
  on public.point_moderation_actions (target_type, target_key, created_at desc);

create or replace function public.moderate_point_rewards(
  p_admin_user_id uuid,
  p_action text,
  p_target_type text,
  p_target_key text,
  p_reason text,
  p_case_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_state public.point_event_states%rowtype;
  v_entry_id bigint;
  v_transition integer;
  v_affected_count integer := 0;
  v_matched_count integer := 0;
  v_affected_amount integer := 0;
  v_action_id bigint;
  v_effective boolean;
  v_touched_users uuid[] := array[]::uuid[];
  v_user uuid;
  v_target_type text := p_target_type;
  v_target_key text := btrim(coalesce(p_target_key, ''));
begin
  if p_admin_user_id is null
     or p_action not in ('suppress', 'restore')
     or p_target_type not in ('business_key', 'post_root', 'post')
     or char_length(btrim(coalesce(p_target_key, ''))) < 3
     or char_length(btrim(coalesce(p_target_key, ''))) > 512
     or char_length(btrim(coalesce(p_reason, ''))) < 3
     or char_length(coalesce(p_reason, '')) > 1000
     or char_length(coalesce(p_case_reference, '')) > 200 then
    raise exception 'invalid point moderation action' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_admin_user_id) then
    raise exception 'moderation admin not found' using errcode = '23503';
  end if;

  -- Exclude all point transitions before taking profile/state locks. Every
  -- `_set_point_event` call takes the shared form first, so moderation cannot
  -- deadlock against the normal business-key -> profile -> state order.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('point-moderation-gate', 408100039)
  );
  if v_target_type = 'post' then
    begin
      v_target_key := public._root_post_points_key(v_target_key::uuid);
    exception when invalid_text_representation then
      raise exception 'invalid moderation post id' using errcode = '22023';
    end;
    if v_target_key is null then
      raise exception 'point moderation post not found' using errcode = 'P0002';
    end if;
    v_target_type := 'post_root';
  end if;

  -- Lock every affected projection in deterministic order before state rows,
  -- matching the normal points transaction's profile-before-state invariant.
  perform p.id
  from public.profiles p
  where p.id in (
    select distinct s.user_id
    from public.point_event_states s
    where (v_target_type = 'business_key' and s.business_key = v_target_key)
       or (v_target_type = 'post_root' and (
         s.metadata ->> 'root_business_key' = v_target_key
         or s.business_key = v_target_key
       ))
  )
  order by p.id
  for update;

  for v_state in
    select s.*
    from public.point_event_states s
    where (v_target_type = 'business_key' and s.business_key = v_target_key)
       or (v_target_type = 'post_root' and (
         s.metadata ->> 'root_business_key' = v_target_key
         or s.business_key = v_target_key
       ))
    order by s.business_key
    for update
  loop
    v_matched_count := v_matched_count + 1;
    if (p_action = 'suppress' and v_state.moderation_suppressed)
       or (p_action = 'restore' and not v_state.moderation_suppressed) then
      continue;
    end if;
    v_effective := p_action = 'restore'
      and v_state.source_active
      and v_state.awarded_amount > 0;
    if v_state.is_active is distinct from v_effective then
      v_transition := v_state.transition_no + 1;
      insert into public.point_entries (
        user_id, event_type, business_key, amount, rule_version, source_id,
        transition_no, reversal_of, metadata
      ) values (
        v_state.user_id, v_state.event_type, v_state.business_key,
        case when v_effective then v_state.awarded_amount else -v_state.awarded_amount end,
        'points-v2-moderation', v_state.source_id, v_transition,
        v_state.last_entry_id, jsonb_build_object(
          'moderationAction', p_action,
          'reason', btrim(p_reason),
          'caseReference', nullif(btrim(coalesce(p_case_reference, '')), '')
        )
      ) returning id into v_entry_id;
      update public.point_event_states
      set is_active = v_effective,
          moderation_suppressed = (p_action = 'suppress'),
          suppressed_reason = case
            when p_action = 'suppress' then 'moderation'
            when awarded_amount = 0
             and decision_rule_version <> 'grandfather-v1' then 'daily_cap'
            else null
          end,
          transition_no = v_transition,
          last_entry_id = v_entry_id,
          updated_at = now()
      where business_key = v_state.business_key;
      v_affected_amount := v_affected_amount + v_state.awarded_amount;
    else
      update public.point_event_states
      set moderation_suppressed = (p_action = 'suppress'),
          suppressed_reason = case
            when p_action = 'suppress' then 'moderation'
            when awarded_amount = 0
             and decision_rule_version <> 'grandfather-v1' then 'daily_cap'
            else null
          end,
          updated_at = now()
      where business_key = v_state.business_key;
    end if;
    v_affected_count := v_affected_count + 1;
    if not v_state.user_id = any(v_touched_users) then
      v_touched_users := array_append(v_touched_users, v_state.user_id);
    end if;
  end loop;

  if v_matched_count = 0 then
    raise exception 'point moderation target not found' using errcode = 'P0002';
  end if;
  foreach v_user in array v_touched_users loop
    perform public._refresh_point_projection(v_user);
  end loop;
  insert into public.point_moderation_actions (
    admin_user_id, action, target_type, target_key, reason, case_reference,
    affected_event_count, affected_amount
  ) values (
    p_admin_user_id, p_action, v_target_type, v_target_key, btrim(p_reason),
    nullif(btrim(coalesce(p_case_reference, '')), ''),
    v_affected_count, v_affected_amount
  ) returning id into v_action_id;
  return jsonb_build_object(
    'id', v_action_id,
    'action', p_action,
    'targetType', v_target_type,
    'targetKey', v_target_key,
    'affectedEventCount', v_affected_count,
    'affectedAmount', v_affected_amount
  );
end;
$$;

-- ── Collaboration signals and privacy-preserving API abuse audit ────────────

create table public.point_abuse_signals (
  id              uuid primary key default extensions.gen_random_uuid(),
  signal_type     text not null check (signal_type in (
                    'owner_concentration', 'reciprocal_pair', 'interaction_cluster',
                    'new_account_burst'
                  )),
  fingerprint     text not null unique,
  account_ids     uuid[] not null,
  target_owner_id uuid references auth.users (id) on delete set null,
  target_root_key text,
  window_start    timestamptz not null,
  window_end      timestamptz not null,
  metrics         jsonb not null default '{}'::jsonb,
  status          text not null default 'pending'
                  check (status in ('pending', 'reviewing', 'dismissed', 'escalated')),
  reviewer_user_id uuid references auth.users (id) on delete set null,
  review_note     text,
  case_reference  text,
  detected_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  check (cardinality(account_ids) between 1 and 64),
  check (window_end > window_start)
);
create index point_abuse_signals_status_idx
  on public.point_abuse_signals (status, detected_at desc);

create or replace function public.review_point_abuse_signal(
  p_reviewer_user_id uuid,
  p_signal_id uuid,
  p_status text,
  p_review_note text default null,
  p_case_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_signal public.point_abuse_signals%rowtype;
begin
  if p_reviewer_user_id is null
     or p_status not in ('reviewing', 'dismissed', 'escalated')
     or char_length(coalesce(p_review_note, '')) > 2000
     or char_length(coalesce(p_case_reference, '')) > 200 then
    raise exception 'invalid abuse signal review' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_reviewer_user_id) then
    raise exception 'signal reviewer not found' using errcode = '23503';
  end if;
  update public.point_abuse_signals
  set status = p_status,
      reviewer_user_id = p_reviewer_user_id,
      review_note = nullif(btrim(coalesce(p_review_note, '')), ''),
      case_reference = nullif(btrim(coalesce(p_case_reference, '')), ''),
      reviewed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = p_signal_id
  returning * into v_signal;
  if not found then
    raise exception 'abuse signal not found' using errcode = 'P0002';
  end if;
  return to_jsonb(v_signal);
end;
$$;

create table public.api_abuse_events (
  id          bigint generated always as identity primary key,
  actor_hmac  text not null check (char_length(actor_hmac) = 64),
  user_id     uuid references auth.users (id) on delete set null,
  route_group text not null,
  rule        text not null,
  bucket_start timestamptz not null,
  event_count bigint not null default 1 check (event_count > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata    jsonb not null default '{}'::jsonb,
  unique (actor_hmac, route_group, rule, bucket_start)
);
create index api_abuse_events_retention_idx on public.api_abuse_events (last_seen_at);

create or replace function public.record_api_abuse_event(
  p_actor_hmac text,
  p_user_id uuid,
  p_route_group text,
  p_rule text,
  p_bucket_start timestamptz,
  p_event_count bigint,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_actor_hmac !~ '^[0-9a-f]{64}$'
     or char_length(btrim(coalesce(p_route_group, ''))) not between 1 and 100
     or char_length(btrim(coalesce(p_rule, ''))) not between 1 and 100
     or p_bucket_start is null or p_event_count <= 0 then
    raise exception 'invalid API abuse audit event' using errcode = '22023';
  end if;
  insert into public.api_abuse_events (
    actor_hmac, user_id, route_group, rule, bucket_start, event_count, metadata
  ) values (
    p_actor_hmac, p_user_id, btrim(p_route_group), btrim(p_rule),
    p_bucket_start, p_event_count, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (actor_hmac, route_group, rule, bucket_start) do update
  set event_count = greatest(public.api_abuse_events.event_count, excluded.event_count),
      last_seen_at = now(),
      metadata = public.api_abuse_events.metadata || excluded.metadata;
end;
$$;

create or replace function public.prune_api_abuse_events()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_count integer;
begin
  delete from public.api_abuse_events where last_seen_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.scan_point_abuse_signals()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket timestamptz := date_trunc('hour', clock_timestamp());
  v_ten_minute_bucket timestamptz := date_trunc('hour', clock_timestamp())
    + floor(extract(minute from clock_timestamp()) / 10) * interval '10 minutes';
  v_count integer := 0;
  v_step_count integer := 0;
begin
  -- Same actor -> same owner: >=8 interactions and >=70% of the actor's day.
  with facts as (
    select c.user_id actor_id, c.target_owner_id owner_id, count(*)::integer n
    from public.point_daily_award_claims c
    where c.decided_at >= v_now - interval '24 hours'
      and c.event_type in ('like_created', 'comment_created', 'repost_created')
      and c.target_owner_id is not null and c.target_owner_id <> c.user_id
    group by c.user_id, c.target_owner_id
  ), totals as (
    select actor_id, sum(n)::integer total from facts group by actor_id
  ), candidates as (
    select f.*, t.total
    from facts f join totals t using (actor_id)
    where f.n >= 8 and f.n::numeric / nullif(t.total, 0) >= 0.70
  )
  insert into public.point_abuse_signals (
    signal_type, fingerprint, account_ids, target_owner_id,
    window_start, window_end, metrics
  )
  select 'owner_concentration',
         encode(extensions.digest('owner_concentration|' || c.actor_id || '|' || c.owner_id || '|' || v_bucket, 'sha256'), 'hex'),
         array[c.actor_id, c.owner_id]::uuid[], c.owner_id,
         v_now - interval '24 hours', v_now,
         jsonb_build_object('interactionCount', c.n, 'actorTotal', c.total,
                            'concentration', round(c.n::numeric / c.total, 4))
  from candidates c
  on conflict (fingerprint) do update
  set metrics = excluded.metrics, window_end = excluded.window_end, updated_at = now();
  get diagnostics v_count = row_count;

  -- Reciprocal pair: >=12 total, each direction >=4.
  with edges as (
    select c.user_id actor_id, c.target_owner_id owner_id, count(*)::integer n
    from public.point_daily_award_claims c
    where c.decided_at >= v_now - interval '24 hours'
      and c.event_type in ('like_created', 'comment_created', 'repost_created')
      and c.target_owner_id is not null and c.target_owner_id <> c.user_id
    group by c.user_id, c.target_owner_id
  ), pairs as (
    select least(a.actor_id, a.owner_id) user_a,
           greatest(a.actor_id, a.owner_id) user_b,
           a.n a_to_b, b.n b_to_a
    from edges a join edges b
      on b.actor_id = a.owner_id and b.owner_id = a.actor_id
    where a.actor_id < a.owner_id and a.n >= 4 and b.n >= 4 and a.n + b.n >= 12
  )
  insert into public.point_abuse_signals (
    signal_type, fingerprint, account_ids, window_start, window_end, metrics
  )
  select 'reciprocal_pair',
         encode(extensions.digest('reciprocal_pair|' || p.user_a || '|' || p.user_b || '|' || v_bucket, 'sha256'), 'hex'),
         array[p.user_a, p.user_b]::uuid[], v_now - interval '24 hours', v_now,
         jsonb_build_object('aToB', p.a_to_b, 'bToA', p.b_to_a,
                            'interactionCount', p.a_to_b + p.b_to_a)
  from pairs p
  on conflict (fingerprint) do update
  set metrics = excluded.metrics, window_end = excluded.window_end, updated_at = now();
  get diagnostics v_step_count = row_count;
  v_count := v_count + v_step_count;

  -- 3-8 account owner-centred connected groups, with >=30 internal interactions
  -- and >=70% concentration among all interactions emitted by group members.
  with raw as (
    select c.user_id actor_id, c.target_owner_id owner_id
    from public.point_daily_award_claims c
    where c.decided_at >= v_now - interval '7 days'
      and c.event_type in ('like_created', 'comment_created', 'repost_created')
      and c.target_owner_id is not null and c.target_owner_id <> c.user_id
  ), candidate_groups as (
    select r.owner_id,
           array_agg(distinct r.actor_id order by r.actor_id) || array[r.owner_id]::uuid[] accounts
    from raw r group by r.owner_id
    having count(distinct r.actor_id) between 2 and 7
  ), normalized as (
    select g.owner_id,
           (select array_agg(distinct x order by x) from unnest(g.accounts) x) accounts
    from candidate_groups g
  ), scored as (
    select n.owner_id, n.accounts,
           count(*) filter (where r.actor_id = any(n.accounts) and r.owner_id = any(n.accounts))::integer internal_n,
           count(*) filter (where r.actor_id = any(n.accounts))::integer total_n
    from normalized n cross join raw r
    group by n.owner_id, n.accounts
  )
  insert into public.point_abuse_signals (
    signal_type, fingerprint, account_ids, target_owner_id,
    window_start, window_end, metrics
  )
  select 'interaction_cluster',
         encode(extensions.digest('interaction_cluster|' || array_to_string(s.accounts, ',') || '|' || date_trunc('day', v_now), 'sha256'), 'hex'),
         s.accounts, s.owner_id, v_now - interval '7 days', v_now,
         jsonb_build_object('internalInteractions', s.internal_n, 'memberInteractions', s.total_n,
                            'concentration', round(s.internal_n::numeric / nullif(s.total_n, 0), 4))
  from scored s
  where cardinality(s.accounts) between 3 and 8
    and s.internal_n >= 30
    and s.internal_n::numeric / nullif(s.total_n, 0) >= 0.70
  on conflict (fingerprint) do update
  set metrics = excluded.metrics, window_end = excluded.window_end, updated_at = now();
  get diagnostics v_step_count = row_count;
  v_count := v_count + v_step_count;

  -- New-account burst: >=8 accounts younger than seven days hit one root/owner.
  with candidates as (
    select c.target_owner_id, c.target_root_key,
           array_agg(distinct c.user_id order by c.user_id) account_ids,
           count(distinct c.user_id)::integer account_count,
           count(*)::integer interaction_count
    from public.point_daily_award_claims c
    join auth.users u on u.id = c.user_id
    where c.decided_at >= v_now - interval '10 minutes'
      and u.created_at >= v_now - interval '7 days'
      and c.event_type in ('like_created', 'comment_created', 'repost_created')
      and (c.target_root_key is not null or c.target_owner_id is not null)
    group by c.target_owner_id, c.target_root_key
    having count(distinct c.user_id) >= 8
  )
  insert into public.point_abuse_signals (
    signal_type, fingerprint, account_ids, target_owner_id, target_root_key,
    window_start, window_end, metrics
  )
  select 'new_account_burst',
         encode(extensions.digest('new_account_burst|' || coalesce(c.target_root_key, '') || '|' || coalesce(c.target_owner_id::text, '') || '|' || v_ten_minute_bucket, 'sha256'), 'hex'),
         c.account_ids, c.target_owner_id, c.target_root_key,
         v_now - interval '10 minutes', v_now,
         jsonb_build_object('accountCount', c.account_count,
                            'interactionCount', c.interaction_count)
  from candidates c
  on conflict (fingerprint) do update
  set metrics = excluded.metrics, window_end = excluded.window_end, updated_at = now();
  get diagnostics v_step_count = row_count;
  v_count := v_count + v_step_count;

  return jsonb_build_object('upserted', v_count, 'scannedAt', v_now);
end;
$$;

-- ── Internal table/function boundary ─────────────────────────────────────────

alter table public.point_daily_windows enable row level security;
alter table public.point_daily_award_claims enable row level security;
alter table public.point_daily_cap_notifications enable row level security;
alter table public.point_moderation_actions enable row level security;
alter table public.point_abuse_signals enable row level security;
alter table public.api_abuse_events enable row level security;

revoke all on table public.point_daily_windows,
  public.point_daily_award_claims,
  public.point_daily_cap_notifications,
  public.point_moderation_actions,
  public.point_abuse_signals,
  public.api_abuse_events
from public, anon, authenticated;
revoke all on table public.point_daily_windows,
  public.point_daily_award_claims,
  public.point_daily_cap_notifications,
  public.point_moderation_actions,
  public.point_abuse_signals,
  public.api_abuse_events
from service_role;
-- The API can inspect these service-only facts, but mutations go through
-- reviewed SECURITY DEFINER workflows. Immutable award decisions and
-- moderation audit rows therefore cannot be rewritten with service-role
-- PostgREST credentials.
grant select on table public.point_daily_windows,
  public.point_daily_award_claims,
  public.point_daily_cap_notifications,
  public.point_moderation_actions,
  public.point_abuse_signals,
  public.api_abuse_events
to service_role;

revoke all on sequence public.point_moderation_actions_id_seq,
  public.api_abuse_events_id_seq
from public, anon, authenticated, service_role;

revoke execute on function public.review_point_abuse_signal(uuid, uuid, text, text, text),
  public._guard_post_integrity(),
  public._guard_feedback_insert(),
  public._guard_study_goal_integrity(),
  public._guard_study_task_integrity(),
  public._point_daily_limit(text),
  public._point_daily_bounds(text, timestamptz, timestamptz),
  public._point_daily_window(uuid),
  public._refresh_point_projection(uuid),
  public._root_post_owner(uuid),
  public.moderate_point_rewards(uuid, text, text, text, text, text),
  public.record_api_abuse_event(text, uuid, text, text, timestamptz, bigint, jsonb),
  public.prune_api_abuse_events(),
  public.scan_point_abuse_signals()
from public, anon, authenticated;

grant execute on function public.review_point_abuse_signal(uuid, uuid, text, text, text),
  public.moderate_point_rewards(uuid, text, text, text, text, text),
  public.record_api_abuse_event(text, uuid, text, text, timestamptz, bigint, jsonb),
  public.prune_api_abuse_events(),
  public.scan_point_abuse_signals()
to service_role;

revoke execute on function public.get_point_reward_receipt(text, uuid)
from public, anon, authenticated;
grant execute on function public.get_point_reward_receipt(text, uuid) to authenticated;

-- Re-assert existing privileged surfaces after CREATE OR REPLACE.
revoke execute on function public._post_author(),
  public._on_like(), public._on_comment(), public._on_post(),
  public._set_point_event(uuid, text, text, integer, boolean, uuid, jsonb)
from public, anon, authenticated;
grant execute on function public._set_point_event(uuid, text, text, integer, boolean, uuid, jsonb)
to service_role;
