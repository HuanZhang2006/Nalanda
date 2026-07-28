-- Nalanda · timed spelling and server-side semantic translation checks
--
-- Spelling preferences belong to a resumable learning session. User-entered
-- translation text is sent to the provider in memory, while PostgreSQL keeps
-- only a SHA-256 digest, the provider decision, token counts, and the
-- authoritative attempt result required for idempotent retries.

alter table public.learning_sessions
  add column spelling_options jsonb not null default jsonb_build_object(
    'timeLimitEnabled', false,
    'timeLimitSeconds', 20,
    'translationFirst', false
  );

alter table public.learning_sessions
  add constraint learning_sessions_spelling_options_valid check (
    jsonb_typeof(spelling_options) = 'object'
    and jsonb_typeof(spelling_options -> 'timeLimitEnabled') = 'boolean'
    and jsonb_typeof(spelling_options -> 'timeLimitSeconds') = 'number'
    and (spelling_options ->> 'timeLimitSeconds')::numeric =
      trunc((spelling_options ->> 'timeLimitSeconds')::numeric)
    and (spelling_options ->> 'timeLimitSeconds')::integer between 3 and 300
    and jsonb_typeof(spelling_options -> 'translationFirst') = 'boolean'
  );

create table public.learning_spelling_translation_assessments (
  assessment_id       uuid primary key,
  user_id             uuid not null references auth.users (id) on delete cascade,
  session_id          uuid not null references public.learning_sessions (id) on delete cascade,
  word_id             uuid not null references public.learning_course_words (id) on delete cascade,
  expected_revision   bigint not null check (expected_revision >= 0),
  answer_hash         text not null check (answer_hash ~ '^[0-9a-f]{64}$'),
  status              text not null default 'processing'
                      check (status in ('pending', 'processing', 'completed')),
  correct             boolean,
  response_payload    jsonb not null default '{}'::jsonb,
  provider            text,
  model               text,
  prompt_tokens       integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens   integer check (completion_tokens is null or completion_tokens >= 0),
  total_tokens        integer check (total_tokens is null or total_tokens >= 0),
  provider_attempts   integer not null default 1 check (provider_attempts > 0),
  lease_token         uuid,
  lease_until         timestamptz,
  last_error_code     text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  completed_at        timestamptz,
  unique (user_id, session_id, assessment_id)
);

create index learning_spelling_translation_owner_created_idx
  on public.learning_spelling_translation_assessments (user_id, created_at desc);
create index learning_spelling_translation_session_idx
  on public.learning_spelling_translation_assessments
    (session_id, word_id, expected_revision, completed_at desc);

alter table public.learning_spelling_translation_assessments enable row level security;
revoke all on table public.learning_spelling_translation_assessments
  from public, anon, authenticated;
grant all on table public.learning_spelling_translation_assessments to service_role;

create or replace function public._learning_normalize_spelling_options(
  p_options jsonb,
  p_has_spelling boolean
)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_timed boolean := false;
  v_seconds integer := 20;
  v_translation_first boolean := false;
begin
  if not coalesce(p_has_spelling, false) then
    return jsonb_build_object(
      'timeLimitEnabled', false,
      'timeLimitSeconds', 20,
      'translationFirst', false
    );
  end if;
  if p_options is not null then
    if jsonb_typeof(p_options) <> 'object'
       or jsonb_typeof(p_options -> 'timeLimitEnabled') <> 'boolean'
       or jsonb_typeof(p_options -> 'timeLimitSeconds') <> 'number'
       or jsonb_typeof(p_options -> 'translationFirst') <> 'boolean'
       or (p_options ->> 'timeLimitSeconds')::numeric <>
          trunc((p_options ->> 'timeLimitSeconds')::numeric) then
      raise exception 'invalid spelling options' using errcode = '22023';
    end if;
    v_timed := (p_options ->> 'timeLimitEnabled')::boolean;
    v_seconds := (p_options ->> 'timeLimitSeconds')::integer;
    v_translation_first := (p_options ->> 'translationFirst')::boolean;
  end if;
  if v_seconds not between 3 and 300 then
    raise exception 'spelling time limit must be between 3 and 300 seconds'
      using errcode = '22023';
  end if;
  return jsonb_build_object(
    'timeLimitEnabled', v_timed,
    'timeLimitSeconds', v_seconds,
    'translationFirst', v_translation_first
  );
