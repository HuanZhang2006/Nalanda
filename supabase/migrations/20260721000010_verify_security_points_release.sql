-- Nalanda · 0010 post-release assertions for the security/points cutover
--
-- Purpose: fail the first production release unless the 0008 security boundary,
-- 0009 legacy-points reset, and Profile ledger projection are all consistent.
-- Dependency: 20260710000008 and 20260721000009.
-- Lock/runtime: read-only catalog and ledger assertions; no application rows are
-- changed. Rollback is unnecessary because this migration contains no writes.

do $$
begin
  if has_table_privilege('authenticated', 'public.profiles', 'UPDATE') then
    raise exception 'authenticated still has whole-table profiles UPDATE'
      using errcode = '42501';
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'points', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'credits', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'level', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'level_name', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'vip_until', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'streak', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'streak_date', 'UPDATE') then
    raise exception 'authenticated can update a server-managed profile column'
      using errcode = '42501';
  end if;

  if has_function_privilege('anon', 'public._add_points(uuid,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._add_points(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public._notify(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public._notify(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'internal points/notification helper is still client-executable'
      using errcode = '42501';
  end if;

  if exists (
    select opening.id
    from public.point_entries opening
    left join public.point_entries reset
      on reset.reversal_of = opening.id
     and reset.event_type = 'legacy_opening_reset'
     and reset.rule_version = 'legacy-reset-v1'
    where opening.event_type = 'legacy_opening'
      and opening.rule_version = 'legacy-import-v1'
      and opening.metadata ->> 'migration' = '20260710000008'
    group by opening.id, opening.amount
    having count(reset.id) <> 1
       or coalesce(sum(reset.amount), 0) <> -opening.amount
  ) then
    raise exception 'legacy opening is not paired with exactly one equal reversal'
      using errcode = '23514';
  end if;

  if exists (
    with balances as (
      select p.id,
             greatest(
               0::bigint,
               least(2147483647::bigint, coalesce(sum(e.amount), 0::bigint))
             )::integer as points
      from public.profiles p
      left join public.point_entries e on e.user_id = p.id
      group by p.id
    ), expected as (
      select b.id,
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
    select 1
    from public.profiles p
    join expected e on e.id = p.id
    where row(p.points, p.level, p.level_name) is distinct from row(
      e.points,
      e.level,
      case e.level
        when 6 then 'Luminary'
        when 5 then 'Sage'
        when 4 then 'Mentor'
        when 3 then 'Scholar'
        when 2 then 'Learner'
        else 'Novice'
      end
    )
  ) then
    raise exception 'Profile points/level projection differs from the ledger'
      using errcode = '23514';
  end if;
end;
$$;

-- Validation after release:
-- select version from supabase_migrations.schema_migrations order by version;
-- select event_type, sum(amount), count(*) from public.point_entries
-- where event_type in ('legacy_opening', 'legacy_opening_reset') group by 1;
