-- Nalanda · 0012 server-only learning-course workflows and growth projection
-- Depends on 0011 and the points state machine introduced in 0008.

create or replace function public._learning_local_date(p_user_id uuid)
returns date
language sql
stable
set search_path = pg_catalog, public
as $$
  select (now() at time zone coalesce(
    (select p.timezone from public.profiles p where p.id = p_user_id),
    'UTC'
  ))::date;
$$;

create or replace function public._learning_course_fingerprint(p_course_id uuid)
returns text
language sql
stable
set search_path = pg_catalog, extensions, public
as $$
  select encode(
    digest(coalesce(string_agg(x.normalized_term, chr(31) order by x.normalized_term), ''), 'sha256'),
    'hex'
  )
  from (
    select distinct w.normalized_term
    from public.learning_course_words w
    where w.course_id = p_course_id
  ) x;
$$;

create or replace function public._learning_course_snapshot(p_course_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', c.id,
    'title', c.title,
    'category', c.category,
    'hasUnits', c.has_units,
    'locale', c.locale,
    'units', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'position', u.position,
        'isSystem', u.is_system,
        'words', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', w.id,
            'term', w.term,
            'normalizedTerm', w.normalized_term,
            'translations', to_jsonb(w.translations),
            'ipa', w.ipa,
            'position', w.position
          ) order by w.position, w.id)
          from public.learning_course_words w
          where w.unit_id = u.id
        ), '[]'::jsonb)
      ) order by u.position, u.id)
      from public.learning_course_units u
      where u.course_id = c.id
    ), '[]'::jsonb)
  )
  from public.learning_courses c
  where c.id = p_course_id;
$$;

