-- Nalanda · 0008 profile 敏感列、内部 RPC 与 points 幂等账本
-- 这是向前迁移：不改写已发布的 0001/0006/0007。
--
-- 目标：
-- 1. authenticated 只可更新 profile 的公开资料列；经济/等级/streak 列由数据库维护。
-- 2. 撤销 SECURITY DEFINER helper 的客户端执行权限。
-- 3. 用 append-only point_entries + 持久 point_event_states 记录净奖励；删除/取消会冲正，
--    重建/重做只恢复同一业务事件的净额，不会累计刷分。

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ── Profile：列级白名单 + 防御触发器 ─────────────────────────────────────

revoke update on table public.profiles from public, anon, authenticated;
grant update (username, university, major, year, language)
  on table public.profiles to authenticated;
grant update on table public.profiles to service_role;

create or replace function public._guard_profile_managed_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- SECURITY DEFINER 的内部账本函数以其 owner 身份更新，不能被 JWT 的 auth.uid()
  -- 误拦；直接来自 PostgREST 的普通用户写入则 current_user=authenticated。
  if current_user in ('anon', 'authenticated')
     and row(new.credits, new.points, new.level, new.level_name, new.vip_until,
             new.streak, new.streak_date)
         is distinct from
         row(old.credits, old.points, old.level, old.level_name, old.vip_until,
             old.streak, old.streak_date) then
    raise exception 'profile economy, level and streak fields are server-managed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_managed_fields on public.profiles;
create trigger profiles_guard_managed_fields
  before update on public.profiles
  for each row execute function public._guard_profile_managed_fields();

-- ── 稳定业务键：由数据库生成，客户端不能指定或改写 ────────────────────────

