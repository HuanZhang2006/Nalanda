-- Purpose: add server-authoritative vocabulary exams, explicit spelling retry
-- round confirmation, and provider-only semantic assessment quotas.
-- Update this document only through a later forward migration.

alter table public.learning_sessions
  drop constraint learning_sessions_mode_check,
  add constraint learning_sessions_mode_check
    check (mode in ('initial', 'review', 'exam'));

alter table public.learning_attempts
  drop constraint learning_attempts_mode_check,
  add constraint learning_attempts_mode_check
    check (mode in ('initial', 'review', 'exam'));

-- Keep TRUE as the default so an older application release that still calls
-- the 0019 claim RPC remains conservatively quota-counted. The new claim RPC
-- explicitly creates an uncounted row and reserves quota only before a real
-- provider request. Deterministic exact matches therefore consume no model
-- allowance.
alter table public.learning_spelling_translation_assessments
  add column quota_counted boolean not null default true,
  add column quota_counted_at timestamptz default now();

update public.learning_spelling_translation_assessments
set quota_counted = false,
    quota_counted_at = null
where provider = 'nalanda-normalized-exact';

update public.learning_spelling_translation_assessments
set quota_counted_at = created_at
where quota_counted;

alter table public.learning_spelling_translation_assessments
  add constraint learning_spelling_translation_quota_time_check
  check (quota_counted = (quota_counted_at is not null));

create index learning_spelling_translation_counted_quota_idx
  on public.learning_spelling_translation_assessments (user_id, quota_counted_at desc)
  where quota_counted;

create or replace function public._learning_guard_retry_round_attempt()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.learning_sessions s
    where s.id = new.session_id
      and s.active
      and s.stage = 'spelling'
      and coalesce((s.state ->> 'awaitingRetryConfirmation')::boolean, false)
  ) then
    raise exception 'spelling retry round confirmation is required'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger learning_attempt_retry_round_guard
before insert on public.learning_attempts
for each row execute function public._learning_guard_retry_round_attempt();

create or replace function public._learning_guard_retry_round_assessment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'processing' then
      return new;
    end if;
  elsif new.status <> 'processing'
        or old.status is not distinct from 'processing' then
    return new;
  end if;

  if exists (
       select 1
       from public.learning_sessions s
       where s.id = new.session_id
         and s.active
         and s.stage = 'spelling'
         and coalesce((s.state ->> 'awaitingRetryConfirmation')::boolean, false)
     ) then
    raise exception 'spelling retry round confirmation is required'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger learning_assessment_retry_round_guard
before insert or update of status on public.learning_spelling_translation_assessments
for each row execute function public._learning_guard_retry_round_assessment();

