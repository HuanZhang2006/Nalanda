-- Nalanda · 0009 reset untrusted pre-ledger points
--
-- Purpose: implement the 2026-07-21 product/security decision that all points
-- imported by 0008 as legacy_opening are untrusted and must start from zero.
-- Dependency: 20260710000008_security_points_ledger.sql.
-- Lock/runtime: inserts one append-only reversal per non-zero legacy opening and
-- updates only the affected profiles; current production audit found one row.
-- Rollback: do not delete ledger rows. Any correction must be a new reviewed
-- forward migration with an explicit adjustment entry.

insert into public.point_entries (
  user_id,
  event_type,
  business_key,
  amount,
  rule_version,
  transition_no,
  reversal_of,
  metadata
)
select e.user_id,
       'legacy_opening_reset',
       'legacy-opening-reset:' || e.user_id::text || ':20260721',
       -e.amount,
       'legacy-reset-v1',
       0,
       e.id,
       jsonb_build_object(
         'decision_date', '2026-07-21',
         'reason', 'pre-ledger points were not backed by trustworthy event history',
         'reverses_business_key', e.business_key
       )
from public.point_entries e
where e.event_type = 'legacy_opening'
  and e.rule_version = 'legacy-import-v1'
  and e.metadata ->> 'migration' = '20260710000008'
on conflict (business_key, transition_no) do nothing;

-- Rebuild the Profile projection from the complete ledger. Events created after
-- 0008 remain intact; only legacy_opening is offset by the append-only reversal.
with affected as (
  select distinct e.user_id
  from public.point_entries e
  where e.event_type = 'legacy_opening_reset'
    and e.rule_version = 'legacy-reset-v1'
), balances as (
  select a.user_id,
         greatest(
           0::bigint,
           least(2147483647::bigint, coalesce(sum(e.amount), 0::bigint))
         )::integer as points
  from affected a
  left join public.point_entries e on e.user_id = a.user_id
  group by a.user_id
), derived as (
  select b.user_id,
         b.points,
         case
           when b.points >= 1200 then 6
           when b.points >= 700 then 5
           when b.points >= 350 then 4
           when b.points >= 150 then 3
           when b.points >= 50 then 2
           else 1
         end as level
  from balances b
)
update public.profiles p
set points = d.points,
    level = d.level,
    level_name = case d.level
      when 6 then 'Luminary'
      when 5 then 'Sage'
      when 4 then 'Mentor'
      when 3 then 'Scholar'
      when 2 then 'Learner'
      else 'Novice'
    end
from derived d
where p.id = d.user_id;

-- Fail the migration if any imported opening was not offset exactly once.
do $$
begin
  if exists (
    select opening.user_id
    from public.point_entries opening
    left join public.point_entries reset
      on reset.reversal_of = opening.id
     and reset.event_type = 'legacy_opening_reset'
     and reset.rule_version = 'legacy-reset-v1'
    where opening.event_type = 'legacy_opening'
      and opening.rule_version = 'legacy-import-v1'
      and opening.metadata ->> 'migration' = '20260710000008'
    group by opening.user_id
    having coalesce(sum(opening.amount), 0) + coalesce(sum(reset.amount), 0) <> 0
  ) then
    raise exception 'legacy opening reset did not balance to zero'
      using errcode = '23514';
  end if;
end;
$$;

-- Validation after release:
-- select event_type, sum(amount), count(*) from public.point_entries
-- where event_type in ('legacy_opening', 'legacy_opening_reset') group by 1;
-- select id, points, level, level_name from public.profiles;