end;
$$;

-- Keep the seven-argument 0017 signature for application rollback. The new
-- application calls this explicit overload and updates options only before an
-- active session has recorded its first immutable fact.
create or replace function public.learning_start_session(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_mode text,
  p_skills text[],
  p_scope text,
  p_schedule_id uuid,
  p_spelling_options jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session_id uuid;
  v_selected_skills text[];
  v_options jsonb;
begin
  v_session_id := public.learning_start_session(
    p_user_id,
    p_course_id,
    p_unit_id,
    p_mode,
    p_skills,
    p_scope,
    p_schedule_id
  );
  select selected_skills
  into strict v_selected_skills
  from public.learning_sessions
  where id = v_session_id and user_id = p_user_id;
  v_options := public._learning_normalize_spelling_options(
    p_spelling_options,
    'spelling' = any(v_selected_skills)
  );
  update public.learning_sessions
  set spelling_options = v_options
  where id = v_session_id
    and user_id = p_user_id
    and revision = 0;
  return v_session_id;
end;
$$;

create or replace function public.learning_get_session_snapshot(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'id', s.id,
    'course_id', s.course_id,
    'unit_id', s.unit_id,
    'mode', s.mode,
    'scope', s.scope,
    'selected_skills', s.selected_skills,
    'stage', s.stage,
    'active', s.active,
    'revision', s.revision,
    'spelling_options', s.spelling_options,
    'spelling_translation_assessment', case
      when s.stage = 'spelling' then (
        select jsonb_build_object(
          'attempt_id', a.assessment_id,
          'word_id', a.word_id,
          'revision', a.expected_revision,
          'correct', true
        )
        from public.learning_spelling_translation_assessments a
        where a.user_id = s.user_id
          and a.session_id = s.id
          and a.word_id = nullif(
            s.state -> 'queue' ->> coalesce((s.state ->> 'cursor')::integer, 0),
            ''
          )::uuid
          and a.expected_revision = s.revision
          and a.status = 'completed'
          and a.correct
        order by a.completed_at desc
        limit 1
      )
      else null
    end,
    'state', s.state,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', i.position,
        'recognition_seen', i.recognition_seen,
        'pronunciation_passed', i.pronunciation_passed,
        'translation_passed', i.translation_passed,
        'spelling_passed', i.spelling_passed,
        'wrong_count', i.wrong_count,
        'word', jsonb_build_object(
          'id', w.id,
          'term', w.term,
          'normalized_term', w.normalized_term,
          'translations', w.translations,
          'ipa', w.ipa,
          'position', w.position,
          'progress', jsonb_build_object(
            'initial_recognition_seen', coalesce(p.initial_recognition_seen, false),
            'initial_pronunciation_passed', coalesce(p.initial_pronunciation_passed, false),
            'initial_translation_passed', coalesce(p.initial_translation_passed, false),
            'initial_spelling_passed', coalesce(p.initial_spelling_passed, false),
            'pronunciation_review_dates', coalesce(p.pronunciation_review_dates, '{}'::date[]),
            'translation_review_dates', coalesce(p.translation_review_dates, '{}'::date[]),
            'spelling_review_dates', coalesce(p.spelling_review_dates, '{}'::date[]),
            'wrong_count', coalesce(p.wrong_count, 0),
            'review_count', coalesce(p.review_count, 0),
            'learned_at', p.learned_at
          )
        )
      ) order by i.position)
      from public.learning_session_items i
      join public.learning_course_words w on w.id = i.word_id
      left join public.learning_word_progress p
        on p.user_id = s.user_id and p.word_id = i.word_id
      where i.session_id = s.id
    ), '[]'::jsonb)
  ) into v_result
  from public.learning_sessions s
  where s.id = p_session_id and s.user_id = p_user_id;

  if v_result is null then
    raise exception 'learning session not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

