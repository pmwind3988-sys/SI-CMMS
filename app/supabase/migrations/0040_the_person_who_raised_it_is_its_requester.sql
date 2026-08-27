-- ===========================================================================
-- 0040 — Whoever raised a work order is its requester, whatever roles they hold
--
-- "Requester" has been read two different ways in this schema, and only one of
-- them is right.
--
--   * As an ACCOUNT PROPERTY — does this person carry the `requester` role.
--     This is what si_eligible_roles() and work_orders_select test today.
--   * As a FACT ABOUT THIS ROW — did this person raise THIS work order. This is
--     what `work_orders.requester_id` records, and it is the one every rule
--     about verifying, reopening and editing actually means.
--
-- Since 0020 an account holds a SET of roles, and most accounts that are not
-- ordinary staff do not carry `requester` at all. So an Administrator, a
-- Manager, a Supervisor or a Technician who reports a fault is not treated as
-- its requester by anything, and the consequences run from cosmetic to severe:
--
--   * Measured before this migration, each account closing its own completed
--     work order: admin ALLOWED, manager ALLOWED, requester ALLOWED,
--     supervisor REFUSED ('a supervisor may not perform "Verify and close"'),
--     technician REFUSED (could not see the row at all).
--   * A technician-only account cannot SEE a work order it raised itself unless
--     it also happens to be assigned to it. It vanishes the moment it is
--     submitted.
--   * Admin and Manager were allowed only incidentally — they qualify as
--     `admin`/`manager`, which is the override path. So the app offered them
--     "Force verify & close" on their own work order, and stamped the history
--     'Force-verified — requester unresponsive' about somebody who was standing
--     right there. FSD Section 4 rule 5 gives the requester the closing say;
--     that is not the same act as an HOD overriding an unresponsive one, and
--     recording one as the other corrupts the audit trail.
--
-- The fix is not to add roles to wo_status_transitions. Putting `supervisor`
-- in the `completed -> closed` row would let ANY supervisor close ANYONE's work
-- order, which deletes the requester's closing say — the opposite of the
-- intent. The rule wanted is about the row, so the ownership test is where it
-- belongs.
--
-- Nothing here widens anything by role. Every branch added is
-- `requester_id = auth.uid()`: strictly your own work orders, and only the three
-- transitions that already name `requester` (verify and close, reopen, edit
-- while open). No other transition is reachable this way.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Eligibility: being the requester of a row qualifies you as its requester.
--
-- 0020's version iterates the caller's roles and keeps those the transition
-- permits, applying an ownership test to `technician` and `requester`. That
-- cannot ever yield `requester` for an account which does not hold the role, no
-- matter who raised the work order.
--
-- The union below adds exactly one case: the transition permits `requester`,
-- and you are the one who raised this work order.
--
-- `technician` deliberately gets no matching clause. Migration 0023 requires an
-- assignee to be a technician, so "the assignee without the technician role"
-- cannot occur, and inventing a path for it would be widening on speculation.
--
-- Consequence worth stating, because it is visible in the audit trail: a
-- Supervisor closing a work order they raised is stamped actor_role
-- 'requester'. That is correct and is the point — work_order_history records
-- the role a move was AUTHORISED under, not the account's seniority.
-- ---------------------------------------------------------------------------
create or replace function si_eligible_roles(
  p_transition_roles si_role[],
  p_assigned_to      uuid,
  p_requester        uuid
)
returns si_role[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct r), '{}'::si_role[])
    from (
      select r
        from unnest(si_roles()) r
       where r = any(p_transition_roles)
         and (r <> 'technician' or p_assigned_to is not distinct from auth.uid())
         and (r <> 'requester'  or p_requester   is not distinct from auth.uid())

      union all

      -- The row's own requester, whatever their account carries.
      select 'requester'::si_role
       where 'requester' = any(p_transition_roles)
         and p_requester is not distinct from auth.uid()
    ) t;
