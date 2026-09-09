-- ---------------------------------------------------------------------------
-- 0061  Completing a work order closes it, and the sign-off sits on the
--       closed record
--
-- 0059 made `completed` the end of the flow and left `closed` unreachable.
-- That is coherent, and it reads wrong on the floor: "Completed" is what a
-- technician says about their own work, and everybody who has used this module
-- reads "Closed" as the word for a job that is over. So the last move is put
-- back and made automatic — marking a repair completed closes the work order in
-- the same transaction, with both steps on the timeline.
--
-- WHAT THIS IS NOT: it is not 0058's requester verification coming back. Nobody
-- is asked to do anything at closure; it happens by itself. The HOD sign-off is
-- unchanged in substance and moves with the record: still a stamp (verified_by
-- / verified_at), still HOD-only, still invisible to everyone else, and still
-- the thing that makes a work order count in the dashboard. It now applies to a
-- `closed` work order rather than a `completed` one, because there are no
-- `completed` ones left to apply it to.
--
-- Consequences, all deliberate:
--
--   * `closed` no longer means "verified". It means "the repair is finished".
--     THIS IS THE ONE LOAD-BEARING CHANGE IN THIS FILE, and it is section 3
--     rather than a footnote: si_stamp_work_order has stamped
--     `verified_at := coalesce(new.verified_at, now())` on every closure since
--     0001, back when closing WAS verifying. Left in place, auto-closing would
--     stamp verified_at on every work order the instant it was completed, the
--     sign-off queue would be permanently empty, si_verify_work_order would
--     refuse every call with "already been verified", and the dashboard would
--     count everything as signed off. The whole feature would be gone and
--     nothing anywhere would raise.
--
--   * Work orders closed BEFORE this keep the verified_at that line gave them.
--     That is what 0059's dashboards read, and why they have no hole at today's
--     date; those rows were verified under the rules of their day.
--
--   * The rework path moves with the status: `closed -> repairing` for
--     {hod,manager,admin}, and `completed -> repairing` is KEPT — see section 2.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Closed is a rung again
--
-- 0060 retired both `verified` and `closed`, on the correct reading of 0059:
-- nothing reached either, so the ladder drew two rungs that read "Pending" for
-- ever, under a work order the panel above already called finished. `closed` is
-- reachable again and comes back.
--
-- `verified` stays retired, and that is not an oversight. It has never been a
-- resting state — the FSD says so, and 0059 made verification a stamp — so a
-- rung for it would be exactly the bug 0060 fixed, on the one status that can
-- never hold a work order.
-- ---------------------------------------------------------------------------
update wo_statuses set is_active = true  where code = 'closed';
update wo_statuses set is_active = false where code = 'verified';


-- ---------------------------------------------------------------------------
-- 2. The matrix
--
-- `completed -> closed` comes back as an ordinary row, because the guard has to
-- find one: si_auto_close_completed below is SECURITY DEFINER, and that changes
-- the database role, not the JWT — a_guard_work_order_transition still reads
-- auth.uid() and still looks the pair up. 0037's header makes the same point
-- about si_decline_work_order. Making it a row keeps "the permitted moves are
-- data, not code" true, and keeps the answer to "who may close a work order" in
-- the table that answers that question for every other move.
--
-- Its roles are the roles that can REACH `completed` — {technician,manager,admin}
-- from `testing -> completed` — because whoever closes it is by definition
-- whoever just completed it. `requires` is empty: closure asks for nothing,
-- which is the whole point of making it automatic.
--
-- `closed -> closed` is the verification row, the same shape 0059 gave
-- `completed -> completed`, and `closed -> repairing` the rework row.
--
-- NOTHING IS DELETED HERE. The two `completed` rows stay, so a work order
-- stranded at `completed` — one mid-flight when this was applied, or one
-- reached by a path nobody has thought of yet — can still be verified and still
-- be sent back. A stranded record with no move available is the failure 0039
-- section 1.3 had to write a whole backfill to undo.
-- ---------------------------------------------------------------------------
insert into wo_status_transitions
  (from_status, to_status, roles, requires, requires_assignee_change, label)
