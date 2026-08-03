-- Purpose: add a server-authoritative pronunciation exam beside the existing
-- spelling exam, with the same first-round pass mark and durable retry-round
-- confirmation boundary. Update this document only through a later forward
-- migration.

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
      and coalesce((s.state ->> 'awaitingRetryConfirmation')::boolean, false)
  ) then
    raise exception 'retry round confirmation is required'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Reject a forged/non-current word before the API spends Azure assessment
-- quota. The returned reference text still comes only from the owner-scoped
-- course row; the browser never supplies it.
create or replace function public.learning_get_assessment_target(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
  v_stage text;
  v_mode text;
  v_state jsonb;
  v_expected uuid;
begin
  select jsonb_build_object(
      'id', w.id,
      'term', w.term,
      'revision', s.revision,
      'stage', s.stage,
      'state', s.state
    ), s.stage, s.mode, s.state
  into v_result, v_stage, v_mode, v_state
  from public.learning_sessions s
  join public.learning_session_items i on i.session_id = s.id
  join public.learning_course_words w on w.id = i.word_id
  where s.id = p_session_id
    and s.user_id = p_user_id
    and s.active
    and i.word_id = p_word_id
    and w.user_id = p_user_id;

  if v_result is null then
    raise exception 'active assessment target not found' using errcode = '42501';
  end if;
  if v_stage = 'recognition'
     or (v_mode = 'exam' and v_stage = 'pronunciation') then
    if coalesce((v_state ->> 'awaitingRetryConfirmation')::boolean, false) then
      raise exception 'retry round confirmation is required' using errcode = '42501';
    end if;
    v_expected := nullif(
      v_state -> 'queue' ->> coalesce((v_state ->> 'cursor')::integer, 0),
      ''
    )::uuid;
    if v_expected is distinct from p_word_id then
      raise exception 'word is not the current assessment target' using errcode = '42501';
    end if;
  end if;
  return v_result;
end;
$$;

-- New application releases call the six-argument overload. The five-argument
-- spelling-only signature remains as a rollback-compatible wrapper.
create or replace function public.learning_start_exam_session(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_spelling_options jsonb,
  p_pass_percent integer,
  p_exam_kind text
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
  if p_exam_kind not in ('spelling', 'pronunciation') then
    raise exception 'invalid exam kind' using errcode = '22023';
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

  -- Preserve the historical spelling resume key so an already-running
  -- spelling exam remains resumable after an application rollback. The new
  -- pronunciation intent gets its own active-session namespace.
  v_resume_key := case p_exam_kind
    when 'spelling' then 'exam:' || p_course_id::text || ':' || v_unit_id::text
    else 'exam:pronunciation:' || p_course_id::text || ':' || v_unit_id::text
  end;
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
      'translationFirst', p_exam_kind = 'spelling'
    )),
    p_exam_kind = 'spelling'
  ) || jsonb_build_object(
    'translationFirst', p_exam_kind = 'spelling'
  );

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
    array[p_exam_kind]::text[],
    p_exam_kind,
    jsonb_build_object(
      'cursor', 0,
      'nextQueue', '[]'::jsonb,
      'round', 1,
      'examKind', p_exam_kind,
      'examRequiredPercent', p_pass_percent,
      'examAnswered', 0,
      'examCorrect', 0,
      'examAccuracyPercent', 0,
      'examPassed', null,
      'examFirstRoundComplete', false,
      'roundAssessmentScores', '{}'::jsonb
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
          v_session_id::text || ':' || p_exam_kind || ':' || i.word_id::text,
          81029
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

create or replace function public.learning_start_exam_session(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_spelling_options jsonb,
  p_pass_percent integer default 90
)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.learning_start_exam_session(
    p_user_id,
    p_course_id,
    p_unit_id,
    p_spelling_options,
    p_pass_percent,
    'spelling'
  );
$$;

create or replace function public.learning_continue_exam_retry_round(
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
  if not v_session.active
     or v_session.stage not in ('spelling', 'pronunciation')
     or (v_session.stage = 'pronunciation' and v_session.mode <> 'exam') then
    raise exception 'session is not waiting for an exam retry round'
      using errcode = '22023';
  end if;
  if not coalesce((v_session.state ->> 'awaitingRetryConfirmation')::boolean, false) then
    if coalesce((v_session.state ->> 'round')::integer, 1) > 1 then
      return jsonb_build_object(
        'revision', v_session.revision,
        'session_patch', public._learning_session_patch(p_session_id, null)
      );
    end if;
    raise exception 'retry round is not waiting for confirmation'
      using errcode = '22023';
  end if;
  v_queue := coalesce(v_session.state -> 'queue', '[]'::jsonb);
  v_round := coalesce((v_session.state ->> 'round')::integer, 2);
  if jsonb_array_length(v_queue) = 0 then
    raise exception 'retry pool is empty' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(q.value) order by
    pg_catalog.hashtextextended(
      p_session_id::text || ':' || v_round::text || ':' || q.value,
      81029
    ), q.value), '[]'::jsonb)
  into v_shuffled
  from jsonb_array_elements_text(v_queue) q(value);

  update public.learning_sessions
  set state = (state
        - 'awaitingRetryConfirmation'
        - 'retrySummaryIds'
        - 'retrySummaryScores'
        - 'retryFromRound') || jsonb_build_object(
          'queue', v_shuffled,
          'cursor', 0,
          'nextQueue', '[]'::jsonb,
          'roundAssessmentScores', '{}'::jsonb
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

create or replace function public.learning_continue_spelling_retry_round(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select public.learning_continue_exam_retry_round(p_user_id, p_session_id);
$$;

create or replace function public.learning_record_speech_assessment(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_assessment jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.learning_sessions%rowtype;
  v_after public.learning_sessions%rowtype;
  v_accuracy numeric;
  v_score numeric;
  v_threshold numeric;
  v_correct boolean;
  v_date date := public._learning_local_date(p_user_id);
  v_cursor integer;
  v_expected uuid;
  v_next_queue jsonb;
  v_retry_queued boolean := false;
  v_revision bigint;
  v_is_exam boolean := false;
  v_round integer;
  v_queue_size integer;
  v_state_patch jsonb := '{}'::jsonb;
  v_score_map jsonb;
  v_exam_answered integer;
  v_exam_correct integer;
  v_exam_total integer;
  v_exam_required integer;
  v_exam_accuracy numeric;
begin
  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id and active
  for update;

  if not exists (
    select 1
    from public.learning_session_items i
    join public.learning_course_words w on w.id = i.word_id
    where i.session_id = p_session_id
      and i.word_id = p_word_id
      and w.user_id = p_user_id
  ) then
    raise exception 'word is not in session' using errcode = '42501';
  end if;

  v_accuracy := nullif(p_assessment ->> 'accuracyScore', '')::numeric;
  v_score := coalesce(nullif(p_assessment ->> 'pronunciationScore', '')::numeric, v_accuracy);
  v_threshold := coalesce(nullif(p_assessment ->> 'passThreshold', '')::numeric, 70);
  if v_accuracy is null or v_accuracy < 0 or v_accuracy > 100
     or v_score is null or v_score < 0 or v_score > 100
     or v_threshold < 1 or v_threshold > 100 then
    raise exception 'invalid speech assessment score' using errcode = '22023';
  end if;
  v_correct := v_score >= v_threshold;
  v_is_exam := v_session.mode = 'exam'
    and v_session.stage = 'pronunciation'
    and coalesce(v_session.state ->> 'examKind', 'spelling') = 'pronunciation';

  if v_session.stage = 'recognition' then
    v_cursor := coalesce((v_session.state ->> 'cursor')::integer, 0);
    v_expected := nullif(v_session.state -> 'queue' ->> v_cursor, '')::uuid;
    if v_expected is distinct from p_word_id then
      raise exception 'word is not the active recognition item' using errcode = '22023';
    end if;
    v_next_queue := coalesce(v_session.state -> 'nextQueue', '[]'::jsonb);
    if not v_correct and not (v_next_queue ? p_word_id::text) then
      v_next_queue := v_next_queue || jsonb_build_array(p_word_id);
    elsif v_correct and (v_next_queue ? p_word_id::text) then
      select coalesce(jsonb_agg(to_jsonb(entry.value)), '[]'::jsonb)
      into v_next_queue
      from jsonb_array_elements_text(v_next_queue) entry(value)
      where entry.value <> p_word_id::text;
    end if;
    v_retry_queued := v_next_queue ? p_word_id::text;
    update public.learning_sessions
    set state = jsonb_set(state, '{nextQueue}', v_next_queue),
        last_activity_at = now()
    where id = p_session_id;
  elsif v_is_exam then
    if coalesce((v_session.state ->> 'awaitingRetryConfirmation')::boolean, false) then
      raise exception 'retry round confirmation is required' using errcode = '22023';
    end if;
    v_cursor := coalesce((v_session.state ->> 'cursor')::integer, 0);
    v_round := coalesce((v_session.state ->> 'round')::integer, 1);
    v_expected := nullif(v_session.state -> 'queue' ->> v_cursor, '')::uuid;
    if v_expected is distinct from p_word_id then
      raise exception 'word is not the active pronunciation exam item'
        using errcode = '22023';
    end if;
    v_score_map := jsonb_set(
      coalesce(v_session.state -> 'roundAssessmentScores', '{}'::jsonb),
      array[p_word_id::text],
      to_jsonb(v_score),
      true
    );
    v_next_queue := coalesce(v_session.state -> 'nextQueue', '[]'::jsonb);
    if not v_correct and not (v_next_queue ? p_word_id::text) then
      v_next_queue := v_next_queue || jsonb_build_array(p_word_id);
    end if;
    v_retry_queued := not v_correct;

    if v_round = 1 then
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
  elsif v_session.stage <> 'recognition' then
    raise exception 'session is not accepting pronunciation assessment'
      using errcode = '22023';
  end if;

  insert into public.learning_attempts (
    user_id, course_id, session_id, word_id, mode, skill, is_correct,
    provider_details, local_date
  ) values (
    p_user_id, v_session.course_id, p_session_id, p_word_id,
    v_session.mode, 'speech_assessment', v_correct,
    coalesce(p_assessment, '{}'::jsonb), v_date
  );

  if v_is_exam then
    update public.learning_session_items
    set pronunciation_passed = pronunciation_passed or v_correct,
        wrong_count = wrong_count + case when v_correct then 0 else 1 end
    where session_id = p_session_id and word_id = p_word_id;
  elsif not v_correct then
    update public.learning_session_items
    set wrong_count = wrong_count + 1
    where session_id = p_session_id and word_id = p_word_id;
  end if;
  if not v_correct then
    update public.learning_word_progress
    set wrong_count = wrong_count + 1, updated_at = now()
    where user_id = p_user_id and word_id = p_word_id;
  end if;

  if v_is_exam then
    v_queue_size := jsonb_array_length(coalesce(v_session.state -> 'queue', '[]'::jsonb));
    if v_cursor + 1 >= v_queue_size then
      if jsonb_array_length(v_next_queue) > 0 then
        update public.learning_sessions
        set state = state || v_state_patch || jsonb_build_object(
              'queue', v_next_queue,
              'cursor', 0,
              'nextQueue', '[]'::jsonb,
              'round', v_round + 1,
              'awaitingRetryConfirmation', true,
              'retrySummaryIds', v_next_queue,
              'retrySummaryScores', v_score_map,
              'retryFromRound', v_round,
              'roundAssessmentScores', '{}'::jsonb
            ),
            last_activity_at = now()
        where id = p_session_id;
      else
        update public.learning_sessions
        set state = jsonb_set(
              state || v_state_patch || jsonb_build_object(
                'roundAssessmentScores', v_score_map
              ),
              '{cursor}',
              to_jsonb(v_cursor + 1)
            ),
            last_activity_at = now()
        where id = p_session_id;
        perform public._learning_advance_session(p_session_id);
        perform public._learning_reset_session_queue(p_session_id);
      end if;
    else
      update public.learning_sessions
      set state = state || v_state_patch || jsonb_build_object(
            'cursor', v_cursor + 1,
            'nextQueue', v_next_queue,
            'roundAssessmentScores', v_score_map
          ),
          last_activity_at = now()
      where id = p_session_id;
    end if;
  else
    update public.learning_sessions
    set last_activity_at = now()
    where id = p_session_id;
  end if;

  select * into strict v_after
  from public.learning_sessions
  where id = p_session_id;
  v_revision := v_after.revision;
  return jsonb_build_object(
    'recorded', true,
    'correct', v_correct,
    'retry_queued', v_retry_queued,
    'pass_threshold', v_threshold,
    'revision', v_revision,
    'session_patch', public._learning_session_patch(p_session_id, p_word_id)
  );
end;
$$;

create or replace function public._learning_apply_passed_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_exam_kind text;
begin
  if old.stage is distinct from 'completed'
     and new.stage = 'completed'
     and new.mode = 'exam'
     and coalesce((new.state ->> 'examPassed')::boolean, false) then
    v_exam_kind := coalesce(new.state ->> 'examKind', 'spelling');
    update public.learning_word_progress p
    set initial_pronunciation_passed = p.initial_pronunciation_passed
          or v_exam_kind = 'pronunciation',
        initial_translation_passed = p.initial_translation_passed
          or v_exam_kind = 'spelling',
        initial_spelling_passed = p.initial_spelling_passed
          or v_exam_kind = 'spelling',
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

revoke execute on function public.learning_start_exam_session(
  uuid, uuid, uuid, jsonb, integer, text
) from public, anon, authenticated;
revoke execute on function public.learning_continue_exam_retry_round(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.learning_start_exam_session(
  uuid, uuid, uuid, jsonb, integer, text
) to service_role;
grant execute on function public.learning_continue_exam_retry_round(uuid, uuid)
  to service_role;
