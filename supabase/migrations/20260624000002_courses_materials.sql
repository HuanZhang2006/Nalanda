-- Nalanda · 0002 courses + materials (+ storage bucket & policies)
-- 资料归属课程；课程与资料均按 user_id 做 RLS（仅本人可见/可改）。
-- 文件存 Storage 桶 'materials'，对象路径以 {user_id}/ 开头，靠 storage RLS 隔离。

create extension if not exists pgcrypto;

-- ── courses ──
create table if not exists public.courses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  code        text,
  name        text not null,
  color       text not null default '#9c6a39',
  term        text,
  instructor  text,
  created_at  timestamptz not null default now()
);
alter table public.courses enable row level security;

drop policy if exists courses_all_own on public.courses;
create policy courses_all_own on public.courses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── materials ──
create table if not exists public.materials (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  course_id    uuid not null references public.courses (id) on delete cascade,
  name         text not null,
  type         text,
  size_bytes   bigint not null default 0,
  storage_path text not null,
  created_at   timestamptz not null default now()
);
create index if not exists materials_course_idx on public.materials (course_id);
alter table public.materials enable row level security;

drop policy if exists materials_all_own on public.materials;
create policy materials_all_own on public.materials
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── storage：私有桶 + 按用户文件夹隔离 ──
insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

drop policy if exists materials_obj_select on storage.objects;
create policy materials_obj_select on storage.objects
  for select to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists materials_obj_insert on storage.objects;
create policy materials_obj_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists materials_obj_delete on storage.objects;
create policy materials_obj_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
