-- Nalanda · 0041 Materials AI schema
-- Durable generation jobs, free-plan quotas, private parse cache, generated
-- notes, online exam attempts, and provider-usage metadata.

create extension if not exists pgcrypto;

create table public.ai_plans (
  code text primary key,
  generation_daily_limit integer not null check (generation_daily_limit between 0 and 10000),
  grading_daily_limit integer not null check (grading_daily_limit between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_plans (code, generation_daily_limit, grading_daily_limit)
values ('free', 10, 10)
on conflict (code) do update
set generation_daily_limit = excluded.generation_daily_limit,
    grading_daily_limit = excluded.grading_daily_limit,
    active = true,
    updated_at = now();

create table public.ai_user_plans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan_code text not null default 'free' references public.ai_plans (code),
  consent_version integer not null default 0 check (consent_version >= 0),
  consented_at timestamptz,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_user_plans (user_id, plan_code)
select id, 'free' from auth.users
on conflict (user_id) do nothing;

create or replace function public._ai_create_user_plan()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.ai_user_plans (user_id, plan_code)
  values (new.id, 'free')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_ai_plan on auth.users;
create trigger on_auth_user_created_ai_plan
  after insert on auth.users
  for each row execute function public._ai_create_user_plan();

create table public.ai_daily_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  kind text not null check (kind in ('generation', 'grading')),
  plan_code text not null references public.ai_plans (code),
  limit_count integer not null check (limit_count >= 0),
  reserved_count integer not null default 0 check (reserved_count >= 0),
  consumed_count integer not null default 0 check (consumed_count >= 0),
  timezone text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date, kind),
  check (reserved_count + consumed_count <= limit_count)
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid references public.materials (id) on delete set null,
  course_id uuid references public.courses (id) on delete set null,
  material_name text not null,
  kind text not null default 'exam' check (kind = 'exam'),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  stage text not null default 'queued'
    check (stage in ('queued', 'validating', 'extracting', 'auditing',
      'visualRecovery', 'generating', 'reviewing', 'saving',
      'succeeded', 'failed', 'cancelled')),
  progress integer not null default 0 check (progress between 0 and 100),
  settings jsonb not null,
  idempotency_key uuid not null,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  consent_version integer not null check (consent_version > 0),
  quota_local_date date not null,
  quota_kind text not null default 'generation' check (quota_kind = 'generation'),
  quota_reserved boolean not null default true,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  source_sha256 text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text,
  prompt_version text not null default 'exam-generate.v1',
  audit_model text not null default 'deepseek/deepseek-v4-flash-0731',
  vision_model text not null default 'xiaomi/mimo-v2.5',
  generation_model text not null default 'deepseek/deepseek-v4-flash-0731',
  note_id uuid,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index generation_jobs_user_created_idx
  on public.generation_jobs (user_id, created_at desc);
create index generation_jobs_dispatch_idx
  on public.generation_jobs (status, created_at)
  where status in ('queued', 'processing');
create unique index generation_jobs_one_active_per_user_idx
  on public.generation_jobs (user_id)
  where status in ('queued', 'processing');

create table public.generation_job_events (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.generation_jobs (id) on delete cascade,
  stage text not null,
  progress integer not null check (progress between 0 and 100),
  event_code text,
  created_at timestamptz not null default now()
);
create index generation_job_events_job_idx
  on public.generation_job_events (job_id, id);

create table public.ai_material_parse_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  material_id uuid not null references public.materials (id) on delete cascade,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  parser_version text not null,
  audit_version text not null,
  vision_model text not null,
  canonical_document jsonb not null,
  block_count integer not null check (block_count >= 0),
  visual_region_count integer not null default 0 check (visual_region_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_id, source_sha256, parser_version, audit_version, vision_model)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid references public.courses (id) on delete set null,
  generation_job_id uuid unique references public.generation_jobs (id) on delete set null,
  title text not null check (char_length(title) between 1 and 160),
  kind text not null default 'ai_exam' check (kind = 'ai_exam'),
  material_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index notes_course_idx on public.notes (course_id, updated_at desc);

alter table public.generation_jobs
  add constraint generation_jobs_note_fk
  foreign key (note_id) references public.notes (id) on delete set null;

create table public.note_materials (
  note_id uuid not null references public.notes (id) on delete cascade,
  material_id uuid references public.materials (id) on delete set null,
  material_name text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (note_id, source_sha256)
);

create table public.note_artifacts (
  note_id uuid primary key references public.notes (id) on delete cascade,
  schema_version text not null check (schema_version = 'generated-exam.v1'),
  content jsonb not null,
  question_count integer not null check (question_count between 1 and 100),
  total_marks integer not null check (total_marks between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null default 'in_progress'
    check (status in ('in_progress', 'submitted_ungraded', 'grading', 'completed')),
  revision bigint not null default 0 check (revision >= 0),
  deadline_at timestamptz not null,
  objective_score numeric(10,2) not null default 0,
  objective_marks integer not null default 0 check (objective_marks >= 0),
  total_score numeric(10,2),
  total_marks integer not null check (total_marks > 0),
  grading_quota_local_date date,
  grading_quota_reserved boolean not null default false,
  grading_lease_token uuid,
  grading_lease_expires_at timestamptz,
  grading_attempt_count integer not null default 0 check (grading_attempt_count >= 0),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, note_id, attempt_number)
);
create index exam_attempts_user_idx on public.exam_attempts (user_id, created_at desc);
create index exam_attempts_deadline_idx on public.exam_attempts (deadline_at)
  where status = 'in_progress';

create table public.exam_attempt_answers (
  attempt_id uuid not null references public.exam_attempts (id) on delete cascade,
  question_id text not null,
  answer jsonb not null default 'null'::jsonb,
  awarded_marks numeric(10,2),
  correct boolean,
  feedback text,
  updated_at timestamptz not null default now(),
  primary key (attempt_id, question_id)
);

create table public.exam_attempt_operations (
  attempt_id uuid not null references public.exam_attempts (id) on delete cascade,
  operation_id uuid not null,
  operation_kind text not null check (operation_kind in ('save', 'submit', 'grade')),
  response_payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (attempt_id, operation_id)
);

create table public.ai_provider_usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.generation_jobs (id) on delete set null,
  attempt_id uuid references public.exam_attempts (id) on delete set null,
  purpose text not null check (purpose in ('parse_audit', 'visual_recovery',
    'safety_audit', 'exam_generation', 'exam_repair', 'exam_review', 'exam_grading')),
  provider text not null default 'openrouter',
  model text not null,
  provider_request_id text,
  prompt_tokens bigint check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens bigint check (completion_tokens is null or completion_tokens >= 0),
  total_tokens bigint check (total_tokens is null or total_tokens >= 0),
  cost_micro_usd bigint check (cost_micro_usd is null or cost_micro_usd >= 0),
  duration_ms integer not null check (duration_ms >= 0),
  zdr_enforced boolean not null default true,
  status text not null check (status in ('succeeded', 'failed')),
  error_code text,
  created_at timestamptz not null default now(),
  check ((job_id is not null)::integer + (attempt_id is not null)::integer = 1)
);
create index ai_provider_usage_month_idx
  on public.ai_provider_usage_events (created_at, status);