create or replace function public._refresh_learning_growth(
  p_user_id uuid,
  p_course_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_words integer;
  v_learned integer;
  v_unique_terms integer;
  v_mastered_unique integer;
  v_completed_courses integer;
  v_review_days integer;
  v_fingerprint text;
  v_business_key text;
begin
  select count(*),
         count(*) filter (where p.learned_at is not null),
         count(distinct w.normalized_term)
  into v_words, v_learned, v_unique_terms
  from public.learning_course_words w
  left join public.learning_word_progress p
    on p.word_id = w.id and p.user_id = p_user_id
  where w.course_id = p_course_id and w.user_id = p_user_id;

  if v_words > 0 and v_words = v_learned and v_unique_terms >= 20
     and exists (
       select 1 from public.learning_courses c
       where c.id = p_course_id and c.user_id = p_user_id and c.points_claimed_at is null
     ) then
    v_fingerprint := public._learning_course_fingerprint(p_course_id);
    v_business_key := 'learning-course-completed:' || p_user_id::text || ':' || v_fingerprint;
    perform public._set_point_event(
      p_user_id,
      'learning_course_completed',
      v_business_key,
      20,
      true,
      p_course_id,
      jsonb_build_object('courseId', p_course_id, 'fingerprint', v_fingerprint, 'rule', 'vocab-course-v1')
    );
    update public.learning_courses
    set points_claimed_at = now(), updated_at = now()
    where id = p_course_id and user_id = p_user_id and points_claimed_at is null;
  end if;

  select count(distinct w.normalized_term)
  into v_mastered_unique
  from public.learning_course_words w
  join public.learning_word_progress p
    on p.word_id = w.id and p.user_id = p_user_id and p.learned_at is not null
  where w.user_id = p_user_id;

  select count(*) into v_completed_courses
  from (
    select c.id
    from public.learning_courses c
    join public.learning_course_words w on w.course_id = c.id
    left join public.learning_word_progress p
      on p.word_id = w.id and p.user_id = p_user_id
    where c.user_id = p_user_id
    group by c.id
    having count(distinct w.normalized_term) >= 20
       and count(*) = count(*) filter (where p.learned_at is not null)
  ) completed;

  select count(distinct a.local_date) into v_review_days
  from public.learning_attempts a
  join public.learning_sessions s on s.id = a.session_id
  where a.user_id = p_user_id
    and a.mode = 'review'
    and s.completed_at is not null;

  insert into public.user_badge_awards (user_id, badge_code, metadata)
  select p_user_id, b.code,
         jsonb_build_object(
           'value', case b.family
             when 'vocab_words' then v_mastered_unique
             when 'vocab_courses' then v_completed_courses
             else v_review_days
           end,
           'rule', 'learning-badges-v1'
         )
  from public.badge_definitions b
  where (b.family = 'vocab_words' and v_mastered_unique >= b.threshold)
     or (b.family = 'vocab_courses' and v_completed_courses >= b.threshold)
     or (b.family = 'vocab_review_days' and v_review_days >= b.threshold)
  on conflict (user_id, badge_code) do nothing;
end;
$$;

create or replace function public.learning_upsert_course(
  p_user_id uuid,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_course_id uuid := coalesce(nullif(p_payload ->> 'id', '')::uuid, extensions.gen_random_uuid());
  v_title text := btrim(coalesce(p_payload ->> 'title', ''));
  v_has_units boolean := coalesce((p_payload ->> 'hasUnits')::boolean, false);
  v_units jsonb := coalesce(p_payload -> 'units', '[]'::jsonb);
  v_unit jsonb;
  v_word jsonb;
  v_unit_id uuid;
  v_word_id uuid;
  v_unit_ids uuid[] := '{}'::uuid[];
  v_word_ids uuid[] := '{}'::uuid[];
  v_translations text[];
  v_term text;
  v_ipa text;
  v_unit_pos integer := 0;
  v_word_pos integer;
  v_old public.learning_course_words%rowtype;
  v_exists boolean;
  v_unit_exists boolean;
  v_content_changed boolean := false;
  v_total integer;
  v_distinct integer;
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'learning course user not found' using errcode = '23503';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'course title must contain 1-80 characters' using errcode = '22023';
  end if;
  if coalesce(p_payload ->> 'category', '') <> 'english_vocabulary'
     or coalesce(p_payload ->> 'locale', 'en-US') <> 'en-US' then
    raise exception 'only en-US english vocabulary courses are enabled' using errcode = '22023';
  end if;
  if jsonb_typeof(v_units) <> 'array' or jsonb_array_length(v_units) not between 1 and 100 then
    raise exception 'course must contain 1-100 units' using errcode = '22023';
  end if;
  if not v_has_units and (
    jsonb_array_length(v_units) <> 1
    or not coalesce((v_units -> 0 ->> 'isSystem')::boolean, false)
  ) then
    raise exception 'a unitless course requires exactly one system unit' using errcode = '22023';
  end if;

  if exists (select 1 from public.learning_courses c where c.id = v_course_id and c.user_id <> p_user_id) then
    raise exception 'learning course not owned by user' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-active-session:' || p_user_id::text || ':' || v_course_id::text, 420776)
  );
  -- Serialize a full save with card/answer writes. Harmless rename/reorder/move
  -- saves release this lock without aborting the queue; content mutations mark
  -- it inactive at the end of the same transaction.
  perform 1 from public.learning_sessions
  where course_id = v_course_id and user_id = p_user_id and active
  for update;

  insert into public.learning_courses (id, user_id, title, category, has_units, locale)
  values (v_course_id, p_user_id, v_title, 'english_vocabulary', v_has_units, 'en-US')
  on conflict (id) do update
    set title = excluded.title,
        has_units = excluded.has_units,
        updated_at = now()
    where learning_courses.user_id = p_user_id;

  for v_unit in select value from jsonb_array_elements(v_units) loop
    v_unit_id := coalesce(nullif(v_unit ->> 'id', '')::uuid, extensions.gen_random_uuid());
    if char_length(btrim(coalesce(v_unit ->> 'name', ''))) not between 1 and 80 then
      raise exception 'unit name must contain 1-80 characters' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(v_unit -> 'words', '[]'::jsonb)) <> 'array'
       or jsonb_array_length(coalesce(v_unit -> 'words', '[]'::jsonb)) < 1 then
      raise exception 'each unit must contain at least one word' using errcode = '22023';
    end if;
    if exists (
      select 1 from public.learning_course_units u
      where u.id = v_unit_id and (u.user_id <> p_user_id or u.course_id <> v_course_id)
    ) then
      raise exception 'learning unit not owned by course' using errcode = '42501';
    end if;
    select exists (
      select 1 from public.learning_course_units u
      where u.id = v_unit_id and u.user_id = p_user_id and u.course_id = v_course_id
    ) into v_unit_exists;
    if not v_unit_exists then v_content_changed := true; end if;

    insert into public.learning_course_units (
      id, course_id, user_id, name, position, is_system
    ) values (
      v_unit_id, v_course_id, p_user_id, btrim(v_unit ->> 'name'), v_unit_pos,
      coalesce((v_unit ->> 'isSystem')::boolean, false)
    )
    on conflict (id) do update
      set name = excluded.name,
          position = excluded.position,
          is_system = excluded.is_system,
          updated_at = now()
      where learning_course_units.user_id = p_user_id
        and learning_course_units.course_id = v_course_id;
    v_unit_ids := array_append(v_unit_ids, v_unit_id);

    v_word_pos := 0;
    for v_word in select value from jsonb_array_elements(v_unit -> 'words') loop
      v_word_id := coalesce(nullif(v_word ->> 'id', '')::uuid, extensions.gen_random_uuid());
      v_term := btrim(regexp_replace(coalesce(v_word ->> 'term', ''), '[[:space:]]+', ' ', 'g'));
      v_ipa := nullif(btrim(coalesce(v_word ->> 'ipa', '')), '');
      if char_length(v_term) not between 1 and 120
         or v_term !~ '[A-Za-z]'
         or v_term !~ '^[A-Za-z0-9][A-Za-z0-9 .''’\-]*$' then
        raise exception 'invalid english word or phrase: %', v_term using errcode = '22023';
      end if;
      if jsonb_typeof(coalesce(v_word -> 'translations', '[]'::jsonb)) <> 'array' then
        raise exception 'translations must be an array' using errcode = '22023';
      end if;
      select array_agg(btrim(value)) into v_translations
      from jsonb_array_elements_text(v_word -> 'translations');
      if cardinality(v_translations) not between 1 and 10
         or exists (select 1 from unnest(v_translations) t where t = '')
         or exists (select 1 from unnest(v_translations) t where char_length(t) > 120)
         or (select count(*) from unnest(v_translations) t)
            <> (select count(distinct lower(t)) from unnest(v_translations) t) then
        raise exception 'word requires 1-10 distinct non-empty translations' using errcode = '22023';
      end if;
      if exists (
        select 1 from public.learning_course_words w
        where w.id = v_word_id and (w.user_id <> p_user_id or w.course_id <> v_course_id)
      ) then
        raise exception 'learning word not owned by course' using errcode = '42501';
      end if;

      select * into v_old from public.learning_course_words where id = v_word_id;
      v_exists := found;
      if v_exists then
        if v_old.term is distinct from v_term
           or v_old.translations is distinct from v_translations
           or v_old.ipa is distinct from v_ipa then
          v_content_changed := true;
        end if;
        update public.learning_course_words
        set unit_id = v_unit_id,
            term = v_term,
            translations = v_translations,
            ipa = v_ipa,
            position = v_word_pos,
            content_version = content_version + case
              when term is distinct from v_term
                or translations is distinct from v_translations
                or ipa is distinct from v_ipa then 1 else 0 end,
            updated_at = now()
        where id = v_word_id and user_id = p_user_id;

        if v_old.term is distinct from v_term then
          update public.learning_word_progress
          set initial_recognition_seen = false,
              initial_pronunciation_passed = false,
              initial_translation_passed = false,
              initial_spelling_passed = false,
              pronunciation_review_dates = '{}'::date[],
              translation_review_dates = '{}'::date[],
              spelling_review_dates = '{}'::date[],
              learned_at = null,
              updated_at = now()
          where user_id = p_user_id and word_id = v_word_id;
        else
          update public.learning_word_progress
          set initial_translation_passed = case when v_old.translations is distinct from v_translations then false else initial_translation_passed end,
              translation_review_dates = case when v_old.translations is distinct from v_translations then '{}'::date[] else translation_review_dates end,
              initial_pronunciation_passed = case when v_old.ipa is distinct from v_ipa then false else initial_pronunciation_passed end,
              pronunciation_review_dates = case when v_old.ipa is distinct from v_ipa then '{}'::date[] else pronunciation_review_dates end,
              learned_at = case when v_old.translations is distinct from v_translations or v_old.ipa is distinct from v_ipa then null else learned_at end,
              updated_at = now()
          where user_id = p_user_id and word_id = v_word_id;
        end if;
      else
        v_content_changed := true;
        insert into public.learning_course_words (
          id, course_id, unit_id, user_id, term, translations, ipa, position
        ) values (
          v_word_id, v_course_id, v_unit_id, p_user_id, v_term, v_translations, v_ipa, v_word_pos
        );
        insert into public.learning_word_progress (user_id, word_id)
        values (p_user_id, v_word_id);
      end if;
      v_word_ids := array_append(v_word_ids, v_word_id);
      v_word_pos := v_word_pos + 1;
    end loop;
    v_unit_pos := v_unit_pos + 1;
  end loop;

  if exists (
    select 1 from public.learning_course_words
    where course_id = v_course_id and user_id = p_user_id and not (id = any(v_word_ids))
  ) or exists (
    select 1 from public.learning_course_units
    where course_id = v_course_id and user_id = p_user_id and not (id = any(v_unit_ids))
  ) then
    v_content_changed := true;
  end if;

  delete from public.learning_course_words
  where course_id = v_course_id and user_id = p_user_id and not (id = any(v_word_ids));
  delete from public.learning_course_units
  where course_id = v_course_id and user_id = p_user_id and not (id = any(v_unit_ids));

  select count(*), count(distinct normalized_term)
  into v_total, v_distinct
  from public.learning_course_words
  where course_id = v_course_id and user_id = p_user_id;
  if v_total > 2000 or v_distinct < 4 then
    raise exception 'course requires 4-2000 distinct words or phrases' using errcode = '22023';
  end if;

  if v_content_changed then
    update public.learning_sessions
    set active = false,
        state = state || jsonb_build_object('abortedReason', 'course_content_updated'),
        last_activity_at = now()
    where course_id = v_course_id and user_id = p_user_id and active;
  end if;
  -- Title/unit-only changes, reorders, and word moves do not invalidate an
  -- unfinished queue. Content-changing saves retain the aborted session and
  -- append-only attempts.
  update public.learning_courses set updated_at = now()
  where id = v_course_id and user_id = p_user_id;
  return v_course_id;
