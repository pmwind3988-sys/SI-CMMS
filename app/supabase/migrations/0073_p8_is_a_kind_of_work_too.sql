-- ============================================================================
-- SI — Service Inside · 0073 P8 is a kind of work too
-- ============================================================================
-- 0051 moves the impact to `long_term` whenever an Administrator overrides a
-- work order to P7, on the grounds that P7 is not a severity, it is a *kind of
-- work* — "Full production stoppage · P7" is a contradiction rather than a
-- re-graded job, and rewriting the impact would destroy the requester's own
-- observation. 0072's P8 is exactly the same kind of value: `scheduled` exists
-- only because since 0036 nobody picks a priority, so a priority with no
-- impact deriving it would be a value the raise form could never reach — the
-- same reason 0050 gave `long_term` for P7. 0072's own header invokes that 1:1
-- impact -> priority map as P8's whole justification.
--
-- Left where 0051/0072 shipped it, the rule was enforced for one of the two
-- values it names in prose and not the other: overriding or extending to P8
-- stored `priority = 'P8'` next to whatever severity the requester had picked,
-- so a row could read "Full production stoppage · P8" — a contradiction this
-- codebase already has a name for and had already decided how to close.
--
-- **The impact moves only for P7 and P8, and never for P1-P4 — same as 0051.**
-- P1 through P4 ARE severities: "what is this doing to production" is a fact
-- the requester observed at the machine, and an Administrator re-grading the
-- priority is disagreeing with the *grading* of that fact, not the fact
-- itself. Rewriting it would destroy the input si_derive_priority is computed
-- from and leave the row with no trace that it had ever read differently. P7
-- and P8 are not severities at all — they are a statement about the shape of
-- the work (long-term repair, scheduled maintenance) that a severity value
-- cannot also carry, so there is nothing for the override to preserve by
-- leaving them alone.
--
-- ---------------------------------------------------------------------------
-- Two call sites, one rule
-- ---------------------------------------------------------------------------
-- `si_override_work_order_priority` (0051) gets the `case` widened to cover
-- both values and nothing else — reproduced here in full and diffed against
-- 0051's body before commit.
--
-- `si_extend_work_order_sla` (0072) gets the same `case`, because it currently
-- never touches `impact` at all: extending to P8 produced the identical
-- contradiction by omission rather than by an unguarded write. The extension
-- RPC has no `p_reason` column of its own to carry an Administrator's
-- explanation the way 0051's does, so the generated remark is the only place
-- the requester's original answer survives once it is displaced — the clause
-- naming it is appended to the remark only when the impact actually changes,
-- reading both labels out of `impact_levels` and falling back to the raw code
-- the same way the priority labels already do.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- si_override_work_order_priority — 0051's body, P8 added to the same case
-- ---------------------------------------------------------------------------
create or replace function si_override_work_order_priority(
  p_work_order_id uuid,
  p_priority      si_priority,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w            work_orders;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_old_label  text;
  v_new_label  text;
  v_target     si_priority;
  v_impact     si_impact;
  v_ack        int;
  v_resp       int;
  v_res        int;
  v_seq        boolean;
  v_ack_due    timestamptz;
  v_resp_due   timestamptz;
  v_res_due    timestamptz;
  v_breached   boolean;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- RLS does not apply inside a SECURITY DEFINER function, so the rank rule is
  -- restated here rather than assumed from the grant.
  if not si_is_admin() then
    raise exception 'Only an Administrator can change a work order''s priority.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(v_reason) < 10 then
    raise exception 'Give a reason of at least 10 characters. It is recorded on the work order and shown to whoever is working on it.'
      using errcode = 'check_violation';
  end if;

  select * into w from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  if w.status in ('verified', 'closed') then
    raise exception 'This work order is finished, so its priority is part of the record now and cannot be changed.'
      using errcode = 'check_violation';
  end if;

  if p_priority is not null then
    if not exists (select 1 from priorities where id = p_priority and is_active) then
      raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
    end if;
  end if;

  -- What the priority will actually become: the override if there is one, the
  -- derivation if there is not. Computed here rather than read back after the
  -- UPDATE because the SLA has to be recomputed in the same statement.
  v_target := coalesce(p_priority,
                       si_derive_priority(w.impact, w.safety_risk, w.environmental_risk),
                       w.priority);

  if v_target = w.priority and p_priority is not distinct from w.priority_override then
    raise exception 'That is already this work order''s priority.' using errcode = 'check_violation';
  end if;

  -- Only P7 and P8 move the impact — see this file's header. Note the absence
  -- of `status` and `assigned_to_id` from the UPDATE below: see 0051 note 5.
  v_impact := case when p_priority = 'P7' then 'long_term'::si_impact
                    when p_priority = 'P8' then 'scheduled'::si_impact
                    else w.impact end;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(v_target);

  v_ack_due := w.created_at + make_interval(mins => v_ack);

  if v_seq then
    v_resp_due := case when w.acknowledged_at is not null
                       then w.acknowledged_at + make_interval(mins => v_resp) end;
    v_res_due  := case when w.responded_at is not null
                       then w.responded_at + make_interval(mins => v_res) end;
  else
    v_resp_due := w.created_at + make_interval(mins => v_resp);
    v_res_due  := w.created_at + make_interval(mins => v_res);
  end if;

  v_breached := v_res_due is not null and v_res_due < now();

  select label into v_old_label from priorities where id = w.priority;
  select label into v_new_label from priorities where id = v_target;
  select name  into v_actor_name from users where id = v_actor;

  -- The door, for this statement only. `set local` dies with the transaction,
  -- so a pooled connection cannot carry it into the next one.
  perform set_config('si.allow_priority_override', 'on', true);

  update work_orders
     set priority_override        = p_priority,
         priority_override_reason = v_reason,
         priority_overridden_by   = v_actor,
         priority_overridden_at   = now(),
         impact                   = v_impact,
         sla_ack_due_at           = v_ack_due,
         sla_response_due_at      = v_resp_due,
         sla_resolution_due_at    = v_res_due,
         sla_breached             = v_breached,
         -- Only reset when the new deadline is still ahead: a work order that
         -- is already past its recomputed deadline has nothing left to warn
         -- about, and re-arming it there would send a warning after the breach.
         sla_warning_sent         = case when v_breached then w.sla_warning_sent else false end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

  /* On the timeline, not merely in a column.
     from_status = to_status = the status it is sitting in, which on this schema
     is NOT a way of saying "not a transition" — ('assigned','assigned') is row
     3 of 0003's matrix. `event_type` is what says so, which is the whole reason
     0043 added the column. */
  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks, event_type)
  values
    (p_work_order_id, w.status, w.status, v_actor, v_actor_name, 'admin',
     coalesce(v_old_label, w.priority::text) || ' (' || w.priority || ') -> ' ||
     coalesce(v_new_label, v_target::text)   || ' (' || v_target  || '). ' || v_reason,
     'priority_override');

  /* Told to the two people it changes something for, and to neither if they
     are the one who did it. Deliberately NOT the whole ops chain the way 0038
     fans accept and decline out: `notifications` still has no retention and no
     per-account mute, and a re-grade is not a routing problem anybody else has
     to act on. `distinct` because on a small site the requester and the
     assignee can be the same person, and one notification is enough. */
  perform si_notify(r.id, r.role, p_work_order_id, coalesce(w.wo_number, 'Work order'),
                    'priority_changed',
                    'Priority changed to ' || v_target,
                    coalesce(w.wo_number, 'A work order') || ' is now ' ||
                    coalesce(v_new_label, v_target::text) || ' (' || v_target || '), was ' ||
                    coalesce(v_old_label, w.priority::text) || ' (' || w.priority || '). ' || v_reason)
    from (select w.assigned_to_id as id, 'technician'::si_role as role
           where w.assigned_to_id is not null
             and w.assigned_to_id is distinct from v_actor
             and w.assigned_to_id is distinct from w.requester_id
          union all
          select w.requester_id, 'requester'::si_role
           where w.requester_id is distinct from v_actor) r;