create or replace function public._points_normalize_text(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select lower(regexp_replace(btrim(coalesce(p_value, '')), '[[:space:]]+', ' ', 'g'));
$$;

create or replace function public._post_points_key(
  p_user_id uuid,
  p_title text,
  p_body text,
  p_kind text,
  p_subject text,
  p_tags text[]
)
returns text
language sql
immutable
set search_path = pg_catalog, extensions, public
as $$
  select 'post:' || p_user_id::text || ':' || encode(
    digest(
      concat_ws(
        chr(30),
        public._points_normalize_text(p_title),
        public._points_normalize_text(p_body),
        public._points_normalize_text(p_kind),
        public._points_normalize_text(p_subject),
        coalesce((
          select string_agg(public._points_normalize_text(tag), chr(31)
                            order by public._points_normalize_text(tag))
          from unnest(coalesce(p_tags, array[]::text[])) as tag
        ), '')
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public._task_points_key(
  p_user_id uuid,
  p_title text,
  p_due_date date,
  p_course_id uuid,
  p_material_id uuid,
  p_goal_id uuid
)
returns text
language sql
immutable
set search_path = pg_catalog, extensions, public
as $$
  select 'task:' || p_user_id::text || ':' || encode(
    digest(
      concat_ws(
        chr(30),
        public._points_normalize_text(p_title),
        coalesce((p_due_date - date '2000-01-01')::text, ''),
        coalesce(p_course_id::text, ''),
        coalesce(p_material_id::text, ''),
        coalesce(p_goal_id::text, '')
      ),
      'sha256'
    ),
    'hex'
  ) || ':completed:v1';
$$;

alter table public.posts
  add column if not exists points_business_key text;

update public.posts
set points_business_key = public._post_points_key(user_id, title, body, kind, subject, tags)
where repost_of is null and points_business_key is null;

-- Repost 永久键锚定“根原创内容键”，而不是易因删除重建变化的 post UUID。
-- 历史 repost 由原帖向下递归回填；若旧数据已形成无根环，迁移会在 NOT NULL
-- 处失败，要求先审计修复，不能悄悄生成不稳定键。
with recursive post_anchors as (
  select p.id, p.points_business_key as root_key
  from public.posts p
  where p.repost_of is null
  union all
  select child.id, parent.root_key
  from public.posts child
  join post_anchors parent on parent.id = child.repost_of
)
update public.posts p
set points_business_key = 'repost:' || p.user_id::text || ':' || a.root_key
from post_anchors a
where p.id = a.id
  and p.repost_of is not null
  and p.points_business_key is null;

alter table public.posts
  alter column points_business_key set not null;
create index if not exists posts_points_business_key_idx
  on public.posts (points_business_key);

create or replace function public._root_post_points_key(p_post_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with recursive chain as (
    select p.id, p.repost_of, p.points_business_key
    from public.posts p
    where p.id = p_post_id
    union all
    select parent.id, parent.repost_of, parent.points_business_key
    from public.posts parent
    join chain child on parent.id = child.repost_of
  )
  select c.points_business_key
  from chain c
  where c.repost_of is null
  limit 1;
$$;

create or replace function public._assign_post_points_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_root_key text;
begin
  if new.repost_of is null then
    new.points_business_key := public._post_points_key(
      new.user_id, new.title, new.body, new.kind, new.subject, new.tags
    );
  else
    v_root_key := public._root_post_points_key(new.repost_of);
    if v_root_key is null then
      raise exception 'repost source does not resolve to an original post'
        using errcode = '23503';
    end if;
    new.points_business_key := 'repost:' || new.user_id::text || ':' || v_root_key;
  end if;
  return new;
end;
$$;

create or replace function public._preserve_post_points_key()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.points_business_key is distinct from old.points_business_key
     or new.repost_of is distinct from old.repost_of then
    raise exception 'posts.points_business_key and repost_of are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists posts_assign_points_key on public.posts;
create trigger posts_assign_points_key
  before insert on public.posts
  for each row execute function public._assign_post_points_key();
drop trigger if exists posts_preserve_points_key on public.posts;
create trigger posts_preserve_points_key
  before update of points_business_key, repost_of on public.posts
  for each row execute function public._preserve_post_points_key();

-- Like/comment 也持久化锚定目标帖的不可变内容键。这样作者发布两个相同内容
-- 的 post、或删除后重建相同内容时，同一 actor 仍只占用同一个奖励 claim；
-- 同时在原帖 cascade delete 后无需再查询已经不存在的 parent row 即可冲正。
alter table public.post_likes
  add column if not exists points_business_key text;
update public.post_likes l
set points_business_key = 'like:' || p.points_business_key || ':' || l.user_id::text
from public.posts p
where p.id = l.post_id and l.points_business_key is null;
alter table public.post_likes
  alter column points_business_key set not null;
create index if not exists post_likes_points_business_key_idx
  on public.post_likes (points_business_key);

alter table public.comments
  add column if not exists points_business_key text;
update public.comments c
set points_business_key = 'comment:' || p.points_business_key || ':' || c.user_id::text
from public.posts p
where p.id = c.post_id and c.points_business_key is null;
alter table public.comments
  alter column points_business_key set not null;
create index if not exists comments_points_business_key_idx
  on public.comments (points_business_key);

create or replace function public._assign_like_points_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_post_key text;
begin
  select p.points_business_key into v_post_key
  from public.posts p where p.id = new.post_id;
  if v_post_key is null then
    raise exception 'like target post not found' using errcode = '23503';
  end if;
  new.points_business_key := 'like:' || v_post_key || ':' || new.user_id::text;
  return new;
end;
$$;

create or replace function public._preserve_like_points_key()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.points_business_key is distinct from old.points_business_key
     or new.post_id is distinct from old.post_id
     or new.user_id is distinct from old.user_id then
    raise exception 'post_likes identity and points_business_key are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public._assign_comment_points_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_post_key text;
begin
  select p.points_business_key into v_post_key
  from public.posts p where p.id = new.post_id;
  if v_post_key is null then
    raise exception 'comment target post not found' using errcode = '23503';
  end if;
  new.points_business_key := 'comment:' || v_post_key || ':' || new.user_id::text;
  return new;
end;
$$;

create or replace function public._preserve_comment_points_key()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.points_business_key is distinct from old.points_business_key
     or new.post_id is distinct from old.post_id
     or new.user_id is distinct from old.user_id then
    raise exception 'comments identity and points_business_key are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists likes_assign_points_key on public.post_likes;
create trigger likes_assign_points_key
  before insert on public.post_likes
  for each row execute function public._assign_like_points_key();
drop trigger if exists likes_preserve_points_key on public.post_likes;
create trigger likes_preserve_points_key
  before update of points_business_key, post_id, user_id on public.post_likes
  for each row execute function public._preserve_like_points_key();

drop trigger if exists comments_assign_points_key on public.comments;
create trigger comments_assign_points_key
  before insert on public.comments
  for each row execute function public._assign_comment_points_key();
drop trigger if exists comments_preserve_points_key on public.comments;
create trigger comments_preserve_points_key
  before update of points_business_key, post_id, user_id on public.comments
  for each row execute function public._preserve_comment_points_key();

alter table public.study_tasks
  add column if not exists points_business_key text;

update public.study_tasks
set points_business_key = public._task_points_key(
  user_id, title, due_date, course_id, material_id, goal_id
)
where points_business_key is null;

alter table public.study_tasks
  alter column points_business_key set not null;
create index if not exists study_tasks_points_business_key_idx
  on public.study_tasks (points_business_key);

create or replace function public._assign_task_points_key()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.points_business_key := public._task_points_key(
    new.user_id, new.title, new.due_date, new.course_id, new.material_id, new.goal_id
  );
  return new;
end;
$$;

create or replace function public._preserve_task_points_key()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.points_business_key is distinct from old.points_business_key then
    raise exception 'study_tasks.points_business_key is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_assign_points_key on public.study_tasks;
create trigger tasks_assign_points_key
  before insert on public.study_tasks
  for each row execute function public._assign_task_points_key();
drop trigger if exists tasks_preserve_points_key on public.study_tasks;
create trigger tasks_preserve_points_key
  before update of points_business_key on public.study_tasks
  for each row execute function public._preserve_task_points_key();

-- ── Append-only points 账本和当前业务事件状态 ───────────────────────────────

create table if not exists public.point_entries (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  event_type     text not null,
  business_key   text not null,
  amount         integer not null check (amount <> 0),
  rule_version   text not null default 'points-v1',
  source_id      uuid,
  transition_no  integer not null check (transition_no >= 0),
  reversal_of    bigint references public.point_entries (id) on delete no action,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (business_key, transition_no)
);
create index if not exists point_entries_user_created_idx
  on public.point_entries (user_id, created_at desc);

create table if not exists public.point_event_states (
  business_key   text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  event_type     text not null,
  reward_amount  integer not null check (reward_amount > 0),
  is_active      boolean not null default false,
  transition_no  integer not null default 0 check (transition_no >= 0),
  source_id      uuid,
  last_entry_id  bigint references public.point_entries (id) on delete no action,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists point_event_states_user_idx
  on public.point_event_states (user_id, updated_at desc);

alter table public.point_entries enable row level security;
alter table public.point_event_states enable row level security;

drop policy if exists point_entries_select_own on public.point_entries;
create policy point_entries_select_own
  on public.point_entries for select to authenticated
  using (user_id = auth.uid());

-- 普通客户端只能读自己的 ledger，不能写 ledger，也不能读取/写入内部状态机。
revoke all on table public.point_entries from public, anon, authenticated;
revoke all on table public.point_event_states from public, anon, authenticated;
grant select on table public.point_entries to authenticated;
revoke all on table public.point_entries from service_role;
revoke all on table public.point_event_states from service_role;
revoke all on sequence public.point_entries_id_seq from service_role;
revoke all on sequence public.point_entries_id_seq from public, anon, authenticated;
grant select on table public.point_entries to service_role;
grant select on table public.point_event_states to service_role;

-- 将迁移前的缓存 points 作为 opening balance；无法从旧模型可靠重建历史事件，
-- 所以不伪造逐笔历史。随后回填的 active state 不再加分，只用于未来冲正/去重。
insert into public.point_entries (
  user_id, event_type, business_key, amount, rule_version, transition_no, metadata
)
select p.id,
       'legacy_opening',
       'legacy-opening:' || p.id::text || ':20260710',
       p.points,
       'legacy-import-v1',
       0,
       jsonb_build_object('migration', '20260710000008', 'reason', 'pre-ledger cached balance')
from public.profiles p
where p.points <> 0
on conflict (business_key, transition_no) do nothing;

-- 立即将旧缓存规范化为 ledger projection，避免旧漏洞留下的负 points 或伪造等级
-- 一直保留到下一次积分事件。credits/VIP 没有可重建历史，只在本迁移中锁写。
with balances as (
  select p.id,
         greatest(
           0::bigint,
           least(2147483647::bigint, coalesce(sum(e.amount), 0::bigint))
         )::integer as points
  from public.profiles p
  left join public.point_entries e on e.user_id = p.id
  group by p.id
), derived as (
  select b.id,
         b.points,
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
where p.id = d.id;

-- 现存关系均登记为已消费/active，但不重复增加 opening balance。
insert into public.point_event_states (
  business_key, user_id, event_type, reward_amount, is_active, source_id, metadata
)
select distinct on (p.points_business_key)
       p.points_business_key,
       p.user_id,
       case when p.repost_of is null then 'post_created' else 'repost_created' end,
       case when p.repost_of is null then 10 else 3 end,
       true,
       p.id,
       jsonb_build_object('backfilled', true)
from public.posts p
order by p.points_business_key, p.created_at, p.id
on conflict (business_key) do nothing;

insert into public.point_event_states (
  business_key, user_id, event_type, reward_amount, is_active, source_id, metadata
)
select distinct on (c.points_business_key)
       c.points_business_key,
       c.user_id,
       'comment_created',
       2,
       true,
       c.id,
       jsonb_build_object('backfilled', true)
from public.comments c
order by c.points_business_key, c.created_at, c.id
on conflict (business_key) do nothing;

insert into public.point_event_states (
  business_key, user_id, event_type, reward_amount, is_active, source_id, metadata
)
select distinct on (l.points_business_key)
       l.points_business_key,
       l.user_id,
       'like_created',
       1,
       true,
       l.post_id,
       jsonb_build_object('backfilled', true)
from public.post_likes l
order by l.points_business_key, l.created_at, l.post_id
on conflict (business_key) do nothing;

insert into public.point_event_states (
  business_key, user_id, event_type, reward_amount, is_active, source_id, metadata
)
select distinct on (t.points_business_key)
       t.points_business_key,
       t.user_id,
       'task_completed',
       5,
       true,
       t.id,
       jsonb_build_object('backfilled', true)
from public.study_tasks t
where t.done
order by t.points_business_key, t.created_at, t.id
on conflict (business_key) do nothing;

-- 唯一的 points 状态转换入口。返回 0 表示幂等 no-op；正数为激活 transition，
-- 负数为冲正 transition。相同业务键通过 advisory lock + row lock 串行化。
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
  v_transition integer;
  v_delta integer;
  v_entry_id bigint;
  v_points integer;
  v_level integer;
  v_level_name text;
begin
  if p_user_id is null or coalesce(p_event_type, '') = '' or coalesce(p_business_key, '') = ''
     or p_reward_amount <= 0 then
    raise exception 'invalid point event'
      using errcode = '22023';
  end if;

  -- auth.users 的级联删除可能先删 profile/state，也可能先删业务行；任何 inactive
  -- 清理在账户已不存在时都必须成为 no-op，不能阻断账号删除。active 写入仍失败。
  if not exists (select 1 from auth.users u where u.id = p_user_id)
     or not exists (select 1 from public.profiles p where p.id = p_user_id) then
    if not p_active then
      return 0;
    end if;
    raise exception 'profile not found for point event user %', p_user_id
      using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_key, 785407621)
  );

  -- 不同 business key 也可能同时更新同一用户。先锁 profile，再写 entry，保证
  -- 每次 projection 都能看到前一个已提交状态，且所有调用遵循 advisory→profile
  -- 的一致锁顺序。
  perform 1
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    if not p_active then
      return 0;
    end if;
    raise exception 'profile not found for point event user %', p_user_id
      using errcode = '23503';
  end if;

  insert into public.point_event_states (
    business_key, user_id, event_type, reward_amount, is_active, source_id, metadata
  ) values (
    p_business_key, p_user_id, p_event_type, p_reward_amount, false, p_source_id,
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

  if v_state.is_active = p_active then
    return 0;
  end if;

  v_transition := v_state.transition_no + 1;
  v_delta := case when p_active then p_reward_amount else -p_reward_amount end;

  insert into public.point_entries (
    user_id, event_type, business_key, amount, rule_version, source_id,
    transition_no, reversal_of, metadata
  ) values (
    p_user_id, p_event_type, p_business_key, v_delta, 'points-v1', p_source_id,
    v_transition, v_state.last_entry_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('active', p_active)
  )
  returning id into v_entry_id;

  update public.point_event_states
  set is_active = p_active,
      transition_no = v_transition,
      source_id = p_source_id,
      last_entry_id = v_entry_id,
      metadata = metadata || coalesce(p_metadata, '{}'::jsonb),
      updated_at = now()
  where business_key = p_business_key;

  -- profile.points 只是 ledger projection。必须从账本总和重算再 clamp，不能在
  -- 已 clamp 的缓存上增减，否则 opening=0 的回填事件 delete(-N)→recreate(+N)
  -- 会错误地从 0 变成 +N。
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
  v_level_name := case v_level
    when 6 then 'Luminary'
    when 5 then 'Sage'
    when 4 then 'Mentor'
    when 3 then 'Scholar'
    when 2 then 'Learner'
    else 'Novice'
  end;

  update public.profiles
  set points = v_points,
      level = v_level,
      level_name = v_level_name
  where id = p_user_id;

  return case when p_active then v_transition else -v_transition end;
end;
$$;

-- ── 用状态机替换旧的直接加分触发器 ─────────────────────────────────────────

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
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then
      return null;
    end if;
    v_key := old.points_business_key;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_key, 785407621)
    );
    if not exists (
      select 1 from public.post_likes l
      where l.points_business_key = old.points_business_key
    ) then
      perform public._set_point_event(
        old.user_id, 'like_created', v_key, 1, false, old.post_id,
        jsonb_build_object('post_id', old.post_id)
      );
    end if;
    return null;
  end if;

  select user_id, title into v_owner, v_title
  from public.posts where id = new.post_id;

  -- 自赞不奖励；迁移前自赞若已回填，取消时仍会被上面的 DELETE 分支冲正。
  if v_owner is not null and v_owner <> new.user_id then
    v_key := new.points_business_key;
    perform public._set_point_event(
      new.user_id, 'like_created', v_key, 1, true, new.post_id,
      jsonb_build_object('post_id', new.post_id)
    );
    select username into v_who from public.profiles where id = new.user_id;
    perform public._notify(
      v_owner, 'like', '收到一个赞',
      coalesce(v_who, '有人') || ' 赞了你的帖子' || coalesce(' 《' || v_title || '》', '')
    );
  end if;
  return null;
end;
$$;

drop trigger if exists likes_award on public.post_likes;
create trigger likes_award
  after insert or delete on public.post_likes
  for each row execute function public._on_like();

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
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then
      return null;
    end if;
    v_key := old.points_business_key;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_key, 785407621)
    );
    if not exists (
      select 1 from public.comments c
      where c.points_business_key = old.points_business_key
    ) then
      perform public._set_point_event(
        old.user_id, 'comment_created', v_key, 2, false, old.id,
        jsonb_build_object('post_id', old.post_id)
      );
    end if;
    return null;
  end if;

  select user_id, title into v_owner, v_title
  from public.posts where id = new.post_id;
  if v_owner is not null and v_owner <> new.user_id then
    v_key := new.points_business_key;
    perform public._set_point_event(
      new.user_id, 'comment_created', v_key, 2, true, new.id,
      jsonb_build_object('post_id', new.post_id)
    );
    select username into v_who from public.profiles where id = new.user_id;
    perform public._notify(
      v_owner, 'comment', '收到新评论',
      coalesce(v_who, '有人') || ' 评论了你的帖子' || coalesce(' 《' || v_title || '》', '')
    );
  end if;
  return null;
end;
$$;

drop trigger if exists comments_award on public.comments;
create trigger comments_award
  after insert or delete on public.comments
  for each row execute function public._on_comment();

create or replace function public._on_post()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner uuid;
  v_who text;
  v_event_type text;
  v_reward integer;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then
      return null;
    end if;
    v_event_type := case when old.repost_of is null
                         then 'post_created' else 'repost_created' end;
    v_reward := case when old.repost_of is null then 10 else 3 end;
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(old.points_business_key, 785407621)
    );
    if not exists (
      select 1 from public.posts p
      where p.points_business_key = old.points_business_key
    ) then
      perform public._set_point_event(
        old.user_id, v_event_type, old.points_business_key, v_reward, false, old.id,
        jsonb_build_object('repost_of', old.repost_of)
      );
    end if;
    return null;
  end if;

  v_event_type := case when new.repost_of is null
                       then 'post_created' else 'repost_created' end;
  v_reward := case when new.repost_of is null then 10 else 3 end;

  perform public._set_point_event(
    new.user_id, v_event_type, new.points_business_key, v_reward, true, new.id,
    jsonb_build_object('repost_of', new.repost_of)
  );

  if new.repost_of is not null then
    select user_id into v_owner from public.posts where id = new.repost_of;
    if v_owner is not null and v_owner <> new.user_id then
      select username into v_who from public.profiles where id = new.user_id;
      perform public._notify(
        v_owner, 'repost', '帖子被转发', coalesce(v_who, '有人') || ' 转发了你的帖子'
      );
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists posts_award on public.posts;
create trigger posts_award
  after insert or delete on public.posts
  for each row execute function public._on_post();

create or replace function public._on_task_done()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_key text;
  v_transition integer := 0;
  v_streak integer;
  v_streak_date date;
  v_today date := current_date;
  v_new_streak integer;
begin
  if tg_op = 'DELETE' then
    v_key := old.points_business_key;
  else
    v_key := new.points_business_key;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_key, 785407621)
  );

  if tg_op = 'DELETE' then
    if not exists (select 1 from auth.users u where u.id = old.user_id)
       or not exists (select 1 from public.profiles p where p.id = old.user_id) then
      return null;
    end if;
    if old.done and not exists (
      select 1 from public.study_tasks t
      where t.points_business_key = old.points_business_key and t.done
    ) then
      perform public._set_point_event(
        old.user_id, 'task_completed', old.points_business_key, 5, false, old.id,
        jsonb_build_object('task_id', old.id)
      );
    end if;
    return null;
  end if;

  if new.done then
    v_transition := public._set_point_event(
      new.user_id, 'task_completed', new.points_business_key, 5, true, new.id,
      jsonb_build_object('task_id', new.id)
    );
  elsif old.done and not exists (
    select 1 from public.study_tasks t
    where t.points_business_key = old.points_business_key and t.done
  ) then
    perform public._set_point_event(
      old.user_id, 'task_completed', old.points_business_key, 5, false, old.id,
      jsonb_build_object('task_id', old.id)
    );
  end if;

  -- 只有该永久业务键的第一次成功奖励（transition=1）能推进 streak；
  -- 取消后重做、重复任务和迁移回填任务都不会再次推进。
  if v_transition = 1 then
    select streak, streak_date into v_streak, v_streak_date
    from public.profiles where id = new.user_id;
    if v_streak_date = v_today then
      v_new_streak := coalesce(v_streak, 0);
    elsif v_streak_date = v_today - 1 then
      v_new_streak := coalesce(v_streak, 0) + 1;
    else
      v_new_streak := 1;
    end if;
    update public.profiles
    set streak = v_new_streak, streak_date = v_today
    where id = new.user_id;
    if v_new_streak in (3, 7, 14, 30, 100)
       and v_streak_date is distinct from v_today then
      perform public._notify(
        new.user_id,
        'streak',
        '🔥 连续学习 ' || v_new_streak || ' 天',
        '坚持就是胜利，继续保持！'
      );
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists task_done on public.study_tasks;
drop trigger if exists task_points_update on public.study_tasks;
drop trigger if exists task_points_delete on public.study_tasks;
create trigger task_points_update
  after update of done on public.study_tasks
  for each row execute function public._on_task_done();