$$;

revoke all on function si_eligible_roles(si_role[], uuid, uuid) from public, anon;
grant execute on function si_eligible_roles(si_role[], uuid, uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- 2. You can always see a work order you raised.
--
-- Without this, part 1 is unreachable for a Technician: the SELECT policy hides
-- the row, and Postgres applies the SELECT policy to an UPDATE's rows, so the
-- transition is refused before the guard is ever consulted. That is the same
-- interaction migration 0037 documents from the other direction.
--
-- This adds rows and removes none. `requester_id = auth.uid()` is your own work
-- and nobody else's, so no account can see anything through this that it could
-- not already have raised itself.
-- ---------------------------------------------------------------------------
drop policy if exists work_orders_select on work_orders;
create policy work_orders_select on work_orders
  for select to authenticated
  using (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or (si_is_technician() and assigned_to_id = auth.uid())
    -- Was `si_is_requester() and requester_id = auth.uid()`. The role test is
    -- dropped: raising a work order is an act, not a job title.
    or requester_id = auth.uid()
  );


-- ---------------------------------------------------------------------------
-- 3. The two places that restate that predicate, moved with it.
--
-- 0018's work_orders_delete deliberately restates work_orders_select so that
-- granting deletion never widens SCOPE, and si_decline_work_order (0037)
-- restates it because RLS does not apply inside a SECURITY DEFINER body. Both
-- headers say in as many words that they have to change when the policy
-- changes. Leaving either behind would mean the loosest path no longer agrees
-- with the boundary — the failure this schema keeps warning about.
-- ---------------------------------------------------------------------------
drop policy if exists work_orders_delete on work_orders;
create policy work_orders_delete on work_orders
  for delete to authenticated
  using (
    si_can_delete_work_orders()
    and (
      si_is_admin()
      or si_is_manager()
      or si_is_supervisor()
      or (si_is_technician() and assigned_to_id = auth.uid())
      or requester_id = auth.uid()
    )
  );

-- si_decline_work_order (0037) carries the same copy inside its body. Restated
-- in full because `create or replace` cannot amend one branch; every other line
-- is 0037's, unchanged.
create or replace function si_decline_work_order(p_wo_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
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
  -- do. 0040 is that happening: the requester branch lost its role test.
  if not (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or (si_is_technician() and v_assigned_to = auth.uid())
    or v_requester = auth.uid()
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
$$;

-- Re-issued: a `create or replace` resets options an earlier revoke set.
revoke all on function si_decline_work_order(uuid, text) from public, anon;
grant execute on function si_decline_work_order(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. And work_orders_update, which is the one that actually decides.
--
-- Found by measurement rather than by reading, which is the point of this
-- block existing. After parts 1-3 a Technician closing their own work order was
-- still refused, now with 'You do not have permission to change this work
-- order.' — si_transition_work_order is SECURITY INVOKER, its UPDATE was
-- filtered to zero rows by RLS, and that message is how it reports it.
--
-- So the predicate lives in FIVE places on this table, not three:
-- work_orders_select, work_orders_update, work_orders_delete,
-- si_decline_work_order, and (as a bare ownership test already)
-- work_orders_insert. The loosest path wins and the tightest path blocks; a
-- change has to walk all of them.
--
-- WITH CHECK is left alone deliberately. It is a bare role list with no
-- ownership test — the row-level rules are enforced by the USING clause above
-- and by a_guard_work_order_transition, and adding an ownership test to the NEW
-- row would break `decline`, which deliberately ends outside the caller's own
-- scope (0037).
-- ---------------------------------------------------------------------------
drop policy if exists work_orders_update on work_orders;
create policy work_orders_update on work_orders
  for update to authenticated
  using (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or (si_is_technician() and assigned_to_id = auth.uid())
    or requester_id = auth.uid()
  )
  with check (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or si_is_technician()
    or si_is_requester()
  );