end;
$$;

revoke all on function si_override_work_order_priority(uuid, si_priority, text) from public, anon;
grant execute on function si_override_work_order_priority(uuid, si_priority, text) to authenticated;

-- ---------------------------------------------------------------------------
-- si_extend_work_order_sla — 0072's body (with fix-round-1's three touch-ups
-- already folded in), with the same impact rule added
-- ---------------------------------------------------------------------------
create or replace function si_extend_work_order_sla(
  p_work_order_id uuid,
  p_priority      si_priority
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w                  work_orders;
  v_actor            uuid := auth.uid();
  v_actor_name       text;
  v_stage            text;
  v_started          timestamptz;
  v_due              timestamptz;
  v_old_rank         int;
  v_new_rank         int;
  v_old_label        text;
  v_new_label        text;
  v_impact           si_impact;
  v_old_impact_label text;
  v_new_impact_label text;
  v_ack              int;
  v_resp             int;
  v_res              int;
  v_seq              boolean;
  v_ack_due          timestamptz;
  v_resp_due         timestamptz;
  v_res_due          timestamptz;
  v_new_due          timestamptz;
  v_remark           text;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  if not si_is_admin() then
    raise exception 'Only an Administrator can extend a work order''s SLA.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into w from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  if w.status in ('completed', 'verified', 'closed') then
    raise exception 'This work order is finished, so its SLA is part of the record now and cannot be extended.'
      using errcode = 'check_violation';
  end if;

  if p_priority is null then
    raise exception 'Choose the priority to extend this work order to.' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from priorities where id = p_priority and is_active) then
    raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
  end if;

  select rank, label into v_old_rank, v_old_label from priorities where id = w.priority;
  select rank, label into v_new_rank, v_new_label from priorities where id = p_priority;

  /* Rank ascending is severity descending, so less urgent is a GREATER rank.
     This is the one rule si_override_work_order_priority must NOT have: a
     re-grade legitimately moves in both directions, an extension never does. */
  if v_new_rank is null or v_old_rank is null or v_new_rank <= v_old_rank then
    raise exception 'Extending an SLA can only move a work order to a lower priority than % (%).',
      coalesce(v_old_label, w.priority::text), w.priority
      using errcode = 'check_violation';
  end if;

  v_stage   := si_open_sla_stage(w);
  v_started := si_open_stage_started_at(w);
  v_due     := si_open_stage_due_at(w);

  if v_stage is null then
    raise exception 'This work order has no SLA stage running, so there is nothing to extend.'
      using errcode = 'check_violation';
  end if;

  /* The gate canExtendSla() mirrors. Overdue, or inside the last quarter of the
     open stage's own window — si_sla_warning_sweep's threshold. */
  if v_due is null then
    raise exception 'This work order''s % stage has no deadline yet, so there is nothing to extend.', v_stage
      using errcode = 'check_violation';
  end if;

  if v_due > now() and (v_started is null or (v_due - now()) > (v_due - v_started) * 0.25) then
    raise exception 'This work order still has most of its % time left. An SLA is extended when it is running out, not before.', v_stage
      using errcode = 'check_violation';
  end if;

  -- Only P7 and P8 move the impact — same rule, same reason, as
  -- si_override_work_order_priority above. The extension RPC has no reason
  -- column of its own, so the displaced impact is named in the generated
  -- remark below instead, which is the only place the requester's original
  -- answer survives once it moves.
  v_impact := case when p_priority = 'P7' then 'long_term'::si_impact
                    when p_priority = 'P8' then 'scheduled'::si_impact
                    else w.impact end;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(p_priority);

  /* Recomputed from the raise time and the recorded stage moments, exactly as
     0051 does it — never from now(). The fault is as old as it is, and
     restarting the clock would reward extending a job that is already late. */
  v_ack_due := w.created_at + make_interval(mins => v_ack);

  if v_seq then
    v_resp_due := case when w.acknowledged_at is not null
                       then w.acknowledged_at + make_interval(mins => v_resp) end;
    v_res_due  := case when w.responded_at is not null
                       then w.responded_at + make_interval(mins => v_res) end;
  else
    v_resp_due := w.created_at + make_interval(mins => v_resp);
    v_res_due  := w.created_at + make_interval(mins => v_res);
  end if;

  v_new_due := case v_stage when 'acknowledge' then v_ack_due
                            when 'response'    then v_resp_due
                            when 'resolution'  then v_res_due end;

  select name into v_actor_name from users where id = v_actor;

  v_remark := 'SLA extended: ' || coalesce(v_old_label, w.priority::text) || ' (' || w.priority ||
              ') -> ' || coalesce(v_new_label, p_priority::text) || ' (' || p_priority ||
              '). ' || initcap(v_stage) || ' stage now due ' ||
              coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                       'when the stage starts') || '.';

  -- Named only when the impact actually changed — an extension to P3 or any
  -- other severity never touches it, so the remark stays silent about a move
  -- that did not happen.
  if v_impact is distinct from w.impact then
    select label into v_old_impact_label from impact_levels where code = w.impact;
    select label into v_new_impact_label from impact_levels where code = v_impact;
    v_remark := v_remark || ' Production impact moved from "' ||
                coalesce(v_old_impact_label, w.impact::text) || '" to "' ||
                coalesce(v_new_impact_label, v_impact::text) || '".';
  end if;

  perform set_config('si.allow_priority_override', 'on', true);

  /* `status` and the assignee are deliberately NOT named — 0051 note 5. An
     extension changes what is expected of a work order, not who is doing it or
     how far along it is, and si_stamp_work_order's decline branch is three
     lines below a test this UPDATE must never reach.
     The three sticky breach flags are NOT reset either: a stage that was missed
     was missed, and granting more time afterwards does not un-miss it. Only
     sla_stage_overdue moves, because the stage may no longer be late. */
  update work_orders
     set priority_override        = p_priority,
         priority_override_reason = v_remark,
         priority_overridden_by   = v_actor,
         priority_overridden_at   = now(),
         sla_extension_count      = coalesce(sla_extension_count, 0) + 1,
         impact                   = v_impact,
         sla_ack_due_at           = v_ack_due,
         sla_response_due_at      = v_resp_due,
         sla_resolution_due_at    = v_res_due,
         sla_breached             = sla_ack_breached or sla_response_breached or sla_resolution_breached,
         sla_stage_overdue        = (v_new_due is not null and v_new_due < now()),
         sla_warning_sent         = case when v_new_due is not null and v_new_due > now()
                                         then false else sla_warning_sent end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks, event_type)
  values
    (p_work_order_id, w.status, w.status, v_actor, v_actor_name, 'admin', v_remark, 'sla_extension');

  /* The two people it changes something for, and neither of them if they are
     the one who did it. `distinct` because on a small site the requester and
     the assignee can be the same person. Deliberately not the ops chain: an
     extension is not a routing problem anybody else has to act on, and
     notifications still has no retention. */
  perform si_notify(r.id, r.role, p_work_order_id, coalesce(w.wo_number, 'Work order'),
                    'priority_changed',
                    'SLA extended to ' || p_priority,
                    coalesce(w.wo_number, 'A work order') || ' has been extended to ' ||
                    coalesce(v_new_label, p_priority::text) || ' (' || p_priority || '), was ' ||
                    coalesce(v_old_label, w.priority::text) || ' (' || w.priority || '). ' ||
                    initcap(v_stage) || ' stage now due ' ||
                    coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                             'when the stage starts') || '.',
                    w.status)
    from (select w.assigned_to_id as id, 'technician'::si_role as role
           where w.assigned_to_id is not null
             and w.assigned_to_id is distinct from v_actor
             and w.assigned_to_id is distinct from w.requester_id
          union all
          select w.requester_id, 'requester'::si_role
           where w.requester_id is distinct from v_actor) r;
end;
$$;

revoke all on function si_extend_work_order_sla(uuid, si_priority) from public, anon;
grant execute on function si_extend_work_order_sla(uuid, si_priority) to authenticated;
