-- Nalanda · Courses low-latency attempts, session snapshots and durable audio
--
-- This migration is deliberately backwards compatible with the application
-- released at 0014. The five-argument learning_record_attempt RPC remains
-- available while the new application uses the seven-argument overload.

alter table public.learning_sessions
  add column if not exists revision bigint not null default 0
  check (revision >= 0);

-- Every immutable attempt fact advances the same revision clock, including
-- calls made through the retained five-argument RPC during an app rollback.
create or replace function public._learning_increment_session_revision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.learning_sessions
  set revision = revision + 1
  where id = new.session_id;
  return new;
end;
$$;

create trigger learning_attempt_revision
after insert on public.learning_attempts
for each row execute function public._learning_increment_session_revision();

alter table public.learning_attempts
  add column if not exists attempt_id uuid,
  add column if not exists response_payload jsonb not null default '{}'::jsonb;

create unique index if not exists learning_attempts_idempotency_idx
  on public.learning_attempts (user_id, session_id, attempt_id);

alter table public.learning_speech_usage
  add column if not exists character_count integer not null default 0
  check (character_count >= 0);

create index if not exists learning_speech_usage_kind_rate_idx
  on public.learning_speech_usage (kind, created_at desc);

create table public.learning_audio_assets (
  cache_key          text primary key check (cache_key ~ '^[0-9a-f]{64}$'),
  normalized_term    text not null check (char_length(normalized_term) between 1 and 120),
  synthesis_text     text check (synthesis_text is null or char_length(synthesis_text) between 1 and 120),
  locale             text not null check (char_length(locale) between 2 and 20),
  voice              text not null check (char_length(voice) between 1 and 100),
  output_format      text not null check (char_length(output_format) between 1 and 100),
  synthesis_version  text not null check (synthesis_version ~ '^[A-Za-z0-9._-]{1,32}$'),
  storage_path       text not null unique,
  status             text not null default 'pending'
                     check (status in ('pending', 'processing', 'ready', 'failed')),
  priority           smallint not null default 20 check (priority between 0 and 100),
  attempt_count      integer not null default 0 check (attempt_count >= 0),
  next_attempt_at    timestamptz not null default now(),
  lease_token        uuid,
  lease_until        timestamptz,
  last_error_code    text,
  last_error_message text,
  ready_at           timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index learning_audio_assets_queue_idx
  on public.learning_audio_assets (priority desc, next_attempt_at, created_at)
  where status in ('pending', 'processing');

alter table public.learning_audio_assets enable row level security;
revoke all on table public.learning_audio_assets from public, anon, authenticated;
grant all on table public.learning_audio_assets to service_role;

create or replace function public._learning_session_patch(
  p_session_id uuid,
  p_word_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'stage', s.stage,
    'active', s.active,
    'state', s.state,
    'changed_item', case when i.word_id is null then null else jsonb_build_object(
      'word_id', i.word_id,
      'recognition_seen', i.recognition_seen,
      'pronunciation_passed', i.pronunciation_passed,
      'translation_passed', i.translation_passed,
      'spelling_passed', i.spelling_passed,
      'wrong_count', i.wrong_count
    ) end,
    'next_word_id', case when s.active then
      nullif(s.state -> 'queue' ->> coalesce((s.state ->> 'cursor')::integer, 0), '')
      else null end
  )
  from public.learning_sessions s
  left join public.learning_session_items i
    on i.session_id = s.id and i.word_id = p_word_id
  where s.id = p_session_id;
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
begin
  select jsonb_build_object(
    'id', w.id,
    'term', w.term,
    'revision', s.revision,
    'stage', s.stage,
    'state', s.state
  ) into v_result
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
  return v_result;
end;
$$;

-- New idempotent overload. Duplicate lookup happens both before and after the
-- session row lock so concurrent retries return the first committed result.
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
    v_correct := public._points_normalize_text(p_answer ->> 'text') = v_word.normalized_term;
  end if;

  -- Insert the immutable attempt fact before advancing the session. Review
  -- completion reads the final correct attempt's local_date in the same
  -- transaction when it projects cross-date mastery.
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

  v_next_queue := coalesce(v_session.state -> 'nextQueue', '[]'::jsonb);
  if not v_correct and not (v_next_queue ? p_word_id::text) then
    v_next_queue := v_next_queue || jsonb_build_array(p_word_id);
  end if;
  v_queue_size := jsonb_array_length(coalesce(v_session.state -> 'queue', '[]'::jsonb));
  if v_cursor + 1 >= v_queue_size then
    if jsonb_array_length(v_next_queue) > 0 then
      update public.learning_sessions
      set state = state || jsonb_build_object(
        'queue', v_next_queue,
        'cursor', 0,
        'nextQueue', '[]'::jsonb,
        'round', coalesce((state ->> 'round')::integer, 1) + 1
      ),
      last_activity_at = now()
      where id = p_session_id;
    else
      update public.learning_sessions
      set state = jsonb_set(state, '{cursor}', to_jsonb(v_cursor + 1)),
          last_activity_at = now()
      where id = p_session_id;
      perform public._learning_advance_session(p_session_id);
      perform public._learning_reset_session_queue(p_session_id);
    end if;
  else
    update public.learning_sessions
    set state = state || jsonb_build_object(
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

-- Recognition remains online-only, but it participates in the same revision
-- clock and returns a small authoritative patch.
create or replace function public.learning_mark_recognition(
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
  v_session public.learning_sessions%rowtype;
  v_date date := public._learning_local_date(p_user_id);
  v_cursor integer;
  v_expected uuid;
  v_queue_size integer;
  v_next_queue jsonb;
  v_revision bigint;
begin
  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id and active
  for update;
  if v_session.mode <> 'initial' or v_session.stage <> 'recognition' then
    raise exception 'session is not in recognition stage' using errcode = '22023';
  end if;
  v_cursor := coalesce((v_session.state ->> 'cursor')::integer, 0);
  v_expected := nullif(v_session.state -> 'queue' ->> v_cursor, '')::uuid;
  if v_expected is distinct from p_word_id then
    raise exception 'word is not the active recognition item' using errcode = '22023';
  end if;
  update public.learning_session_items
  set recognition_seen = true
  where session_id = p_session_id and word_id = p_word_id;
  if not found then
    raise exception 'word is not in session' using errcode = '42501';
  end if;
  update public.learning_word_progress
  set initial_recognition_seen = true, updated_at = now()
  where user_id = p_user_id and word_id = p_word_id;
  insert into public.learning_attempts (
    user_id, course_id, session_id, word_id, mode, skill, is_correct, local_date
  ) values (
    p_user_id, v_session.course_id, p_session_id, p_word_id,
    'initial', 'recognition', true, v_date
  );

  v_queue_size := jsonb_array_length(coalesce(v_session.state -> 'queue', '[]'::jsonb));
  v_next_queue := coalesce(v_session.state -> 'nextQueue', '[]'::jsonb);
  if v_cursor + 1 >= v_queue_size then
    if jsonb_array_length(v_next_queue) > 0 then
      update public.learning_sessions
      set state = state || jsonb_build_object(
        'queue', v_next_queue,
        'cursor', 0,
        'nextQueue', '[]'::jsonb,
        'round', coalesce((state ->> 'round')::integer, 1) + 1
      ),
      last_activity_at = now()
      where id = p_session_id;
    else
      update public.learning_sessions
      set state = jsonb_set(state, '{cursor}', to_jsonb(v_cursor + 1)),
          last_activity_at = now()
      where id = p_session_id;
      perform public._learning_advance_session(p_session_id);
      perform public._learning_reset_session_queue(p_session_id);
    end if;
  else
    update public.learning_sessions
    set state = jsonb_set(state, '{cursor}', to_jsonb(v_cursor + 1)),
        last_activity_at = now()
    where id = p_session_id;
  end if;
  select revision into strict v_revision
  from public.learning_sessions
  where id = p_session_id;
  return jsonb_build_object(
    'revision', v_revision,
    'session_patch', public._learning_session_patch(p_session_id, p_word_id)
  );
end;
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
  end if;

  insert into public.learning_attempts (
    user_id, course_id, session_id, word_id, mode, skill, is_correct,
    provider_details, local_date
  ) values (
    p_user_id, v_session.course_id, p_session_id, p_word_id,
    v_session.mode, 'speech_assessment', v_correct,
    coalesce(p_assessment, '{}'::jsonb), v_date
  );

  if not v_correct then
    update public.learning_session_items
    set wrong_count = wrong_count + 1
    where session_id = p_session_id and word_id = p_word_id;
    update public.learning_word_progress
    set wrong_count = wrong_count + 1, updated_at = now()
    where user_id = p_user_id and word_id = p_word_id;
  end if;
  update public.learning_sessions
  set last_activity_at = now()
  where id = p_session_id
  returning revision into v_revision;
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

create or replace function public._learning_audio_cache_key(
  p_normalized_term text,
  p_locale text,
  p_voice text,
  p_output_format text,
  p_synthesis_version text
)
returns text
language sql
immutable
set search_path = pg_catalog, extensions, public
as $$
  select encode(digest(
    coalesce(p_normalized_term, '') || chr(31)
      || coalesce(p_locale, '') || chr(31)
      || coalesce(p_voice, '') || chr(31)
      || coalesce(p_output_format, '') || chr(31)
      || coalesce(p_synthesis_version, ''),
    'sha256'
  ), 'hex');
$$;

create or replace function public.learning_get_unit_audio_manifest(
  p_user_id uuid,
  p_unit_id uuid,
  p_locale text,
  p_voice text,
  p_output_format text,
  p_synthesis_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if not exists (
    select 1 from public.learning_course_units u
    where u.id = p_unit_id and u.user_id = p_user_id
  ) then
    raise exception 'learning unit not found' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'unit_id', p_unit_id,
    'total', count(*),
    'ready', count(*) filter (where a.status = 'ready'),
    'pending', count(*) filter (where a.status in ('pending', 'processing') or a.status is null),
    'failed', count(*) filter (where a.status = 'failed'),
    'assets', coalesce(jsonb_agg(jsonb_build_object(
      'word_id', w.id,
      'cache_key', k.cache_key,
      'status', coalesce(a.status, 'missing'),
      'storage_path', a.storage_path,
      'last_error_code', a.last_error_code
    ) order by w.position), '[]'::jsonb)
  ) into v_result
  from public.learning_course_words w
  cross join lateral (
    select public._learning_audio_cache_key(
      w.normalized_term, p_locale, p_voice, p_output_format, p_synthesis_version
    ) as cache_key
  ) k
  left join public.learning_audio_assets a on a.cache_key = k.cache_key
  where w.unit_id = p_unit_id and w.user_id = p_user_id;
  return v_result;
end;
$$;

create or replace function public.learning_prepare_unit_audio(
  p_user_id uuid,
  p_unit_id uuid,
  p_locale text,
  p_voice text,
  p_output_format text,
  p_synthesis_version text,
  p_priority integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_priority is null or p_priority < 0 or p_priority > 100
     or p_synthesis_version !~ '^[A-Za-z0-9._-]{1,32}$'
     or char_length(coalesce(p_locale, '')) not between 2 and 20
     or char_length(coalesce(p_voice, '')) not between 1 and 100
     or char_length(coalesce(p_output_format, '')) not between 1 and 100 then
    raise exception 'invalid audio preparation configuration' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.learning_course_units u
    where u.id = p_unit_id and u.user_id = p_user_id
  ) then
    raise exception 'learning unit not found' using errcode = '42501';
  end if;

  insert into public.learning_audio_assets (
    cache_key, normalized_term, synthesis_text, locale, voice,
    output_format, synthesis_version, storage_path, priority
  )
  select
    public._learning_audio_cache_key(
      w.normalized_term, p_locale, p_voice, p_output_format, p_synthesis_version
    ),
    w.normalized_term,
    w.term,
    p_locale,
    p_voice,
    p_output_format,
    p_synthesis_version,
    public._learning_audio_cache_key(
      w.normalized_term, p_locale, p_voice, p_output_format, p_synthesis_version
    ) || '.mp3',
    p_priority::smallint
  from public.learning_course_words w
  where w.unit_id = p_unit_id and w.user_id = p_user_id
  on conflict (cache_key) do update
    set priority = greatest(public.learning_audio_assets.priority, excluded.priority),
        updated_at = now();

  return public.learning_get_unit_audio_manifest(
    p_user_id, p_unit_id, p_locale, p_voice, p_output_format, p_synthesis_version
  );
end;
$$;

create or replace function public.learning_prepare_word_audio(
  p_user_id uuid,
  p_word_id uuid,
  p_locale text,
  p_voice text,
  p_output_format text,
  p_synthesis_version text,
  p_priority integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_word public.learning_course_words%rowtype;
  v_key text;
  v_asset public.learning_audio_assets%rowtype;
begin
  if p_priority is null or p_priority < 0 or p_priority > 100
     or p_synthesis_version !~ '^[A-Za-z0-9._-]{1,32}$'
     or char_length(coalesce(p_locale, '')) not between 2 and 20
     or char_length(coalesce(p_voice, '')) not between 1 and 100
     or char_length(coalesce(p_output_format, '')) not between 1 and 100 then
    raise exception 'invalid audio preparation configuration' using errcode = '22023';
  end if;

  select * into strict v_word
  from public.learning_course_words w
  where w.id = p_word_id and w.user_id = p_user_id;

  v_key := public._learning_audio_cache_key(
    v_word.normalized_term, p_locale, p_voice, p_output_format, p_synthesis_version
  );
  insert into public.learning_audio_assets (
    cache_key, normalized_term, synthesis_text, locale, voice,
    output_format, synthesis_version, storage_path, priority
  ) values (
    v_key, v_word.normalized_term, v_word.term, p_locale, p_voice,
    p_output_format, p_synthesis_version, v_key || '.mp3', p_priority::smallint
  )
  on conflict (cache_key) do update
    set priority = greatest(public.learning_audio_assets.priority, excluded.priority),
        updated_at = now()
  returning * into v_asset;

  return jsonb_build_object(
    'word_id', v_word.id,
    'cache_key', v_asset.cache_key,
    'status', v_asset.status,
    'storage_path', v_asset.storage_path,
    'last_error_code', v_asset.last_error_code
  );
exception
  when no_data_found then
    raise exception 'learning word not found' using errcode = '42501';
end;
$$;

create or replace function public.learning_claim_audio_asset(
  p_lease_token uuid,
  p_lease_seconds integer default 60,
  p_min_interval_milliseconds integer default 3100
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_asset public.learning_audio_assets%rowtype;
begin
  if p_lease_token is null or p_lease_seconds not between 10 and 600
     or p_min_interval_milliseconds not between 3100 and 60000 then
    raise exception 'invalid audio asset lease' using errcode = '22023';
  end if;
  -- Serialize claims across API replicas. A durable processing lease provides
  -- global single concurrency; the latest quota reservation enforces the
  -- configured Azure start-to-start interval after the prior job completes.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-audio-global-worker', 420772)
  );
  if exists (
    select 1 from public.learning_audio_assets a
    where a.status = 'processing' and a.lease_until >= now()
  ) or exists (
    select 1 from public.learning_speech_usage u
    where u.kind = 'tts'
      and u.created_at > now()
        - make_interval(secs => p_min_interval_milliseconds::double precision / 1000)
  ) then
    return null;
  end if;
  select * into v_asset
  from public.learning_audio_assets a
  where (
      a.status = 'pending'
      or (a.status = 'processing' and a.lease_until < now())
    )
    and a.next_attempt_at <= now()
  order by a.priority desc, a.next_attempt_at, a.created_at
  for update skip locked
  limit 1;
  if not found then return null; end if;

  update public.learning_audio_assets
  set status = 'processing',
      lease_token = p_lease_token,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      attempt_count = attempt_count + 1,
      updated_at = now()
  where cache_key = v_asset.cache_key
  returning * into v_asset;

  return jsonb_build_object(
    'cache_key', v_asset.cache_key,
    'text', v_asset.synthesis_text,
    'locale', v_asset.locale,
    'voice', v_asset.voice,
    'output_format', v_asset.output_format,
    'synthesis_version', v_asset.synthesis_version,
    'storage_path', v_asset.storage_path,
    'attempt_count', v_asset.attempt_count,
    'created_at', v_asset.created_at
  );
end;
$$;

create or replace function public.learning_finish_audio_asset(
  p_lease_token uuid,
  p_cache_key text,
  p_success boolean,
  p_error_code text default null,
  p_error_message text default null,
  p_retry_after_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempt_count integer;
begin
  if p_retry_after_seconds not between 1 and 86400 then
    raise exception 'invalid audio retry delay' using errcode = '22023';
  end if;
  select attempt_count into v_attempt_count
  from public.learning_audio_assets
  where cache_key = p_cache_key and lease_token = p_lease_token
  for update;
  if not found then
    raise exception 'audio asset lease not found' using errcode = '42501';
  end if;

  if p_success then
    update public.learning_audio_assets
    set status = 'ready',
        lease_token = null,
        lease_until = null,
        last_error_code = null,
        last_error_message = null,
        ready_at = now(),
        updated_at = now()
    where cache_key = p_cache_key;
  else
    update public.learning_audio_assets
    set status = case
          when coalesce(p_error_code, '') in (
            'SPEECH_TTS_RATE_LIMIT',
            'SPEECH_TTS_MONTHLY_LIMIT',
            'SPEECH_QUOTA_EXCEEDED'
          ) then 'pending'
          when v_attempt_count >= 5 then 'failed'
          else 'pending'
        end,
        attempt_count = case
          when coalesce(p_error_code, '') in (
            'SPEECH_TTS_RATE_LIMIT',
            'SPEECH_TTS_MONTHLY_LIMIT',
            'SPEECH_QUOTA_EXCEEDED'
          ) then greatest(0, attempt_count - 1)
          else attempt_count
        end,
        lease_token = null,
        lease_until = null,
        next_attempt_at = now() + make_interval(secs => p_retry_after_seconds),
        last_error_code = left(coalesce(p_error_code, 'UNKNOWN'), 100),
        last_error_message = left(coalesce(p_error_message, ''), 500),
        updated_at = now()
    where cache_key = p_cache_key;
  end if;
end;
$$;

create or replace function public.learning_requeue_audio_asset(
  p_cache_key text
)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.learning_audio_assets
  set status = 'pending',
      synthesis_text = coalesce(synthesis_text, normalized_term),
      next_attempt_at = now(),
      lease_token = null,
      lease_until = null,
      ready_at = null,
      updated_at = now()
  where cache_key = p_cache_key;
$$;

create or replace function public.learning_reserve_tts_quota(
  p_character_count integer,
  p_cost_microusd integer,
  p_minute_limit integer,
  p_month_character_limit bigint,
  p_month_budget_microusd bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_month_characters bigint;
  v_month_spend bigint;
begin
  if p_character_count is null or p_character_count <= 0
     or p_cost_microusd is null or p_cost_microusd <= 0
     or p_minute_limit is null or p_minute_limit <= 0
     or p_month_character_limit is null or p_month_character_limit <= 0
     or p_month_budget_microusd is null or p_month_budget_microusd <= 0 then
    raise exception 'invalid TTS quota request' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-tts-budget:' || to_char(now(), 'YYYY-MM'), 420772)
  );
  if (
    select count(*) from public.learning_speech_usage u
    where u.kind = 'tts' and u.created_at >= now() - interval '1 minute'
  ) >= p_minute_limit then
    raise exception 'speech tts minute quota exceeded' using errcode = 'P0001';
  end if;

  select coalesce(sum(u.character_count), 0), coalesce(sum(u.cost_microusd), 0)
  into v_month_characters, v_month_spend
  from public.learning_speech_usage u
  where u.created_at >= date_trunc('month', now());
  if v_month_characters + p_character_count > p_month_character_limit then
    raise exception 'speech tts monthly character quota exceeded' using errcode = 'P0001';
  end if;
  if v_month_spend + p_cost_microusd > p_month_budget_microusd then
    raise exception 'speech monthly budget exceeded' using errcode = 'P0001';
  end if;

  insert into public.learning_speech_usage (
    user_id, kind, cost_microusd, character_count, local_date
  ) values (
    null, 'tts', p_cost_microusd, p_character_count, current_date
  );
end;
$$;

revoke execute on function public._learning_session_patch(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public._learning_increment_session_revision()
  from public, anon, authenticated;
revoke execute on function public._learning_audio_cache_key(text, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.learning_get_session_snapshot(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.learning_get_assessment_target(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.learning_record_attempt(uuid, uuid, uuid, text, jsonb, uuid, bigint)
  from public, anon, authenticated;
revoke execute on function public.learning_get_unit_audio_manifest(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.learning_prepare_unit_audio(uuid, uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.learning_prepare_word_audio(uuid, uuid, text, text, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.learning_claim_audio_asset(uuid, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.learning_finish_audio_asset(uuid, text, boolean, text, text, integer)
  from public, anon, authenticated;
revoke execute on function public.learning_requeue_audio_asset(text)
  from public, anon, authenticated;
revoke execute on function public.learning_reserve_tts_quota(integer, integer, integer, bigint, bigint)
  from public, anon, authenticated;

grant execute on function public.learning_get_session_snapshot(uuid, uuid) to service_role;
grant execute on function public.learning_get_assessment_target(uuid, uuid, uuid) to service_role;
grant execute on function public.learning_record_attempt(uuid, uuid, uuid, text, jsonb, uuid, bigint)
  to service_role;
grant execute on function public.learning_get_unit_audio_manifest(uuid, uuid, text, text, text, text)
  to service_role;
grant execute on function public.learning_prepare_unit_audio(uuid, uuid, text, text, text, text, integer)
  to service_role;
grant execute on function public.learning_prepare_word_audio(uuid, uuid, text, text, text, text, integer)
  to service_role;
grant execute on function public.learning_claim_audio_asset(uuid, integer, integer) to service_role;
grant execute on function public.learning_finish_audio_asset(uuid, text, boolean, text, text, integer)
  to service_role;
grant execute on function public.learning_requeue_audio_asset(text) to service_role;
grant execute on function public.learning_reserve_tts_quota(integer, integer, integer, bigint, bigint)
  to service_role;
