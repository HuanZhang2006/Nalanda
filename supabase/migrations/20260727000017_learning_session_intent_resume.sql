-- Nalanda · resume learning sessions by requested intent
--
-- A paused first-learning session and a review of another unit are independent
-- pieces of progress. Keep both resumable while still deduplicating concurrent
-- requests for the exact same learning/review intent.

alter table public.learning_sessions
  add column resume_key text;

update public.learning_sessions as s
set resume_key = case
  when s.mode = 'initial' then
    'initial:' || s.course_id::text || ':' || coalesce(s.unit_id::text, 'deleted')
  when nullif(s.state ->> 'scheduleId', '') is not null then
    'schedule:' || (s.state ->> 'scheduleId')
  else
    'review:' || s.course_id::text || ':' || coalesce(s.unit_id::text, 'deleted')
      || ':' || s.scope || ':'
      || array_to_string(
        array(select skill from unnest(s.selected_skills) as selected(skill) order by skill),
        ','
      )
end;

alter table public.learning_sessions
  alter column resume_key set not null,
  add constraint learning_sessions_resume_key_length
    check (length(resume_key) between 1 and 500);

drop index public.learning_sessions_one_active_course_idx;

create unique index learning_sessions_one_active_intent_idx
  on public.learning_sessions (user_id, resume_key)
  where active;

create index learning_sessions_active_course_activity_idx
  on public.learning_sessions (user_id, course_id, last_activity_at desc)
  where active;

create or replace function public.learning_start_session(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_mode text,
  p_skills text[],
  p_scope text,
  p_schedule_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_session_id uuid;
  v_unit_id uuid := p_unit_id;
  v_stage text;
  v_skills text[];
  v_scope text := coalesce(p_scope, 'all');
  v_count integer;
  v_resume_key text;
begin
  if p_mode is null or p_mode not in ('initial', 'review') then
    raise exception 'invalid learning mode' using errcode = '22023';
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

  if p_schedule_id is not null then
    if p_mode <> 'review' then
      raise exception 'a review schedule requires review mode' using errcode = '22023';
    end if;
    select r.skills, r.scope
    into v_skills, v_scope
    from public.learning_review_schedules r
    where r.id = p_schedule_id
      and r.user_id = p_user_id
      and r.course_id = p_course_id
      and r.unit_id = v_unit_id
      and r.status = 'pending'
    for update;
    if not found then
      raise exception 'review schedule not found' using errcode = '42501';
    end if;
  end if;

  if p_mode = 'initial' then
    v_skills := array['pronunciation','translation','spelling']::text[];
    v_scope := 'all';
    v_stage := 'recognition';
  else
    if p_schedule_id is null then
      v_skills := p_skills;
    end if;
    if v_skills is null
       or cardinality(v_skills) not between 1 and 3
       or cardinality(v_skills) <> (
         select count(distinct skill)
         from unnest(v_skills) as selected(skill)
       )
       or not (
         v_skills <@ array['pronunciation','translation','spelling']::text[]
       ) then
      raise exception 'invalid review skills' using errcode = '22023';
    end if;
    select array_agg(skill order by skill)
    into v_skills
    from unnest(v_skills) as selected(skill);
    v_stage := case
      when 'pronunciation' = any(v_skills) then 'pronunciation'
      when 'translation' = any(v_skills) then 'translation'
      else 'spelling'
    end;
  end if;

  if v_scope not in ('all', 'unlearned') then
    raise exception 'invalid review scope' using errcode = '22023';
  end if;

  v_resume_key := case
    when p_schedule_id is not null then
      'schedule:' || p_schedule_id::text
    when p_mode = 'initial' then
      'initial:' || p_course_id::text || ':' || v_unit_id::text
    else
      'review:' || p_course_id::text || ':' || v_unit_id::text
        || ':' || v_scope || ':' || array_to_string(v_skills, ',')
  end;

  -- Serialize only matching intents. Different units/modes remain independently
  -- resumable; duplicate requests for one intent still return one session.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'learning-active-session:' || p_user_id::text || ':' || v_resume_key,
      420776
    )
  );

  select id
  into v_session_id
  from public.learning_sessions
  where user_id = p_user_id
    and resume_key = v_resume_key
    and active
  order by started_at desc
  limit 1;
  if v_session_id is not null then
    return v_session_id;
  end if;

  insert into public.learning_sessions (
    user_id,
    course_id,
    unit_id,
    mode,
    scope,
    selected_skills,
    stage,
    state,
    resume_key
  ) values (
    p_user_id,
    p_course_id,
    v_unit_id,
    p_mode,
    v_scope,
    v_skills,
    v_stage,
    case
      when p_schedule_id is null then '{}'::jsonb
      else jsonb_build_object('scheduleId', p_schedule_id)
    end,
    v_resume_key
  )
  returning id into v_session_id;

  insert into public.learning_session_items (session_id, word_id, position)
  select
    v_session_id,
    w.id,
    row_number() over (order by w.position, w.id) - 1
  from public.learning_course_words w
  left join public.learning_word_progress p
    on p.word_id = w.id and p.user_id = p_user_id
  where w.unit_id = v_unit_id
    and w.user_id = p_user_id
    and (v_scope = 'all' or p.learned_at is null)
  order by w.position, w.id;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    delete from public.learning_sessions where id = v_session_id;
    raise exception 'no words match this learning scope' using errcode = '22023';
  end if;

  update public.learning_sessions s
  set state = s.state || jsonb_build_object(
    'queue',
    (
      select coalesce(
        jsonb_agg(to_jsonb(i.word_id) order by i.position),
        '[]'::jsonb
      )
      from public.learning_session_items i
      where i.session_id = v_session_id
    ),
    'cursor', 0,
    'nextQueue', '[]'::jsonb,
    'round', 1
  )
  where s.id = v_session_id;

  return v_session_id;
end;
$$;

revoke execute on function public.learning_start_session(
  uuid, uuid, uuid, text, text[], text, uuid
) from public, anon, authenticated;

grant execute on function public.learning_start_session(
  uuid, uuid, uuid, text, text[], text, uuid
) to service_role;