end;
$$;

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
begin
  -- Serialize start/resume across API instances. The partial unique index is
  -- still the invariant; this lock turns concurrent starts into the same
  -- resumable session instead of surfacing a transient 23505 to one caller.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-active-session:' || p_user_id::text || ':' || p_course_id::text, 420776)
  );
  select id into v_session_id
  from public.learning_sessions
  where user_id = p_user_id and course_id = p_course_id and active
  order by started_at desc limit 1;
  if v_session_id is not null then return v_session_id; end if;

  if not exists (
    select 1 from public.learning_courses c where c.id = p_course_id and c.user_id = p_user_id
  ) then raise exception 'course not found' using errcode = '42501'; end if;
  if v_unit_id is null then
    select id into v_unit_id from public.learning_course_units
    where course_id = p_course_id and user_id = p_user_id order by position limit 1;
  end if;
  if not exists (
    select 1 from public.learning_course_units u
    where u.id = v_unit_id and u.course_id = p_course_id and u.user_id = p_user_id
  ) then raise exception 'unit not found' using errcode = '42501'; end if;
  if p_schedule_id is not null then
    if p_mode <> 'review' then
      raise exception 'a review schedule requires review mode' using errcode = '22023';
    end if;
    select r.skills, r.scope into v_skills, v_scope
    from public.learning_review_schedules r
    where r.id = p_schedule_id and r.user_id = p_user_id
      and r.course_id = p_course_id and r.unit_id = v_unit_id and r.status = 'pending'
    for update;
    if not found then raise exception 'review schedule not found' using errcode = '42501'; end if;
  end if;

  if p_mode = 'initial' then
    v_skills := array['pronunciation','translation','spelling']::text[];
    v_stage := 'recognition';
  elsif p_mode = 'review' then
    if p_schedule_id is null then v_skills := p_skills; end if;
    if v_skills is null
       or cardinality(v_skills) not between 1 and 3
       or cardinality(v_skills) <> (select count(distinct skill) from unnest(v_skills) as selected(skill))
       or not (v_skills <@ array['pronunciation','translation','spelling']::text[]) then
      raise exception 'invalid review skills' using errcode = '22023';
    end if;
    v_stage := case
      when 'pronunciation' = any(v_skills) then 'pronunciation'
      when 'translation' = any(v_skills) then 'translation'
      else 'spelling'
    end;
  else
    raise exception 'invalid learning mode' using errcode = '22023';
  end if;
  if v_scope not in ('all', 'unlearned') then
    raise exception 'invalid review scope' using errcode = '22023';
  end if;

  insert into public.learning_sessions (
    user_id, course_id, unit_id, mode, scope, selected_skills, stage, state
  ) values (
    p_user_id, p_course_id, v_unit_id, p_mode, v_scope, v_skills, v_stage,
    case when p_schedule_id is null then '{}'::jsonb else jsonb_build_object('scheduleId', p_schedule_id) end
  ) returning id into v_session_id;

  insert into public.learning_session_items (session_id, word_id, position)
  select v_session_id, w.id, row_number() over (order by w.position, w.id) - 1
  from public.learning_course_words w
  left join public.learning_word_progress p
    on p.word_id = w.id and p.user_id = p_user_id
  where w.unit_id = v_unit_id and w.user_id = p_user_id
    and (v_scope = 'all' or p.learned_at is null)
  order by w.position, w.id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    delete from public.learning_sessions where id = v_session_id;
    raise exception 'no words match this learning scope' using errcode = '22023';
  end if;
  update public.learning_sessions s
  set state = s.state || jsonb_build_object(
    'queue', (select coalesce(jsonb_agg(to_jsonb(i.word_id) order by i.position), '[]'::jsonb)
              from public.learning_session_items i where i.session_id = v_session_id),
    'cursor', 0, 'nextQueue', '[]'::jsonb, 'round', 1
  )
  where s.id = v_session_id;
  return v_session_id;