alter table public.ai_plans enable row level security;
alter table public.ai_user_plans enable row level security;
alter table public.ai_daily_usage enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_job_events enable row level security;
alter table public.ai_material_parse_cache enable row level security;
alter table public.notes enable row level security;
alter table public.note_materials enable row level security;
alter table public.note_artifacts enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.exam_attempt_answers enable row level security;
alter table public.exam_attempt_operations enable row level security;
alter table public.ai_provider_usage_events enable row level security;

create policy ai_plans_read on public.ai_plans
  for select to authenticated using (active);
create policy ai_user_plans_read_own on public.ai_user_plans
  for select to authenticated using (user_id = auth.uid());
create policy ai_daily_usage_read_own on public.ai_daily_usage
  for select to authenticated using (user_id = auth.uid());
create policy generation_jobs_read_own on public.generation_jobs
  for select to authenticated using (user_id = auth.uid());
create policy generation_job_events_read_own on public.generation_job_events
  for select to authenticated using (exists (
    select 1 from public.generation_jobs j
    where j.id = job_id and j.user_id = auth.uid()
  ));
create policy notes_read_own on public.notes
  for select to authenticated using (user_id = auth.uid());
create policy note_materials_read_own on public.note_materials
  for select to authenticated using (exists (
    select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid()
  ));
create policy note_artifacts_read_own on public.note_artifacts
  for select to authenticated using (exists (
    select 1 from public.notes n where n.id = note_id and n.user_id = auth.uid()
  ));
create policy exam_attempts_read_own on public.exam_attempts
  for select to authenticated using (user_id = auth.uid());
create policy exam_attempt_answers_read_own on public.exam_attempt_answers
  for select to authenticated using (exists (
    select 1 from public.exam_attempts a
    where a.id = attempt_id and a.user_id = auth.uid()
  ));

revoke all on table public.ai_plans, public.ai_user_plans, public.ai_daily_usage,
  public.generation_jobs, public.generation_job_events, public.ai_material_parse_cache,
  public.notes, public.note_materials, public.note_artifacts, public.exam_attempts,
  public.exam_attempt_answers, public.exam_attempt_operations,
  public.ai_provider_usage_events from anon, authenticated;
grant select on table public.ai_plans, public.ai_user_plans, public.ai_daily_usage,
  public.generation_jobs, public.generation_job_events, public.notes,
  public.note_materials, public.note_artifacts, public.exam_attempts,
  public.exam_attempt_answers to authenticated;

grant all on table public.ai_plans, public.ai_user_plans, public.ai_daily_usage,
  public.generation_jobs, public.generation_job_events, public.ai_material_parse_cache,
  public.notes, public.note_materials, public.note_artifacts, public.exam_attempts,
  public.exam_attempt_answers, public.exam_attempt_operations,
  public.ai_provider_usage_events to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public._ai_create_user_plan() from public, anon, authenticated;
grant execute on function public._ai_create_user_plan() to service_role;
