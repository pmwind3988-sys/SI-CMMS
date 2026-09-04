-- ===========================================================================
-- SI — Service Inside · migration 0056
-- A notification says which phase it is about, and two moments that produced
-- none now do.
--
-- Three changes, one theme: the notification list is the only place most
-- people meet a work order, and it was a flat stream of sentences with no way
-- to tell an assignment from a completion at a glance, or to tell which of
-- them concerned work you are doing from work you reported.
--
--   1. notifications.wo_status  — the phase, stamped at the chokepoint
--   2. verified & closed        — the one end of the flow nobody was told about
--   3. waiting for a spare part — and the resume that closes that loop
--
-- ---------------------------------------------------------------------------
-- 1. THE PHASE
--
-- `type` was doing two jobs and doing the second one badly. 'status_change'
-- covers accept, start-work and anything added later, so a client grouping by
-- type produces a bucket called "Status update" holding three different
-- moments — and no client could say WHICH status without re-reading the work
-- order it points at.
--
-- So the row carries the phase. Nullable, and deliberately not backfilled:
-- every notification already written happened at a phase nobody recorded, and
-- inferring one now from the work order's CURRENT status would stamp today's
-- answer onto last month's event. An unlabelled old row is honest; a
-- confidently wrong one is not. The client renders no chip when it is null.
--
-- IT IS RESOLVED INSIDE si_notify() RATHER THAN AT THE CALL SITES. There are
-- eleven callers across 0003, 0004, 0038, 0051, 0052 and 0054, and a stamp
-- each caller has to remember is a stamp that is missing from whichever branch
-- is added next — the argument compressImage makes for living inside
-- addAttachment() rather than at its two call sites. p_wo_status is still
-- accepted, defaulted, for the one case the lookup gets wrong: a notification
-- deliberately about a phase the work order has already left.
--
-- The lookup reads the row in the SAME transaction as the trigger that is
-- writing it, so it sees the NEW status, which is the one the notification is
-- about. On a decline that is 'open' — correct, because the point of the
-- message is that the job is back in the queue.
--
-- ---------------------------------------------------------------------------
-- 2. VERIFIED AND CLOSED — completed -> closed
--
-- The last transition in the flow, and it notified NOBODY. The technician who
-- did the work, in particular: they are told when a job is handed to them
-- (0052), when it is reopened because it was not fixed (0038), and nothing at
-- all when the person who raised it confirms it is right. That is the one of
-- the three worth hearing.
--
-- Technician + everyone who can assign. The requester is excluded because they
-- performed it, and the actor exclusion covers the case where a Manager or
-- Administrator closed it on their behalf.
--
-- ---------------------------------------------------------------------------
-- 3. WAITING FOR A SPARE PART — repairing -> waiting_spare_part
--
-- The one phase where the work order stops moving for a reason nobody in the
-- app can fix by working harder, and it announced itself to nobody. The
-- requester is told because their machine is still down and the reason is not
-- "we forgot"; the assigners are told because ordering the part is their
-- problem rather than the technician's.
--
-- `spare_part_reason` is required by the transition matrix for this move, so
-- it is always there to carry — and a Manager reading "waiting for a part"
-- without knowing which part has to open the work order to act on it.
--
-- The RESUME (waiting_spare_part -> repairing) goes to the requester only.
-- Telling somebody their job is paused and never telling them it restarted is
-- a worse state than never having told them: they are left believing it is
-- still stuck. The assigners are not told, because a resume asks nothing of
-- them and `notifications` still has no retention (see 0038).
--
-- ---------------------------------------------------------------------------
-- WHAT A TECHNICIAN RECEIVES, stated because it is now a rule rather than an
-- accident: every technician-addressed notification in this schema is gated on
-- `assigned_to_id`, so a technician hears about the work orders they hold and
-- no others. They are told when one is handed to them, when it is reopened,
-- when its SLA is at risk or breached, when its priority is re-graded, and now
-- when the requester verifies and closes it. An account that ALSO holds
-- supervisor, manager or admin receives the ops-chain rows too — by that role,
-- through si_notify_assigners, stamped with it. That is the union rule from
-- 0020 and not a leak.
--
-- Everything else in si_notify_work_order_update is 0052's, restated because
-- `create or replace function` cannot amend one branch of a body. The two
-- pre-existing fan-out loops are replaced by si_notify_assigners() calls
-- (0054), which is the same query with the same dedupe, ordering and highest-
-- role stamp — verified row for row against the old shape.
-- ===========================================================================

alter table notifications
  add column if not exists wo_status si_wo_status;

comment on column notifications.wo_status is
  'The work order phase this notification is about, stamped by si_notify(). Null on rows written before migration 0056 and on anything not about a work order — the client shows no phase chip rather than guessing one.';

-- ---------------------------------------------------------------------------
-- si_notify() stamps the phase.
--
-- 0003's body with the lookup added. The signature gains a defaulted eighth
-- argument, so all eleven existing callers keep compiling unchanged and keep
-- their behaviour — they now simply record a phase they did not before.
--
-- THE OLD SIGNATURE IS DROPPED FIRST, and that line is the whole migration's
-- most load-bearing statement. `create or replace function` matches on the
-- ARGUMENT LIST: adding an eighth parameter creates an OVERLOAD and leaves the
-- seven-argument function exactly where it was. Postgres then resolves every
-- existing seven-argument call to the old body in preference to defaulting the
-- new one — so all eleven callers would carry on writing rows with no phase,
-- the migration would push cleanly, the column would exist, and the feature
-- would simply not happen. Dropping it is safe because plpgsql bodies are not
-- linked to the functions they call until they run.
-- ---------------------------------------------------------------------------
drop function if exists si_notify(uuid, si_role, uuid, text, text, text, text);

