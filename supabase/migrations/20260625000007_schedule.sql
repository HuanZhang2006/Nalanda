-- Nalanda · 0007 学习计划：目标 + 任务（owner-only）；完成任务奖励积分 + 连续学习 streak + 里程碑通知
-- 依赖 0006 的 _add_points / _notify。

alter table public.profiles add column if not exists streak int not null default 0;
alter table public.profiles add column if not exists streak_date date;

-- ── 目标 / 考试倒计时 ──
create table if not exists public.study_goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title      text not null,
  exam_date  date,
  course_id  uuid references public.courses (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.study_goals enable row level security;
drop policy if exists study_goals_own on public.study_goals;
create policy study_goals_own on public.study_goals for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── 任务 ──
create table if not exists public.study_tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null,
  due_date    date not null default current_date,
  done        boolean not null default false,
  done_at     timestamptz,
  course_id   uuid references public.courses (id) on delete set null,
  material_id uuid references public.materials (id) on delete set null,
  goal_id     uuid references public.study_goals (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists study_tasks_user_due_idx on public.study_tasks (user_id, due_date);
alter table public.study_tasks enable row level security;
drop policy if exists study_tasks_own on public.study_tasks;
create policy study_tasks_own on public.study_tasks for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (course_id   is null or exists (select 1 from public.courses c     where c.id = course_id   and c.user_id = auth.uid()))
    and (material_id is null or exists (select 1 from public.materials m   where m.id = material_id and m.user_id = auth.uid()))
    and (goal_id     is null or exists (select 1 from public.study_goals g where g.id = goal_id     and g.user_id = auth.uid()))
  );

-- ── 完成任务：+5 分 + streak + 里程碑通知 ──
create or replace function public._on_task_done() returns trigger language plpgsql security definer set search_path = public as $$
declare s int; sd date; today date := current_date; ns int;
begin
  if new.done and not coalesce(old.done, false) then
    perform public._add_points(new.user_id, 5);
    select streak, streak_date into s, sd from public.profiles where id = new.user_id;
    if sd = today then ns := coalesce(s, 0);
    elsif sd = today - 1 then ns := coalesce(s, 0) + 1;
    else ns := 1; end if;
    update public.profiles set streak = ns, streak_date = today where id = new.user_id;
    if ns in (3, 7, 14, 30, 100) and sd is distinct from today then
      perform public._notify(new.user_id, 'streak', '🔥 连续学习 ' || ns || ' 天', '坚持就是胜利，继续保持！');
    end if;
  end if;
  return null;
end$$;
drop trigger if exists task_done on public.study_tasks;
create trigger task_done after update of done on public.study_tasks for each row execute function public._on_task_done();
