-- Purpose: add owner-validated custom word subsets for review/exam sessions,
-- and persist the distinction between first-round exam success and completing
-- every retry word. Update this behavior only through a later forward migration.

-- Exam history must not silently change when the owner later edits or removes a
-- word. The snapshot is private, follows the session lifecycle, and deliberately
-- does not reference learning_course_words.
create table public.learning_exam_word_snapshots (
  session_id    uuid not null references public.learning_sessions (id) on delete cascade,
  word_id       uuid not null,
  position      integer not null check (position >= 0),
  term          text not null check (char_length(term) between 1 and 120),
  ipa           text check (ipa is null or char_length(ipa) <= 120),
  translations  text[] not null check (cardinality(translations) between 1 and 10),
  wrong_count   integer not null default 0 check (wrong_count >= 0),
  passed        boolean not null default false,
  primary key (session_id, word_id),
  unique (session_id, position) deferrable initially deferred
);

alter table public.learning_exam_word_snapshots enable row level security;
revoke all on table public.learning_exam_word_snapshots
  from public, anon, authenticated;
grant all on table public.learning_exam_word_snapshots to service_role;

alter table public.learning_attempts
  add column word_id_snapshot uuid,
  add column term_snapshot text
    check (term_snapshot is null or char_length(term_snapshot) between 1 and 120);

create or replace function public._learning_capture_exam_attempt_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_term text;
begin
  if new.mode = 'exam' and new.word_id is not null then
    select w.term into v_term
    from public.learning_course_words w
    where w.id = new.word_id
      and w.user_id = new.user_id
      and w.course_id = new.course_id;
    if not found then
      raise exception 'exam attempt word ownership mismatch' using errcode = '42501';
    end if;
    new.word_id_snapshot := new.word_id;
    new.term_snapshot := v_term;
  end if;
  return new;
end;
$$;

drop trigger if exists learning_exam_attempt_snapshot on public.learning_attempts;
create trigger learning_exam_attempt_snapshot
before insert on public.learning_attempts
for each row execute function public._learning_capture_exam_attempt_snapshot();

create or replace function public._learning_capture_exam_word_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.learning_sessions s
    where s.id = new.session_id and s.mode = 'exam'
  ) and not exists (
    select 1
    from public.learning_sessions s
    join public.learning_course_words w
      on w.id = new.word_id
      and w.user_id = s.user_id
      and w.course_id = s.course_id
    where s.id = new.session_id and s.mode = 'exam'
  ) then
    raise exception 'exam item word ownership mismatch' using errcode = '42501';
  end if;
  insert into public.learning_exam_word_snapshots (
    session_id, word_id, position, term, ipa, translations
  )
  select new.session_id, new.word_id, new.position, w.term, w.ipa, w.translations
  from public.learning_sessions s
  join public.learning_course_words w
    on w.id = new.word_id
    and w.user_id = s.user_id
    and w.course_id = s.course_id
  where s.id = new.session_id and s.mode = 'exam'
  on conflict (session_id, word_id) do nothing;
  return new;
end;
$$;

drop trigger if exists learning_exam_word_snapshot on public.learning_session_items;
create trigger learning_exam_word_snapshot
after insert on public.learning_session_items
for each row execute function public._learning_capture_exam_word_snapshot();

-- Preserve every exam that still has live words at upgrade time. Attempts whose
-- source word was deleted before this migration cannot be reconstructed.
insert into public.learning_exam_word_snapshots (
  session_id, word_id, position, term, ipa, translations, wrong_count, passed
)
select i.session_id, i.word_id, i.position, w.term, w.ipa, w.translations,
  i.wrong_count,
  case coalesce(s.state ->> 'examKind', 'spelling')
    when 'pronunciation' then i.pronunciation_passed
    else i.spelling_passed end
from public.learning_session_items i
join public.learning_sessions s on s.id = i.session_id and s.mode = 'exam'
join public.learning_course_words w
  on w.id = i.word_id and w.user_id = s.user_id and w.course_id = s.course_id
on conflict (session_id, word_id) do nothing;

update public.learning_attempts a
set word_id_snapshot = a.word_id,
    term_snapshot = w.term