end;
$$;

create or replace function public._learning_reset_session_queue(p_session_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.learning_sessions s
  set state = s.state || jsonb_build_object(
    'queue', (
      select coalesce(jsonb_agg(to_jsonb(i.word_id) order by i.position), '[]'::jsonb)
      from public.learning_session_items i where i.session_id = p_session_id
    ),
    'cursor', 0,
    'nextQueue', '[]'::jsonb,
    'round', 1
  )
  where s.id = p_session_id and s.active;
$$;

create or replace function public._learning_advance_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.learning_sessions%rowtype;
  v_next text;
  v_schedule_id uuid;
begin
  select * into strict v_session from public.learning_sessions where id = p_session_id for update;
  if not v_session.active then return; end if;

  if v_session.stage = 'recognition' and not exists (
    select 1 from public.learning_session_items where session_id = p_session_id and not recognition_seen
  ) then v_next := 'pronunciation';
  elsif v_session.stage = 'pronunciation' and not exists (
    select 1 from public.learning_session_items where session_id = p_session_id and not pronunciation_passed
  ) then
    v_next := case
      when 'translation' = any(v_session.selected_skills) then 'translation'
      when 'spelling' = any(v_session.selected_skills) then 'spelling'
      else 'completed' end;
  elsif v_session.stage = 'translation' and not exists (
    select 1 from public.learning_session_items where session_id = p_session_id and not translation_passed
  ) then
    v_next := case when 'spelling' = any(v_session.selected_skills) then 'spelling' else 'completed' end;
  elsif v_session.stage = 'spelling' and not exists (
    select 1 from public.learning_session_items where session_id = p_session_id and not spelling_passed
  ) then v_next := 'completed';
  end if;

  if v_next is null then return; end if;
  if v_next = 'completed' then
    update public.learning_sessions
    set stage = 'completed', active = false, completed_at = now(), last_activity_at = now()
    where id = p_session_id;
    if v_session.mode = 'review' then
      -- A review date becomes a mastery fact only after the whole review
      -- session completes. Abandoned sessions may keep append-only attempts,
      -- but can never advance mastery. Use the date captured on the final
      -- correct attempt instead of recalculating it after a timezone change.
      with completed as (
        select i.word_id,
          (select max(a.local_date) from public.learning_attempts a
           where a.session_id = p_session_id and a.word_id = i.word_id
             and a.skill = 'pronunciation' and a.is_correct) as pronunciation_date,
          (select max(a.local_date) from public.learning_attempts a
           where a.session_id = p_session_id and a.word_id = i.word_id
             and a.skill = 'translation' and a.is_correct) as translation_date,
          (select max(a.local_date) from public.learning_attempts a
           where a.session_id = p_session_id and a.word_id = i.word_id
             and a.skill = 'spelling' and a.is_correct) as spelling_date
        from public.learning_session_items i
        where i.session_id = p_session_id
      )
      update public.learning_word_progress p
      set pronunciation_review_dates = case
            when 'pronunciation' = any(v_session.selected_skills)
              and c.pronunciation_date is not null
              and not (c.pronunciation_date = any(p.pronunciation_review_dates))
              then array_append(p.pronunciation_review_dates, c.pronunciation_date)
            else p.pronunciation_review_dates end,
          translation_review_dates = case
            when 'translation' = any(v_session.selected_skills)
              and c.translation_date is not null
              and not (c.translation_date = any(p.translation_review_dates))
              then array_append(p.translation_review_dates, c.translation_date)
            else p.translation_review_dates end,
          spelling_review_dates = case
            when 'spelling' = any(v_session.selected_skills)
              and c.spelling_date is not null
              and not (c.spelling_date = any(p.spelling_review_dates))
              then array_append(p.spelling_review_dates, c.spelling_date)
            else p.spelling_review_dates end,
          review_count = p.review_count + 1,
          updated_at = now()
      from completed c
      where p.user_id = v_session.user_id and p.word_id = c.word_id;

      update public.learning_word_progress p
      set learned_at = coalesce(p.learned_at, now()), updated_at = now()
      from public.learning_session_items i
      where i.session_id = p_session_id
        and p.user_id = v_session.user_id and p.word_id = i.word_id
        and cardinality(p.pronunciation_review_dates) >= 2
        and cardinality(p.translation_review_dates) >= 2
        and cardinality(p.spelling_review_dates) >= 2;
      v_schedule_id := nullif(v_session.state ->> 'scheduleId', '')::uuid;
      if v_schedule_id is not null then
        update public.learning_review_schedules
        set status = 'completed', completed_session_id = p_session_id, completed_at = now()
        where id = v_schedule_id
          and user_id = v_session.user_id
          and status = 'pending';
      end if;
    end if;
    perform public._refresh_learning_growth(v_session.user_id, v_session.course_id);
  else
    update public.learning_sessions set stage = v_next, last_activity_at = now()
    where id = p_session_id;
  end if;
end;
$$;

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
  update public.learning_sessions
  set state = jsonb_set(state, '{cursor}', to_jsonb(v_cursor + 1)), last_activity_at = now()
  where id = p_session_id;
  if v_cursor + 1 >= v_queue_size then
    perform public._learning_advance_session(p_session_id);
    perform public._learning_reset_session_queue(p_session_id);
  end if;
  return (select jsonb_build_object('stage', stage, 'completed', not active)
          from public.learning_sessions where id = p_session_id);
end;
$$;

create or replace function public.learning_record_attempt(
  p_user_id uuid,
  p_session_id uuid,
  p_word_id uuid,
  p_skill text,
  p_answer jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.learning_sessions%rowtype;
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
begin
  if p_skill not in ('pronunciation', 'translation', 'spelling') then
    raise exception 'invalid learning skill' using errcode = '22023';
  end if;
  select * into strict v_session from public.learning_sessions
  where id = p_session_id and user_id = p_user_id and active for update;
  if v_session.stage <> p_skill or not (p_skill = any(v_session.selected_skills)) then
    raise exception 'answer does not match active session stage' using errcode = '22023';
  end if;
  v_cursor := coalesce((v_session.state ->> 'cursor')::integer, 0);
  v_expected := nullif(v_session.state -> 'queue' ->> v_cursor, '')::uuid;
  if p_skill = 'pronunciation' then
    select q.ordinality::integer - 1 into v_target_index
    from jsonb_array_elements_text(coalesce(v_session.state -> 'queue', '[]'::jsonb)) with ordinality q(value, ordinality)
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
  where i.session_id = p_session_id and w.id = p_word_id and w.user_id = p_user_id;

  if p_skill = 'pronunciation' then
    v_correct := nullif(p_answer ->> 'wordId', '')::uuid = p_word_id;
  elsif p_skill = 'translation' then
    if jsonb_typeof(coalesce(p_answer -> 'translations', '[]'::jsonb)) = 'array' then
      select array_agg(lower(btrim(value)) order by lower(btrim(value))) into v_answer_translations
      from jsonb_array_elements_text(p_answer -> 'translations');
      select array_agg(lower(btrim(value)) order by lower(btrim(value))) into v_expected_translations
      from unnest(v_word.translations) value;
      v_correct := coalesce(v_answer_translations, '{}'::text[]) = coalesce(v_expected_translations, '{}'::text[]);
    end if;
  else
    v_correct := public._points_normalize_text(p_answer ->> 'text') = v_word.normalized_term;
  end if;

  insert into public.learning_attempts (
    user_id, course_id, session_id, word_id, mode, skill, is_correct, answer, local_date
  ) values (
    p_user_id, v_session.course_id, p_session_id, p_word_id, v_session.mode, p_skill, v_correct,
    coalesce(p_answer, '{}'::jsonb), v_date
  );

  update public.learning_session_items
  set pronunciation_passed = pronunciation_passed or (p_skill = 'pronunciation' and v_correct),
      translation_passed = translation_passed or (p_skill = 'translation' and v_correct),
      spelling_passed = spelling_passed or (p_skill = 'spelling' and v_correct),
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
        'queue', v_next_queue, 'cursor', 0, 'nextQueue', '[]'::jsonb,
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
    set state = state || jsonb_build_object(
      'cursor', v_cursor + 1, 'nextQueue', v_next_queue
    ), last_activity_at = now()
    where id = p_session_id;
  end if;
  return (select jsonb_build_object(
    'correct', v_correct,
    'stage', s.stage,
    'completed', not s.active,
    'expected', case p_skill
      when 'translation' then to_jsonb(v_word.translations)
      when 'spelling' then to_jsonb(v_word.term)
      else to_jsonb(v_word.term)
    end
  ) from public.learning_sessions s where s.id = p_session_id);
end;
$$;

create or replace function public.learning_schedule_reviews(
  p_user_id uuid,
  p_unit_id uuid,
  p_source_session_id uuid,
  p_offsets integer[]
)
returns setof public.learning_review_schedules
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_course_id uuid;
  v_offset integer;
  v_today date := public._learning_local_date(p_user_id);
begin
  if p_offsets is null
     or cardinality(p_offsets) > 4
     or cardinality(p_offsets) <> (select count(distinct review_offset) from unnest(p_offsets) as selected(review_offset))
     or exists (
    select 1 from unnest(p_offsets) x where x not in (3, 7, 15, 30)
  ) then raise exception 'review offsets must be selected from 3,7,15,30' using errcode = '22023'; end if;
  select course_id into v_course_id from public.learning_course_units
  where id = p_unit_id and user_id = p_user_id;
  if v_course_id is null then raise exception 'unit not found' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.learning_sessions s
    where s.id = p_source_session_id and s.user_id = p_user_id
      and s.course_id = v_course_id and s.unit_id = p_unit_id
      and s.mode = 'initial' and s.stage = 'completed' and not s.active
      and s.completed_at is not null
  ) then raise exception 'a completed initial session is required' using errcode = '42501'; end if;
  foreach v_offset in array p_offsets loop
    insert into public.learning_review_schedules (user_id, course_id, unit_id, source_session_id, due_date)
    values (p_user_id, v_course_id, p_unit_id, p_source_session_id, v_today + v_offset)
    on conflict (user_id, unit_id, due_date) do update
      set source_session_id = case when learning_review_schedules.status = 'completed'
            then learning_review_schedules.source_session_id else excluded.source_session_id end,
          status = case when learning_review_schedules.status = 'completed' then 'completed' else 'pending' end,
          completed_session_id = case when learning_review_schedules.status = 'completed'
            then learning_review_schedules.completed_session_id else null end,
          completed_at = case when learning_review_schedules.status = 'completed'
            then learning_review_schedules.completed_at else null end;
  end loop;
  return query select * from public.learning_review_schedules
    where user_id = p_user_id and unit_id = p_unit_id order by due_date;
end;
$$;

create or replace function public.learning_profile_summary(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with stats as (
    select
      (select count(*) from public.learning_courses c where c.user_id = p_user_id) as courses,
      (select count(distinct w.normalized_term)
       from public.learning_course_words w
       join public.learning_word_progress p on p.word_id = w.id and p.user_id = p_user_id
       where w.user_id = p_user_id and p.learned_at is not null) as learned_words,
      (select count(distinct a.local_date)
       from public.learning_attempts a
       join public.learning_sessions s on s.id = a.session_id
       where a.user_id = p_user_id and a.mode = 'review' and s.completed_at is not null) as review_days
  )
  select jsonb_build_object(
    'courses', stats.courses,
    'learnedWords', stats.learned_words,
    'reviewDays', stats.review_days,
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', b.code, 'family', b.family, 'tier', b.tier, 'name', b.name,
        'description', b.description, 'threshold', b.threshold, 'icon', b.icon,
        'awardedAt', a.awarded_at
      ) order by b.family, b.tier)
      from public.user_badge_awards a
      join public.badge_definitions b on b.code = a.badge_code
      where a.user_id = p_user_id
    ), '[]'::jsonb)
  ) from stats;
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
  v_correct boolean;
  v_date date := public._learning_local_date(p_user_id);
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
  if v_accuracy is null or v_accuracy < 0 or v_accuracy > 100 then
    raise exception 'invalid speech assessment score' using errcode = '22023';
  end if;
  v_correct := v_accuracy >= 70;

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
  return jsonb_build_object('recorded', true, 'correct', v_correct);
