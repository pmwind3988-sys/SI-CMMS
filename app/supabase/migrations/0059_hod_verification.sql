-- ============================================================================
-- SI — Service Inside · 0059 Completed is the end, and an HOD signs it off
-- ============================================================================
-- Four changes that only make sense together.
--
-- 1. THE REQUESTER NO LONGER VERIFIES ANYTHING.
--
-- `completed` was a waiting room: the technician marked the repair done and the
-- person who raised the fault had to come back and press "Confirm fixed —
-- Close" before the work order finished. In practice that is a step owed by
-- somebody with no reason to open the app again, which is why 0003 needed a
-- Manager override for an unresponsive requester in the first place — an escape
-- hatch is evidence that the step it escapes does not reliably happen.
--
-- So `completed` is now TERMINAL. `('completed','closed')` and
-- `('completed','repairing')` leave the matrix for the requester entirely, and
-- nothing reaches `closed` from here on.
--
-- Work orders ALREADY closed stay closed and are not touched. `closed` keeps
-- its enum label, its wo_statuses row, its badge colour and its rung on the
-- timeline, for the reason 0039 kept On The Way: a work order that went through
-- it has history rows saying so, and a status the client cannot resolve renders
-- as a blank grey badge on a real record.
--
-- 2. AN HOD VERIFIES, AND THAT IS A STAMP RATHER THAN A STATUS.
--
-- Verification is `verified_by` + `verified_at` on the row — columns 0001
-- already created — written by si_verify_work_order(). It deliberately does NOT
-- move the status, and that is what makes the rest of the requirement possible:
-- the verified/unverified distinction is to be visible to HODs alone, and a
-- status change is visible to everybody who can see the row at all. A flag can
-- be withheld from a screen; a status badge cannot.
--
-- Be honest about what that hiding is. Postgres RLS is row-level, the
-- application roles live in a JWT rather than in database roles, and there is
-- therefore no column-level boundary available here: `verified_at` is readable
-- by anyone `work_orders_select` already lets read the row. Hiding it is a
-- DISPLAY decision made in the client, which is the sanctioned direction this
-- schema states everywhere — showing less than the policy allows is fine, and
-- gating a capability on it is the line. Nothing is gated on it. The WRITE is
-- what is guarded, and that guard is here.
--
-- 3. A WORK ORDER COUNTS ONCE IT IS VERIFIED, AND NOT BEFORE.
--
-- `verified_at is not null` is now the single test for "this work has been
-- signed off", across the cards, the card drill-downs and all four charts.
--
-- No backfill is needed and none is done, which is the neat part: the stamp
-- trigger has always written `verified_at := coalesce(verified_at, now())` when
-- a work order reached `closed` (0003, restated in 0050), so every historically
-- closed work order already carries one. The old world's "closed" and the new
-- world's "verified" are the same predicate, and the dashboard does not develop
-- a hole at today's date.
--
-- The consequence to expect rather than to fix: the trend, department and
-- machine charts count work RAISED in the period AND since verified, so a
-- recent period reads low and fills in as HODs work through it. That is the
-- requirement — unverified work is not counted — and each chart's subtitle says
-- so, rather than leaving a reader to infer it from a number that looks wrong.
--
-- `completed_today` and `avg_repair_minutes` move off `closed_at`, which
-- nothing stamps any more, onto `verified_at` and `resolved_at`. Left alone the
-- first would read zero forever and the second would freeze at its last
-- pre-0059 value. A card that is wrong is worse than a card that is missing,
-- because nobody doubts it.
--
-- 4. HOD RANKS 4, AND EVERYTHING ABOVE IT SHIFTS UP ONE.
--
--   requester(1) technician(2) supervisor(3) hod(4) manager(5) admin(6)
--   superuser(7)
--
-- The ladder's shape is unchanged and so is every rule written against it —
-- "you may write a users row if its rank is strictly below yours" still means
-- exactly what it meant. Only the integers move, and they move in all three
-- functions that carry them, because the superuser tier is a LITERAL in two of
-- them rather than a lookup.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. The role, and the rank ladder it is inserted into
-- ---------------------------------------------------------------------------

