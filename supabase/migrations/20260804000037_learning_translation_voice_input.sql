-- Nalanda · owner-scoped translation voice input quota
--
-- Raw recordings and transcripts never enter PostgreSQL. The only durable
-- fact is a conservative cost/rate reservation made after the active session,
-- revision and spelling word have been checked in one server-only RPC.

alter table public.learning_speech_usage
  drop constraint if exists learning_speech_usage_kind_check;

alter table public.learning_speech_usage
  add constraint learning_speech_usage_kind_check
  check (kind in ('tts', 'assessment', 'translation_stt'));

create or replace function public.learning_reserve_translation_stt(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_expected_revision bigint,
  p_cost_microusd integer,
  p_minute_limit integer,
  p_day_limit integer,
  p_month_budget_microusd bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.learning_sessions%rowtype;
  v_current_word uuid;
  v_local_date date;
  v_now timestamptz := clock_timestamp();
  v_month_spend bigint;
  v_retry_after integer;
begin
  if p_user_id is null
     or p_session_id is null
     or p_word_id is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or p_cost_microusd is null
     or p_cost_microusd <= 0
     or p_minute_limit is null
     or p_minute_limit not between 1 and 1000
     or p_day_limit is null
     or p_day_limit not between 1 and 100000
     or p_month_budget_microusd is null
     or p_month_budget_microusd <= 0 then
    raise exception 'invalid translation stt reservation' using errcode = '22023';
  end if;

  select * into v_session
  from public.learning_sessions
  where id = p_session_id
    and user_id = p_user_id
  for update;
  if not found then
    raise exception 'translation stt session not found' using errcode = '42501';
  end if;
  if not v_session.active or v_session.stage <> 'spelling' then
    raise exception 'session is not in spelling stage' using errcode = '22023';
  end if;
  if coalesce((v_session.state ->> 'awaitingRetryConfirmation')::boolean, false) then
    raise exception 'spelling retry round confirmation is required'
      using errcode = '22023';
  end if;
  if coalesce((v_session.spelling_options ->> 'translationFirst')::boolean, false)
     is not true then
    raise exception 'translation-first spelling is not enabled' using errcode = '22023';
  end if;
  if v_session.revision <> p_expected_revision then
    return jsonb_build_object(
      'conflict', true,
      'current_revision', v_session.revision
    );
  end if;
  v_current_word := nullif(
    v_session.state -> 'queue' ->> coalesce((v_session.state ->> 'cursor')::integer, 0),
    ''
  )::uuid;
  if v_current_word is distinct from p_word_id then
    raise exception 'word is not the active spelling item' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.learning_session_items i
    join public.learning_course_words w on w.id = i.word_id
    where i.session_id = p_session_id
      and i.word_id = p_word_id
      and w.user_id = p_user_id
  ) then
    raise exception 'word is not owned by the active session user' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'learning-translation-stt-budget:' || to_char(v_now, 'YYYY-MM'),
      408040
    )
  );
  v_local_date := public._learning_local_date(p_user_id);

  if (
    select count(*)
    from public.learning_speech_usage u
    where u.user_id = p_user_id
      and u.kind = 'translation_stt'
      and u.created_at >= v_now - interval '1 minute'
  ) >= p_minute_limit then
    select greatest(
      1,
      ceil(extract(epoch from (min(created_at) + interval '1 minute' - v_now)))::integer
    ) into v_retry_after
    from public.learning_speech_usage
    where user_id = p_user_id
      and kind = 'translation_stt'
      and created_at >= v_now - interval '1 minute';
    raise exception 'translation stt minute quota exceeded'
      using errcode = 'P0001',
        hint = 'retry_after_seconds=' || coalesce(v_retry_after, 60)::text;
  end if;

  if (
    select count(*)
    from public.learning_speech_usage u
    where u.user_id = p_user_id
      and u.kind = 'translation_stt'
      and u.local_date = v_local_date
  ) >= p_day_limit then
    raise exception 'translation stt daily quota exceeded'
      using errcode = 'P0001', hint = 'retry_after_seconds=86400';
  end if;

  select coalesce(sum(u.cost_microusd), 0)
  into v_month_spend
  from public.learning_speech_usage u
  where u.kind = 'translation_stt'
    and u.created_at >= date_trunc('month', v_now);
  if v_month_spend + p_cost_microusd > p_month_budget_microusd then
    raise exception 'translation stt monthly budget exceeded' using errcode = 'P0001';
  end if;

  insert into public.learning_speech_usage (
    user_id,
    kind,
    cost_microusd,
    character_count,
    local_date
  ) values (
    p_user_id,
    'translation_stt',
    p_cost_microusd,
    0,
    v_local_date
  );

  return jsonb_build_object(
    'reserved', true,
    'revision', v_session.revision
  );
end;
$$;

revoke execute on function public.learning_reserve_translation_stt(
  uuid, uuid, uuid, bigint, integer, integer, integer, bigint
) from public, anon, authenticated;

grant execute on function public.learning_reserve_translation_stt(
  uuid, uuid, uuid, bigint, integer, integer, integer, bigint
) to service_role;