end;
$$;

create or replace function public.learning_reserve_speech_quota(
  p_user_id uuid,
  p_kind text,
  p_cost_microusd integer,
  p_minute_limit integer,
  p_day_limit integer,
  p_month_budget_microusd bigint
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_local_date date;
  v_month_spend bigint;
begin
  if p_kind is null or p_kind not in ('tts', 'assessment')
     or p_cost_microusd is null or p_cost_microusd <= 0
     or p_minute_limit is null or p_minute_limit <= 0
     or p_day_limit is null or p_day_limit <= 0
     or p_month_budget_microusd is null or p_month_budget_microusd <= 0 then
    raise exception 'invalid speech quota request' using errcode = '22023';
  end if;
  if p_kind = 'assessment' and (
    p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id)
  ) then
    raise exception 'speech assessment user not found' using errcode = '23503';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-speech-budget:' || to_char(now(), 'YYYY-MM'), 420771)
  );
  v_local_date := case when p_user_id is null then current_date
                       else public._learning_local_date(p_user_id) end;

  if p_kind = 'assessment' and (
    select count(*) from public.learning_speech_usage u
    where u.user_id = p_user_id and u.kind = 'assessment'
      and u.created_at >= now() - interval '1 minute'
  ) >= p_minute_limit then
    raise exception 'speech assessment minute quota exceeded' using errcode = 'P0001';
  end if;
  if p_kind = 'assessment' and (
    select count(*) from public.learning_speech_usage u
    where u.user_id = p_user_id and u.kind = 'assessment' and u.local_date = v_local_date
  ) >= p_day_limit then
    raise exception 'speech assessment daily quota exceeded' using errcode = 'P0001';
  end if;

  select coalesce(sum(u.cost_microusd), 0) into v_month_spend
  from public.learning_speech_usage u
  where u.created_at >= date_trunc('month', now());
  if v_month_spend + p_cost_microusd > p_month_budget_microusd then
    raise exception 'speech monthly budget exceeded' using errcode = 'P0001';
  end if;

  insert into public.learning_speech_usage (user_id, kind, cost_microusd, local_date)
  values (p_user_id, p_kind, p_cost_microusd, v_local_date);
