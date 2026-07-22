-- Nalanda · 0011 independent learning courses, progress facts, sharing and badges
--
-- This is an additive migration. The existing public.courses table remains the
-- Materials/Schedule academic-course model; vocabulary learning lives under
-- the learning_* namespace below.

alter table public.profiles
  add column if not exists timezone text not null default 'UTC';

grant update (timezone) on table public.profiles to authenticated;

create or replace function public._guard_profile_timezone()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid IANA timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_timezone on public.profiles;
create trigger profiles_guard_timezone
  before update of timezone on public.profiles
  for each row execute function public._guard_profile_timezone();

drop trigger if exists profiles_guard_timezone_insert on public.profiles;
create trigger profiles_guard_timezone_insert
  before insert on public.profiles
  for each row execute function public._guard_profile_timezone();

create table public.learning_courses (
  id                    uuid primary key default extensions.gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  title                 text not null check (char_length(btrim(title)) between 1 and 80),
  category              text not null default 'english_vocabulary'
                        check (category in ('english_vocabulary', 'knowledge_points', 'reading_comprehension', 'question_bank')),
  has_units             boolean not null default false,
  locale                text not null default 'en-US' check (locale = 'en-US'),
  origin_publication_id uuid,
  origin_share_id       uuid,
  origin_author_name    text,
  can_republish         boolean not null default true,
  points_claimed_at     timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (id, user_id)
);

create index learning_courses_user_updated_idx
  on public.learning_courses (user_id, updated_at desc);

create table public.learning_course_units (
  id         uuid primary key default extensions.gen_random_uuid(),
  course_id  uuid not null references public.learning_courses (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(btrim(name)) between 1 and 80),
  position   integer not null check (position >= 0),
  is_system  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (course_id, user_id) references public.learning_courses (id, user_id) on delete cascade,
  unique (id, course_id, user_id),
  unique (course_id, position) deferrable initially deferred
);

create index learning_course_units_owner_idx
  on public.learning_course_units (user_id, course_id, position);