from public.learning_course_words w
where a.mode = 'exam'
  and a.word_id = w.id
  and a.user_id = w.user_id
  and a.course_id = w.course_id
  and a.word_id_snapshot is null;

create or replace function public.learning_start_selected_review_session(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_skills text[],
  p_scope text,
  p_schedule_id uuid,
  p_spelling_options jsonb,
  p_word_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_session_id uuid;
  v_skills text[];
  v_scope text := coalesce(p_scope, 'all');
  v_stage text;
  v_resume_key text;
  v_selection_hash text;
  v_options jsonb;
  v_count integer;
  v_sorted_ids uuid[];
begin
  if not exists (
    select 1 from public.learning_courses c
    where c.id = p_course_id and c.user_id = p_user_id
  ) then
    raise exception 'course not found' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.learning_course_units u
    where u.id = p_unit_id
      and u.course_id = p_course_id
      and u.user_id = p_user_id
  ) then
    raise exception 'unit not found' using errcode = '42501';
  end if;
  if p_word_ids is null
     or cardinality(p_word_ids) not between 1 and 2000
     or array_position(p_word_ids, null) is not null
     or cardinality(p_word_ids) <> (
       select count(distinct selected_id)
       from unnest(p_word_ids) selected(selected_id)
     ) then
    raise exception 'selected words must contain 1 to 2000 unique ids'
      using errcode = '22023';
  end if;

  if p_schedule_id is not null then
    select r.skills, r.scope
    into v_skills, v_scope
    from public.learning_review_schedules r
    where r.id = p_schedule_id
      and r.user_id = p_user_id
      and r.course_id = p_course_id
      and r.unit_id = p_unit_id
      and r.status = 'pending'
    for update;
    if not found then
      raise exception 'review schedule not found' using errcode = '42501';
    end if;
  else
    v_skills := p_skills;
  end if;

  if v_skills is null
     or cardinality(v_skills) not between 1 and 3
     or cardinality(v_skills) <> (
       select count(distinct skill) from unnest(v_skills) selected(skill)
     )
     or not (v_skills <@ array['pronunciation','translation','spelling']::text[]) then
    raise exception 'invalid review skills' using errcode = '22023';
  end if;
  select array_agg(skill order by skill)
  into v_skills
  from unnest(v_skills) selected(skill);
  if v_scope not in ('all', 'unlearned') then
    raise exception 'invalid review scope' using errcode = '22023';
  end if;

  if exists (
    select 1
    from unnest(p_word_ids) selected(word_id)
    left join public.learning_course_words w
      on w.id = selected.word_id
      and w.user_id = p_user_id
      and w.course_id = p_course_id
      and w.unit_id = p_unit_id
    left join public.learning_word_progress progress
      on progress.user_id = p_user_id and progress.word_id = selected.word_id
    where w.id is null
       or (v_scope = 'unlearned' and progress.learned_at is not null)
  ) then
    raise exception 'selected word is outside the requested review scope'
      using errcode = '42501';
  end if;

  select array_agg(w.id order by w.position, w.id)
  into v_sorted_ids
  from public.learning_course_words w
  where w.id = any(p_word_ids)
    and w.user_id = p_user_id
    and w.course_id = p_course_id
    and w.unit_id = p_unit_id;
  v_selection_hash := encode(
    extensions.digest(array_to_string(v_sorted_ids, ','), 'sha256'),
    'hex'
  );
  v_resume_key := case
    when p_schedule_id is not null then 'schedule:' || p_schedule_id::text
    else 'review:selected:' || p_course_id::text || ':' || p_unit_id::text
      || ':' || v_scope || ':' || array_to_string(v_skills, ',')
      || ':' || v_selection_hash
  end;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'learning-active-session:' || p_user_id::text || ':' || v_resume_key,
      420776
    )
  );
  select id into v_session_id
  from public.learning_sessions
  where user_id = p_user_id and resume_key = v_resume_key and active
  order by started_at desc
  limit 1;
  if v_session_id is not null then
    return v_session_id;
  end if;

  v_stage := case
    when 'pronunciation' = any(v_skills) then 'pronunciation'
    when 'translation' = any(v_skills) then 'translation'
    else 'spelling'
  end;
  v_options := public._learning_normalize_spelling_options(
    p_spelling_options,
    'spelling' = any(v_skills)
  );

  insert into public.learning_sessions (
    user_id, course_id, unit_id, mode, scope, selected_skills, stage,
    state, resume_key, spelling_options
  ) values (
    p_user_id, p_course_id, p_unit_id, 'review', v_scope, v_skills, v_stage,
    jsonb_strip_nulls(jsonb_build_object(
      'scheduleId', p_schedule_id,
      'selectionMode', 'custom',
      'selectedWordIds', to_jsonb(v_sorted_ids)
    )),
    v_resume_key,
    v_options
  ) returning id into v_session_id;

  insert into public.learning_session_items (session_id, word_id, position)
  select v_session_id, w.id, row_number() over (order by w.position, w.id) - 1
  from public.learning_course_words w
  where w.id = any(v_sorted_ids)
  order by w.position, w.id;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_sorted_ids) then
    raise exception 'selected review words changed while starting the session'
      using errcode = '40001';
  end if;

  update public.learning_sessions s
  set state = s.state || jsonb_build_object(
    'queue', (
      select coalesce(jsonb_agg(to_jsonb(i.word_id) order by i.position), '[]'::jsonb)
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

create or replace function public.learning_start_selected_exam_session(
  p_user_id uuid,
  p_course_id uuid,
  p_unit_id uuid,
  p_spelling_options jsonb,
  p_pass_percent integer,
  p_exam_kind text,
  p_word_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions, public
as $$
declare
  v_session_id uuid;
  v_resume_key text;
  v_selection_hash text;
  v_options jsonb;
  v_count integer;
  v_sorted_ids uuid[];
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
  if not exists (
    select 1 from public.learning_course_units u
    where u.id = p_unit_id
      and u.course_id = p_course_id
      and u.user_id = p_user_id
  ) then
    raise exception 'unit not found' using errcode = '42501';
  end if;
  if p_word_ids is null
     or cardinality(p_word_ids) not between 1 and 2000
     or array_position(p_word_ids, null) is not null
     or cardinality(p_word_ids) <> (
       select count(distinct selected_id)
       from unnest(p_word_ids) selected(selected_id)
     ) then
    raise exception 'selected words must contain 1 to 2000 unique ids'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_word_ids) selected(word_id)
    left join public.learning_course_words w
      on w.id = selected.word_id
      and w.user_id = p_user_id
      and w.course_id = p_course_id
      and w.unit_id = p_unit_id
    where w.id is null
  ) then
    raise exception 'selected word is outside the requested exam unit'
      using errcode = '42501';
  end if;

  select array_agg(w.id order by w.position, w.id)
  into v_sorted_ids
  from public.learning_course_words w
  where w.id = any(p_word_ids)
    and w.user_id = p_user_id
    and w.course_id = p_course_id
    and w.unit_id = p_unit_id;
  v_selection_hash := encode(
    extensions.digest(array_to_string(v_sorted_ids, ','), 'sha256'),
    'hex'
  );
  v_resume_key := 'exam:selected:' || p_exam_kind || ':' || p_course_id::text
    || ':' || p_unit_id::text || ':' || v_selection_hash;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'learning-active-session:' || p_user_id::text || ':' || v_resume_key,
      420776
    )
  );
  select id into v_session_id
  from public.learning_sessions
  where user_id = p_user_id and resume_key = v_resume_key and active
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
  ) || jsonb_build_object('translationFirst', p_exam_kind = 'spelling');

  insert into public.learning_sessions (
    user_id, course_id, unit_id, mode, scope, selected_skills, stage,
    state, resume_key, spelling_options
  ) values (
    p_user_id, p_course_id, p_unit_id, 'exam', 'all',
    array[p_exam_kind]::text[], p_exam_kind,
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
      'roundAssessmentScores', '{}'::jsonb,
      'selectionMode', 'custom',
      'selectedWordIds', to_jsonb(v_sorted_ids)
    ),
    v_resume_key,
    v_options
  ) returning id into v_session_id;

  insert into public.learning_session_items (session_id, word_id, position)
  select v_session_id, w.id, row_number() over (order by w.position, w.id) - 1
  from public.learning_course_words w
  where w.id = any(v_sorted_ids)
  order by w.position, w.id;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(v_sorted_ids) then
    raise exception 'selected exam words changed while starting the session'
      using errcode = '40001';
  end if;

  update public.learning_sessions s
  set state = s.state || jsonb_build_object(
    'queue', (
      select coalesce(jsonb_agg(to_jsonb(i.word_id) order by
        pg_catalog.hashtextextended(
          v_session_id::text || ':' || p_exam_kind || ':' || i.word_id::text,
          81031
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

-- Completing every retry word ends an exam independently of whether the
-- immutable first-round score met its threshold. Only a passed exam projects
-- learned_at; a failed-but-remediated exam records practiceCompleted=true.
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
     and new.mode = 'exam' then
    v_exam_kind := coalesce(new.state ->> 'examKind', 'spelling');
    update public.learning_exam_word_snapshots snapshot
    set wrong_count = item.wrong_count,
        passed = case v_exam_kind
          when 'pronunciation' then item.pronunciation_passed
          else item.spelling_passed end
    from public.learning_session_items item
    where item.session_id = new.id
      and snapshot.session_id = item.session_id
      and snapshot.word_id = item.word_id;

    update public.learning_sessions
    set state = state || jsonb_build_object('practiceCompleted', true)
    where id = new.id;

    if coalesce((new.state ->> 'examPassed')::boolean, false) then
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
  end if;
  return new;
end;
$$;

create or replace function public.learning_list_exam_history(
  p_user_id uuid,
  p_course_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', history.id,
    'course_id', history.course_id,
    'course_title', history.course_title,
    'unit_id', history.unit_id,
    'unit_name', history.unit_name,
    'exam_kind', history.exam_kind,
    'required_percent', history.required_percent,
    'first_round_accuracy_percent', history.first_round_accuracy_percent,
    'first_round_correct', history.first_round_correct,
    'word_count', history.word_count,
    'passed', history.passed,
    'practice_completed', history.practice_completed,
    'status', history.status,
    'attempt_count', history.attempt_count,
    'wrong_count', history.wrong_count,
    'started_at', history.started_at,
    'completed_at', history.completed_at
  ) order by history.started_at desc), '[]'::jsonb)
  from (
    select
      s.id,
      s.course_id,
      c.title as course_title,
      s.unit_id,
      u.name as unit_name,
      coalesce(s.state ->> 'examKind', 'spelling') as exam_kind,
      coalesce((s.state ->> 'examRequiredPercent')::integer, 90) as required_percent,
      coalesce((s.state ->> 'examAccuracyPercent')::numeric, 0) as first_round_accuracy_percent,
      coalesce((s.state ->> 'examCorrect')::integer, 0) as first_round_correct,
      (select count(*) from public.learning_exam_word_snapshots snapshot
       where snapshot.session_id = s.id) as word_count,
      case when jsonb_typeof(s.state -> 'examPassed') = 'boolean'
        then (s.state ->> 'examPassed')::boolean else null end as passed,
      coalesce((s.state ->> 'practiceCompleted')::boolean, s.stage = 'completed') as practice_completed,
      case when s.active then 'in_progress'
        when s.stage = 'completed' then 'completed'
        else 'cancelled' end as status,
      (select count(*) from public.learning_attempts a where a.session_id = s.id) as attempt_count,
      (select count(*) from public.learning_attempts a where a.session_id = s.id and a.is_correct = false) as wrong_count,
      s.started_at,
      s.completed_at
    from public.learning_sessions s
    join public.learning_courses c
      on c.id = s.course_id and c.user_id = p_user_id
    left join public.learning_course_units u
      on u.id = s.unit_id and u.user_id = p_user_id
    where s.user_id = p_user_id
      and s.mode = 'exam'
      and (p_course_id is null or s.course_id = p_course_id)
    order by s.started_at desc
    limit 100
  ) history;
$$;

create or replace function public.learning_get_exam_history_detail(
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
    'course_title', c.title,
    'unit_id', s.unit_id,
    'unit_name', u.name,
    'exam_kind', coalesce(s.state ->> 'examKind', 'spelling'),
    'required_percent', coalesce((s.state ->> 'examRequiredPercent')::integer, 90),
    'first_round_accuracy_percent', coalesce((s.state ->> 'examAccuracyPercent')::numeric, 0),
    'first_round_correct', coalesce((s.state ->> 'examCorrect')::integer, 0),
    'word_count', (select count(*) from public.learning_exam_word_snapshots snapshot
      where snapshot.session_id = s.id),
    'passed', case when jsonb_typeof(s.state -> 'examPassed') = 'boolean'
      then (s.state ->> 'examPassed')::boolean else null end,
    'practice_completed', coalesce((s.state ->> 'practiceCompleted')::boolean, s.stage = 'completed'),
    'status', case when s.active then 'in_progress'
      when s.stage = 'completed' then 'completed' else 'cancelled' end,
    'attempt_count', (select count(*) from public.learning_attempts a where a.session_id = s.id),
    'wrong_count', (select count(*) from public.learning_attempts a where a.session_id = s.id and a.is_correct = false),
    'started_at', s.started_at,
    'completed_at', s.completed_at,
    'words', coalesce((
      select jsonb_agg(jsonb_build_object(
        'word_id', snapshot.word_id,
        'term', snapshot.term,
        'ipa', snapshot.ipa,
        'translations', snapshot.translations,
        'wrong_count', coalesce(item.wrong_count, snapshot.wrong_count),
        'passed', case when item.word_id is null then snapshot.passed
          when coalesce(s.state ->> 'examKind', 'spelling') = 'pronunciation'
            then item.pronunciation_passed
          else item.spelling_passed end
      ) order by snapshot.position)
      from public.learning_exam_word_snapshots snapshot
      left join public.learning_session_items item
        on item.session_id = snapshot.session_id and item.word_id = snapshot.word_id
      where snapshot.session_id = s.id
    ), '[]'::jsonb),
    'attempts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id::text,
        'word_id', coalesce(a.word_id_snapshot, a.word_id),
        'term', coalesce(a.term_snapshot, w.term),
        'skill', a.skill,
        'correct', a.is_correct,
        'answer', case
          when a.skill = 'spelling' then nullif(a.answer ->> 'text', '')
          when a.skill = 'translation' then a.answer ->> 'translations'
          else null end,
        'pronunciation_score', nullif(a.provider_details ->> 'pronunciationScore', '')::numeric,
        'accuracy_score', nullif(a.provider_details ->> 'accuracyScore', '')::numeric,
        'created_at', a.created_at
      ) order by a.created_at, a.id)
      from public.learning_attempts a
      left join public.learning_course_words w on w.id = a.word_id
      where a.session_id = s.id and a.user_id = p_user_id
    ), '[]'::jsonb)
  ) into v_result
  from public.learning_sessions s
  join public.learning_courses c
    on c.id = s.course_id and c.user_id = p_user_id
  left join public.learning_course_units u
    on u.id = s.unit_id and u.user_id = p_user_id
  where s.id = p_session_id
    and s.user_id = p_user_id
    and s.mode = 'exam';

  if v_result is null then
    raise exception 'exam history not found' using errcode = 'P0002';
  end if;
  return v_result;
end;
$$;

revoke execute on function public.learning_start_selected_review_session(
  uuid, uuid, uuid, text[], text, uuid, jsonb, uuid[]
) from public, anon, authenticated;
revoke execute on function public.learning_start_selected_exam_session(
  uuid, uuid, uuid, jsonb, integer, text, uuid[]
) from public, anon, authenticated;
revoke execute on function public.learning_list_exam_history(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.learning_get_exam_history_detail(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.learning_start_selected_review_session(
  uuid, uuid, uuid, text[], text, uuid, jsonb, uuid[]
) to service_role;
grant execute on function public.learning_start_selected_exam_session(
  uuid, uuid, uuid, jsonb, integer, text, uuid[]
) to service_role;
grant execute on function public.learning_list_exam_history(uuid, uuid)
  to service_role;
grant execute on function public.learning_get_exam_history_detail(uuid, uuid)
  to service_role;

revoke execute on function public._learning_capture_exam_attempt_snapshot()
  from public, anon, authenticated;
revoke execute on function public._learning_capture_exam_word_snapshot()
  from public, anon, authenticated;