create or replace function si_notify(
  p_recipient_id   uuid,
  p_recipient_role si_role,
  p_entity_id      uuid,
  p_entity_label   text,
  p_type           text,
  p_title          text,
  p_body           text,
  p_wo_status      si_wo_status default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notifications (recipient_id, recipient_role, entity_type, entity_id,
                             entity_label, type, title, body, status, wo_status)
  values (p_recipient_id, p_recipient_role, 'work_order', p_entity_id,
          p_entity_label, p_type, p_title, p_body, 'sent',
          coalesce(p_wo_status,
                   (select w.status from work_orders w where w.id = p_entity_id)));
$$;

revoke all on function si_notify(uuid, si_role, uuid, text, text, text, text, si_wo_status)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The update fan-out.
-- ---------------------------------------------------------------------------
create or replace function si_notify_work_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_supervisor uuid;
  v_asset text := coalesce(new.asset_name, 'equipment');
  v_ref   text := coalesce(new.wo_number, 'This work order');
  v_who   text;
  v_why   text;
  v_seen  uuid[];
begin
  /* 0052: ABOVE the status guard, and keyed on the ASSIGNEE changing rather
     than on the status becoming 'assigned'. A handover at `accepted` or later
     deliberately preserves the status, so the guard below returns before this
     ever ran and the new technician was told nothing. */
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
    v_why := nullif(btrim(coalesce(new.decline_reason, '')), '');
    perform si_notify_assigners(new.department_id, new.id, new.wo_number,
      'declined', 'Technician declined — needs reassignment',
      v_ref || ' — ' || v_asset || coalesce(' · ' || v_why, ''),
      array[auth.uid()]);
  end if;

  if old.status = 'assigned' and new.status = 'accepted' then
    v_who  := coalesce(new.assigned_to_name, 'A technician');
    v_seen := array[auth.uid()];

    -- The Requester's wording is unchanged from 0003 and is deliberately
    -- warmer than the ops chain's: it is the one of the two written for
    -- somebody waiting on the repair rather than managing it.
    if new.requester_id is not null and new.requester_id <> all (array_remove(v_seen, null)) then
      perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
        'status_change', 'Technician accepted your work order',
        v_who || ' has accepted ' || v_ref || ' and will start shortly.');
      v_seen := v_seen || new.requester_id;
    end if;

    perform si_notify_assigners(new.department_id, new.id, new.wo_number,
      'accepted', 'Technician accepted a work order',
      v_who || ' has accepted ' || v_ref || ' — ' || v_asset || '.',
      v_seen);
  end if;

  -- 0052 replaced 0038's `on_the_way -> on_site` branch with this. Requester
  -- only, matching what that branch did: the ops chain already heard about this
  -- work order at accept, and hearing again a minute later when the same
  -- technician starts is noise on a table that has no retention.
  if old.status = 'accepted' and new.status = 'repairing' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'status_change', 'Technician has started work',
      coalesce(new.assigned_to_name, 'A technician') || ' has started work on ' || v_ref || '.');
  end if;

  -- NEW (0056): the repair has stopped on something nobody in the app can fix
  -- by working harder.
  if new.status = 'waiting_spare_part' then
    v_why  := nullif(btrim(coalesce(new.spare_part_reason, '')), '');
    v_who  := coalesce(new.assigned_to_name, 'The technician');
    v_seen := array[auth.uid()];

    if new.requester_id is not null and new.requester_id <> all (array_remove(v_seen, null)) then
      perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
        'waiting_part', 'Your work order is waiting for a part',
        v_ref || ' — ' || v_asset || ' is paused until a part arrives'
          || coalesce(' · ' || v_why, '') || '.');
      v_seen := v_seen || new.requester_id;
    end if;

    perform si_notify_assigners(new.department_id, new.id, new.wo_number,
      'waiting_part', 'Work order waiting for a spare part',
      v_ref || ' — ' || v_asset || ' · ' || v_who || ' is held up'
        || coalesce(' · ' || v_why, ''),
      v_seen);
  end if;

  -- NEW (0056): and the part arrived. Requester only — see the header.
  if old.status = 'waiting_spare_part' and new.status = 'repairing' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'status_change', 'Work resumed on your work order',
      coalesce(new.assigned_to_name, 'A technician') || ' has the part and has resumed ' || v_ref || '.');
  end if;

  if new.status = 'completed' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'completed', 'Your work order was completed — please verify',
      v_ref || ' — ' || v_asset);
  end if;

  -- NEW (0056): verified and closed. The end of the flow, and until now the
  -- only transition in it that told nobody anything.
  if old.status = 'completed' and new.status = 'closed' then
    v_seen := array[auth.uid(), new.requester_id];

    if new.assigned_to_id is not null
       and new.assigned_to_id <> all (array_remove(v_seen, null)) then
      perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
        'verified_closed', 'Your repair was verified and closed',
        coalesce(new.requester_name, 'The requester') || ' has verified ' || v_ref
          || ' — ' || v_asset || ' and closed it.');
      v_seen := v_seen || new.assigned_to_id;
    end if;

    perform si_notify_assigners(new.department_id, new.id, new.wo_number,
      'verified_closed', 'Work order verified and closed',
      v_ref || ' — ' || v_asset || ' · verified by '
        || coalesce(new.requester_name, 'the requester')
        || coalesce(' · repaired by ' || new.assigned_to_name, '') || '.',
      v_seen);
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
$fn$;

revoke all on function si_notify_work_order_update() from public, anon, authenticated;