create table public.learning_course_words (
  id              uuid primary key default extensions.gen_random_uuid(),
  course_id       uuid not null references public.learning_courses (id) on delete cascade,
  unit_id         uuid not null references public.learning_course_units (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  term            text not null check (char_length(btrim(term)) between 1 and 120),
  normalized_term text generated always as (public._points_normalize_text(term)) stored,
  translations    text[] not null check (cardinality(translations) between 1 and 10),
  ipa             text check (ipa is null or char_length(ipa) <= 120),
  position        integer not null check (position >= 0),
  content_version integer not null default 1 check (content_version > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (unit_id, course_id, user_id) references public.learning_course_units (id, course_id, user_id) on delete cascade,
  unique (unit_id, normalized_term) deferrable initially deferred,
  unique (unit_id, position) deferrable initially deferred
);

create index learning_course_words_course_idx
  on public.learning_course_words (course_id, unit_id, position);
create index learning_course_words_owner_term_idx
  on public.learning_course_words (user_id, normalized_term);

create table public.learning_sessions (
  id              uuid primary key default extensions.gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  course_id       uuid not null references public.learning_courses (id) on delete cascade,
  unit_id         uuid references public.learning_course_units (id) on delete set null,
  mode            text not null check (mode in ('initial', 'review')),
  scope           text not null default 'all' check (scope in ('all', 'unlearned')),
  selected_skills text[] not null default array['pronunciation','translation','spelling']::text[],
  stage           text not null check (stage in ('recognition', 'pronunciation', 'translation', 'spelling', 'completed')),
  active          boolean not null default true,
  state           jsonb not null default '{}'::jsonb,
  started_at      timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  completed_at    timestamptz,
  check (selected_skills <@ array['pronunciation','translation','spelling']::text[]),
  check (cardinality(selected_skills) between 1 and 3)
);

create unique index learning_sessions_one_active_course_idx
  on public.learning_sessions (user_id, course_id)
  where active;
create index learning_sessions_owner_activity_idx
  on public.learning_sessions (user_id, last_activity_at desc);

create table public.learning_session_items (
  session_id            uuid not null references public.learning_sessions (id) on delete cascade,
  word_id               uuid not null references public.learning_course_words (id) on delete cascade,
  position              integer not null check (position >= 0),
  recognition_seen      boolean not null default false,
  pronunciation_passed  boolean not null default false,
  translation_passed    boolean not null default false,
  spelling_passed       boolean not null default false,
  wrong_count           integer not null default 0 check (wrong_count >= 0),
  primary key (session_id, word_id),
  unique (session_id, position) deferrable initially deferred
);

create table public.learning_attempts (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references auth.users (id) on delete cascade,
  course_id        uuid not null references public.learning_courses (id) on delete cascade,
  session_id       uuid not null references public.learning_sessions (id) on delete cascade,
  word_id          uuid references public.learning_course_words (id) on delete set null,
  mode             text not null check (mode in ('initial', 'review')),
  skill            text not null check (skill in ('recognition', 'pronunciation', 'translation', 'spelling', 'speech_assessment')),
  is_correct       boolean,
  answer           jsonb not null default '{}'::jsonb,
  error_kind       text,
  provider_details jsonb not null default '{}'::jsonb,
  local_date       date not null,
  created_at       timestamptz not null default now()
);

create index learning_attempts_owner_created_idx
  on public.learning_attempts (user_id, created_at desc);
create index learning_attempts_course_idx
  on public.learning_attempts (course_id, created_at desc);
create index learning_attempts_word_idx
  on public.learning_attempts (word_id, created_at desc);

-- Durable quota/cost reservations make limits global across API instances.
-- Rows contain no audio or reference text.
create table public.learning_speech_usage (
  id            bigint generated always as identity primary key,
  user_id       uuid references auth.users (id) on delete set null,
  kind          text not null check (kind in ('tts', 'assessment')),
  cost_microusd integer not null check (cost_microusd > 0),
  local_date    date not null,
  created_at    timestamptz not null default now()
);

create index learning_speech_usage_user_rate_idx
  on public.learning_speech_usage (user_id, kind, created_at desc);
create index learning_speech_usage_budget_idx
  on public.learning_speech_usage (created_at desc);

create table public.learning_word_progress (
  user_id                    uuid not null references auth.users (id) on delete cascade,
  word_id                    uuid not null references public.learning_course_words (id) on delete cascade,
  initial_recognition_seen   boolean not null default false,
  initial_pronunciation_passed boolean not null default false,
  initial_translation_passed boolean not null default false,
  initial_spelling_passed    boolean not null default false,
  pronunciation_review_dates date[] not null default '{}'::date[],
  translation_review_dates  date[] not null default '{}'::date[],
  spelling_review_dates     date[] not null default '{}'::date[],
  wrong_count               integer not null default 0 check (wrong_count >= 0),
  review_count              integer not null default 0 check (review_count >= 0),
  learned_at                timestamptz,
  updated_at                timestamptz not null default now(),
  primary key (user_id, word_id)
);

create index learning_word_progress_learned_idx
  on public.learning_word_progress (user_id, learned_at)
  where learned_at is not null;

create table public.learning_review_schedules (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  course_id  uuid not null references public.learning_courses (id) on delete cascade,
  unit_id    uuid not null references public.learning_course_units (id) on delete cascade,
  source_session_id uuid not null references public.learning_sessions (id) on delete cascade,
  due_date   date not null,
  skills     text[] not null default array['pronunciation','translation','spelling']::text[],
  scope      text not null default 'unlearned' check (scope in ('all', 'unlearned')),
  status     text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  completed_session_id uuid references public.learning_sessions (id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (skills <@ array['pronunciation','translation','spelling']::text[]),
  check (cardinality(skills) between 1 and 3),
  unique (user_id, unit_id, due_date)
);

create index learning_review_schedules_owner_due_idx
  on public.learning_review_schedules (user_id, due_date, status);

create table public.learning_course_shares (
  id          uuid primary key default extensions.gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  course_id   uuid not null references public.learning_courses (id) on delete cascade,
  token_hash  text not null unique,
  active      boolean not null default true,
  author_name text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create unique index learning_course_shares_one_active_idx
  on public.learning_course_shares (course_id)
  where active;

alter table public.learning_courses
  add constraint learning_courses_origin_share_fk
  foreign key (origin_share_id)
  references public.learning_course_shares (id) on delete set null;

create table public.learning_course_publications (
  id                  uuid primary key default extensions.gen_random_uuid(),
  author_id           uuid not null references auth.users (id) on delete cascade,
  source_course_id    uuid references public.learning_courses (id) on delete set null,
  title               text not null check (char_length(btrim(title)) between 1 and 80),
  description         text not null default '' check (char_length(description) <= 500),
  author_name         text not null,
  category            text not null check (category = 'english_vocabulary'),
  locale              text not null default 'en-US' check (locale = 'en-US'),
  version             integer not null default 1 check (version > 0),
  snapshot            jsonb not null,
  content_fingerprint text not null,
  status              text not null default 'published' check (status in ('published', 'hidden', 'withdrawn')),
  rights_declared_at  timestamptz not null,
  clone_count         integer not null default 0 check (clone_count >= 0),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index learning_course_publications_market_idx
  on public.learning_course_publications (status, created_at desc);
create index learning_course_publications_author_idx
  on public.learning_course_publications (author_id, created_at desc);
create unique index learning_course_publications_version_idx
  on public.learning_course_publications (author_id, source_course_id, version)
  where source_course_id is not null;

-- A market version is a content snapshot. Only lifecycle state, clone_count,
-- source nulling on course deletion, and updated_at may change afterwards.
create or replace function public._guard_learning_publication_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(new.author_id, new.title, new.description, new.author_name,
         new.category, new.locale, new.version, new.snapshot,
         new.content_fingerprint, new.rights_declared_at, new.created_at)
     is distinct from
     row(old.author_id, old.title, old.description, old.author_name,
         old.category, old.locale, old.version, old.snapshot,
         old.content_fingerprint, old.rights_declared_at, old.created_at) then
    raise exception 'published course version content is immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger learning_publications_preserve_snapshot
  before update on public.learning_course_publications
  for each row execute function public._guard_learning_publication_snapshot();

alter table public.learning_courses
  add constraint learning_courses_origin_publication_fk
  foreign key (origin_publication_id)
  references public.learning_course_publications (id) on delete set null;

create table public.learning_course_reports (
  id             uuid primary key default extensions.gen_random_uuid(),
  reporter_id    uuid not null references auth.users (id) on delete cascade,
  publication_id uuid references public.learning_course_publications (id) on delete cascade,
  share_id       uuid references public.learning_course_shares (id) on delete cascade,
  category       text not null check (category in ('abuse', 'copyright', 'privacy', 'spam', 'academic_integrity', 'other')),
  details        text not null default '' check (char_length(details) <= 1000),
  status         text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at     timestamptz not null default now(),
  check ((publication_id is not null)::integer + (share_id is not null)::integer = 1)
);

create index learning_course_reports_target_idx
  on public.learning_course_reports (publication_id, share_id, status, created_at desc);

create table public.learning_course_moderation_actions (
  id             bigint generated always as identity primary key,
  publication_id uuid references public.learning_course_publications (id) on delete set null,
  actor_id       uuid references auth.users (id) on delete set null,
  action         text not null check (action in ('hide', 'restore', 'withdraw')),
  reason         text not null check (char_length(btrim(reason)) between 1 and 1000),
  created_at     timestamptz not null default now()
);

create table public.badge_definitions (
  code        text primary key,
  family      text not null,
  tier        integer not null check (tier between 1 and 3),
  name        text not null,
  description text not null,
  threshold   integer not null check (threshold > 0),
  icon        text not null,
  unique (family, tier)
);

insert into public.badge_definitions (code, family, tier, name, description, threshold, icon) values
  ('vocab_words_bronze', 'vocab_words', 1, '词汇行者', '熟练掌握 20 个不同英文词或短语', 20, '🧭'),
  ('vocab_words_silver', 'vocab_words', 2, '词汇行者', '熟练掌握 200 个不同英文词或短语', 200, '🧭'),
  ('vocab_words_gold', 'vocab_words', 3, '词汇行者', '熟练掌握 1000 个不同英文词或短语', 1000, '🧭'),
  ('vocab_courses_bronze', 'vocab_courses', 1, '课程毕业生', '完成 1 门合格英语单词课程', 1, '🎓'),
  ('vocab_courses_silver', 'vocab_courses', 2, '课程毕业生', '完成 5 门合格英语单词课程', 5, '🎓'),
  ('vocab_courses_gold', 'vocab_courses', 3, '课程毕业生', '完成 20 门合格英语单词课程', 20, '🎓'),
  ('vocab_review_days_bronze', 'vocab_review_days', 1, '复习坚持者', '在 3 个不同日期完成复习', 3, '🗓️'),
  ('vocab_review_days_silver', 'vocab_review_days', 2, '复习坚持者', '在 15 个不同日期完成复习', 15, '🗓️'),
  ('vocab_review_days_gold', 'vocab_review_days', 3, '复习坚持者', '在 50 个不同日期完成复习', 50, '🗓️')
on conflict (code) do update set
  family = excluded.family,
  tier = excluded.tier,
  name = excluded.name,
  description = excluded.description,
  threshold = excluded.threshold,
  icon = excluded.icon;

create table public.user_badge_awards (
  user_id    uuid not null references auth.users (id) on delete cascade,
  badge_code text not null references public.badge_definitions (code) on delete restrict,
  awarded_at timestamptz not null default now(),
  metadata   jsonb not null default '{}'::jsonb,
  primary key (user_id, badge_code)
);

-- All learning tables use server-mediated writes. Authenticated clients may
-- read their private rows, badge catalogue and own awards only.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'learning_courses', 'learning_course_units', 'learning_course_words',
    'learning_sessions', 'learning_session_items', 'learning_attempts',
    'learning_speech_usage',
    'learning_word_progress', 'learning_review_schedules',
    'learning_course_shares', 'learning_course_publications',
    'learning_course_reports', 'learning_course_moderation_actions',
    'badge_definitions', 'user_badge_awards'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant all on table public.%I to service_role', v_table);
  end loop;
end;
$$;

grant select on table public.learning_courses,
  public.learning_course_units,
  public.learning_course_words,
  public.learning_sessions,
  public.learning_session_items,
  public.learning_attempts,
  public.learning_word_progress,
  public.learning_review_schedules,
  public.learning_course_shares,
  public.learning_course_publications,
  public.learning_course_reports,
  public.badge_definitions,
  public.user_badge_awards
to authenticated;

grant usage, select on all sequences in schema public to service_role;
revoke update, delete on table public.learning_attempts from service_role;
revoke all on sequence public.learning_attempts_id_seq,
  public.learning_speech_usage_id_seq,
  public.learning_course_moderation_actions_id_seq
from public, anon, authenticated;

create policy learning_courses_select_own on public.learning_courses
  for select to authenticated using (user_id = auth.uid());
create policy learning_units_select_own on public.learning_course_units
  for select to authenticated using (user_id = auth.uid());
create policy learning_words_select_own on public.learning_course_words
  for select to authenticated using (user_id = auth.uid());
create policy learning_sessions_select_own on public.learning_sessions
  for select to authenticated using (user_id = auth.uid());
create policy learning_session_items_select_own on public.learning_session_items
  for select to authenticated using (
    exists (select 1 from public.learning_sessions s where s.id = session_id and s.user_id = auth.uid())
  );
create policy learning_attempts_select_own on public.learning_attempts
  for select to authenticated using (user_id = auth.uid());
create policy learning_progress_select_own on public.learning_word_progress
  for select to authenticated using (user_id = auth.uid());
create policy learning_reviews_select_own on public.learning_review_schedules
  for select to authenticated using (user_id = auth.uid());
create policy learning_shares_select_own on public.learning_course_shares
  for select to authenticated using (user_id = auth.uid());
create policy learning_publications_select_own on public.learning_course_publications
  for select to authenticated using (author_id = auth.uid());
create policy learning_reports_select_own on public.learning_course_reports
  for select to authenticated using (reporter_id = auth.uid());
create policy badge_definitions_select_authenticated on public.badge_definitions
  for select to authenticated using (true);
create policy user_badges_select_own on public.user_badge_awards
  for select to authenticated using (user_id = auth.uid());

revoke execute on function public._guard_profile_timezone()
  from public, anon, authenticated;
revoke execute on function public._guard_learning_publication_snapshot()
  from public, anon, authenticated;

-- TTS cache contains only vendor-generated audio for normalized public English
-- text. There are deliberately no client Storage policies; the API mediates it.
insert into storage.buckets (id, name, public)
values ('vocabulary-audio', 'vocabulary-audio', false)
on conflict (id) do update set public = false;
