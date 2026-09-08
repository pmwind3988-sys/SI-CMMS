-- ============================================================================
-- SI - Service Inside - 0058 Verify and close says what was verified
-- ============================================================================
-- Closing a work order was the one move in the flow that recorded a decision
-- and no reason. `completed -> closed` required `verified_by` and nothing else,
-- so the trail read "Confirmed fixed by requester" -- a sentence the client
-- wrote, not the person who pressed the button.
--
-- That matters most in the case it was reported from: the job was done, the
-- technician never accepted the work order, and somebody closes it knowing
-- something the record does not. Now they have to write it down.
--
-- WHAT IS NOT TOUCHED: every work order already `closed`. The column is
-- nullable with no backfill and no default, and the check below fires only on
-- the `completed -> closed` transition itself, so a finished record keeps its
-- null note. Inventing one now would stamp today's answer onto last month's
-- event -- the argument 0056 makes for not backfilling notifications.wo_status.
--
-- THREE PLACES, because the loosest path wins:
--   1. `wo_status_transitions.requires` gains the column, which covers the
--      requester and the manager through the guard's existing required-fields
--      loop.
--   2. si_guard_work_order_transition() checks it ABOVE the admin bypass, since
--      that bypass returns before the loop ever runs. Without this an
--      Administrator or Superuser -- the accounts that hold "Force verify &
--      close" -- would be the only ones exempt from a rule written for them.
--   3. si_transition_work_order() whitelists the column, or the value the
--      client sends is dropped and the guard then refuses every close. That
--      whitelist is explicit by design (0020); a new column has to be named.
--
-- Both functions are their current definitions -- 0020's RPC and 0023's guard --
-- with one block each. `create or replace` keeps the BEFORE UPDATE binding from
-- 0003 and the ACLs 0007 revoked; both revokes are restated below anyway,
-- because a later replace resets what an earlier statement set and CLAUDE.md is
-- emphatic that this is the step that gets forgotten.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists verification_notes text;

comment on column work_orders.verification_notes is
  'What the requester (or the Manager/Administrator overriding for them) confirmed when the work order was closed. Required from migration 0058 onwards; null on everything closed before it.';

-- ---------------------------------------------------------------------------
-- 2. The matrix row. `requires` is a text[] of column names the guard reads off
--    the NEW row, so naming the column here is the whole change -- no code path
--    is added for it.
-- ---------------------------------------------------------------------------
update wo_status_transitions
   set requires = '{verified_by,verification_notes}'
 where from_status = 'completed' and to_status = 'closed';

-- ---------------------------------------------------------------------------
-- 3. The guard: 0023's function with the check above the admin bypass.
-- ---------------------------------------------------------------------------
create or replace function si_guard_work_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t          wo_status_transitions;
  v_eligible si_role[];
  v_field    text;
  v_assignee record;
