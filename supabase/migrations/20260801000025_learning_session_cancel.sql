-- Nalanda · explicitly cancel an in-progress learning session
--
-- Cancellation is a state transition, not deletion: confirmed attempts,
-- projections and mastery history remain intact. The revision increment makes
-- any browser answer based on the former active state stale.

create or replace function public.learning_cancel_session(
  p_user_id uuid,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session public.learning_sessions%rowtype;
  v_cancelled boolean := false;
begin
  if p_user_id is null or p_session_id is null then
    raise exception 'user id and learning session id are required' using errcode = '22023';
  end if;

  select s.*
    into v_session
  from public.learning_sessions s
  where s.id = p_session_id
    and s.user_id = p_user_id
  for update;

  if not found then
    raise exception 'learning session not found' using errcode = 'P0002';
  end if;

  if v_session.active then
    update public.learning_sessions
    set active = false,
        revision = revision + 1,
        last_activity_at = now()
    where id = p_session_id
      and user_id = p_user_id
    returning * into v_session;
    v_cancelled := true;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'active', false,
    'revision', v_session.revision,
    'cancelled', v_cancelled
  );
end;
$$;

revoke execute on function public.learning_cancel_session(uuid, uuid)
from public, anon, authenticated;
grant execute on function public.learning_cancel_session(uuid, uuid)
to service_role;
