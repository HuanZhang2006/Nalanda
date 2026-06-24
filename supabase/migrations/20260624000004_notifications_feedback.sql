-- Nalanda · 0004 notifications + feedback（均 owner-only RLS）

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  type       text,
  title      text not null,
  body       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists notifications_all_own on public.notifications;
create policy notifications_all_own on public.notifications for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category   text,
  summary    text not null,
  body       text,
  status     text not null default 'open',
  created_at timestamptz not null default now()
);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);
alter table public.feedback enable row level security;
drop policy if exists feedback_all_own on public.feedback;
create policy feedback_all_own on public.feedback for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