create or replace function public.learning_claim_spelling_translation_assessment(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_assessment_id uuid,
  p_expected_revision bigint,
  p_answer_hash text,
  p_lease_token uuid,
  p_lease_seconds integer,
  p_minute_limit integer,
  p_day_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.learning_sessions%rowtype;
  v_existing public.learning_spelling_translation_assessments%rowtype;
  v_word public.learning_course_words%rowtype;
  v_current_word uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_assessment_id is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_answer_hash !~ '^[0-9a-f]{64}$'
     or p_lease_token is null
     or p_lease_seconds not between 5 and 120
     or p_minute_limit not between 1 and 1000
     or p_day_limit not between 1 and 100000 then
    raise exception 'invalid translation assessment request' using errcode = '22023';
  end if;

  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id
  for update;
  if not v_session.active or v_session.stage <> 'spelling' then
    raise exception 'session is not in spelling stage' using errcode = '22023';
  end if;
  if v_session.revision <> p_expected_revision then
    return jsonb_build_object(
      'conflict', true,
      'current_revision', v_session.revision
    );
  end if;
  if coalesce((v_session.spelling_options ->> 'translationFirst')::boolean, false)
     is not true then
    raise exception 'translation-first spelling is not enabled' using errcode = '22023';
  end if;
  v_current_word := nullif(
    v_session.state -> 'queue' ->> coalesce((v_session.state ->> 'cursor')::integer, 0),
    ''
  )::uuid;
  if v_current_word is distinct from p_word_id then
    raise exception 'word is not the active spelling item' using errcode = '22023';
  end if;

  select * into v_existing
  from public.learning_spelling_translation_assessments
  where assessment_id = p_assessment_id
  for update;
  if found then
    if v_existing.user_id <> p_user_id
       or v_existing.session_id <> p_session_id
       or v_existing.word_id <> p_word_id
       or v_existing.expected_revision <> p_expected_revision
       or v_existing.answer_hash <> p_answer_hash then
      raise exception 'translation assessment id was reused with different input'
        using errcode = '22023';
    end if;
    if v_existing.status = 'completed' then
      return jsonb_build_object(
        'replayed', true,
        'response_payload', v_existing.response_payload
      );
    end if;
    if v_existing.status = 'processing'
       and v_existing.lease_until is not null
       and v_existing.lease_until > v_now then
      return jsonb_build_object(
        'pending', true,
        'retry_after_ms',
        greatest(100, ceil(extract(epoch from (v_existing.lease_until - v_now)) * 1000)::integer)
      );
    end if;
    update public.learning_spelling_translation_assessments
    set status = 'processing',
        lease_token = p_lease_token,
        lease_until = v_now + make_interval(secs => p_lease_seconds),
        provider_attempts = provider_attempts + 1,
        last_error_code = null,
        updated_at = v_now
    where assessment_id = p_assessment_id;
  else
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'learning-translation-quota:' || p_user_id::text,
        280719
      )
    );
    if (
      select count(*)
      from public.learning_spelling_translation_assessments
      where user_id = p_user_id
        and created_at >= v_now - interval '1 minute'
    ) >= p_minute_limit then
      raise exception 'translation assessment minute quota exceeded' using errcode = 'P0001';
    end if;
    if (
      select count(*)
      from public.learning_spelling_translation_assessments
      where user_id = p_user_id
        and created_at >= v_now - interval '24 hours'
    ) >= p_day_limit then
      raise exception 'translation assessment daily quota exceeded' using errcode = 'P0001';
    end if;
    insert into public.learning_spelling_translation_assessments (
      assessment_id,
      user_id,
      session_id,
      word_id,
      expected_revision,
      answer_hash,
      status,
      lease_token,
      lease_until
    ) values (
      p_assessment_id,
      p_user_id,
      p_session_id,
      p_word_id,
      p_expected_revision,
      p_answer_hash,
      'processing',
      p_lease_token,
      v_now + make_interval(secs => p_lease_seconds)
    );
  end if;

  select * into strict v_word
  from public.learning_course_words
  where id = p_word_id and user_id = p_user_id;
  return jsonb_build_object(
    'claimed', true,
    'term', v_word.term,
    'translations', v_word.translations
  );
