-- Materials AI resumable execution, incremental usage, knowledge graphs and node questions.
-- This migration is additive/compatible with the 0041-0043 application. Old RPC
-- signatures remain available until the new application has completed its
-- protected production observation window.

begin;

alter table public.generation_jobs
  drop constraint if exists generation_jobs_kind_check;
alter table public.generation_jobs
  add constraint generation_jobs_kind_check
  check (kind in ('exam', 'knowledge_graph', 'knowledge_question'));

alter table public.generation_jobs
  drop constraint if exists generation_jobs_stage_check;
alter table public.generation_jobs
  add constraint generation_jobs_stage_check
  check (stage in ('queued', 'validating', 'extracting', 'auditing',
    'visualRecovery', 'generating', 'organizing', 'answering', 'reviewing',
    'saving', 'succeeded', 'failed', 'cancelled'));

alter table public.generation_jobs
  add column retryable boolean not null default false,
  add column resume_until timestamptz,
  add column checkpoint_stage text,
  add column resume_count integer not null default 0 check (resume_count between 0 and 5),
  add column accepted_at timestamptz;

alter table public.generation_jobs
  add constraint generation_jobs_resume_state_check
  check (
    (retryable and resume_until is not null)
    or (not retryable)
  );

create index generation_jobs_resume_expiry_idx
  on public.generation_jobs (resume_until)
  where retryable;

create table public.generation_job_checkpoints (
  job_id uuid primary key references public.generation_jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage text not null check (stage in ('parsed', 'audited', 'document_ready', 'artifact_ready', 'answer_ready')),
  checkpoint_version text not null default 'material-ai-checkpoint.v1',
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index generation_job_checkpoints_expiry_idx
  on public.generation_job_checkpoints (expires_at);

create table public.exam_grading_checkpoints (
  attempt_id uuid primary key references public.exam_attempts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  checkpoint_version text not null default 'exam-grading-checkpoint.v1',
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index exam_grading_checkpoints_expiry_idx
  on public.exam_grading_checkpoints (expires_at);

alter table public.ai_provider_usage_events
  add column event_id uuid default gen_random_uuid();
update public.ai_provider_usage_events set event_id = gen_random_uuid() where event_id is null;
alter table public.ai_provider_usage_events alter column event_id set not null;
create unique index ai_provider_usage_events_event_id_idx
  on public.ai_provider_usage_events (event_id);

alter table public.ai_provider_usage_events
  drop constraint if exists ai_provider_usage_events_purpose_check;
alter table public.ai_provider_usage_events
  add constraint ai_provider_usage_events_purpose_check
  check (purpose in ('parse_audit', 'visual_recovery', 'safety_audit',
    'exam_generation', 'exam_repair', 'exam_review', 'exam_grading',
    'knowledge_graph_generation', 'knowledge_graph_review',
    'knowledge_graph_repair', 'knowledge_node_question'));

alter table public.notes drop constraint if exists notes_kind_check;
alter table public.notes add constraint notes_kind_check
  check (kind in ('ai_exam', 'ai_knowledge_graph'));

alter table public.note_artifacts
  drop constraint if exists note_artifacts_schema_version_check;
alter table public.note_artifacts
  add constraint note_artifacts_schema_version_check
  check (schema_version in ('generated-exam.v1', 'generated-knowledge-graph.v1'));
alter table public.note_artifacts
  drop constraint if exists note_artifacts_question_count_check;
alter table public.note_artifacts
  add constraint note_artifacts_question_count_check
  check (question_count between 0 and 100);
alter table public.note_artifacts
  drop constraint if exists note_artifacts_total_marks_check;
alter table public.note_artifacts
  add constraint note_artifacts_total_marks_check
  check (total_marks between 0 and 1000);
alter table public.note_artifacts
  add column node_count integer not null default 0 check (node_count between 0 and 250),
  add column edge_count integer not null default 0 check (edge_count between 0 and 1000);
alter table public.note_artifacts
  add constraint note_artifacts_kind_shape_check
  check (
    (schema_version = 'generated-exam.v1' and question_count between 1 and 100
      and total_marks between 1 and 1000 and node_count = 0 and edge_count = 0)
    or
    (schema_version = 'generated-knowledge-graph.v1' and question_count = 0
      and total_marks = 0 and node_count between 1 and 250)
  );

create table public.knowledge_node_questions (
  id uuid primary key references public.generation_jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid not null references public.notes (id) on delete cascade,
  node_id text not null check (char_length(node_id) between 1 and 80),
  question text not null check (char_length(question) between 1 and 2000),
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create index knowledge_node_questions_note_idx
  on public.knowledge_node_questions (note_id, created_at desc);

alter table public.generation_job_checkpoints enable row level security;
alter table public.exam_grading_checkpoints enable row level security;
alter table public.knowledge_node_questions enable row level security;

create policy knowledge_node_questions_read_own
  on public.knowledge_node_questions for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.generation_job_checkpoints from public, anon, authenticated;
revoke all on table public.exam_grading_checkpoints from public, anon, authenticated;
revoke all on table public.knowledge_node_questions from public, anon, authenticated;
grant select on table public.knowledge_node_questions to authenticated;
grant select, insert, update, delete on table public.generation_job_checkpoints to service_role;
grant select, insert, update, delete on table public.exam_grading_checkpoints to service_role;
grant select, insert, update, delete on table public.knowledge_node_questions to service_role;

create or replace function public._ai_cleanup_terminal_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status in ('succeeded', 'cancelled')
      or (new.status = 'failed' and not new.retryable) then
    delete from public.generation_job_checkpoints where job_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists generation_jobs_cleanup_checkpoint on public.generation_jobs;
create trigger generation_jobs_cleanup_checkpoint
after update of status, retryable on public.generation_jobs
for each row execute function public._ai_cleanup_terminal_checkpoint();

revoke execute on function public._ai_cleanup_terminal_checkpoint() from public, anon, authenticated;

create or replace function public._ai_cleanup_terminal_grading_checkpoint()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status <> 'grading' then
    delete from public.exam_grading_checkpoints where attempt_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists exam_attempts_cleanup_grading_checkpoint on public.exam_attempts;
create trigger exam_attempts_cleanup_grading_checkpoint
after update of status on public.exam_attempts
for each row execute function public._ai_cleanup_terminal_grading_checkpoint();

revoke execute on function public._ai_cleanup_terminal_grading_checkpoint()
  from public, anon, authenticated;

commit;
