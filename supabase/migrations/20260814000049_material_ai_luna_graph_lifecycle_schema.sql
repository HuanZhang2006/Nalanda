-- Nalanda · 0049 Materials AI native-file pipelines, cancellable cleanup,
-- provider provenance, and private cross-device knowledge-graph layouts.
-- Additive/compatible: existing rows and old RPC callers remain on the
-- document_ir_v1 pipeline until the new application is activated.

begin;

alter table public.generation_jobs
  drop constraint if exists generation_jobs_status_check;
alter table public.generation_jobs
  add constraint generation_jobs_status_check
  check (status in ('queued', 'processing', 'deleting', 'succeeded', 'failed', 'cancelled'));

alter table public.generation_jobs
  drop constraint if exists generation_jobs_stage_check;
alter table public.generation_jobs
  add constraint generation_jobs_stage_check
  check (stage in ('queued', 'validating', 'preparingSource', 'extracting', 'auditing',
    'visualRecovery', 'generating', 'organizing', 'answering', 'reviewing',
    'saving', 'cleaning', 'succeeded', 'failed', 'cancelled'));

alter table public.generation_jobs
  add column pipeline text not null default 'document_ir_v1',
  add column deletion_requested_at timestamptz,
  add column deletion_previous_status text,
  add column deletion_quota_consumed boolean not null default false,
  add column delete_after_cleanup boolean not null default false,
  add column cleanup_attempt_count integer not null default 0,
  add column cleanup_error text;

alter table public.generation_jobs
  add constraint generation_jobs_pipeline_check
  check (pipeline in ('document_ir_v1', 'luna_native_file_v1')),
  add constraint generation_jobs_deletion_previous_status_check
  check (deletion_previous_status is null or deletion_previous_status in
    ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  add constraint generation_jobs_cleanup_attempt_count_check
  check (cleanup_attempt_count between 0 and 10000);

-- A row being purged is still the user's active AI operation. Extending the
-- existing partial unique index keeps legacy create/retry RPCs compatible with
-- the new lifecycle and prevents a rollback release from dispatching another
-- job while private files from the previous one are still being cleaned.
drop index if exists public.generation_jobs_one_active_per_user_idx;
create unique index generation_jobs_one_active_per_user_idx
  on public.generation_jobs (user_id)
  where status in ('queued', 'processing')
    or (status = 'deleting' and deletion_previous_status in ('queued', 'processing'));

comment on column public.generation_jobs.deletion_quota_consumed is
  'True only when a worker-accepted generation reservation was converted to consumed during manual cleanup.';
comment on column public.generation_jobs.delete_after_cleanup is
  'False retains a cancelled audit row; true hard-deletes the queue row after the worker confirms purge.';

alter table public.generation_job_checkpoints
  drop constraint if exists generation_job_checkpoints_stage_check;
alter table public.generation_job_checkpoints
  add constraint generation_job_checkpoints_stage_check
  check (stage in ('parsed', 'audited', 'document_ready', 'artifact_ready',
    'answer_ready', 'native_audited', 'native_artifact_ready'));

alter table public.notes
  add column pipeline text not null default 'document_ir_v1',
  add column generation_model text not null default 'deepseek/deepseek-v4-flash-0731';
alter table public.notes
  add constraint notes_pipeline_check
  check (pipeline in ('document_ir_v1', 'luna_native_file_v1'));

alter table public.ai_provider_usage_events
  add column pipeline text not null default 'document_ir_v1',
  add column upstream_provider text,
  add column upstream_endpoint text;
alter table public.ai_provider_usage_events
  add constraint ai_provider_usage_events_pipeline_check
  check (pipeline in ('document_ir_v1', 'luna_native_file_v1'));

create table public.knowledge_graph_layouts (
  note_id uuid primary key references public.notes (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  artifact_version text not null check (artifact_version ~ '^[0-9a-f]{64}$'),
  revision bigint not null default 0 check (revision >= 0),
  positions jsonb not null default '[]'::jsonb check (jsonb_typeof(positions) = 'array'),
  viewport jsonb not null default '{"x":0,"y":0,"zoom":1}'::jsonb
    check (jsonb_typeof(viewport) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index knowledge_graph_layouts_user_idx
  on public.knowledge_graph_layouts (user_id, updated_at desc);

alter table public.knowledge_graph_layouts enable row level security;
create policy knowledge_graph_layouts_read_own
  on public.knowledge_graph_layouts for select to authenticated
  using (user_id = auth.uid());

revoke all on table public.knowledge_graph_layouts from public, anon, authenticated;
grant select on table public.knowledge_graph_layouts to authenticated;
grant select, insert, update, delete on table public.knowledge_graph_layouts to service_role;

create or replace function public._ai_inherit_job_pipeline()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_note public.notes%rowtype;
begin
  if new.kind = 'knowledge_question' and new.note_id is not null then
    select * into v_note from public.notes where id = new.note_id;
    if found then
      new.pipeline := v_note.pipeline;
      new.audit_model := case when v_note.pipeline = 'luna_native_file_v1'
        then 'openai/gpt-5.6-luna' else new.audit_model end;
      new.vision_model := case when v_note.pipeline = 'luna_native_file_v1'
        then 'openai/gpt-5.6-luna' else new.vision_model end;
      new.generation_model := v_note.generation_model;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists generation_jobs_inherit_pipeline on public.generation_jobs;
create trigger generation_jobs_inherit_pipeline
before insert on public.generation_jobs
for each row execute function public._ai_inherit_job_pipeline();

revoke execute on function public._ai_inherit_job_pipeline()
  from public, anon, authenticated;
grant execute on function public._ai_inherit_job_pipeline() to service_role;

commit;
