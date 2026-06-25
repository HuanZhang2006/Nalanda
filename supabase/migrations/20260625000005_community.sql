-- Nalanda · 0005 社区：帖子 / 评论 / 点赞 / 收藏 / 转发 / 关注
-- 帖子、评论：公共可读（认证用户），作者可写改删。点赞/收藏/关注：按用户。
-- 计数（like/comment/favorite/repost）由触发器维护；作者展示字段由触发器从 profiles 快照，防伪造。

-- ── posts ──
create table if not exists public.posts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name       text,
  author_university text,
  author_major      text,
  title             text,
  body              text,
  kind              text not null default 'experience',  -- experience/question/tip/note_share
  subject           text,                                -- 课程/学科代码（如 COGS 210）
  tags              text[] not null default '{}',
  repost_of         uuid references public.posts (id) on delete cascade,
  like_count        int not null default 0,
  comment_count     int not null default 0,
  favorite_count    int not null default 0,
  repost_count      int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists posts_created_idx on public.posts (created_at desc);
create index if not exists posts_user_idx on public.posts (user_id);
create index if not exists posts_subject_idx on public.posts (subject);
alter table public.posts enable row level security;
drop policy if exists posts_select_all on public.posts;
create policy posts_select_all on public.posts for select to authenticated using (true);
drop policy if exists posts_insert_own on public.posts;
create policy posts_insert_own on public.posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists posts_update_own on public.posts;
create policy posts_update_own on public.posts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists posts_delete_own on public.posts;
create policy posts_delete_own on public.posts for delete to authenticated using (user_id = auth.uid());

-- ── comments ──
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.posts (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);
alter table public.comments enable row level security;
drop policy if exists comments_select_all on public.comments;
create policy comments_select_all on public.comments for select to authenticated using (true);
drop policy if exists comments_insert_own on public.comments;
create policy comments_insert_own on public.comments for insert to authenticated with check (user_id = auth.uid());
drop policy if exists comments_delete_own on public.comments;
create policy comments_delete_own on public.comments for delete to authenticated using (user_id = auth.uid());

-- ── likes / favorites（按用户，唯一） ──
create table if not exists public.post_likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_likes enable row level security;
drop policy if exists post_likes_own on public.post_likes;
create policy post_likes_own on public.post_likes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.post_favorites (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_favorites enable row level security;
drop policy if exists post_favorites_own on public.post_favorites;
create policy post_favorites_own on public.post_favorites for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── follows ──
create table if not exists public.follows (
  follower_id  uuid not null default auth.uid() references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id)
);
alter table public.follows enable row level security;
drop policy if exists follows_select_self on public.follows;
create policy follows_select_self on public.follows for select to authenticated using (follower_id = auth.uid() or following_id = auth.uid());
drop policy if exists follows_insert_own on public.follows;
create policy follows_insert_own on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists follows_delete_own on public.follows;
create policy follows_delete_own on public.follows for delete to authenticated using (follower_id = auth.uid());

-- ── 作者展示字段：插入时从 profiles 快照（忽略客户端传值，防伪造） ──
create or replace function public._post_author() returns trigger language plpgsql security definer set search_path = public as $$
begin
  select username, university, major into new.author_name, new.author_university, new.author_major
  from public.profiles where id = auth.uid();
  return new;
end$$;
drop trigger if exists posts_author on public.posts;
create trigger posts_author before insert on public.posts for each row execute function public._post_author();

create or replace function public._comment_author() returns trigger language plpgsql security definer set search_path = public as $$
begin
  select username into new.author_name from public.profiles where id = auth.uid();
  return new;
end$$;
drop trigger if exists comments_author on public.comments;
create trigger comments_author before insert on public.comments for each row execute function public._comment_author();

-- ── 计数维护（security definer：点赞者≠作者也能更新帖子计数） ──
create or replace function public._bump_counts() returns trigger language plpgsql security definer set search_path = public as $$
declare d int; pid uuid;
begin
  d := case when tg_op = 'INSERT' then 1 else -1 end;
  pid := coalesce(new.post_id, old.post_id);
  if tg_table_name = 'post_likes' then
    update public.posts set like_count = greatest(0, like_count + d) where id = pid;
  elsif tg_table_name = 'post_favorites' then
    update public.posts set favorite_count = greatest(0, favorite_count + d) where id = pid;
  elsif tg_table_name = 'comments' then
    update public.posts set comment_count = greatest(0, comment_count + d) where id = pid;
  end if;
  return null;
end$$;
drop trigger if exists likes_cnt on public.post_likes;
create trigger likes_cnt after insert or delete on public.post_likes for each row execute function public._bump_counts();
drop trigger if exists favs_cnt on public.post_favorites;
create trigger favs_cnt after insert or delete on public.post_favorites for each row execute function public._bump_counts();
drop trigger if exists comments_cnt on public.comments;
create trigger comments_cnt after insert or delete on public.comments for each row execute function public._bump_counts();

create or replace function public._bump_repost() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.repost_of is not null then
    update public.posts set repost_count = repost_count + 1 where id = new.repost_of;
  elsif tg_op = 'DELETE' and old.repost_of is not null then
    update public.posts set repost_count = greatest(0, repost_count - 1) where id = old.repost_of;
  end if;
  return null;
end$$;
drop trigger if exists repost_cnt on public.posts;
create trigger repost_cnt after insert or delete on public.posts for each row execute function public._bump_repost();