begin
  -- pg_cron, the service role, and admin scripts are trusted, exactly as the
  -- Admin SDK bypassed security rules.
  if auth.uid() is null then return new; end if;

  /* Self-assignment, checked ABOVE the admin bypass so the rule is uniform for
     every role including Administrator and Superuser.

     Precedent: 0015 put the self-role-change lock above the same exemption, for
     the same reason — a rule whose entire purpose is to stop you acting on
     yourself is worthless if the most privileged account is exempt.

     Purely additive for single-role accounts: a Supervisor was never in the
     technicians roster, so they could never have been assigned anything anyway.

     Known consequence, accepted: if one person is simultaneously the only
     active Supervisor and the only active Technician, work orders become
     unassignable by them and a Manager or Admin has to step in. */
  if new.assigned_to_id is distinct from old.assigned_to_id
     and new.assigned_to_id = auth.uid() then
    raise exception 'You cannot assign a work order to yourself. Ask another Supervisor or a Manager.'
      using errcode = 'insufficient_privilege';
  end if;

  /* The assignment also has to land on someone who can move it.

     si_eligible_roles() computes eligibility from the ASSIGNEE's own roles, so
     an assignment onto an account that does not hold `technician`, or that is
     inactive, produces a work order nobody can move: `assigned -> accepted` and
     every technician transition after it return an empty eligible set, and the
     job sits at `assigned` until a Manager or Admin reassigns it. The account
     cannot rescue itself, and nothing in the flow says why.

     Reachable because si_set_user_roles() creates the `technicians` row when the
     role is granted and deliberately LEAVES IT IN PLACE when the role is
     revoked -- it holds skills and certifications, which outlive the role. So
     the table answers "who has ever been a technician" and the roster offered
     people who had stopped being one. Behaviour dates to 0004 and is unchanged
     here; what changed is that revoking one role out of a set became routine.
     listenTechnicians() now intersects `technicians` with `users`; this is the
     half that still holds when the client is stale, hand-rolled, or wrong.

     Checked ONLY when the assignee changes, which is what keeps it from
     stranding work already in flight. If a technician's role is revoked
     mid-job, every remaining transition on that work order still runs and a
     Manager can still reassign it -- reassignment names a valid technician, so
     it passes. Only a NEW bad assignment is refused.

     Above the admin bypass, following the self-assignment rule directly above
     and 0015's self-role-change lock. A rule whose whole purpose is to stop a
     work order becoming unmovable is worthless if the account most likely to be
     tidying up is exempt, and it costs an Administrator nothing they need:
     correcting a stuck record means assigning it to a real technician, which
     this permits. Assigning it to a non-technician only deepens the hole. */
  if new.assigned_to_id is distinct from old.assigned_to_id
     and new.assigned_to_id is not null then
    select name, roles, status into v_assignee
      from users
     where id = new.assigned_to_id;

    if not found then
      raise exception 'That account no longer exists. Reload and choose another technician.'
        using errcode = 'no_data_found';
    end if;

    if not ('technician' = any(v_assignee.roles)) then
      raise exception '% does not hold the Technician role, so they could never accept this work order. Grant it in Admin -> Users, or choose another technician.',
        coalesce(v_assignee.name, 'That account')
        using errcode = 'check_violation';
    end if;

    if v_assignee.status <> 'active' then
      raise exception 'The account for % is inactive, so they could never accept this work order. Reactivate it in Admin -> Users, or choose another technician.',
        coalesce(v_assignee.name, 'That account')
        using errcode = 'check_violation';
    end if;
  end if;

  /* Verify-and-close has to say what was verified, and the rule is checked
     ABOVE the admin bypass so it binds every role including Administrator and
     Superuser -- the same placement the self-assignment lock directly above
     uses, and 0015's self-role-change lock before it.

     That placement is the point rather than tidiness. The matrix's `requires`
     loop at the bottom of this function covers the requester and the manager,
     and an Administrator never reaches it: the bypass returns first.
     Administrators are also the accounts most likely to be closing a work order
     verified out-of-band -- "Force verify & close" is theirs -- so exempting
     them would exempt the case the note exists for.

     Only forward, and only from `completed`. Nothing here reaches a work order
     that is already closed, so records closed before this migration keep their
     null note and stay readable, exportable and unedited. */
  if new.status = 'closed' and old.status = 'completed'
     and coalesce(btrim(new.verification_notes), '') = '' then
    raise exception 'Closing a work order needs a note saying what was verified. Add one and try again.'
      using errcode = 'not_null_violation';
  end if;

  -- Administrator bypasses the matrix outright. Deliberate and narrow; policy,
  -- not this trigger, is what keeps it used sparingly.
  if si_has_role('admin') then return new; end if;

  if cardinality(si_roles()) = 0 then
    raise exception 'Your account has no role assigned — sign out and back in.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t
    from wo_status_transitions
   where from_status = old.status and to_status = new.status;

  if not found then
    raise exception '% is not a permitted transition from %.', new.status, old.status
      using errcode = 'check_violation';
  end if;

  v_eligible := si_eligible_roles(t.roles, old.assigned_to_id, old.requester_id);

  /* Two different refusals, because they send the reader to different places.
     Holding none of the transition's roles is "your job does not do this".
     Holding one but failing its scope test is "not on this record". */
  if cardinality(v_eligible) = 0 then
    if not (si_roles() && t.roles) then
      raise exception 'A % may not perform "%" (% -> %).',
        array_to_string(array(select r::text from unnest(si_roles()) r), '/'),
        coalesce(t.label, 'this transition'), old.status, new.status
        using errcode = 'insufficient_privilege';
    elsif 'technician' = any(t.roles) and si_has_role('technician') then
      raise exception 'You can only act on work orders assigned to you.'
        using errcode = 'insufficient_privilege';
    else
      raise exception 'You can only act on work orders you raised.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if t.requires_assignee_change
     and new.assigned_to_id is not distinct from old.assigned_to_id then
    raise exception 'Reassigning a work order at status "%" requires a different technician.', old.status
      using errcode = 'check_violation';
  end if;

  -- Required fields must be present and non-empty.
  foreach v_field in array t.requires loop
    if coalesce(to_jsonb(new) ->> v_field, '') = '' then
      raise exception '"%" is required for "%" (% -> %).',
        v_field, coalesce(t.label, 'this transition'), old.status, new.status
        using errcode = 'not_null_violation';
    end if;
  end loop;

  return new;
end;
$$;