create or replace function public.learning_claim_spelling_translation_assessment_v2(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_assessment_id uuid,
  p_expected_revision bigint,
  p_answer_hash text,
  p_lease_token uuid,
  p_lease_seconds integer
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
     or p_lease_seconds not between 5 and 120 then
    raise exception 'invalid translation assessment request' using errcode = '22023';
  end if;

  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id
  for update;
  if not v_session.active or v_session.stage <> 'spelling' then
    raise exception 'session is not in spelling stage' using errcode = '22023';
  end if;
  if coalesce((v_session.state ->> 'awaitingRetryConfirmation')::boolean, false) then
    raise exception 'spelling retry round confirmation is required'
      using errcode = '22023';
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
    insert into public.learning_spelling_translation_assessments (
      assessment_id,
      user_id,
      session_id,
      word_id,
      expected_revision,
      answer_hash,
      status,
      lease_token,
      lease_until,
      quota_counted,
      quota_counted_at
    ) values (
      p_assessment_id,
      p_user_id,
      p_session_id,
      p_word_id,
      p_expected_revision,
      p_answer_hash,
      'processing',
      p_lease_token,
      v_now + make_interval(secs => p_lease_seconds),
      false,
      null
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

create or replace function public.learning_reserve_spelling_translation_quota(
  p_user_id uuid,
  p_assessment_id uuid,
  p_lease_token uuid,
  p_minute_limit integer,
  p_day_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_assessment public.learning_spelling_translation_assessments%rowtype;
  v_now timestamptz := clock_timestamp();
  v_retry_after integer;
begin
  if p_assessment_id is null
     or p_lease_token is null
     or p_minute_limit not between 1 and 1000
     or p_day_limit not between 1 and 100000 then
    raise exception 'invalid translation quota reservation' using errcode = '22023';
  end if;

  select * into strict v_assessment
  from public.learning_spelling_translation_assessments
  where assessment_id = p_assessment_id
    and user_id = p_user_id
  for update;
  if v_assessment.status <> 'processing'
     or v_assessment.lease_token is distinct from p_lease_token then
    raise exception 'translation assessment lease does not match'
      using errcode = '22023';
  end if;
  if v_assessment.quota_counted then
    return jsonb_build_object('reserved', true, 'replayed', true);
  end if;

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
      and quota_counted
      and quota_counted_at >= v_now - interval '1 minute'
  ) >= p_minute_limit then
    select greatest(
      1,
      ceil(extract(epoch from (min(quota_counted_at) + interval '1 minute' - v_now)))::integer
    ) into v_retry_after
    from public.learning_spelling_translation_assessments
    where user_id = p_user_id
      and quota_counted
      and quota_counted_at >= v_now - interval '1 minute';
    raise exception 'translation assessment minute quota exceeded'
      using errcode = 'P0001',
        hint = 'retry_after_seconds=' || coalesce(v_retry_after, 60)::text;
  end if;
  if (
    select count(*)
    from public.learning_spelling_translation_assessments
    where user_id = p_user_id
      and quota_counted
      and quota_counted_at >= v_now - interval '24 hours'
  ) >= p_day_limit then
    select greatest(
      1,
      ceil(extract(epoch from (min(quota_counted_at) + interval '24 hours' - v_now)))::integer
    ) into v_retry_after
    from public.learning_spelling_translation_assessments
    where user_id = p_user_id
      and quota_counted
      and quota_counted_at >= v_now - interval '24 hours';
    raise exception 'translation assessment daily quota exceeded'
      using errcode = 'P0001',
        hint = 'retry_after_seconds=' || coalesce(v_retry_after, 86400)::text;
  end if;

  update public.learning_spelling_translation_assessments
  set quota_counted = true,
      quota_counted_at = v_now,
      updated_at = v_now
  where assessment_id = p_assessment_id;
  return jsonb_build_object('reserved', true, 'replayed', false);
end;
$$;

create or replace function public.learning_start_exam_session(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_spelling_options jsonb,
  p_pass_percent integer default 90
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_session_id uuid;
  v_unit_id uuid := p_unit_id;
  v_count integer;
  v_resume_key text;
  v_options jsonb;
begin
  if p_pass_percent is null or p_pass_percent not between 1 and 100 then
    raise exception 'exam pass percent must be between 1 and 100'
      using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.learning_courses c
    where c.id = p_course_id and c.user_id = p_user_id
  ) then
    raise exception 'course not found' using errcode = '42501';
  end if;
  if v_unit_id is null then
    select id into v_unit_id
    from public.learning_course_units
    where course_id = p_course_id and user_id = p_user_id
    order by position
    limit 1;
  end if;
  if not exists (
    select 1 from public.learning_course_units u
    where u.id = v_unit_id
      and u.course_id = p_course_id
      and u.user_id = p_user_id
  ) then
    raise exception 'unit not found' using errcode = '42501';
  end if;

  v_resume_key := 'exam:' || p_course_id::text || ':' || v_unit_id::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'learning-active-session:' || p_user_id::text || ':' || v_resume_key,
      420776
    )
  );
  select id into v_session_id
  from public.learning_sessions
  where user_id = p_user_id
    and resume_key = v_resume_key
    and active
  order by started_at desc
  limit 1;
  if v_session_id is not null then
    return v_session_id;
  end if;

  v_options := public._learning_normalize_spelling_options(
    coalesce(p_spelling_options, jsonb_build_object(
      'timeLimitEnabled', false,
      'timeLimitSeconds', 20,
      'translationFirst', true
    )),
    true
  ) || jsonb_build_object('translationFirst', true);

  insert into public.learning_sessions (
    user_id,
    course_id,
    unit_id,
    mode,
    scope,
    selected_skills,
    stage,
    state,
    resume_key,
    spelling_options
  ) values (
    p_user_id,
    p_course_id,
    v_unit_id,
    'exam',
    'all',
    array['spelling']::text[],
    'spelling',
    jsonb_build_object(
      'cursor', 0,
      'nextQueue', '[]'::jsonb,
      'round', 1,
      'examRequiredPercent', p_pass_percent,
      'examAnswered', 0,
      'examCorrect', 0,
      'examAccuracyPercent', 0,
      'examPassed', null,
      'examFirstRoundComplete', false
    ),
    v_resume_key,
    v_options
  ) returning id into v_session_id;

  insert into public.learning_session_items (session_id, word_id, position)
  select
    v_session_id,
    w.id,
    row_number() over (order by w.position, w.id) - 1
  from public.learning_course_words w
  where w.unit_id = v_unit_id and w.user_id = p_user_id
  order by w.position, w.id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    delete from public.learning_sessions where id = v_session_id;
    raise exception 'no words match this exam scope' using errcode = '22023';
  end if;

  update public.learning_sessions s
  set state = s.state || jsonb_build_object(
    'queue', (
      select coalesce(jsonb_agg(to_jsonb(i.word_id) order by
        pg_catalog.hashtextextended(
          v_session_id::text || ':' || i.word_id::text,
          81027
        ), i.word_id), '[]'::jsonb)
      from public.learning_session_items i
      where i.session_id = v_session_id
    ),
    'examTotal', v_count
  )
  where s.id = v_session_id;
  return v_session_id;
