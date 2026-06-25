-- Nalanda · 0006 积分体系 + 全局标签 + 互动通知 + 媒体附件
-- 积分(points)独立于钱包(credits)；等级随积分提升；点赞/评论/转发/被关注产生通知。

-- ── points（活动积分，与 credits 钱包分开） ──
alter table public.profiles add column if not exists points int not null default 0;

-- ── 全局标签：所有用户的 大学 / 专业 / 学科 + 自由标签，公共可读 ──
create table if not exists public.tags (
  kind       text not null,           -- university | major | subject | tag
  value      text not null,
  created_at timestamptz not null default now(),
  primary key (kind, value)
);
alter table public.tags enable row level security;
drop policy if exists tags_select_all on public.tags;
create policy tags_select_all on public.tags for select to authenticated using (true);
drop policy if exists tags_insert_auth on public.tags;
create policy tags_insert_auth on public.tags for insert to authenticated with check (true);

create or replace function public._sync_profile_tags() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.university,'') <> '' then insert into public.tags(kind,value) values('university', new.university) on conflict do nothing; end if;
  if coalesce(new.major,'') <> '' then insert into public.tags(kind,value) values('major', new.major) on conflict do nothing; end if;
  return new;
end$$;
drop trigger if exists profiles_tags on public.profiles;
create trigger profiles_tags after insert or update of university, major on public.profiles for each row execute function public._sync_profile_tags();

create or replace function public._sync_course_tags() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.tags(kind,value) values('subject', coalesce(nullif(new.code,''), new.name)) on conflict do nothing;
  return new;
end$$;
drop trigger if exists courses_tags on public.courses;
create trigger courses_tags after insert on public.courses for each row execute function public._sync_course_tags();

-- 回填已有数据
insert into public.tags(kind,value) select distinct 'university', university from public.profiles where coalesce(university,'')<>'' on conflict do nothing;
insert into public.tags(kind,value) select distinct 'major', major from public.profiles where coalesce(major,'')<>'' on conflict do nothing;
insert into public.tags(kind,value) select distinct 'subject', coalesce(nullif(code,''),name) from public.courses on conflict do nothing;

-- ── 帖子媒体附件 ──
alter table public.posts add column if not exists image_url text;
alter table public.posts add column if not exists audio_url text;

insert into storage.buckets (id, name, public) values ('community-media','community-media', true) on conflict (id) do nothing;
drop policy if exists media_insert_own on storage.objects;
create policy media_insert_own on storage.objects for insert to authenticated
  with check (bucket_id='community-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects for delete to authenticated
  using (bucket_id='community-media' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── 积分 + 等级 ──
create or replace function public._add_points(uid uuid, d int) returns void language plpgsql security definer set search_path = public as $$
declare p int; lv int; nm text;
begin
  update public.profiles set points = greatest(0, points + d) where id = uid returning points into p;
  if p is null then return; end if;
  lv := case when p>=1200 then 6 when p>=700 then 5 when p>=350 then 4 when p>=150 then 3 when p>=50 then 2 else 1 end;
  nm := case lv when 6 then 'Luminary' when 5 then 'Sage' when 4 then 'Mentor' when 3 then 'Scholar' when 2 then 'Learner' else 'Novice' end;
  update public.profiles set level = lv, level_name = nm where id = uid;
end$$;

create or replace function public._notify(uid uuid, ntype text, ntitle text, nbody text) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications(user_id, type, title, body) values (uid, ntype, ntitle, nbody);
end$$;

-- 点赞：点赞者 +1 分；通知帖主
create or replace function public._on_like() returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; who text; ttl text;
begin
  perform public._add_points(new.user_id, 1);
  select user_id, title into owner, ttl from public.posts where id = new.post_id;
  if owner is not null and owner <> new.user_id then
    select username into who from public.profiles where id = new.user_id;
    perform public._notify(owner, 'like', '收到一个赞', coalesce(who,'有人')||' 赞了你的帖子'||coalesce(' 《'||ttl||'》',''));
  end if;
  return null;
end$$;
drop trigger if exists likes_award on public.post_likes;
create trigger likes_award after insert on public.post_likes for each row execute function public._on_like();

-- 评论：评论者 +2 分；通知帖主
create or replace function public._on_comment() returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; who text; ttl text;
begin
  perform public._add_points(new.user_id, 2);
  select user_id, title into owner, ttl from public.posts where id = new.post_id;
  if owner is not null and owner <> new.user_id then
    select username into who from public.profiles where id = new.user_id;
    perform public._notify(owner, 'comment', '收到新评论', coalesce(who,'有人')||' 评论了你的帖子'||coalesce(' 《'||ttl||'》',''));
  end if;
  return null;
end$$;
drop trigger if exists comments_award on public.comments;
create trigger comments_award after insert on public.comments for each row execute function public._on_comment();

-- 收藏：通知帖主（不加分）
create or replace function public._on_fav() returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; who text;
begin
  select user_id into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.user_id then
    select username into who from public.profiles where id = new.user_id;
    perform public._notify(owner, 'favorite', '帖子被收藏', coalesce(who,'有人')||' 收藏了你的帖子');
  end if;
  return null;
end$$;
drop trigger if exists favs_notify on public.post_favorites;
create trigger favs_notify after insert on public.post_favorites for each row execute function public._on_fav();

-- 发帖：发帖 +10 / 转发 +3；转发时通知原作者
create or replace function public._on_post() returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; who text;
begin
  if new.repost_of is null then
    perform public._add_points(new.user_id, 10);
  else
    perform public._add_points(new.user_id, 3);
    select user_id into owner from public.posts where id = new.repost_of;
    if owner is not null and owner <> new.user_id then
      select username into who from public.profiles where id = new.user_id;
      perform public._notify(owner, 'repost', '帖子被转发', coalesce(who,'有人')||' 转发了你的帖子');
    end if;
  end if;
  return null;
end$$;
drop trigger if exists posts_award on public.posts;
create trigger posts_award after insert on public.posts for each row execute function public._on_post();

-- 关注：通知被关注者
create or replace function public._on_follow() returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.following_id <> new.follower_id then
    select username into who from public.profiles where id = new.follower_id;
    perform public._notify(new.following_id, 'follow', '新粉丝', coalesce(who,'有人')||' 关注了你');
  end if;
  return null;
end$$;
drop trigger if exists follows_notify on public.follows;
create trigger follows_notify after insert on public.follows for each row execute function public._on_follow();