create or replace function si_is_hod() returns boolean
language sql stable set search_path = public as $$ select si_has_role('hod') $$;

revoke all on function si_is_hod()    from public, anon;
grant execute on function si_is_hod() to authenticated, service_role;

create or replace function si_role_rank(p_role text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_role
           when 'requester'  then 1
           when 'technician' then 2
           when 'supervisor' then 3
           when 'hod'        then 4
           when 'manager'    then 5
           when 'admin'      then 6
           else 0
         end;
$$;

-- The superuser tier is a literal in both of these, so both move with the
-- ladder. Missing one would leave a Superuser ranking 6 — equal to an
-- Administrator rather than above one — and "only a Superuser can create or
-- promote an Administrator" would quietly stop being true. That is the failure
-- mode 0015's header names: silence, not an error.
create or replace function si_account_rank(p_roles si_role[], p_is_protected boolean)
returns int
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_is_protected, false) then 7 else si_roles_rank(p_roles) end;
$$;

create or replace function si_caller_rank()
returns int
language sql
stable
set search_path = public
as $$
  select case when si_is_superuser() then 7 else si_roles_rank(si_roles()) end;
$$;

-- 0015's two-argument TEXT form is still on the schema. Nothing on a
-- fully-migrated project should reach it, but it is reachable, and a rank
-- function that disagrees with the other two is worse than one that is unused.
create or replace function si_account_rank(p_role text, p_is_protected boolean)
returns int
language sql
immutable
set search_path = public
as $$
  select case when coalesce(p_is_protected, false) then 7 else si_role_rank(p_role) end;
$$;


-- ---------------------------------------------------------------------------
-- 2. An HOD sees the whole plant
--
-- Verification is a system-wide duty here — no department or plant narrowing;
-- 0019 withdrew the one previous attempt to scope a role by department and its
-- reasoning has not changed — so an HOD needs the read a Supervisor has.
--
-- THREE PLACES RESTATE work_orders_select AND ALL THREE MOVE TOGETHER: the
-- policy, work_orders_delete (0018 — granting deletion must never widen scope)
-- and si_decline_work_order (0037 — RLS does not apply inside a SECURITY
-- DEFINER body). 0040's header says in as many words that leaving one behind
-- means the loosest path no longer agrees with the boundary.
-- ---------------------------------------------------------------------------
drop policy if exists work_orders_select on work_orders;
create policy work_orders_select on work_orders
  for select to authenticated
  using (
    si_is_admin()
    or si_is_manager()
    or si_is_hod()
    or si_is_supervisor()
    or (si_is_technician() and assigned_to_id = auth.uid())
    or requester_id = auth.uid()
  );

drop policy if exists work_orders_delete on work_orders;
create policy work_orders_delete on work_orders
  for delete to authenticated
  using (
    si_can_delete_work_orders()
    and (
      si_is_admin()
      or si_is_manager()
      or si_is_hod()
      or si_is_supervisor()
      or (si_is_technician() and assigned_to_id = auth.uid())
      or requester_id = auth.uid()
    )
  );

-- Nothing else needs widening, and that is worth stating so the next person
-- does not go looking. wo_history_select (0002) is
-- `exists (select 1 from work_orders w where w.id = work_order_id)`, so it
-- inherits whatever the policy above grants; attachments_select and
-- comments_select are `si_signed_in()` and were never narrower than this.

-- si_decline_work_order (0037, last restated by 0040) carries the same copy
-- inside its body. Restated in full because `create or replace` cannot amend
-- one branch; every line but the added disjunct is 0040's, unchanged.
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
    or si_is_hod()
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