end;
$$;

-- The current idempotent answer RPC remains the single authority for cursor,
-- retry pool, errors, revision, and exam score. A spelling round with errors
-- now stops at an explicit durable confirmation boundary.
create or replace function public.learning_record_attempt(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_skill text,
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
  v_session public.learning_sessions%rowtype;
  v_after public.learning_sessions%rowtype;
  v_word public.learning_course_words%rowtype;
  v_correct boolean := false;
  v_answer_translations text[];
  v_expected_translations text[];
  v_date date := public._learning_local_date(p_user_id);
  v_cursor integer;
  v_expected uuid;
  v_queue_size integer;
  v_next_queue jsonb;
  v_target_index integer;
  v_result jsonb;
  v_state_patch jsonb := '{}'::jsonb;
  v_round integer;
  v_exam_answered integer;
  v_exam_correct integer;
  v_exam_total integer;
  v_exam_required integer;
  v_exam_accuracy numeric;
begin
  if p_attempt_id is null or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'attempt id and expected revision are required' using errcode = '22023';
  end if;
  if p_skill not in ('pronunciation', 'translation', 'spelling') then
    raise exception 'invalid learning skill' using errcode = '22023';
  end if;

  select a.response_payload into v_result
  from public.learning_attempts a
  where a.user_id = p_user_id
    and a.session_id = p_session_id
    and a.attempt_id = p_attempt_id;
  if found then
    return jsonb_set(v_result, '{replayed}', 'true'::jsonb, true);
  end if;

  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id
  for update;

  select a.response_payload into v_result
  from public.learning_attempts a
  where a.user_id = p_user_id
    and a.session_id = p_session_id
    and a.attempt_id = p_attempt_id;
  if found then
    return jsonb_set(v_result, '{replayed}', 'true'::jsonb, true);
  end if;

  if not v_session.active then
    raise exception 'learning session is not active' using errcode = '22023';
  end if;
  if coalesce((v_session.state ->> 'awaitingRetryConfirmation')::boolean, false) then
    raise exception 'spelling retry round confirmation is required'
      using errcode = '22023';
  end if;
  if v_session.revision <> p_expected_revision then
    return jsonb_build_object(
      'conflict', true,
      'current_revision', v_session.revision
    );
  end if;
  if v_session.stage <> p_skill or not (p_skill = any(v_session.selected_skills)) then
    raise exception 'answer does not match active session stage' using errcode = '22023';
  end if;

  v_cursor := coalesce((v_session.state ->> 'cursor')::integer, 0);
  v_round := coalesce((v_session.state ->> 'round')::integer, 1);
  v_expected := nullif(v_session.state -> 'queue' ->> v_cursor, '')::uuid;
  if p_skill = 'pronunciation' then
    select q.ordinality::integer - 1 into v_target_index
    from jsonb_array_elements_text(coalesce(v_session.state -> 'queue', '[]'::jsonb))
      with ordinality q(value, ordinality)
    where q.value::uuid = p_word_id
      and q.ordinality::integer - 1 between v_cursor and v_cursor + 4
    limit 1;
    if v_target_index is null then
      raise exception 'word is not in the active pronunciation batch' using errcode = '22023';
    end if;
    if v_target_index <> v_cursor then
      update public.learning_sessions
      set state = jsonb_set(
        jsonb_set(state, array['queue', v_cursor::text], to_jsonb(p_word_id)),
        array['queue', v_target_index::text], to_jsonb(v_expected)
      )
      where id = p_session_id;
    end if;
  elsif v_expected is distinct from p_word_id then
    raise exception 'word is not the active test item' using errcode = '22023';
  end if;

  select w.* into strict v_word
  from public.learning_course_words w
  join public.learning_session_items i on i.word_id = w.id
  where i.session_id = p_session_id
    and w.id = p_word_id
    and w.user_id = p_user_id;

  if p_skill = 'pronunciation' then
    v_correct := nullif(p_answer ->> 'wordId', '')::uuid = p_word_id;
  elsif p_skill = 'translation' then
    if jsonb_typeof(coalesce(p_answer -> 'translations', '[]'::jsonb)) = 'array' then
      select array_agg(lower(btrim(value)) order by lower(btrim(value)))
        into v_answer_translations
      from jsonb_array_elements_text(p_answer -> 'translations');
      select array_agg(lower(btrim(value)) order by lower(btrim(value)))
        into v_expected_translations
      from unnest(v_word.translations) value;
      v_correct := coalesce(v_answer_translations, '{}'::text[])
        = coalesce(v_expected_translations, '{}'::text[]);
    end if;
  else
    v_correct := public._learning_spelling_text_matches(
      p_answer ->> 'text',
      v_word.term
    );
  end if;

  insert into public.learning_attempts (
    user_id, course_id, session_id, word_id, mode, skill, is_correct,
    answer, local_date, attempt_id
  ) values (
    p_user_id, v_session.course_id, p_session_id, p_word_id,
    v_session.mode, p_skill, v_correct, coalesce(p_answer, '{}'::jsonb),
    v_date, p_attempt_id
  );

  update public.learning_session_items
  set pronunciation_passed = pronunciation_passed
        or (p_skill = 'pronunciation' and v_correct),
      translation_passed = translation_passed
        or (p_skill = 'translation' and v_correct),
      spelling_passed = spelling_passed
        or (p_skill = 'spelling' and v_correct),
      wrong_count = wrong_count + case when v_correct then 0 else 1 end
  where session_id = p_session_id and word_id = p_word_id;

  update public.learning_word_progress
  set wrong_count = wrong_count + case when v_correct then 0 else 1 end,
      initial_pronunciation_passed = initial_pronunciation_passed
        or (v_session.mode = 'initial' and p_skill = 'pronunciation' and v_correct),
      initial_translation_passed = initial_translation_passed
        or (v_session.mode = 'initial' and p_skill = 'translation' and v_correct),
      initial_spelling_passed = initial_spelling_passed
        or (v_session.mode = 'initial' and p_skill = 'spelling' and v_correct),
      updated_at = now()
  where user_id = p_user_id and word_id = p_word_id;

  if v_session.mode = 'exam' and p_skill = 'spelling' and v_round = 1 then
    v_exam_answered := coalesce((v_session.state ->> 'examAnswered')::integer, 0) + 1;
    v_exam_correct := coalesce((v_session.state ->> 'examCorrect')::integer, 0)
      + case when v_correct then 1 else 0 end;
    v_exam_total := coalesce(
      (v_session.state ->> 'examTotal')::integer,
      jsonb_array_length(coalesce(v_session.state -> 'queue', '[]'::jsonb))
    );
    v_exam_required := coalesce((v_session.state ->> 'examRequiredPercent')::integer, 90);
    v_exam_accuracy := round(
      100.0 * v_exam_correct / greatest(1, v_exam_answered),
      1
    );
    v_state_patch := jsonb_build_object(
      'examAnswered', v_exam_answered,
      'examCorrect', v_exam_correct,
      'examAccuracyPercent', v_exam_accuracy,
      'examFirstRoundComplete', v_exam_answered >= v_exam_total,
      'examPassed', case when v_exam_answered >= v_exam_total
        then v_exam_correct * 100 >= v_exam_required * v_exam_total
        else null end
    );
  end if;

  v_next_queue := coalesce(v_session.state -> 'nextQueue', '[]'::jsonb);
  if not v_correct and not (v_next_queue ? p_word_id::text) then
    v_next_queue := v_next_queue || jsonb_build_array(p_word_id);
  end if;
  v_queue_size := jsonb_array_length(coalesce(v_session.state -> 'queue', '[]'::jsonb));
  if v_cursor + 1 >= v_queue_size then
    if jsonb_array_length(v_next_queue) > 0 then
      if p_skill = 'spelling' then
        update public.learning_sessions
        set state = state || v_state_patch || jsonb_build_object(
          'queue', v_next_queue,
          'cursor', 0,
          'nextQueue', '[]'::jsonb,
          'round', v_round + 1,
          'awaitingRetryConfirmation', true,
          'retrySummaryIds', v_next_queue,
          'retryFromRound', v_round
        ),
        last_activity_at = now()
        where id = p_session_id;
      else
        update public.learning_sessions
        set state = state || v_state_patch || jsonb_build_object(
          'queue', v_next_queue,
          'cursor', 0,
          'nextQueue', '[]'::jsonb,
          'round', v_round + 1
        ),
        last_activity_at = now()
        where id = p_session_id;
      end if;
    else
      update public.learning_sessions
      set state = jsonb_set(state || v_state_patch, '{cursor}', to_jsonb(v_cursor + 1)),
          last_activity_at = now()
      where id = p_session_id;
      perform public._learning_advance_session(p_session_id);
      perform public._learning_reset_session_queue(p_session_id);
    end if;
  else
    update public.learning_sessions
    set state = state || v_state_patch || jsonb_build_object(
      'cursor', v_cursor + 1,
      'nextQueue', v_next_queue
    ),
    last_activity_at = now()
    where id = p_session_id;
  end if;

  select * into strict v_after
  from public.learning_sessions
  where id = p_session_id;

  v_result := jsonb_build_object(
    'attempt_id', p_attempt_id,
    'correct', v_correct,
    'expected', case p_skill
      when 'translation' then to_jsonb(v_word.translations)
      else to_jsonb(v_word.term)
    end,
    'revision', v_after.revision,
    'replayed', false,
    'session_patch', public._learning_session_patch(p_session_id, p_word_id)
  );

  update public.learning_attempts
  set response_payload = v_result
  where user_id = p_user_id
    and session_id = p_session_id
    and attempt_id = p_attempt_id;
  return v_result;
end;
$$;

create or replace function public.learning_continue_spelling_retry_round(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.learning_sessions%rowtype;
  v_queue jsonb;
  v_shuffled jsonb;
  v_round integer;
  v_revision bigint;
begin
  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id
  for update;
  if not v_session.active or v_session.stage <> 'spelling' then
    raise exception 'session is not in spelling stage' using errcode = '22023';
  end if;
  if not coalesce((v_session.state ->> 'awaitingRetryConfirmation')::boolean, false) then
    if coalesce((v_session.state ->> 'round')::integer, 1) > 1 then
      return jsonb_build_object(
        'revision', v_session.revision,
        'session_patch', public._learning_session_patch(p_session_id, null)
      );
    end if;
    raise exception 'spelling retry round is not waiting for confirmation'
      using errcode = '22023';
  end if;
  v_queue := coalesce(v_session.state -> 'queue', '[]'::jsonb);
  v_round := coalesce((v_session.state ->> 'round')::integer, 2);
  if jsonb_array_length(v_queue) = 0 then
    raise exception 'spelling retry pool is empty' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q.value) order by
    pg_catalog.hashtextextended(
      p_session_id::text || ':' || v_round::text || ':' || q.value,
      81027
    ), q.value), '[]'::jsonb)
  into v_shuffled
  from jsonb_array_elements_text(v_queue) q(value);

  update public.learning_sessions
  set state = (state
        - 'awaitingRetryConfirmation'
        - 'retrySummaryIds'
        - 'retryFromRound') || jsonb_build_object(
          'queue', v_shuffled,
          'cursor', 0,
          'nextQueue', '[]'::jsonb
        ),
      revision = revision + 1,
      last_activity_at = now()
  where id = p_session_id
  returning revision into v_revision;

  return jsonb_build_object(
    'revision', v_revision,
    'session_patch', public._learning_session_patch(p_session_id, null)
  );
