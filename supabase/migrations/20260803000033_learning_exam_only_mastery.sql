-- Purpose: make vocabulary mastery an exam-only projection. A word is learned
-- only after the owner has passed both a spelling exam and a pronunciation
-- exam containing that word. Initial learning and reviews remain useful
-- practice facts, but can no longer write learned_at. Update this rule only
-- through a later forward migration.

alter table public.learning_word_progress
  add column spelling_exam_passed_at timestamptz,
  add column pronunciation_exam_passed_at timestamptz;

-- Preserve only exam facts that can be proven from completed, passing exam
-- sessions. Historical review-derived learned_at values deliberately do not
-- count under the new product rule.
with exam_passes as (
  select
    s.user_id,
    i.word_id,
    max(s.completed_at) filter (
      where coalesce(s.state ->> 'examKind', 'spelling') = 'spelling'
    ) as spelling_passed_at,
    max(s.completed_at) filter (
      where coalesce(s.state ->> 'examKind', 'spelling') = 'pronunciation'
    ) as pronunciation_passed_at
  from public.learning_sessions s
  join public.learning_session_items i on i.session_id = s.id
  where s.mode = 'exam'
    and s.stage = 'completed'
    and s.completed_at is not null
    and coalesce((s.state ->> 'examPassed')::boolean, false)
  group by s.user_id, i.word_id
)
update public.learning_word_progress p
set spelling_exam_passed_at = passes.spelling_passed_at,
    pronunciation_exam_passed_at = passes.pronunciation_passed_at,
    learned_at = case
      when passes.spelling_passed_at is not null
       and passes.pronunciation_passed_at is not null
        then greatest(passes.spelling_passed_at, passes.pronunciation_passed_at)
      else null
    end,
    updated_at = now()
from exam_passes passes
where p.user_id = passes.user_id
  and p.word_id = passes.word_id;

update public.learning_word_progress
set learned_at = null,
    updated_at = now()
where learned_at is not null
  and (spelling_exam_passed_at is null or pronunciation_exam_passed_at is null);

alter table public.learning_word_progress
  add constraint learning_word_progress_exam_only_mastery
  check (
    learned_at is null
    or (spelling_exam_passed_at is not null and pronunciation_exam_passed_at is not null)
  );

-- Content edits invalidate only the exam fact whose tested material changed.
-- Changing the English term invalidates both exams; changing translations
-- invalidates spelling (which includes typed translation); changing IPA
-- invalidates pronunciation. Reordering and renaming never touch mastery.
create or replace function public._learning_reset_exam_mastery_on_word_edit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if old.term is distinct from new.term
     or old.translations is distinct from new.translations
     or old.ipa is distinct from new.ipa then
    update public.learning_word_progress p
    set spelling_exam_passed_at = case
          when old.term is distinct from new.term
            or old.translations is distinct from new.translations
            then null
          else p.spelling_exam_passed_at
        end,
        pronunciation_exam_passed_at = case
          when old.term is distinct from new.term
            or old.ipa is distinct from new.ipa
            then null
          else p.pronunciation_exam_passed_at
        end,
        learned_at = null,
        updated_at = now()
    where p.user_id = old.user_id and p.word_id = old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists learning_word_exam_mastery_reset
  on public.learning_course_words;
create trigger learning_word_exam_mastery_reset
before update of term, translations, ipa on public.learning_course_words
for each row execute function public._learning_reset_exam_mastery_on_word_edit();

-- Exam completion records the corresponding exam fact. learned_at is projected
-- only when the same word has both facts, independent of exam order. Completing
-- retry practice after a failed first round does not create an exam pass fact.
create or replace function public._learning_apply_passed_exam_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_exam_kind text;
  v_passed_at timestamptz;
begin
  if old.stage is distinct from 'completed'
     and new.stage = 'completed'
     and new.mode = 'exam' then
    v_exam_kind := coalesce(new.state ->> 'examKind', 'spelling');
    v_passed_at := coalesce(new.completed_at, now());

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
          spelling_exam_passed_at = case
            when v_exam_kind = 'spelling'
              then coalesce(p.spelling_exam_passed_at, v_passed_at)
            else p.spelling_exam_passed_at
          end,
          pronunciation_exam_passed_at = case
            when v_exam_kind = 'pronunciation'
              then coalesce(p.pronunciation_exam_passed_at, v_passed_at)
            else p.pronunciation_exam_passed_at
          end,
          updated_at = now()
      from public.learning_session_items i
      where i.session_id = new.id
        and p.user_id = new.user_id
        and p.word_id = i.word_id;

      update public.learning_word_progress p
      set learned_at = coalesce(
            p.learned_at,
            greatest(p.spelling_exam_passed_at, p.pronunciation_exam_passed_at)
          ),
          updated_at = now()
      from public.learning_session_items i
      where i.session_id = new.id
        and p.user_id = new.user_id
        and p.word_id = i.word_id
        and p.spelling_exam_passed_at is not null
        and p.pronunciation_exam_passed_at is not null;
    end if;
  end if;
  return new;
end;
$$;

-- Reviews still persist distinct correct dates and review counts, complete
-- schedules, and refresh growth projections. They intentionally never write
-- learned_at.
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

-- Keep the single-RPC cold-start snapshot authoritative for both exam facts.
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
            'spelling_exam_passed_at', p.spelling_exam_passed_at,
            'pronunciation_exam_passed_at', p.pronunciation_exam_passed_at,
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

revoke execute on function public._learning_reset_exam_mastery_on_word_edit()
  from public, anon, authenticated;
revoke execute on function public._learning_apply_passed_exam_progress()
  from public, anon, authenticated;
revoke execute on function public._learning_advance_session(uuid)
  from public, anon, authenticated;
revoke execute on function public.learning_get_session_snapshot(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.learning_get_session_snapshot(uuid, uuid)
  to service_role;