-- ---------------------------------------------------------------------------
-- 3. The matrix: completed is terminal
--
-- Both moves out of `completed` were the requester's, and both go. Reopen comes
-- back immediately below under new ownership, because the alternative is an
-- HOD who can see that a repair was not really done and has no move available
-- but to sign it off anyway.
--
-- `('completed','closed')` is NOT replaced. There is no path to `closed` on
-- this schema from now on, deliberately — see the header on why the status is
-- kept anyway.
-- ---------------------------------------------------------------------------
delete from wo_status_transitions
 where (from_status, to_status) in (
   ('completed', 'closed'),
   ('completed', 'repairing')
 );

-- Reopen, re-owned. Same shape as the row it replaces — same required field,
-- no assignee change — so nothing about the move itself changes, only who may
-- make it. The requester is off it because "completed is the end" has to mean
-- the same thing from both directions: a work order they can push back into
-- Repairing is not one that has ended.
insert into wo_status_transitions
  (from_status, to_status, roles, requires, requires_assignee_change, label)
values
  ('completed', 'repairing', '{hod,manager,admin}', '{reopen_reason}', false, 'Send back for rework')
on conflict (from_status, to_status) do update
  set roles                    = excluded.roles,
      requires                 = excluded.requires,
      requires_assignee_change = excluded.requires_assignee_change,
      label                    = excluded.label;

-- Verification is a matrix row too, and it has to be.
--
-- si_guard_work_order_transition has NO early return for an unchanged status —
-- it looks the pair up unconditionally and raises "% is not a permitted
-- transition from %" when there is no row. A SECURITY DEFINER function does not
-- escape that: triggers read auth.uid() and the JWT rather than the database
-- role, which is the whole point 0037's header makes about si_decline_work_order.
-- So without this row si_verify_work_order below would be refused for every
-- caller it is written for, and would work only for the Administrators it
-- deliberately excludes.
--
-- Making it a row rather than an exemption is the better answer anyway: "the
-- permitted moves are data, not code" stays true, `requires` makes the guard
-- itself insist on verified_by, and the one place to look up who may verify is
-- the one place that already answers that question for every other move.
--
-- It is a same-status pair, like 0003's reassignment rows. Nothing moves — see
-- the header on why verification is a stamp and not a status.
insert into wo_status_transitions
  (from_status, to_status, roles, requires, requires_assignee_change, label)
values
  ('completed', 'completed', '{hod}', '{verified_by}', false, 'Verify')
on conflict (from_status, to_status) do update
  set roles                    = excluded.roles,
      requires                 = excluded.requires,
      requires_assignee_change = excluded.requires_assignee_change,
      label                    = excluded.label;


-- ---------------------------------------------------------------------------
-- 4. si_verify_work_order — the one way a work order gets signed off
--
-- SECURITY DEFINER, and the three things that door needs are all restated in
-- the body: who may call it (an HOD, and only an HOD), what state the target
-- has to be in, and that it has not been signed off already.
--
-- HOD AND ONLY HOD, INCLUDING ADMINISTRATORS. Every other guarded move on this
-- schema exempts `admin` so a stuck record can be corrected, and this one does
-- not. The requirement is that verification identifies a specific person in a
-- specific role, and an Administrator waving one through would put a name in
-- `verified_by` that answers a different question from the one the column is
-- being read to answer. The correction path for a work order nobody will sign
-- off is to grant somebody the role, which Admin → Users already does.
--
-- ONE HOD PER WORK ORDER, AND ONE WORK ORDER IS ALL THAT COSTS THEM. The
-- `verified_at is null` test is what makes the first of those true; there is
-- deliberately no limit of any kind in the other direction, because an HOD
-- working through a morning's completions is the normal case rather than the
-- exception.
--
-- The history row is NOT a transition — event_type says so, and both statuses
-- are the current one because nothing moved, exactly as 0043's photo_replaced
-- row is written. That is also what keeps it off the timeline ladder for
-- everyone: the client renders it as a note under the Completed rung, and
-- filters that note by role.
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
    raise exception 'Only a Head of Department may verify a completed work order.'
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

  if v_status <> 'completed' then
    raise exception 'Only a completed work order can be verified — this one is %.', v_status
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
    (p_wo_id, 'completed', 'completed', 'verified',
     auth.uid(), v_actor_name, 'hod',
     coalesce(nullif(btrim(p_remarks), ''), 'Verified by ' || v_actor_name));

  -- The technician who did the work, and nobody else.
  --
  -- si_notify_work_order_update cannot carry this: it returns early when the
  -- status has not changed, and verification deliberately does not change it.
  --
  -- The requester is NOT told. They were told at `completed`, which is the end
  -- of the flow as far as they are concerned, and a second message about an
  -- internal sign-off step they cannot see the outcome of anywhere in the app
  -- would be asking them to care about a distinction being withheld from them
  -- by design.
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
  'Sign off a completed work order as its Head of Department. SECURITY DEFINER because the write touches columns no UPDATE policy exposes; the HOD check, the completed check and the already-verified check are all restated in the body. Stamps verified_by/verified_at and writes a non-transition work_order_history row in the same transaction (migration 0059).';


