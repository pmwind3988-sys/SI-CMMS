-- ============================================================================
-- SI - Service Inside · 0022 An assignment must land on someone who can move it
-- ============================================================================
-- The client half of this fix is listenTechnicians() in src/lib/workOrders.js,
-- which now intersects `technicians` with `users` on "holds technician" and
-- "is active". Per CLAUDE.md the client predicate decides what to SHOW and the
-- database decides what is ALLOWED; a predicate shipped without the matching
-- enforcement is a bug, so both halves are here.
--
-- REPRODUCED, 2026-08-19:
--   1. Priya Nair (supervisor@example.com) held ["supervisor","technician"].
--   2. Technician revoked via Admin -> Users -> Role. users.roles becomes
--      ["supervisor"]; her `technicians` row survives, which is deliberate.
--   3. WO-2026-000003 -> Assignment still listed "Priya Nair - 0 open jobs"
--      with a live Reassign button. Assigning her stranded the work order at
--      `assigned`: si_eligible_roles() reads the assignee's own roles, and
--      hers no longer contained `technician`, so she could never accept.
--
-- An account set inactive produced the same dead end, because the roster had no
-- status filter either.
--
-- ONE function is replaced and nothing else changes: no new object, no policy
-- change, no widening. si_guard_work_order_transition() is 0020's function with
-- one block added; `create or replace` keeps both the BEFORE UPDATE binding from
-- 0003 and the ACL 0007 revoked, so this adds no anon-callable surface. The
-- revoke is restated below anyway - it is idempotent, and CLAUDE.md is emphatic
-- that this is the step that gets forgotten.
--
-- NOT changed, deliberately:
--   * si_set_user_roles() still leaves the `technicians` row in place on revoke.
--     Skills and certifications are facts about the person; deleting them would
--     lose real data every time somebody's roles were edited, and re-granting
--     the role would silently return an empty skill list.
--   * work_orders INSERT is not guarded. This is a BEFORE UPDATE trigger and the
--     raise form does not assign, so there is no path that creates an already-
--     assigned work order from the client.
-- ============================================================================

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

-- Trigger functions are never called directly; 0007 revoked this one and
-- `create or replace` preserved that. Restated because it is idempotent and
-- cheap, and because a function reachable by `authenticated` here would let a
-- caller invoke it outside a trigger context.
revoke all on function si_guard_work_order_transition() from public, anon, authenticated;
