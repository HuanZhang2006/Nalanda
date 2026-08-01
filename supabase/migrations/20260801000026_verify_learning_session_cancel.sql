-- Purpose: fail the release if cancellation ownership, revision or RPC grants drift.
-- Update this verification only through a later forward migration.

do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.learning_cancel_session(uuid,uuid)') is null then
    raise exception 'learning session cancellation RPC is missing';
  end if;

  select lower(pg_get_functiondef(
    'public.learning_cancel_session(uuid,uuid)'::regprocedure
  )) into v_definition;

  if position('security definer' in v_definition) = 0
     or position('s.user_id = p_user_id' in v_definition) = 0
     or position('for update' in v_definition) = 0
     or position('active = false' in v_definition) = 0
     or position('revision = revision + 1' in v_definition) = 0 then
    raise exception 'learning session cancellation RPC lost its ownership or concurrency boundary';
  end if;

  if has_function_privilege(
       'anon',
       'public.learning_cancel_session(uuid,uuid)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.learning_cancel_session(uuid,uuid)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'service_role',
       'public.learning_cancel_session(uuid,uuid)',
       'EXECUTE'
     ) then
    raise exception 'learning session cancellation RPC privileges are unsafe' using errcode = '42501';
  end if;
end;
$$;