-- ---------------------------------------------------------------------------
-- 5. Telling people
--
-- si_hods() has the shape si_managers() and si_admins() have had since 0020 —
-- active accounts holding the role, read from the array column.
--
-- si_notify_hods() is si_notify_assigners() narrowed to one role, and it keeps
-- that function's two hard-won details: the exclusion list has its NULLs
-- stripped, because `id <> all (array)` evaluates to NULL rather than true the
-- moment the array holds one and silences the entire fan-out; and auth.uid() is
-- null on any write from a script or a migration, which is exactly where that
-- would go unnoticed.
-- ---------------------------------------------------------------------------
create or replace function si_hods()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from users where 'hod' = any(roles) and status = 'active';
$$;

revoke all on function si_hods() from public, anon, authenticated;

create or replace function si_notify_hods(
  p_work_order_id uuid,
  p_wo_number     text,
  p_type          text,
  p_title         text,
  p_body          text,
  p_exclude       uuid[] default '{}'
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_seen      uuid[] := array_remove(coalesce(p_exclude, '{}'), null);
  v_n         int := 0;
begin
  for v_recipient in
    select h from si_hods() h where h is not null and h <> all (v_seen)
  loop
    perform si_notify(v_recipient, 'hod', p_work_order_id, p_wo_number,
                      p_type, p_title, p_body);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke all on function si_notify_hods(uuid, text, text, text, text, uuid[])
  from public, anon, authenticated;

comment on function si_notify_hods(uuid, text, text, text, text, uuid[]) is
  'Notifies every active Head of Department once, skipping p_exclude. Not callable from a client (migration 0059).';

-- The update fan-out, restated in full because `create or replace` cannot amend
-- one branch of a body. Every line but the two branches named in its own
-- comments is 0056's, unchanged.
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

  -- 0059: `completed` is the end of the flow, so this is the last thing the
  -- requester hears and it no longer asks them for anything. It used to read
  -- "please verify"; there is nothing for them to verify any more, and a
  -- notification asking for a step the app will not offer is worse than none.
  if new.status = 'completed' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'completed', 'Your work order has been completed',
      v_ref || ' — ' || v_asset);

    -- And the sign-off queue has something in it. Without this an HOD learns
    -- that a repair finished only by opening the app and looking, which is
    -- precisely the failure that made requester verification unreliable enough
    -- to be replaced.
    perform si_notify_hods(new.id, new.wo_number,
      'awaiting_verification', 'A completed work order needs verifying',
      v_ref || ' — ' || v_asset
        || coalesce(' · repaired by ' || new.assigned_to_name, '') || '.',
      array[auth.uid()]);
  end if;

  -- 0056's `completed -> closed` fan-out is GONE, with the transition it
  -- described. Nothing reaches `closed` after 0059, so keeping the branch would
  -- be dead code asserting a rule that no longer exists -- the shape of bug
  -- this schema has already shipped twice (users.status in 0026, a retirement
  -- that only filtered a dropdown in 0031). Its replacement is not here:
  -- verification does not move the status, so this trigger never sees it, and
  -- si_verify_work_order does its own fan-out.

  -- Reopening is operationally significant enough that the department's
  -- Supervisor should know too, not just the technician doing the work. Unlike
  -- Decline, this is not asking them to act, only to be aware.
  if old.status = 'completed' and new.status = 'repairing' then
    if new.assigned_to_id is not null then
      perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
        'reopened', 'Work order sent back for rework',
        v_ref || ' — ' || v_asset);
    end if;
    for v_supervisor in select si_department_supervisors(new.department_id) loop
      perform si_notify(v_supervisor, 'supervisor', new.id, new.wo_number,
        'reopened', 'Work order sent back for rework',
        v_ref || ' — ' || v_asset || ' was not accepted and has gone back for rework.');
    end loop;
  end if;

  return null;