end;
$$;

create or replace function public.learning_complete_spelling_translation_assessment(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_assessment_id uuid,
  p_expected_revision bigint,
  p_answer_hash text,
  p_lease_token uuid,
  p_correct boolean,
  p_feedback text,
  p_provider text,
  p_model text,
  p_usage jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assessment public.learning_spelling_translation_assessments%rowtype;
  v_session public.learning_sessions%rowtype;
  v_word public.learning_course_words%rowtype;
  v_current_word uuid;
  v_attempt jsonb;
  v_result jsonb;
begin
  if p_correct is null
     or char_length(coalesce(p_feedback, '')) not between 1 and 240
     or char_length(coalesce(p_provider, '')) not between 1 and 80
     or char_length(coalesce(p_model, '')) not between 1 and 160
     or jsonb_typeof(coalesce(p_usage, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid translation assessment result' using errcode = '22023';
  end if;

  select * into strict v_assessment
  from public.learning_spelling_translation_assessments
  where assessment_id = p_assessment_id
    and user_id = p_user_id
    and session_id = p_session_id
    and word_id = p_word_id
  for update;
  if v_assessment.status = 'completed' then
    return jsonb_set(v_assessment.response_payload, '{replayed}', 'true'::jsonb, true);
  end if;
  if v_assessment.expected_revision <> p_expected_revision
     or v_assessment.answer_hash <> p_answer_hash
     or v_assessment.lease_token is distinct from p_lease_token then
    raise exception 'translation assessment lease does not match'
      using errcode = '22023';
  end if;

  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id
  for update;
  v_current_word := nullif(
    v_session.state -> 'queue' ->> coalesce((v_session.state ->> 'cursor')::integer, 0),
    ''
  )::uuid;
  if not v_session.active
     or v_session.stage <> 'spelling'
     or v_session.revision <> p_expected_revision
     or v_current_word is distinct from p_word_id then
    v_result := jsonb_build_object(
      'conflict', true,
      'current_revision', v_session.revision
    );
  else
    select * into strict v_word
    from public.learning_course_words
    where id = p_word_id and user_id = p_user_id;
    if not p_correct then
      v_attempt := public.learning_record_attempt(
        p_user_id,
        p_session_id,
        p_word_id,
        'spelling',
        jsonb_build_object(
          'text', '',
          'translationAssessmentId', p_assessment_id
        ),
        p_assessment_id,
        p_expected_revision
      );
    end if;
    v_result := jsonb_build_object(
      'attempt_id', p_assessment_id,
      'correct', p_correct,
      'expected', v_word.translations,
      'feedback', btrim(p_feedback),
      'revision', case
        when p_correct then v_session.revision
        else (v_attempt ->> 'revision')::bigint
      end,
      'replayed', false,
      'attempt_result', case when p_correct then null else v_attempt end
    );
  end if;

  update public.learning_spelling_translation_assessments
  set status = 'completed',
      correct = p_correct,
      response_payload = v_result,
      provider = p_provider,
      model = p_model,
      prompt_tokens = nullif(p_usage ->> 'promptTokens', '')::integer,
      completion_tokens = nullif(p_usage ->> 'completionTokens', '')::integer,
      total_tokens = nullif(p_usage ->> 'totalTokens', '')::integer,
      lease_token = null,
      lease_until = null,
      updated_at = now(),
      completed_at = now()
  where assessment_id = p_assessment_id;
  return v_result;
end;
$$;

create or replace function public.learning_release_spelling_translation_assessment(
  p_user_id uuid,
  p_assessment_id uuid,
  p_lease_token uuid,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if char_length(coalesce(p_error_code, '')) not between 1 and 80 then
    raise exception 'invalid translation provider error code' using errcode = '22023';
  end if;
  update public.learning_spelling_translation_assessments
  set status = 'pending',
      lease_token = null,
      lease_until = null,
      last_error_code = p_error_code,
      updated_at = now()
  where assessment_id = p_assessment_id
    and user_id = p_user_id
    and status = 'processing'
    and lease_token = p_lease_token;
  return found;
end;
$$;

create or replace function public.learning_record_spelling_attempt(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_answer jsonb,
  p_attempt_id uuid,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_translation_first boolean;
begin
  -- Let the original idempotent function replay a result before inspecting
  -- the now-advanced session.
  if exists (
    select 1
    from public.learning_attempts
    where user_id = p_user_id
      and session_id = p_session_id
      and attempt_id = p_attempt_id
  ) then
    return public.learning_record_attempt(
      p_user_id,
      p_session_id,
      p_word_id,
      'spelling',
      p_answer,
      p_attempt_id,
      p_expected_revision
    );
  end if;

  select coalesce((spelling_options ->> 'translationFirst')::boolean, false)
  into strict v_translation_first
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id;
  if v_translation_first and not exists (
    select 1
    from public.learning_spelling_translation_assessments
    where assessment_id = p_attempt_id
      and user_id = p_user_id
      and session_id = p_session_id
      and word_id = p_word_id
      and expected_revision = p_expected_revision
      and status = 'completed'
      and correct
  ) then
    raise exception 'a passed translation assessment is required before spelling'
      using errcode = '22023';
  end if;
  return public.learning_record_attempt(
    p_user_id,
    p_session_id,
    p_word_id,
    'spelling',
    p_answer,
    p_attempt_id,
    p_expected_revision
  );
end;
$$;

revoke execute on function public._learning_normalize_spelling_options(jsonb, boolean)
  from public, anon, authenticated;
revoke execute on function public.learning_start_session(
  uuid, uuid, uuid, text, text[], text, uuid, jsonb
) from public, anon, authenticated;
revoke execute on function public.learning_get_session_snapshot(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.learning_claim_spelling_translation_assessment(
  uuid, uuid, uuid, uuid, bigint, text, uuid, integer, integer, integer
) from public, anon, authenticated;
revoke execute on function public.learning_complete_spelling_translation_assessment(
  uuid, uuid, uuid, uuid, bigint, text, uuid, boolean, text, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.learning_release_spelling_translation_assessment(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.learning_record_spelling_attempt(
  uuid, uuid, uuid, jsonb, uuid, bigint
) from public, anon, authenticated;

grant execute on function public.learning_start_session(
  uuid, uuid, uuid, text, text[], text, uuid, jsonb
) to service_role;
grant execute on function public.learning_get_session_snapshot(uuid, uuid)
  to service_role;
grant execute on function public.learning_claim_spelling_translation_assessment(
  uuid, uuid, uuid, uuid, bigint, text, uuid, integer, integer, integer
) to service_role;
grant execute on function public.learning_complete_spelling_translation_assessment(
  uuid, uuid, uuid, uuid, bigint, text, uuid, boolean, text, text, text, jsonb
) to service_role;
grant execute on function public.learning_release_spelling_translation_assessment(
  uuid, uuid, uuid, text
) to service_role;
grant execute on function public.learning_record_spelling_attempt(
  uuid, uuid, uuid, jsonb, uuid, bigint
) to service_role;