create trigger task_points_delete
  after delete on public.study_tasks
  for each row execute function public._on_task_done();

-- ── SECURITY DEFINER 权限收口 ───────────────────────────────────────────────

-- 旧 imperative helper 不再由业务触发器或 service-role 使用。所有 points 写入
-- 必须使用带稳定 business key 的状态转换函数，避免绕过 ledger projection。
revoke execute on function public._add_points(uuid, integer)
  from public, anon, authenticated, service_role;

revoke execute on function public._notify(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public._notify(uuid, text, text, text) to service_role;

revoke execute on function public._set_point_event(uuid, text, text, integer, boolean, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public._set_point_event(uuid, text, text, integer, boolean, uuid, jsonb)
  to service_role;

-- trigger/helper 函数也不需要成为 RPC surface。
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
revoke execute on function public._post_author() from public, anon, authenticated;
revoke execute on function public._comment_author() from public, anon, authenticated;
revoke execute on function public._bump_counts() from public, anon, authenticated;
revoke execute on function public._bump_repost() from public, anon, authenticated;
revoke execute on function public._sync_profile_tags() from public, anon, authenticated;
revoke execute on function public._sync_course_tags() from public, anon, authenticated;
revoke execute on function public._on_fav() from public, anon, authenticated;
revoke execute on function public._on_follow() from public, anon, authenticated;
revoke execute on function public._guard_profile_managed_fields() from public, anon, authenticated;
revoke execute on function public._points_normalize_text(text) from public, anon, authenticated;
revoke execute on function public._post_points_key(uuid, text, text, text, text, text[]) from public, anon, authenticated;
revoke execute on function public._root_post_points_key(uuid) from public, anon, authenticated;
revoke execute on function public._task_points_key(uuid, text, date, uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public._assign_post_points_key() from public, anon, authenticated;
revoke execute on function public._preserve_post_points_key() from public, anon, authenticated;
revoke execute on function public._assign_like_points_key() from public, anon, authenticated;
revoke execute on function public._preserve_like_points_key() from public, anon, authenticated;
revoke execute on function public._assign_comment_points_key() from public, anon, authenticated;
revoke execute on function public._preserve_comment_points_key() from public, anon, authenticated;
revoke execute on function public._assign_task_points_key() from public, anon, authenticated;
revoke execute on function public._preserve_task_points_key() from public, anon, authenticated;
revoke execute on function public._on_like() from public, anon, authenticated;
revoke execute on function public._on_comment() from public, anon, authenticated;
revoke execute on function public._on_post() from public, anon, authenticated;
revoke execute on function public._on_task_done() from public, anon, authenticated;