end;
$$;

create or replace function public.learning_clone_course(
  p_user_id uuid,
  p_payload jsonb,
  p_origin_publication_id uuid,
  p_origin_author_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_course_id uuid;
begin
  v_course_id := public.learning_upsert_course(p_user_id, p_payload);
  if p_origin_publication_id is not null and not exists (
    select 1 from public.learning_course_publications p
    where p.id = p_origin_publication_id and p.status = 'published'
  ) then
    raise exception 'publication not found' using errcode = '42501';
  end if;
  update public.learning_courses
  set can_republish = false,
      origin_publication_id = p_origin_publication_id,
      origin_share_id = null,
      origin_author_name = nullif(btrim(p_origin_author_name), ''),
      updated_at = now()
  where id = v_course_id and user_id = p_user_id;
  if p_origin_publication_id is not null then
    update public.learning_course_publications
    set clone_count = clone_count + 1, updated_at = now()
    where id = p_origin_publication_id;
  end if;
  return v_course_id;
end;
$$;

create or replace function public.learning_rename_course(
  p_user_id uuid,
  p_course_id uuid,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 80 then
    raise exception 'course title must contain 1-80 characters' using errcode = '22023';
  end if;
  update public.learning_courses
  set title = btrim(p_title), updated_at = now()
  where id = p_course_id and user_id = p_user_id;
  if not found then raise exception 'course not found' using errcode = '42501'; end if;
  return p_course_id;
end;
$$;

create or replace function public.learning_delete_course(
  p_user_id uuid,
  p_course_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.learning_courses where id = p_course_id and user_id = p_user_id;
  if not found then raise exception 'course not found' using errcode = '42501'; end if;
  return true;
end;
$$;

create or replace function public.learning_cancel_review_schedule(
  p_user_id uuid,
  p_schedule_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.learning_review_schedules
  set status = 'cancelled', completed_session_id = null, completed_at = null
  where id = p_schedule_id and user_id = p_user_id and status <> 'completed';
  if not found then raise exception 'review schedule not found' using errcode = '42501'; end if;
  return true;
end;
$$;

create or replace function public.learning_create_share(
  p_user_id uuid,
  p_course_id uuid,
  p_token_hash text,
  p_author_name text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_share_id uuid;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid share token hash' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_author_name, ''))) not between 1 and 80 then
    raise exception 'invalid share author name' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.learning_courses c
    where c.id = p_course_id and c.user_id = p_user_id and c.can_republish
  ) then raise exception 'course cannot be shared' using errcode = '42501'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-share:' || p_course_id::text, 420772)
  );
  update public.learning_course_shares
  set active = false, revoked_at = now()
  where course_id = p_course_id and user_id = p_user_id and active;
  insert into public.learning_course_shares (
    user_id, course_id, token_hash, author_name
  ) values (
    p_user_id, p_course_id, p_token_hash, btrim(p_author_name)
  ) returning id into v_share_id;
  return v_share_id;
end;
$$;

create or replace function public.learning_revoke_share(
  p_user_id uuid,
  p_share_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.learning_course_shares
  set active = false, revoked_at = now()
  where id = p_share_id and user_id = p_user_id and active;
  if not found then raise exception 'share not found' using errcode = '42501'; end if;
  return true;
end;
$$;

create or replace function public.learning_clone_share(
  p_user_id uuid,
  p_payload jsonb,
  p_token_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_share public.learning_course_shares%rowtype;
  v_course_id uuid;
begin
  select * into v_share
  from public.learning_course_shares
  where token_hash = p_token_hash and active
  for share;
  if not found then raise exception 'share not found or revoked' using errcode = '42501'; end if;

  v_course_id := public.learning_upsert_course(p_user_id, p_payload);
  update public.learning_courses
  set can_republish = false,
      origin_publication_id = null,
      origin_share_id = v_share.id,
      origin_author_name = v_share.author_name,
      updated_at = now()
  where id = v_course_id and user_id = p_user_id;
  return v_course_id;
end;
$$;

create or replace function public.learning_publish_course(
  p_user_id uuid,
  p_course_id uuid,
  p_description text,
  p_author_name text,
  p_rights_declared boolean,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_course public.learning_courses%rowtype;
  v_snapshot jsonb;
  v_version integer;
  v_publication public.learning_course_publications%rowtype;
begin
  if p_rights_declared is distinct from true then
    raise exception 'content rights declaration is required' using errcode = '22023';
  end if;
  if char_length(coalesce(p_description, '')) > 500
     or char_length(btrim(coalesce(p_author_name, ''))) not between 1 and 80
     or p_daily_limit is null or p_daily_limit <= 0 then
    raise exception 'invalid publication metadata' using errcode = '22023';
  end if;
  select * into v_course from public.learning_courses
  where id = p_course_id and user_id = p_user_id
  for update;
  if not found or not v_course.can_republish then
    raise exception 'course cannot be published' using errcode = '42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-publish-rate:' || p_user_id::text, 420774)
  );
  if (select count(*) from public.learning_course_publications p
      where p.author_id = p_user_id and p.created_at >= now() - interval '1 day') >= p_daily_limit then
    raise exception 'course publication daily quota exceeded' using errcode = 'P0001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-publication:' || p_course_id::text, 420773)
  );
  select coalesce(max(p.version), 0) + 1 into v_version
  from public.learning_course_publications p
  where p.author_id = p_user_id and p.source_course_id = p_course_id;
  update public.learning_course_publications
  set status = 'withdrawn', updated_at = now()
  where author_id = p_user_id and source_course_id = p_course_id and status = 'published';

  v_snapshot := public._learning_course_snapshot(p_course_id);
  insert into public.learning_course_publications (
    author_id, source_course_id, title, description, author_name,
    category, locale, version, snapshot, content_fingerprint,
    rights_declared_at
  ) values (
    p_user_id, p_course_id, v_course.title, coalesce(p_description, ''), btrim(p_author_name),
    'english_vocabulary', 'en-US', v_version, v_snapshot,
    public._learning_course_fingerprint(p_course_id), now()
  ) returning * into v_publication;

  return jsonb_build_object(
    'id', v_publication.id,
    'version', v_publication.version,
    'snapshot', v_publication.snapshot,
    'authorName', v_publication.author_name,
    'description', v_publication.description,
    'createdAt', v_publication.created_at
  );
end;
$$;

create or replace function public.learning_create_report(
  p_user_id uuid,
  p_publication_id uuid,
  p_share_id uuid,
  p_category text,
  p_details text,
  p_daily_limit integer,
  p_alert_threshold integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_report public.learning_course_reports%rowtype;
  v_open_count integer;
begin
  if ((p_publication_id is not null)::integer + (p_share_id is not null)::integer) <> 1
     or p_category is null
     or p_category not in ('abuse', 'copyright', 'privacy', 'spam', 'academic_integrity', 'other')
     or char_length(coalesce(p_details, '')) > 1000
     or p_daily_limit is null or p_daily_limit <= 0
     or p_alert_threshold is null or p_alert_threshold <= 0 then
    raise exception 'invalid course report' using errcode = '22023';
  end if;
  if p_publication_id is not null and not exists (
    select 1 from public.learning_course_publications where id = p_publication_id
  ) then raise exception 'publication not found' using errcode = '42501'; end if;
  if p_share_id is not null and not exists (
    select 1 from public.learning_course_shares where id = p_share_id
  ) then raise exception 'share not found' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('learning-report-rate:' || p_user_id::text, 420775)
  );
  if (select count(*) from public.learning_course_reports r
      where r.reporter_id = p_user_id and r.created_at >= date_trunc('day', now())) >= p_daily_limit then
    raise exception 'course report daily quota exceeded' using errcode = 'P0001';
  end if;

  insert into public.learning_course_reports (
    reporter_id, publication_id, share_id, category, details
  ) values (
    p_user_id, p_publication_id, p_share_id, p_category, btrim(coalesce(p_details, ''))
  ) returning * into v_report;
  select count(*) into v_open_count
  from public.learning_course_reports r
  where r.status = 'open'
    and (r.publication_id is not distinct from p_publication_id)
    and (r.share_id is not distinct from p_share_id);
  return jsonb_build_object(
    'id', v_report.id, 'status', v_report.status,
    'openCount', v_open_count,
    'thresholdReached', v_open_count >= p_alert_threshold
  );
end;
$$;

create or replace function public.learning_moderate_publication(
  p_actor_id uuid,
  p_publication_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
begin
  if p_actor_id is null
     or not exists (select 1 from auth.users u where u.id = p_actor_id)
     or p_action is null
     or p_action not in ('hide', 'restore', 'withdraw')
     or char_length(btrim(coalesce(p_reason, ''))) not between 1 and 1000 then
    raise exception 'invalid moderation action' using errcode = '22023';
  end if;
  v_status := case p_action when 'restore' then 'published' when 'hide' then 'hidden' else 'withdrawn' end;
  update public.learning_course_publications
  set status = v_status, updated_at = now()
  where id = p_publication_id;
  if not found then raise exception 'publication not found' using errcode = '42501'; end if;
  insert into public.learning_course_moderation_actions (
    publication_id, actor_id, action, reason
  ) values (
    p_publication_id, p_actor_id, p_action, btrim(p_reason)
  );
  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

-- Every workflow function is server-only. The API authenticates the user JWT,
-- then invokes these transactions with the service-role credential.
revoke execute on function public._learning_local_date(uuid) from public, anon, authenticated;
revoke execute on function public._learning_course_fingerprint(uuid) from public, anon, authenticated;
revoke execute on function public._learning_course_snapshot(uuid) from public, anon, authenticated;
revoke execute on function public._refresh_learning_growth(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.learning_upsert_course(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.learning_start_session(uuid, uuid, uuid, text, text[], text, uuid) from public, anon, authenticated;
revoke execute on function public._learning_advance_session(uuid) from public, anon, authenticated;
revoke execute on function public._learning_reset_session_queue(uuid) from public, anon, authenticated;
revoke execute on function public.learning_mark_recognition(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.learning_record_attempt(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke execute on function public.learning_schedule_reviews(uuid, uuid, uuid, integer[]) from public, anon, authenticated;
revoke execute on function public.learning_profile_summary(uuid) from public, anon, authenticated;
revoke execute on function public.learning_record_speech_assessment(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.learning_reserve_speech_quota(uuid, text, integer, integer, integer, bigint) from public, anon, authenticated;
revoke execute on function public.learning_clone_course(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke execute on function public.learning_rename_course(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public.learning_delete_course(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.learning_cancel_review_schedule(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.learning_create_share(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function public.learning_revoke_share(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.learning_clone_share(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function public.learning_publish_course(uuid, uuid, text, text, boolean, integer) from public, anon, authenticated;
revoke execute on function public.learning_create_report(uuid, uuid, uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.learning_moderate_publication(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public._learning_course_snapshot(uuid) to service_role;
grant execute on function public.learning_upsert_course(uuid, jsonb) to service_role;
grant execute on function public.learning_start_session(uuid, uuid, uuid, text, text[], text, uuid) to service_role;
grant execute on function public.learning_mark_recognition(uuid, uuid, uuid) to service_role;
grant execute on function public.learning_record_attempt(uuid, uuid, uuid, text, jsonb) to service_role;
grant execute on function public.learning_schedule_reviews(uuid, uuid, uuid, integer[]) to service_role;
grant execute on function public.learning_profile_summary(uuid) to service_role;
grant execute on function public.learning_record_speech_assessment(uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.learning_reserve_speech_quota(uuid, text, integer, integer, integer, bigint) to service_role;
grant execute on function public.learning_clone_course(uuid, jsonb, uuid, text) to service_role;
grant execute on function public.learning_rename_course(uuid, uuid, text) to service_role;
grant execute on function public.learning_delete_course(uuid, uuid) to service_role;
grant execute on function public.learning_cancel_review_schedule(uuid, uuid) to service_role;
grant execute on function public.learning_create_share(uuid, uuid, text, text) to service_role;
grant execute on function public.learning_revoke_share(uuid, uuid) to service_role;
grant execute on function public.learning_clone_share(uuid, jsonb, text) to service_role;
grant execute on function public.learning_publish_course(uuid, uuid, text, text, boolean, integer) to service_role;
grant execute on function public.learning_create_report(uuid, uuid, uuid, text, text, integer, integer) to service_role;
grant execute on function public.learning_moderate_publication(uuid, uuid, text, text) to service_role;