end;
$fn$;


-- ---------------------------------------------------------------------------
-- 6. The card drill-downs
--
-- Two branches move off `closed_at`, which nothing stamps any more, and both
-- move to the SAME pair of columns the cards themselves now use: the elapsed
-- figure is `resolved_at - created_at` (raised to repaired, which is what "how
-- long did it take" has always meant) and the moment it is sorted and filtered
-- on is `verified_at` (when it started counting).
--
-- Keeping these two predicates identical to si_compute_dashboard_stats is the
-- entire purpose of this function, and 0012's header says so — a second
-- definition of "completed today" written in the other file is how a
-- drill-down starts disagreeing with the number it was opened from.
--
-- Restated in full, every other line 0050's, because `create or replace` cannot
-- amend one branch. `v_terminal` goes with the predicate that used it.
-- ---------------------------------------------------------------------------
create or replace function si_dashboard_card_rows(p_card text, p_limit int default 200)
returns table (
  ref_id       text,
  kind         text,
  title        text,
  subtitle     text,
  meta         text,
  priority     text,
  status       text,
  metric_kind  text,
  metric_value numeric,
  occurred_at  timestamptz
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_open     si_wo_status[] := si_open_statuses();
  v_limit    int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_priority si_priority;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  if p_card in ('total_open', 'p1_critical', 'p2_high', 'p3_medium', 'p4_low',
                'p7_long_term', 'overdue') then
    v_priority := (case p_card
                     when 'p1_critical' then 'P1'
                     when 'p2_high'     then 'P2'
                     when 'p3_medium'   then 'P3'
                     when 'p4_low'      then 'P4'
                     when 'p7_long_term' then 'P7'
                   end)::si_priority;

    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             (coalesce(d.name, w.department_id) || ' · ' ||
              coalesce(w.assigned_to_name, 'Unassigned'))::text,
             w.priority::text,
             w.status::text,
             'sla_remaining'::text,
             round(extract(epoch from (w.sla_resolution_due_at - now())) / 60)::numeric,
             w.created_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_open)
         and (v_priority is null or w.priority = v_priority)
         and (p_card <> 'overdue' or w.sla_breached)
       order by w.sla_resolution_due_at asc nulls last
       limit v_limit;

  elsif p_card = 'completed_today' then
    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             (coalesce(d.name, w.department_id) || ' · ' ||
              coalesce(w.assigned_to_name, 'Unassigned'))::text,
             w.priority::text,
             w.status::text,
             'duration'::text,
             round(extract(epoch from (w.resolved_at - w.created_at)) / 60)::numeric,
             w.verified_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.verified_at >= date_trunc('day', now())
       order by w.verified_at desc
       limit v_limit;

  elsif p_card = 'avg_response_minutes' then
    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             ('Accepted by ' || coalesce(h.actor_name, 'a technician'))::text,
             w.priority::text,
             w.status::text,
             'duration'::text,
             round(extract(epoch from (h.created_at - w.created_at)) / 60)::numeric,
             h.created_at
        from work_order_history h
        join work_orders w on w.id = h.work_order_id
       where h.to_status = 'accepted'
         and h.created_at >= w.created_at
       order by h.created_at desc
       limit v_limit;

  elsif p_card = 'avg_repair_minutes' then
    return query
      select w.id::text,
             'work_order'::text,
             coalesce(w.wo_number, 'Pending…')::text,
             coalesce(w.asset_name, w.asset_id)::text,
             (coalesce(d.name, w.department_id) || ' · ' ||
              coalesce(w.assigned_to_name, 'Unassigned'))::text,
             w.priority::text,
             w.status::text,
             'duration'::text,
             round(extract(epoch from (w.resolved_at - w.created_at)) / 60)::numeric,
             w.verified_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.verified_at is not null
         and w.resolved_at is not null
       order by w.verified_at desc
       limit v_limit;

  -- One row per technician rather than one per work order. `left join users u`
  -- returns null for a row the caller may not see, so the coalesce falls through
  -- to max(w.assigned_to_name), the denormalised copy.
  elsif p_card = 'active_technicians' then
    return query
      select w.assigned_to_id::text,
             'technician'::text,
             coalesce(u.name, max(w.assigned_to_name), 'Unknown technician')::text,
             coalesce(nullif(array_to_string(t.skills, ', '), ''), 'No skills recorded')::text,
             coalesce(u.department_id, '—')::text,
             null::text,
             null::text,
             'count'::text,
             count(*)::numeric,
             max(w.created_at)
        from work_orders w
        left join users u       on u.id = w.assigned_to_id
        left join technicians t on t.user_id = w.assigned_to_id
       where w.status = any (v_open)
         and w.assigned_to_id is not null
       group by w.assigned_to_id, u.name, t.skills, u.department_id
       order by count(*) desc
       limit v_limit;

  else
    raise exception 'Unknown dashboard card: %', p_card
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- 7. The cards
--
-- Two figures move, for the reason in the header, and nine do not. The nine are
-- current-state counters over the OPEN set — Total Open, the priority bands,
-- Overdue, Active Technicians — and verification says nothing about open work,
-- so scoping them to it would be inventing a filter rather than applying one.
--
-- `completed_today` keeps its name. It counts work signed off since midnight
-- rather than repairs finished since midnight, and the two now differ by
-- however long an HOD takes. Renaming it "Verified Today" was the alternative
-- and is worse on this schema: the card sits on the Manager and Admin
-- dashboards, the verified/unverified distinction is meant to be an HOD's, and
-- a card title is a poor place to introduce a concept the rest of those screens
-- deliberately withhold. The card's own blurb says what it counts, which is
-- where the honesty belongs.
--
-- avg_repair_minutes measures `resolved_at - created_at` now, not
-- `closed_at - created_at` — raised to repaired, over the signed-off set. That
-- is the figure the card has always claimed to show; it was only ever closed_at
-- because closure used to follow completion within a day or two. Measuring to
-- verification instead would fold an administrative delay into a number
-- labelled "Avg. Repair Time".
--
-- Restated in full, every other line 0055's, because `create or replace` cannot
-- amend one half of a body.
-- ---------------------------------------------------------------------------
create or replace function si_compute_dashboard_stats()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_open     si_wo_status[] := si_open_statuses();
  v_cards    jsonb;
  v_response numeric;
begin
  select avg(extract(epoch from (h.created_at - w.created_at)) / 60)
    into v_response
    from work_order_history h
    join work_orders w on w.id = h.work_order_id
   where h.to_status = 'accepted'
     and h.created_at >= w.created_at;

  select jsonb_build_object(
    'total_open',           count(*) filter (where status = any (v_open)),
    'p1_critical',          count(*) filter (where status = any (v_open) and priority = 'P1'),
    'p2_high',              count(*) filter (where status = any (v_open) and priority = 'P2'),
    'p3_medium',            count(*) filter (where status = any (v_open) and priority = 'P3'),
    'p4_low',               count(*) filter (where status = any (v_open) and priority = 'P4'),
    'p7_long_term',         count(*) filter (where status = any (v_open) and priority = 'P7'),
    'completed_today',      count(*) filter (where verified_at >= date_trunc('day', now())),
    'overdue',              count(*) filter (where status = any (v_open) and sla_breached),
    'avg_response_minutes', coalesce(round(v_response), 0),
    'avg_repair_minutes',   coalesce(round(avg(
                              extract(epoch from (resolved_at - created_at)) / 60
                            ) filter (where verified_at is not null
                                        and resolved_at is not null)), 0),
    'active_technicians',   count(distinct assigned_to_id) filter (
                              where status = any (v_open)
                                and assigned_to_id is not null)
  )
  into v_cards
  from work_orders;

  insert into stats (id, data, updated_at)
  values ('dashboard_cards', v_cards, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end;
$fn$;

revoke execute on function si_compute_dashboard_stats() from authenticated, anon, public;


-- ---------------------------------------------------------------------------
-- 8. The charts: signed-off work only, and one plant at a time
--
-- TWO CHANGES, and the parameter is the smaller of them.
--
-- `p_plant_id` narrows every chart to one site, or to all four when it is null.
-- Null rather than a sentinel like 'ALL', because `(p_plant_id is null or
-- w.plant_id = p_plant_id)` is one predicate that reads correctly either way,
-- and because a sentinel is a plant id that must never collide with a real one
-- — `plants` is user-editable reference data and PLT001 is already a retired
-- row somebody could recreate.
--
-- It is NOT validated against `plants`. An unknown id yields empty charts
-- rather than an error, which is the right failure for a filter: the id comes
-- from a picker built off the same table, and a plant retired a moment after
-- being chosen should draw nothing rather than break the page.
--
-- VERIFIED ONLY is the change that matters. Every chart gains
-- `verified_at is not null`, so unsigned-off work contributes to none of them.
--
-- What that costs, stated because the charts state it too: `raised` counts work
-- RAISED in the period AND since verified, so the trend for a recent period is
-- incomplete by design and fills in behind the HODs. A reader looking at this
-- week will see less than happened. That is the requirement, and the subtitles
-- carry it — a chart whose scope is unusual and unstated is the one way a chart
-- lies without containing a wrong number, which is 0055's own argument about
-- empty buckets pointed at a different omission.
--
-- The technician table moves from `closed_at` to `verified_at` for the reason
-- the cards do: nothing stamps closed_at any more, so left alone the league
-- table would have emptied out. Its elapsed figure moves to
-- `resolved_at - created_at` so "how long did the repair take" is not inflated
-- by how long the sign-off queue was.
--
-- Everything else is 0055's, unchanged: Asia/Kuala_Lumpur bucketing, the
-- exclusive `to`, the filled spine on the trend and the deliberately unfilled
-- breakdowns.
-- ---------------------------------------------------------------------------
create or replace function si_dashboard_charts_range(
  p_from     timestamptz,
  p_to       timestamptz,
  p_bucket   text default 'month',
  p_plant_id text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_tz   constant text := 'Asia/Kuala_Lumpur';
  v_step interval;
  v_fmt  text;
  v_out  jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'A chart period needs a start and an end, with the end after the start.';
  end if;

  -- The bucket is validated rather than interpolated: p_bucket reaches
  -- date_trunc as a value settled here and never as the caller's own string.
  case p_bucket
    when 'hour'  then v_step := interval '1 hour';  v_fmt := 'HH24:00';
    when 'day'   then v_step := interval '1 day';   v_fmt := 'DD Mon';
    when 'week'  then v_step := interval '1 week';  v_fmt := 'DD Mon';
    when 'month' then v_step := interval '1 month'; v_fmt := 'Mon YY';
    else raise exception 'Unknown chart bucket "%". Expected hour, day, week or month.', p_bucket;
  end case;

  with
  raised as (
    select w.id, w.department_id, w.asset_id, w.asset_name,
           date_trunc(p_bucket, w.created_at at time zone v_tz) as bucket
      from work_orders w
     where w.created_at >= p_from
       and w.created_at <  p_to
       and w.verified_at is not null
       and (p_plant_id is null or w.plant_id = p_plant_id)
  ),
  signed_off as (
    select w.assigned_to_id, w.assigned_to_name, w.created_at, w.resolved_at
      from work_orders w
     where w.verified_at >= p_from
       and w.verified_at <  p_to
       and w.resolved_at is not null
       and (p_plant_id is null or w.plant_id = p_plant_id)
  ),
  spine as (
    select g as bucket
      from generate_series(
             date_trunc(p_bucket, p_from at time zone v_tz),
             date_trunc(p_bucket, (p_to - interval '1 microsecond') at time zone v_tz),
             v_step
           ) g
  ),
  trend as (
    select s.bucket,
           to_char(s.bucket, v_fmt) as label,
           count(r.id) as n
      from spine s
      left join raised r on r.bucket = s.bucket
     group by s.bucket
  )
  select jsonb_build_object(
    'work_orders_trend', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', n) order by bucket)
        from trend
    ), '[]'::jsonb),

    'department_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('department', name, 'count', n) order by n desc)
        from (
          select coalesce(d.name, r.department_id) as name, count(*) as n
            from raised r
            left join departments d on d.id = r.department_id
           group by 1
        ) x
    ), '[]'::jsonb),

    'machine_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('asset', name, 'count', n) order by n desc)
        from (
          select coalesce(r.asset_name, r.asset_id) as name, count(*) as n
            from raised r
           group by 1
           order by count(*) desc
           limit 10
        ) x
    ), '[]'::jsonb),

    -- Grouped on assigned_to_name, the denormalised copy (0001), so the table
    -- still reads correctly for a technician whose account has since gone.
    'technician_performance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'technician', name,
               'completed', completed,
               'avg_repair_minutes', avg_minutes
             ) order by completed desc)
        from (
          select coalesce(c.assigned_to_name, c.assigned_to_id::text) as name,
                 count(*) as completed,
                 coalesce(round(avg(
                   extract(epoch from (c.resolved_at - c.created_at)) / 60
                 )), 0) as avg_minutes
            from signed_off c
           where c.assigned_to_id is not null
           group by 1
           order by count(*) desc
           limit 10
        ) x
    ), '[]'::jsonb),

    'bucket',   p_bucket,
    'from',     p_from,
    'to',       p_to,
    'plant_id', p_plant_id
  )
  into v_out;

  return v_out;
end;
$fn$;

-- 0055's three-argument signature is DROPPED rather than left beside the new
-- one. PostgREST resolves an RPC by the argument names the client sends, so a
-- browser running a cached bundle would keep binding to the old function — and
-- the old function has no verified_at filter, so the charts would carry on
-- counting unsigned-off work with nothing on screen or in the logs saying which
-- of the two answered. 0056 dropped si_notify's seven-argument form for exactly
-- this, and its header explains why adding a defaulted parameter is not enough
-- on its own.
drop function if exists si_dashboard_charts_range(timestamptz, timestamptz, text);

revoke all on function si_dashboard_charts_range(timestamptz, timestamptz, text, text)
  from public, anon;
grant execute on function si_dashboard_charts_range(timestamptz, timestamptz, text, text)
  to authenticated, service_role;
