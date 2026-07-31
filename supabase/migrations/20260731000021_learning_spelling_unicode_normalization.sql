-- Purpose: make spelling comparison deterministic across Web and PostgreSQL
-- without changing course identity, point fingerprints, or stored source terms.
-- Update this migration only by adding a later forward migration.

create or replace function public._learning_normalize_spelling_text(p_value text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public
as $$
declare
  v_value text;
begin
  -- Course terms are English, so ASCII-only case folding avoids database
  -- collation differences. NFKC first converts compatibility input such as
  -- full-width Latin characters to the same ASCII representation used by Web.
  v_value := normalize(coalesce(p_value, ''), NFKC);
  v_value := regexp_replace(
    v_value,
    U&'[\02BB\02BC\2018\2019\FF07]',
    '''',
    'g'
  );
  v_value := regexp_replace(
    v_value,
    U&'[\2010-\2015\2212\FE63\FF0D]',
    '-',
    'g'
  );
  v_value := translate(
    v_value,
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    'abcdefghijklmnopqrstuvwxyz'
  );
  return btrim(regexp_replace(v_value, '[[:space:]]+', ' ', 'g'));
end;
$$;

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
    v_correct := public._learning_normalize_spelling_text(p_answer ->> 'text')
      = public._learning_normalize_spelling_text(v_word.term);
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

revoke execute on function public._learning_normalize_spelling_text(text)
  from public, anon, authenticated;
revoke execute on function public.learning_record_attempt(
  uuid, uuid, uuid, text, jsonb, uuid, bigint
) from public, anon, authenticated;

grant execute on function public.learning_record_attempt(
  uuid, uuid, uuid, text, jsonb, uuid, bigint
) to service_role;
