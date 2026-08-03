-- Purpose: make learned_at a database-derived projection instead of a value
-- that any current or future workflow can assign independently. A word is
-- learned if and only if both owner-scoped exam pass facts exist. Update this
-- product rule only through a later forward migration.

update public.learning_word_progress
set learned_at = case
      when spelling_exam_passed_at is not null
       and pronunciation_exam_passed_at is not null
        then greatest(spelling_exam_passed_at, pronunciation_exam_passed_at)
      else null
    end,
    updated_at = now()
where learned_at is distinct from case
  when spelling_exam_passed_at is not null
   and pronunciation_exam_passed_at is not null
    then greatest(spelling_exam_passed_at, pronunciation_exam_passed_at)
  else null
end;

alter table public.learning_word_progress
  drop constraint learning_word_progress_exam_only_mastery;

alter table public.learning_word_progress
  add constraint learning_word_progress_exam_only_mastery
  check (
    learned_at is not distinct from case
      when spelling_exam_passed_at is not null
       and pronunciation_exam_passed_at is not null
        then greatest(spelling_exam_passed_at, pronunciation_exam_passed_at)
      else null
    end
  );

create or replace function public._learning_project_exam_only_mastery()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.learned_at := case
    when new.spelling_exam_passed_at is not null
     and new.pronunciation_exam_passed_at is not null
      then greatest(
        new.spelling_exam_passed_at,
        new.pronunciation_exam_passed_at
      )
    else null
  end;
  return new;
end;
$$;

drop trigger if exists learning_word_exam_only_mastery_projection
  on public.learning_word_progress;
create trigger learning_word_exam_only_mastery_projection
before insert or update of
  spelling_exam_passed_at,
  pronunciation_exam_passed_at,
  learned_at
on public.learning_word_progress
for each row execute function public._learning_project_exam_only_mastery();

revoke all on function public._learning_project_exam_only_mastery()
  from public, anon, authenticated;
grant execute on function public._learning_project_exam_only_mastery()
  to service_role;

comment on column public.learning_word_progress.learned_at is
  'Derived mastery timestamp: greatest(spelling_exam_passed_at, pronunciation_exam_passed_at) when both exam facts exist; otherwise null.';

