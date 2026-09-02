-- ============================================================================
-- SI — Service Inside · 0052 A handover tells the technician it happened
-- ============================================================================
-- **Only the FIRST assignment ever notified the technician. Every reassignment
-- notified nobody** — not at `assigned`, not at `accepted`, not mid-repair. The
-- new technician silently owned a job they had never been told about, and the
-- only way to find out was to open the app and look.
--
-- Not a missing feature — a consequence of two correct decisions meeting.
-- `si_notify_work_order_update` opens with
-- `if new.status = old.status then return null`, which is the same early return
-- that makes 0051's priority re-grade keep quiet about phases it did not move.
-- And a reassignment does not move the status: FSD Business Rule 6 says one at
-- `accepted` or later preserves it exactly, because ownership changing must not
-- restart the flow, while a pre-acceptance one re-enters `assigned` from
-- `assigned`. Either way `new.status = old.status`, the function returned before
-- reaching its own assignment branch, and the transition whose entire purpose is
-- to change who owns the work order was the one transition that announced
-- nothing.
--
-- Measured on the live test project before this migration, handing a work order
-- from one technician to another: **zero** notification rows written for the new
-- assignee at `assigned`, at `accepted` and at `repairing`. The first assignment
-- (open -> assigned) did notify, which is why this went unnoticed — the path
-- everybody exercises daily is the one path that worked.
--
-- ---------------------------------------------------------------------------
-- The fix is where the test is, not what the test is
-- ---------------------------------------------------------------------------
-- The notification moves ABOVE the status guard and keys on
-- `new.assigned_to_id is distinct from old.assigned_to_id` instead of on
-- `new.status = 'assigned'`. That is strictly more accurate in both directions:
--
--   * It fires for a status-preserving handover, which is the bug.
--   * It stops firing when the status becomes 'assigned' with the SAME assignee
--     — reachable, because `wo_status_transitions`' pre-acceptance
--     `assigned -> assigned` row does not require the assignee to change. That
--     used to re-notify a technician about a job they already held.
--
-- Widening the guard to `new.status = old.status and assignee unchanged` was the
-- alternative and is worse: it would let every other branch below run on an
-- UPDATE that moved no status, so a priority re-grade would start emitting
-- accept and decline notifications. The early return is load-bearing for
-- everything after it; only this one branch belongs in front of it.
--
-- **Two wordings, because a handover is not an assignment.** A first assignment
-- has an Accept step waiting for the technician. A handover at `repairing` does
-- not — the work is already under way and there is nothing to accept — so
-- telling them to accept it would send them looking for a button the workflow
-- will not offer. The status label is read from `wo_statuses` rather than
-- printing the raw enum, so it says "Repairing" and follows a relabelling.
--
-- `is distinct from` rather than `<>`: the first assignment moves the column
-- from NULL, and `null <> 'uuid'` is NULL, which is not true.
--
-- Nobody can be handed a work order by themselves —
-- si_guard_work_order_transition refuses self-assignment above the admin
-- bypass — so there is no actor to exclude here, unlike 0038's fan-outs.
--
-- A decline sets `assigned_to_id` to NULL, which the `is not null` test skips;
-- decline keeps its own branch below.
--
-- Nothing else in the function changes. It is 0039's body with that one block
-- moved and rewritten, and its grants are re-issued afterwards because a
-- `create or replace` resets what an earlier grant set.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.si_notify_work_order_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_supervisor uuid;
  v_recipient  uuid;
  v_role       si_role;
  v_seen       uuid[];
  v_asset text := coalesce(new.asset_name, 'equipment');
  v_ref   text := coalesce(new.wo_number, 'This work order');
  v_who   text;
  v_why   text;
