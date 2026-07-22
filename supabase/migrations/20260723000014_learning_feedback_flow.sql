-- Nalanda · learning feedback flow
--
-- A low optional pronunciation assessment now enters the persisted recognition
-- retry pool. Recognition consumes that pool before moving to the formal test
-- stages. The overall PronScore threshold is supplied only by the trusted API
-- (default 70); clients still cannot execute either workflow RPC directly.

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
begin
  select * into strict v_session from public.learning_sessions
  where id = p_session_id and user_id = p_user_id and active for update;
  if v_session.mode <> 'initial' or v_session.stage <> 'recognition' then
    raise exception 'session is not in recognition stage' using errcode = '22023';
  end if;
  v_cursor := coalesce((v_session.state ->> 'cursor')::integer, 0);
  v_expected := nullif(v_session.state -> 'queue' ->> v_cursor, '')::uuid;
  if v_expected is distinct from p_word_id then
    raise exception 'word is not the active recognition item' using errcode = '22023';
  end if;
  update public.learning_session_items set recognition_seen = true
  where session_id = p_session_id and word_id = p_word_id;
  if not found then raise exception 'word is not in session' using errcode = '42501'; end if;
  update public.learning_word_progress
  set initial_recognition_seen = true, updated_at = now()
  where user_id = p_user_id and word_id = p_word_id;
  insert into public.learning_attempts (
    user_id, course_id, session_id, word_id, mode, skill, is_correct, local_date
  ) values (p_user_id, v_session.course_id, p_session_id, p_word_id, 'initial', 'recognition', true, v_date);

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
      ), last_activity_at = now()
      where id = p_session_id;
    else
      update public.learning_sessions
      set state = jsonb_set(state, '{cursor}', to_jsonb(v_cursor + 1)), last_activity_at = now()
      where id = p_session_id;
      perform public._learning_advance_session(p_session_id);
      perform public._learning_reset_session_queue(p_session_id);
    end if;
  else
    update public.learning_sessions
    set state = jsonb_set(state, '{cursor}', to_jsonb(v_cursor + 1)), last_activity_at = now()
    where id = p_session_id;
  end if;
  return (select jsonb_build_object('stage', stage, 'completed', not active)
          from public.learning_sessions where id = p_session_id);
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
begin
  select * into strict v_session
  from public.learning_sessions
  where id = p_session_id and user_id = p_user_id and active
  for update;

  if not exists (
    select 1
    from public.learning_session_items i
    join public.learning_course_words w on w.id = i.word_id
    where i.session_id = p_session_id and i.word_id = p_word_id and w.user_id = p_user_id
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

  -- Retry-pool mutation is valid only for the recognition card currently on
  -- screen. This prevents a stale or handcrafted assessment from changing a
  -- different word's queue position.
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
    set state = jsonb_set(state, '{nextQueue}', v_next_queue), last_activity_at = now()
    where id = p_session_id;
  end if;

  insert into public.learning_attempts (
    user_id, course_id, session_id, word_id, mode, skill, is_correct,
    provider_details, local_date
  ) values (
    p_user_id, v_session.course_id, p_session_id, p_word_id, v_session.mode,
    'speech_assessment', v_correct, coalesce(p_assessment, '{}'::jsonb), v_date
  );

  if not v_correct then
    update public.learning_session_items
    set wrong_count = wrong_count + 1
    where session_id = p_session_id and word_id = p_word_id;
    update public.learning_word_progress
    set wrong_count = wrong_count + 1, updated_at = now()
    where user_id = p_user_id and word_id = p_word_id;
  end if;
  update public.learning_sessions set last_activity_at = now() where id = p_session_id;
  return jsonb_build_object(
    'recorded', true,
    'correct', v_correct,
    'retryQueued', v_retry_queued,
    'passThreshold', v_threshold
  );
end;
$$;

revoke execute on function public.learning_mark_recognition(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.learning_record_speech_assessment(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.learning_mark_recognition(uuid, uuid, uuid) to service_role;
grant execute on function public.learning_record_speech_assessment(uuid, uuid, uuid, jsonb) to service_role;

do $$
begin
  if has_function_privilege('anon', 'public.learning_mark_recognition(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.learning_mark_recognition(uuid,uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.learning_mark_recognition(uuid,uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.learning_record_speech_assessment(uuid,uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'learning feedback workflow privileges are unsafe' using errcode = '42501';
  end if;
end;
$$;