end;
$$;

create or replace function public._learning_apply_passed_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.stage is distinct from 'completed'
     and new.stage = 'completed'
     and new.mode = 'exam'
     and coalesce((new.state ->> 'examPassed')::boolean, false) then
    update public.learning_word_progress p
    set initial_translation_passed = true,
        initial_spelling_passed = true,
        learned_at = coalesce(p.learned_at, now()),
        updated_at = now()
    from public.learning_session_items i
    where i.session_id = new.id
      and p.user_id = new.user_id
      and p.word_id = i.word_id;
  end if;
  return new;
end;
$$;

create trigger learning_session_passed_exam_progress
after update of stage on public.learning_sessions
for each row execute function public._learning_apply_passed_exam_progress();

revoke execute on function public._learning_guard_retry_round_attempt()
  from public, anon, authenticated;
revoke execute on function public._learning_guard_retry_round_assessment()
  from public, anon, authenticated;
revoke execute on function public.learning_claim_spelling_translation_assessment_v2(
  uuid, uuid, uuid, uuid, bigint, text, uuid, integer
) from public, anon, authenticated;
revoke execute on function public.learning_reserve_spelling_translation_quota(
  uuid, uuid, uuid, integer, integer
) from public, anon, authenticated;
revoke execute on function public.learning_start_exam_session(
  uuid, uuid, uuid, jsonb, integer
) from public, anon, authenticated;
revoke execute on function public.learning_record_attempt(
  uuid, uuid, uuid, text, jsonb, uuid, bigint
) from public, anon, authenticated;
revoke execute on function public.learning_continue_spelling_retry_round(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public._learning_apply_passed_exam_progress()
  from public, anon, authenticated;

grant execute on function public.learning_claim_spelling_translation_assessment_v2(
  uuid, uuid, uuid, uuid, bigint, text, uuid, integer
) to service_role;
grant execute on function public.learning_reserve_spelling_translation_quota(
  uuid, uuid, uuid, integer, integer
) to service_role;
grant execute on function public.learning_start_exam_session(
  uuid, uuid, uuid, jsonb, integer
) to service_role;
grant execute on function public.learning_record_attempt(
  uuid, uuid, uuid, text, jsonb, uuid, bigint
) to service_role;
grant execute on function public.learning_continue_spelling_retry_round(uuid, uuid)
  to service_role;
