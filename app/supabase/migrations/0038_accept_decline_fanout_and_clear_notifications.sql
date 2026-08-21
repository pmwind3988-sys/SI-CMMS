-- ===========================================================================
-- SI — Service Inside · migration 0038
-- Accept and decline stop being silent, and a recipient may finally throw a
-- notification away.
--
-- Three unrelated-looking changes, one theme: an event that happened and left
-- no legible trace anywhere a human looks.
--
--   1. si_admins()                    — the fan-out target that did not exist
--   2. si_notify_work_order_update()  — accept and decline reach the ops chain
--   3. notifications_delete           — the recipient, not only an Admin
--
-- The fourth part of the same change is client-side and needs no migration:
-- StatusTimeline rendered `history.find(h => h.to_status === s)` against a
-- fixed ladder of statuses, so a decline — which is `assigned -> open` — landed
-- on the same rung as the work order's original `open` row and lost to it,
-- .find() returning the first match. The decline, its reason and every
-- re-assignment after it were in work_order_history all along and none of them
-- rendered. Same for `testing -> repairing` and `completed -> repairing`.
-- Nothing here fixes that; it is recorded so the two halves are findable
-- together.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. si_admins() — every active Administrator, system-wide.
--
-- Mirrors si_managers() (0003, replaced in 0020) exactly, including the
-- membership test over the `roles` array rather than a dropped `role` column.
-- SECURITY DEFINER because it reads users, which users_select hides from most
-- callers, and the fan-out has to reach accounts the actor cannot see.
--
-- It deliberately says `'admin' = any(roles)` rather than leaning on
-- si_is_admin()'s notion of admin: a Superuser IS role='admin' plus
-- is_protected (0015/0017), so a Superuser is included here — correctly, they
-- hold the role — and a protected account being invisible in Admin -> Users
-- does not stop it receiving its own notifications.
-- ---------------------------------------------------------------------------
create or replace function si_admins()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from users where 'admin' = any(roles) and status = 'active';
$$;

revoke all on function si_admins() from public, anon, authenticated;

comment on function si_admins() is
  'Every active account holding the admin role, Superuser included. Fan-out target for si_notify_work_order_update; not callable from a client.';

-- ---------------------------------------------------------------------------
-- 2. The fan-out.
--
-- Accept and decline previously told one side each: accept went to the
-- Requester only, decline to the department Supervisors only. 0003's own
-- comment excluded Manager and Admin from routine traffic on the grounds that
-- they watch the Dashboard instead. That holds for volume statistics and does
-- not hold for these two events, which are the moments a work order either
-- starts moving or comes back unstarted.
--
-- Who gets what, and the asymmetry is deliberate:
--
--   accept  -> Requester (unchanged wording) + Supervisors + Managers + Admins
--   decline -> Supervisors (unchanged) + Managers + Admins, and NOT the
--              Requester
--
-- The Requester is told when their job starts moving and is not told when it
-- bounces: a decline is an internal routing problem the ops chain fixes,
-- usually within minutes, and telling the person who raised the fault that
-- nobody has taken it yet invites a second work order for the same fault. The
-- decline stays fully visible to them on the work order's own timeline, which
-- is what the client half of this change makes true.
--
-- Two properties of the loops worth not undoing:
--
--   * They are deduplicated, by id. Since 0020 an account holds a SET of
--     roles, so a Supervisor+Manager appears in two of the three source sets
--     and the naive version writes two identical rows for one event.
--     `distinct on (id) ... order by id, rk desc` keeps one and stamps
--     recipient_role with the HIGHEST role held, matching the `user_role`
--     convention everywhere else in this schema (recipient_role is singular
--     and stays that way — it records a role in a moment, and a moment has
--     one).
--
--   * The actor is excluded. auth.uid() is readable here even though
--     si_decline_work_order is SECURITY DEFINER — that changes the database
--     role, not the JWT — and without the exclusion a Supervisor+Technician
--     accepting their own assignment is informed by the system that a
--     technician accepted it. On decline the actor cannot be identified any
--     other way: the BEFORE trigger b_stamp_work_order has already cleared
--     assigned_to_id by the time this AFTER trigger runs, which is the whole
--     reason 0037 exists.
--
-- The decline body now carries the reason. new.decline_reason is set in the
-- same UPDATE, and a Manager reading "needs reassignment" without it has to
-- open the work order to learn whether this is a spare-part problem or a
-- competence one.
--
-- Every other branch below is 0003's, byte for byte. They are restated because
-- `create or replace function` has no way to amend one branch of a body.
-- ---------------------------------------------------------------------------
create or replace function si_notify_work_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
  if new.status = old.status then return null; end if;

  if new.status = 'assigned' and new.assigned_to_id is not null then
    perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
      'assigned', 'You''ve been assigned a work order',
      v_ref || ' — ' || v_asset);
  end if;

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
        v_who || ' has accepted ' || v_ref || ' and will be on their way shortly.');
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

  if old.status = 'on_the_way' and new.status = 'on_site' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'status_change', 'Technician has arrived',
      coalesce(new.assigned_to_name, 'A technician') || ' is now on site for ' || v_ref || '.');
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
$$;

-- Re-issued because a `create or replace` resets options an earlier `alter` or
-- `revoke` set — the trap 0034's header records. 0007 line 38 is the original.
revoke all on function si_notify_work_order_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. A recipient may delete their own notifications.
--
-- notifications_delete has been `si_is_admin()` since 0002, whose header calls
-- that policy "manual correction only". The consequence is written up in
-- DATA_AND_STORAGE.md as a thing that grows unbounded: the table has no
-- retention, no cron sweep, and no client of any role but Admin could remove a
-- row. A pane that only ever accumulates is one people stop reading.
--
-- Hard delete rather than an `is_cleared` column. That is what was asked for
-- and it is also the only version that reclaims anything: a flag would add a
-- column to every row of the fastest-growing table in the schema in order to
-- hide rows that are already hidden.
--
-- Nothing else moves. si_guard_notification_update is BEFORE UPDATE, so it has
-- no opinion on a DELETE and needs none — there is no column to protect on a
-- row that is going away, and the USING clause below is the whole boundary.
-- Worth contrasting with 0030's users_delete, where hiding a row through the
-- SELECT policy did NOT stop a delete, because a DELETE policy's USING is
-- evaluated independently of it. Here that independence is exactly what is
-- wanted, so the predicate is stated in full rather than inherited.
--
-- Deleting a notification destroys no audit trail: work_order_history is the
-- record of what happened and a notification is only ever a copy of it
-- addressed to somebody. That is why this is allowed where deleting a `users`
-- row that has history is refused outright (0030).
-- ---------------------------------------------------------------------------
drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications for delete to authenticated
  using (recipient_id = auth.uid() or si_is_admin());