begin
  /* ABOVE the status guard, and keyed on the ASSIGNEE changing rather than on
     the status becoming 'assigned' — see the header. A handover at `accepted`
     or later deliberately preserves the status, so the guard below returns
     before this ever ran and the new technician was told nothing. */
  if new.assigned_to_id is distinct from old.assigned_to_id
     and new.assigned_to_id is not null then
    if new.status = 'assigned' then
      perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
        'assigned', 'You''ve been assigned a work order',
        v_ref || ' — ' || v_asset);
    else
      /* Already under way: there is no Accept step waiting for them, so the
         wording must not ask for one. */
      perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
        'assigned', 'A work order has been handed to you',
        v_ref || ' — ' || v_asset || ' · already in progress ('
          || coalesce((select label from wo_statuses where code = new.status), new.status::text)
          || '), no need to accept.');
    end if;
  end if;

  if new.status = old.status then return null; end if;

  if old.status = 'assigned' and new.status = 'open' then
    v_why  := nullif(btrim(coalesce(new.decline_reason, '')), '');
    v_seen := array[auth.uid()];
    for v_recipient, v_role in
      select distinct on (t.id) t.id, t.r
        from (
          select s, 'supervisor'::si_role, 3 from si_department_supervisors(new.department_id) s
          union all
          select m, 'manager'::si_role,    4 from si_managers() m
          union all
          select a, 'admin'::si_role,      5 from si_admins()   a
        ) as t(id, r, rk)
       where t.id is not null
         and t.id <> all (v_seen)
       order by t.id, t.rk desc
    loop
      perform si_notify(v_recipient, v_role, new.id, new.wo_number,
        'declined', 'Technician declined — needs reassignment',
        v_ref || ' — ' || v_asset || coalesce(' · ' || v_why, ''));
    end loop;
  end if;

  if old.status = 'assigned' and new.status = 'accepted' then
    v_who  := coalesce(new.assigned_to_name, 'A technician');
    v_seen := array[auth.uid()];

    -- The Requester's wording is unchanged from 0003 and is deliberately
    -- warmer than the ops chain's: it is the one of the two written for
    -- somebody waiting on the repair rather than managing it.
    if new.requester_id is not null and new.requester_id <> all (v_seen) then
      perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
        'status_change', 'Technician accepted your work order',
        v_who || ' has accepted ' || v_ref || ' and will start shortly.');
      v_seen := v_seen || new.requester_id;
    end if;

    for v_recipient, v_role in
      select distinct on (t.id) t.id, t.r
        from (
          select s, 'supervisor'::si_role, 3 from si_department_supervisors(new.department_id) s
          union all
          select m, 'manager'::si_role,    4 from si_managers() m
          union all
          select a, 'admin'::si_role,      5 from si_admins()   a
        ) as t(id, r, rk)
       where t.id is not null
         and t.id <> all (v_seen)
       order by t.id, t.rk desc
    loop
      perform si_notify(v_recipient, v_role, new.id, new.wo_number,
        'accepted', 'Technician accepted a work order',
        v_who || ' has accepted ' || v_ref || ' — ' || v_asset || '.');
    end loop;
  end if;

  -- Replaces 0038's `on_the_way -> on_site` branch. Requester only, matching
  -- what that branch did: the ops chain already heard about this work order at
  -- accept, and hearing again a minute later when the same technician starts is
  -- noise on a table that has no retention.
  if old.status = 'accepted' and new.status = 'repairing' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'status_change', 'Technician has started work',
      coalesce(new.assigned_to_name, 'A technician') || ' has started work on ' || v_ref || '.');
  end if;

  if new.status = 'completed' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'completed', 'Your work order was completed — please verify',
      v_ref || ' — ' || v_asset);
  end if;

  -- Reopening is operationally significant enough that the department's
  -- Supervisor should know too, not just the technician doing the work. Unlike
  -- Decline, this is not asking them to act, only to be aware.
  if old.status = 'completed' and new.status = 'repairing' then
    if new.assigned_to_id is not null then
      perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
        'reopened', 'Work order reopened by requester',
        v_ref || ' — ' || v_asset);
    end if;
    for v_supervisor in select si_department_supervisors(new.department_id) loop
      perform si_notify(v_supervisor, 'supervisor', new.id, new.wo_number,
        'reopened', 'Work order reopened by requester',
        v_ref || ' — ' || v_asset || ' was not fixed and has been reopened.');
    end loop;
  end if;

  return null;
end;
$function$;

revoke all on function si_notify_work_order_update() from public, anon, authenticated;