values
  ('completed', 'closed',    '{technician,manager,admin}', '{}',              false, 'Close on completion'),
  ('closed',    'closed',    '{hod}',                      '{verified_by}',   false, 'Verify'),
  ('closed',    'repairing', '{hod,manager,admin}',        '{reopen_reason}', false, 'Send back for rework')
on conflict (from_status, to_status) do update
  set roles                    = excluded.roles,
      requires                 = excluded.requires,
      requires_assignee_change = excluded.requires_assignee_change,
      label                    = excluded.label;


-- ---------------------------------------------------------------------------
-- 3. Closing stops meaning verified
--
-- 0050's definition with one line removed: the `verified_at` stamp in the
-- `closed` branch. Everything else is byte-for-byte, including the sequential
-- SLA block and its position above the completed/closed stamps, which the 0050
-- header explains has to stay where it is.
--
-- `sla_breached` is still decided here, and now it is decided when the repair
-- finishes rather than whenever somebody got round to closing the record. That
-- is strictly more honest about the SLA than the old timing was.
-- ---------------------------------------------------------------------------
create or replace function si_stamp_work_order()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_ack  int;
  v_resp int;
  v_res  int;
  v_seq  boolean;
begin
  if new.status = old.status then return new; end if;

  -- Decline: assigned -> open with the assignee cleared.
  if old.status = 'assigned' and new.status = 'open' then
    new.decline_count := old.decline_count + 1;
    new.assigned_to_id := null;
    new.assigned_to_name := null;
  end if;

  -- First arrival only, never moved again.
  if new.status = 'assigned' then
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
  end if;

  if new.status = 'repairing' then
    new.responded_at := coalesce(new.responded_at, now());
  end if;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(new.priority);

  if v_seq then
    if new.acknowledged_at is not null and new.sla_response_due_at is null then
      new.sla_response_due_at := new.acknowledged_at + make_interval(mins => v_resp);
    end if;
    if new.responded_at is not null and new.sla_resolution_due_at is null then
      new.sla_resolution_due_at := new.responded_at + make_interval(mins => v_res);
    end if;
  end if;

  if new.status = 'completed' then
    new.resolved_at := now();
  end if;

  if new.status = 'closed' then
    new.closed_at := now();
    new.sla_breached := (new.sla_resolution_due_at is not null
                         and new.sla_resolution_due_at < now());
    -- NO verified_at HERE ANY MORE (0061). Closing is the technician finishing
    -- the job; verifying is a Head of Department saying they checked it. One
    -- line, and with it in place the sign-off queue is empty for ever.
  end if;

  return new;
end
$fn$;

