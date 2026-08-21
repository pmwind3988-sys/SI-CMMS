-- ===========================================================================
-- SI — Service Inside · migration 0037
-- A technician can decline again — and the reason it broke is worth reading,
-- because it is a property of UPDATE under RLS rather than a mistake in any
-- policy in this directory.
--
-- Symptom, measured on the test project as tech.arun@example.com holding
-- WO-2026-000003 assigned to them:
--
--   rpc si_transition_work_order(assigned -> open, {decline_reason})
--     -> 42501  new row violates row-level security policy for table "work_orders"
--
-- which describeError() correctly refuses to show verbatim and replaces with
-- "You don't have permission to do that." Accept (assigned -> accepted)
-- succeeded from the same session seconds earlier, which is what localises it.
--
-- WHY. Both policies are exactly what 0019 says they are — checked against
-- pg_policies on the live project, there is no drift here:
--
--   work_orders_update  WITH CHECK  si_is_admin() or ... or si_is_technician()
--   work_orders_select  USING       ... or (si_is_technician()
--                                          and assigned_to_id = auth.uid())
--
-- The UPDATE's own WITH CHECK passes. The one that fails is **the SELECT
-- policy, applied to the NEW row**: an UPDATE has to read the table, so
-- Postgres adds the SELECT policy's USING clause as a check on the row the
-- statement produces. And a decline is implemented by si_stamp_work_order
-- (0003) as
--
--     new.assigned_to_id := null;  new.assigned_to_name := null;
--
-- so the technician branch of that predicate compares NULL to auth.uid() and
-- the technician is refused sight of the row they have just let go of. Every
-- other transition a technician makes keeps them on the row, which is why
-- decline is the only one that fails.
--
-- Proven rather than reasoned: inside a transaction that was rolled back,
-- `alter policy work_orders_select ... using (true)` and nothing else made the
-- identical statement succeed. It is not the RETURNING clause either — the bare
-- `update work_orders set status='open', decline_reason='p'` fails the same way.
--
-- WHAT IS NOT THE FIX.
--
--  * Widening work_orders_select (e.g. letting a technician see every
--    unassigned open work order) would change what the queue shows everyone,
--    to repair one write. The policy is right: once declined, that work order
--    is not this technician's business.
--  * Keeping the assignee on the row would leave a declined job still showing
--    the person who refused it, and the Supervisor's whole reason for being
--    notified is that it now has nobody.
--  * Making si_transition_work_order SECURITY DEFINER would fix decline by
--    removing RLS from all twenty-two transitions. Its invoker rights are the
--    boundary; see 0020's comment on it.
--
-- THE FIX is one narrow SECURITY DEFINER path for the one transition that
-- deliberately ends outside the caller's own scope. RLS is bypassed there, so
-- the visibility half is restated in the body — that is the price of the
-- bypass, and it is why this is a dedicated function for one move rather than a
-- general-purpose door.
--
-- What still enforces everything else, unchanged: a_guard_work_order_transition
-- fires on this UPDATE like any other, so the matrix row
-- ('assigned','open','{technician,manager,admin}','{decline_reason}') is what
-- decides who may decline. A trigger reads auth.uid() and the JWT, not the
-- database role, so SECURITY DEFINER does not blind it: a technician who is
-- *not* the assignee is still refused by si_eligible_roles, and a Requester or
-- Supervisor still cannot decline at all. Both measured, the same way the bug
-- was.
-- ===========================================================================

create or replace function si_decline_work_order(p_wo_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_from        si_wo_status;
  v_assigned_to uuid;
  v_requester   uuid;
  v_actor_name  text;
  v_actor_role  si_role;
  v_trans_roles si_role[];
begin
  -- The matrix already lists decline_reason as required and the trigger raises
  -- on it. Checked here too because a blank string satisfies that check, and a
  -- decline whose reason reads nothing is what the Supervisor has to act on.
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required to decline a work order.'
      using errcode = 'not_null_violation';
  end if;

  select status, assigned_to_id, requester_id
    into v_from, v_assigned_to, v_requester
    from work_orders where id = p_wo_id;
  if not found then
    raise exception 'Work order not found.' using errcode = 'no_data_found';
  end if;

  select name into v_actor_name from users where id = auth.uid();
  if v_actor_name is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- work_orders_select, restated. RLS does not apply to the UPDATE below, so
  -- without this the function would let anyone signed in reach any work order
  -- and leave the trigger as the only boundary. Deliberately a copy of the
  -- policy rather than a looser summary of it: if that predicate changes, this
  -- has to change with it, exactly as the three enforcement points on `users`
  -- do.
  if not (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or (si_is_technician() and v_assigned_to = auth.uid())
    or (si_is_requester()  and v_requester  = auth.uid())
  ) then
    raise exception 'You do not have permission to change this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  -- The role stamped on the history row is the role the move was authorised
  -- under, not the account's highest — same as si_transition_work_order (0020).
  select roles into v_trans_roles
    from wo_status_transitions
   where from_status = v_from and to_status = 'open';

  v_actor_role := (
    select r
      from unnest(si_eligible_roles(coalesce(v_trans_roles, '{}'::si_role[]),
                                    v_assigned_to, v_requester)) r
     order by si_role_rank(r::text) desc
     limit 1
  );
  if v_actor_role is null then
    v_actor_role := nullif(si_role(), '')::si_role;
  end if;

  -- a_guard_work_order_transition runs on this statement and is what refuses a
  -- non-assignee technician, a requester, a supervisor, and any from_status
  -- other than 'assigned'. b_stamp_work_order clears the assignee and
  -- increments decline_count.
  update work_orders
     set status = 'open', decline_reason = p_reason
   where id = p_wo_id;

  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
  values
    (p_wo_id, v_from, 'open', auth.uid(), v_actor_name, v_actor_role,
     'Declined: ' || p_reason);
end
$fn$;

revoke all on function si_decline_work_order(uuid, text) from public, anon;
grant execute on function si_decline_work_order(uuid, text) to authenticated;

comment on function si_decline_work_order(uuid, text) is
  'Decline an assigned work order: status back to open, assignee cleared by the stamp trigger, one history row. SECURITY DEFINER because the row it produces is deliberately outside the declining technician own SELECT scope, and Postgres applies the SELECT policy to an UPDATE new row — so the invoker-rights path cannot complete this one transition. The transition matrix still decides who may call it; visibility is re-checked in the body.';