-- Restated: idempotent, and a trigger function reachable by `authenticated`
-- would let a caller invoke it outside a trigger context.
revoke all on function si_guard_work_order_transition() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The RPC: 0020's function with the column added to its explicit whitelist.
-- ---------------------------------------------------------------------------
create or replace function si_transition_work_order(
  p_wo_id      uuid,
  p_to_status  si_wo_status,
  p_fields     jsonb        default '{}'::jsonb,
  p_remarks    text         default null,
  p_via_status si_wo_status default null
)
returns work_orders
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_from        si_wo_status;
  v_assigned_to uuid;
  v_requester   uuid;
  v_trans_roles si_role[];
  v_actor_name  text;
  v_actor_role  si_role;
  v_row         work_orders;
begin
  -- The pre-update values: si_eligible_roles judges the row as it stands now,
  -- which is the same thing the BEFORE UPDATE trigger sees in OLD.
  select status, assigned_to_id, requester_id
    into v_from, v_assigned_to, v_requester
    from work_orders where id = p_wo_id;
  if not found then
    raise exception 'Work order not found, or outside what your role can see.'
      using errcode = 'no_data_found';
  end if;

  select name into v_actor_name from users where id = auth.uid();
  if v_actor_name is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- The first of the (possibly two) transitions is the one the caller had to be
  -- authorised for; p_via_status only exists because verify-and-close records an
  -- intermediate step the same actor performed.
  select roles into v_trans_roles
    from wo_status_transitions
   where from_status = v_from and to_status = coalesce(p_via_status, p_to_status);

  v_actor_role := (
    select r
      from unnest(si_eligible_roles(coalesce(v_trans_roles, '{}'::si_role[]), v_assigned_to, v_requester)) r
     order by si_role_rank(r::text) desc
     limit 1
  );

  -- Empty means the admin bypass: an Administrator skips the matrix, so no
  -- transition row constrained them and there is no "eligible" role to name.
  -- Their highest role is the honest answer.
  if v_actor_role is null then
    v_actor_role := nullif(si_role(), '')::si_role;
  end if;

  -- Explicit whitelist rather than dynamic SQL from p_fields. Only the columns a
  -- transition is ever allowed to carry can be set here; anything else in the
  -- payload is ignored rather than trusted. The trigger-owned columns
  -- (wo_number, the SLA deadlines, decline_count, resolved_at, closed_at,
  -- verified_at, sla_breached) are deliberately absent.
  update work_orders set
    status            = p_to_status,
    assigned_to_id    = case when p_fields ? 'assigned_to_id'
                             then nullif(p_fields->>'assigned_to_id', '')::uuid
                             else assigned_to_id end,
    assigned_to_name  = case when p_fields ? 'assigned_to_name'
                             then p_fields->>'assigned_to_name' else assigned_to_name end,
    decline_reason    = case when p_fields ? 'decline_reason'
                             then p_fields->>'decline_reason' else decline_reason end,
    spare_part_reason = case when p_fields ? 'spare_part_reason'
                             then p_fields->>'spare_part_reason' else spare_part_reason end,
    test_fail_reason  = case when p_fields ? 'test_fail_reason'
                             then p_fields->>'test_fail_reason' else test_fail_reason end,
    resolution_notes  = case when p_fields ? 'resolution_notes'
                             then p_fields->>'resolution_notes' else resolution_notes end,
    reopen_reason     = case when p_fields ? 'reopen_reason'
                             then p_fields->>'reopen_reason' else reopen_reason end,
    verified_by       = case when p_fields ? 'verified_by'
                             then nullif(p_fields->>'verified_by', '')::uuid
                             else verified_by end,
    verification_notes = case when p_fields ? 'verification_notes'
                             then p_fields->>'verification_notes'
                             else verification_notes end
  where id = p_wo_id
  returning * into v_row;

  -- RLS filters a denied UPDATE to zero rows rather than raising, so this is
  -- where a permission failure surfaces.
  if not found then
    raise exception 'You do not have permission to change this work order.'
      using errcode = 'insufficient_privilege';
  end if;

  -- p_via_status covers verify-and-close, where the status goes straight from
  -- completed to closed but the trail must still show the verification step.
  if p_via_status is not null then
    insert into work_order_history
      (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
    values
      (p_wo_id, v_from, p_via_status, auth.uid(), v_actor_name, v_actor_role, p_remarks),
      (p_wo_id, p_via_status, p_to_status, auth.uid(), v_actor_name, v_actor_role, null);
  else
    insert into work_order_history
      (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks)
    values
      (p_wo_id, v_from, p_to_status, auth.uid(), v_actor_name, v_actor_role, p_remarks);
  end if;

  return v_row;
end
$fn$;

revoke all on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) from public, anon;
grant execute on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) to authenticated;

comment on function si_transition_work_order(uuid, si_wo_status, jsonb, text, si_wo_status) is
  'Atomically advance a work order and append its history row, stamping the role the caller was authorised under. SECURITY INVOKER: RLS and the transition guard still apply.';