-- Mirrors the grants the function already had: postgres and service_role only.
-- It is SECURITY INVOKER and fires as a trigger, so nothing else needs EXECUTE.
revoke all on function si_stamp_work_order() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. Completing closes it
--
-- AFTER UPDATE, and after si_notify_work_order_update — triggers fire in name
-- order and `after_work_order_update` sorts before `c_auto_close_on_completion`.
-- That ordering is deliberate: the completion notifications (the requester's
-- "your work order has been completed" and the HODs' "needs verifying") are
-- written first, against the status that earned them. When the closing UPDATE
-- runs the notify trigger again with `completed -> closed`, no branch matches —
-- 0059 deleted that fan-out along with the transition, and 0056's
-- verified_closed message with it — so closure is silent. It should be: nobody
-- did anything, and a notification reading "verified and closed" would now be
-- two lies in three words.
--
-- SECURITY DEFINER so the inner UPDATE is not re-checked against
-- work_orders_update, exactly as si_decline_work_order (0037) and
-- si_replace_attachment (0043) are. The transition matrix still governs it:
-- the guard reads the JWT, not the database role.
--
-- Recursion terminates on the status test rather than on a flag — the inner
-- UPDATE arrives here with new.status = 'closed', which does not match.
--
-- The history row is what puts Closed on the ladder, and it is a real
-- `transition` row because a real transition is what happened. The actor is
-- whoever completed the work order, which is true: they closed it, they simply
-- were not asked. `actor_id` is NOT NULL, so a completion with no signed-in
-- user (a script, a migration, pg_cron) closes the work order and writes no
-- history row rather than failing the whole statement.
-- ---------------------------------------------------------------------------
create or replace function si_auto_close_completed()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor_name text;
  v_actor_role si_role;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return null;
  end if;

  update work_orders set status = 'closed' where id = new.id;

  if auth.uid() is null then return null; end if;

  select u.name,
         (select r from unnest(u.roles) r
           order by si_role_rank(r::text) desc limit 1)
    into v_actor_name, v_actor_role
    from users u where u.id = auth.uid();

  insert into work_order_history
    (work_order_id, from_status, to_status, event_type,
     actor_id, actor_name, actor_role, remarks)
  values
    (new.id, 'completed', 'closed', 'transition',
     auth.uid(), coalesce(v_actor_name, 'Unknown'), v_actor_role,
     'Closed automatically when the repair was marked completed.');

  return null;
end
$fn$;

revoke all on function si_auto_close_completed() from public, anon, authenticated;

comment on function si_auto_close_completed() is
  'Closes a work order the moment it is marked completed, writing the completed -> closed history row itself. SECURITY DEFINER for the inner UPDATE only; the transition matrix still governs it, because triggers read the JWT rather than the database role (migration 0061).';

drop trigger if exists c_auto_close_on_completion on work_orders;
create trigger c_auto_close_on_completion
  after update on work_orders
  for each row execute function si_auto_close_completed();


-- ---------------------------------------------------------------------------
-- 5. Sign-off applies to a closed work order
--
-- 0059's function with the status test widened and the history row stamped with
-- the status the work order is actually at. Everything else — HOD and only HOD
-- including Administrators, one sign-off per work order, the technician's
-- notification, the non-transition event_type that keeps it off the ladder — is
-- unchanged.
--
-- `completed` is still accepted, for the same reason section 2 deletes no rows:
-- a work order stranded there must still be signable rather than permanently
-- unaccounted for.
-- ---------------------------------------------------------------------------
create or replace function si_verify_work_order(p_wo_id uuid, p_remarks text default null)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_status      si_wo_status;
  v_verified_at timestamptz;
  v_actor_name  text;
  v_assignee    uuid;
  v_ref         text;
  v_asset       text;
begin
  if not si_is_hod() then
    raise exception 'Only a Head of Department may verify a work order.'
      using errcode = 'insufficient_privilege';
  end if;

  select name into v_actor_name from users where id = auth.uid();
  if v_actor_name is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  select status, verified_at, assigned_to_id,
         coalesce(wo_number, 'A work order'), coalesce(asset_name, 'equipment')
    into v_status, v_verified_at, v_assignee, v_ref, v_asset
    from work_orders where id = p_wo_id;
  if not found then
    raise exception 'Work order not found.' using errcode = 'no_data_found';
  end if;

  if v_verified_at is not null then
    raise exception 'That work order has already been verified.'
      using errcode = 'unique_violation';
  end if;

  if v_status not in ('closed', 'completed') then
    raise exception 'Only a finished work order can be verified — this one is %.', v_status
      using errcode = 'check_violation';
  end if;

  update work_orders
     set verified_by = auth.uid(),
         verified_at = now()
   where id = p_wo_id;

  insert into work_order_history
    (work_order_id, from_status, to_status, event_type,
     actor_id, actor_name, actor_role, remarks)
  values
    (p_wo_id, v_status, v_status, 'verified',
     auth.uid(), v_actor_name, 'hod',
     coalesce(nullif(btrim(p_remarks), ''), 'Verified by ' || v_actor_name));

  if v_assignee is not null and v_assignee <> auth.uid() then
    perform si_notify(v_assignee, 'technician', p_wo_id, v_ref,
      'verified', 'Your repair was verified',
      v_ref || ' — ' || v_asset || ' has been signed off by ' || v_actor_name || '.');
  end if;
end
$fn$;

revoke all on function si_verify_work_order(uuid, text) from public, anon;
grant execute on function si_verify_work_order(uuid, text) to authenticated;

comment on function si_verify_work_order(uuid, text) is
  'Sign off a finished work order as its Head of Department. SECURITY DEFINER because the write touches columns no UPDATE policy exposes; the HOD check, the status check and the already-verified check are all restated in the body. Accepts `closed` (0061) and `completed` (a work order stranded by 0059).';


-- ---------------------------------------------------------------------------
-- 6. Anything sitting at `completed` is closed
--
-- Not tidiness. The sign-off queue is "closed and not yet verified" from here
-- on, so a work order left at `completed` would be invisible to the HOD who is
-- supposed to sign it: finished, uncounted, and on nobody's screen. Section 5
-- keeps it signable if one ever appears; this makes sure none is left today.
--
-- `verified_at` is deliberately left alone, so a job completed an hour ago
-- still needs its sign-off. That is only true because section 3 ran first: with
-- 0050's stamp still in place, this statement would have silently marked every
-- one of them verified.
--
-- The notify trigger is off for the statement, the way 0039 section 1.3 turned
-- two of them off. auth.uid() is null in a migration, so si_notify would write
-- rows with nobody to exclude and tell a requester their month-old job had just
-- moved. The transition guard needs no such treatment — it returns early on a
-- null uid — and neither does the auto-close trigger above, which does not
-- match an UPDATE already going to `closed`.
--
-- No history rows: nobody performed this, and inventing an actor is worse than
-- a rung with no line under it. `open` already renders that way on every work
-- order, because raising one writes no history row either.
-- ---------------------------------------------------------------------------
alter table work_orders disable trigger after_work_order_update;

update work_orders set status = 'closed' where status = 'completed';

alter table work_orders enable trigger after_work_order_update;


-- ---------------------------------------------------------------------------
-- 7. An HOD may actually perform the moves the matrix gives them
--
-- 0059 gave `completed -> repairing` the roles {hod,manager,admin} and amended
-- work_orders_select and work_orders_delete. It did not amend
-- work_orders_UPDATE, which is still 0019's list: admin, manager, supervisor,
-- the assigned technician, the requester. So "Send back for rework" -- the move
-- that exists precisely so an HOD who can see a repair was not done has an
-- alternative to signing it off anyway -- was refused by RLS for every HOD.
--
-- REFUSED SILENTLY, which is why it survived the migration that introduced it:
-- RLS does not raise on an UPDATE it filters out, it matches zero rows. Measured
-- on test before this section: an HOD's `closed -> repairing` returned no error
-- and left the status exactly as it was.
--
-- Sign-off itself was unaffected and is why nothing looked broken:
-- si_verify_work_order is SECURITY DEFINER, so it never consulted this policy.
--
-- The transition guard is what keeps the widening narrow. An HOD holds two
-- matrix rows and no others, so the only status moves this policy now permits
-- them are the two they are meant to have. It does hand them a Supervisor's
-- ability to edit a work order's own fields, which is the same reach every other
-- senior role on this table already has; the tighter alternative -- a SECURITY
-- DEFINER RPC for rework, the way 0037 did decline -- buys nothing here, because
-- rework ends inside the caller's own visibility rather than outside it, which
-- was the entire reason decline needed a door.
-- ---------------------------------------------------------------------------
drop policy if exists work_orders_update on work_orders;
create policy work_orders_update on work_orders
  for update
  using (
    si_is_admin() or si_is_manager() or si_is_hod() or si_is_supervisor()
    or (si_is_technician() and assigned_to_id = auth.uid())
    or requester_id = auth.uid()
  )
  with check (
    si_is_admin() or si_is_manager() or si_is_hod() or si_is_supervisor()
    or si_is_technician() or si_is_requester()
  );
