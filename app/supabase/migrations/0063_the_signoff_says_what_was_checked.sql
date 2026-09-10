-- ---------------------------------------------------------------------------
-- 0063  The sign-off says what was checked
--
-- This migration exists because two branches met. `main` carried "Closing a
-- work order says what was verified": `work_orders.verification_notes`, required
-- by `completed -> closed`, on the argument that the one move in the flow that
-- recorded a decision recorded no reason for it. That argument is right and it
-- survives; what does not survive is where the note was collected, because
-- 0061 made that move automatic. Nobody performs it, so nobody can be asked.
--
-- MAIN'S 0058 IS DROPPED IN THE MERGE RATHER THAN AMENDED, and that is only
-- safe because of where it had reached: production is at 0057 and never applied
-- it, and on the test project its version number was taken by 0058_hod_role_enum
-- so `db push` had skipped it there too. It was applied nowhere. Its number was
-- also the practical problem — two files claiming version 0058 in one directory
-- is not a state the CLI can resolve, and renumbering the *applied* one is the
-- thing CLAUDE.md says never to do.
--
-- Left alone, its rule would have refused every completion on this branch: the
-- guard demands a note on `completed -> closed`, si_auto_close_completed
-- performs exactly that move, and it has nothing to say. Measured on test,
-- which was carrying that guard out-of-band: *"Closing a work order needs a
-- note saying what was verified."* raised from inside the auto-close trigger,
-- with the technician's Mark completed the thing that failed.
--
-- So the note moves to the act that is still a decision by a person: the HOD's
-- sign-off. It is REQUIRED there, which is main's own choice about this column
-- rather than a new one, and it matches every other deliberate act on this
-- schema — a decline, a rework, an Administrator's re-grade all carry a reason.
--
-- Two readings, one argument, exactly as main described it: the column is what
-- the work order says about itself, and the history remark is what the timeline
-- says about the moment it was signed. si_verify_work_order already wrote the
-- remark; it writes the column now too.
--
-- WHO CAN READ IT IS THE PART TO NOT UNDO. The note is now the sign-off, so it
-- is HOD-only like everything else about the sign-off (0059): the detail page
-- renders it inside canSeeVerification(), and the export column main added was
-- removed with this migration rather than kept, because a workbook has no such
-- gate and a Manager exporting the month would read what the app declines to
-- show them.
-- ---------------------------------------------------------------------------

-- Idempotent because test already has the column: main's 0058 reached that
-- database out-of-band even though its version was never recorded.
alter table work_orders
  add column if not exists verification_notes text;

comment on column work_orders.verification_notes is
  'What the Head of Department checked when they signed this work order off. '
  'Required by si_verify_work_order (0063). Null on everything closed before '
  'the sign-off existed, which is why every reader renders it conditionally. '
  'HOD-only on the client, like verified_at/verified_by.';


-- ---------------------------------------------------------------------------
-- The matrix, both halves
--
-- The note is required on the row that IS the sign-off, so the guard's own
-- required-fields loop enforces it and "the permitted moves are data, not code"
-- keeps being true of the newest rule as well as the oldest.
--
-- And it is stripped from `completed -> closed`, which is the statement that
-- makes this file safe to apply to a database that did get main's 0058 by hand.
-- 0061 already rewrote that row's `requires` to '{}' on both projects; this
-- says so out loud rather than leaving it to have been a side effect of an
-- `on conflict do update`.
-- ---------------------------------------------------------------------------
insert into wo_status_transitions
  (from_status, to_status, roles, requires, requires_assignee_change, label)
values
  ('closed', 'closed', '{hod}', '{verified_by,verification_notes}', false, 'Verify')
on conflict (from_status, to_status) do update
  set roles                    = excluded.roles,
      requires                 = excluded.requires,
      requires_assignee_change = excluded.requires_assignee_change,
      label                    = excluded.label;

update wo_status_transitions
   set requires = array_remove(requires, 'verification_notes')
 where from_status = 'completed' and to_status = 'closed';


-- ---------------------------------------------------------------------------
-- si_verify_work_order — 0061's function, with the note
--
-- Restated in full because `create or replace` cannot amend one branch. The
-- three checks it already restated are untouched: an HOD and only an HOD
-- (Administrators included), a finished work order, and not already signed off.
--
-- The blank test is `btrim`, so whitespace is not a note. It is checked HERE as
-- well as by the guard's `requires` loop, for the reason every other door on
-- this schema restates its own rules: RLS and the matrix do not apply inside a
-- SECURITY DEFINER body, and the guard's message names a column where this one
-- names the thing being asked for.
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
  v_note        text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  if not si_is_hod() then
    raise exception 'Only a Head of Department may verify a work order.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_note is null then
    raise exception 'Signing off a work order needs a note saying what you checked.'
      using errcode = 'not_null_violation';
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
     set verified_by        = auth.uid(),
         verified_at        = now(),
         verification_notes = v_note
   where id = p_wo_id;

  insert into work_order_history
    (work_order_id, from_status, to_status, event_type,
     actor_id, actor_name, actor_role, remarks)
  values
    (p_wo_id, v_status, v_status, 'verified',
     auth.uid(), v_actor_name, 'hod', v_note);

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
  'Sign off a finished work order as its Head of Department, with a required note saying what was checked (0063). SECURITY DEFINER because the write touches columns no UPDATE policy exposes; the HOD check, the note check, the status check and the already-verified check are all restated in the body.';
