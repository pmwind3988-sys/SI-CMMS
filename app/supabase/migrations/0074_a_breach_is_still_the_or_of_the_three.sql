-- ============================================================================
-- SI — Service Inside · 0074 A breach is still the OR of the three
-- ============================================================================
-- 0067 redefined `sla_breached` as "any stage was ever missed" —
-- `sla_ack_breached or sla_response_breached or sla_resolution_breached` —
-- and made it sticky: once a stage's own flag is set, nothing clears it by
-- the passage of time or by anything short of a named correction. 0068's two
-- sweeps, 0069/0070's backfill, and `si_extend_work_order_sla` (0072/0073) all
-- honour that. Three writers did not, and each still carried the pre-0067
-- line `sla_breached := <resolution deadline> < <some instant>` — a leftover
-- from when the resolution deadline was the only one that existed.
--
-- The reachable failure this fixes: a P2 raised at 09:00 misses its 15-minute
-- acknowledge target and is assigned at 09:40 — `sla_ack_breached` and
-- `sla_breached` both true. Work has not started, so `responded_at` and the
-- resolution deadline are both still null. An Administrator re-grades it to
-- P3 at 10:00 through `si_override_work_order_priority`. The old body computed
-- `v_breached := v_res_due is not null and v_res_due < now()`, which is false
-- (v_res_due is null), and wrote `sla_breached = false` while
-- `sla_ack_breached` stayed true and nothing ever restores it — 0068's sweep
-- only touches a stage whose own sticky flag is not yet set. The export then
-- prints "SLA Status: Within target" beside "Ack Stage Missed: Yes" on the
-- same row.
--
-- The three writers, and why each could only be fixed here:
--
--   si_override_work_order_priority (0051, last reproduced whole in 0073) —
--     `v_breached` computed from the resolution deadline alone. 0073 is
--     applied; an applied migration is never re-run, so the only way to
--     change this function's body is a later `create or replace` in a new
--     file.
--
--   si_correct_work_order_timeline (0065, revised whole in 0066) — the
--     FINISHED path recomputes `sla_breached` from
--     `sla_resolution_due_at < p_completed_at` alone when backdating a
--     completed/closed work order's completion time, and the UNDER-WAY path's
--     second UPDATE does the same when forcing a stuck work order through
--     `completed`. Both need the corrected `sla_resolution_breached` folded in
--     first — the correction can retroactively turn a resolution stage from
--     on-time to breached (or the reverse), and `sla_breached` has to read
--     that new verdict, not skip it. 0066 is applied; same reasoning as above.
--
-- Both functions are reproduced here in full — the whole body, not a diff —
-- because `create or replace function` replaces the entire definition, and
-- Postgres has no partial-body syntax. Diffed against their sources before
-- commit; the only differences are the ones named below.
--
-- ---------------------------------------------------------------------------
-- si_override_work_order_priority: also recomputes sla_stage_overdue
-- ---------------------------------------------------------------------------
-- Reproduced from 0073 with two changes: `sla_breached` reads the OR of the
-- three sticky flags (bare column references in an UPDATE's SET list read the
-- OLD row, which is exactly what is wanted — an override does not move the
-- sticky flags, it only might close the gap that made one of them true going
-- forward). And `sla_stage_overdue` is recomputed from the open stage's new
-- deadline, the way `si_extend_work_order_sla` already does — without it the
-- dashboard's Overdue card would carry a stale verdict until the next sweep,
-- up to five minutes after an Administrator just changed the very deadline
-- that verdict is about.
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
  v_stage      text;
  v_new_due    timestamptz;
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

  -- Which stage is currently open (unaffected by this UPDATE — status,
  -- acknowledged_at and responded_at all stay put) and what it is now due,
  -- under the recomputed deadlines above.
  v_stage := si_open_sla_stage(w);
  v_new_due := case v_stage when 'acknowledge' then v_ack_due
                            when 'response'    then v_resp_due
                            when 'resolution'  then v_res_due end;

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
         -- The permanent record is the OR of the three sticky flags, not the
         -- resolution deadline alone (0074) — an override does not move the
         -- sticky flags (bare references on the right read OLD), it can only
         -- leave `sla_breached` correctly true when an earlier stage already
         -- missed its own deadline, which the pre-0074 line silently cleared.
         sla_breached             = sla_ack_breached or sla_response_breached or sla_resolution_breached,
         -- TRANSIENT: recomputed against the open stage's new deadline (0074),
         -- the same shape si_extend_work_order_sla already uses — otherwise
         -- the dashboard's Overdue card carries a stale verdict until the next
         -- sweep, up to five minutes after the very deadline it is about just
         -- moved.
         sla_stage_overdue        = (v_new_due is not null and v_new_due < now()),
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
-- si_correct_work_order_timeline: recompute sla_resolution_breached against
-- the corrected instant, then read sla_breached off all three
-- ---------------------------------------------------------------------------
-- Reproduced from 0066 (which itself revised 0065) in full. Two sites change,
-- both named in 0066's own comments as "recomputes the breach":
--
--   FINISHED path (completed/closed, status unchanged) — was
--     `sla_breached := (sla_resolution_due_at is not null
--                        and sla_resolution_due_at < p_completed_at)`.
--   Now recomputes `sla_resolution_breached` against the corrected completion
--   time first (`or`'d with its own old value, since a correction can only
--   ever be discovering a breach that was missed or fixing one that was
--   wrongly recorded going forward from here — either way the stage's own
--   flag has to reflect the corrected instant), then derives `sla_breached`
--   from all three. `sla_ack_breached` / `sla_response_breached` are
--   untouched: this path never moves `acknowledged_at` or `responded_at`.
--
--   UNDER-WAY path's second UPDATE (forcing repairing/waiting_spare_part/
--   testing through completed, then backdating) — same fix, same reasoning:
--   the resolution stage's own flag has to be recomputed against the
--   corrected `p_completed_at` before `sla_breached` reads it.
-- ---------------------------------------------------------------------------

create or replace function si_correct_work_order_timeline(
  p_work_order_id uuid,
  p_completed_at  timestamptz,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w             work_orders;
  v_reason      text := btrim(coalesce(p_reason, ''));
  v_actor       uuid := auth.uid();
  v_actor_name  text;
  v_started     timestamptz;
  v_note        text;
  v_finished    boolean;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- Superuser only — restated here because RLS does not apply inside a SECURITY
  -- DEFINER function.
  if not si_is_superuser() then
    raise exception 'Only a Superuser can correct a work order''s timeline.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(v_reason) < 10 then
    raise exception 'Give a reason of at least 10 characters. It is recorded on the work order and on its timeline.'
      using errcode = 'check_violation';
  end if;

  select * into w from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  -- Now: under way OR finished. Only the not-yet-started statuses are refused —
  -- there is no completion to record for a work order nobody has worked on.
  if w.status not in ('repairing', 'waiting_spare_part', 'testing', 'completed', 'closed') then
    raise exception 'This work order has not been worked on yet (it is %), so there is no completion time to correct.', w.status
      using errcode = 'check_violation';
  end if;

  v_finished := w.status in ('completed', 'closed');

  -- When work actually started, the earliest a completion can honestly be.
  v_started := coalesce(w.responded_at, w.acknowledged_at, w.created_at);

  if p_completed_at is null then
    raise exception 'Give the time the work was actually finished.' using errcode = 'not_null_violation';
  end if;
  if p_completed_at > now() then
    raise exception 'The completion time cannot be in the future.' using errcode = 'check_violation';
  end if;
  if p_completed_at < v_started then
    raise exception 'The completion time cannot be before the work started (%).', v_started
      using errcode = 'check_violation';
  end if;

  select name into v_actor_name from users where id = v_actor;

  -- The door, for this correction's statements only.
  perform set_config('si.allow_timeline_correction', 'on', true);

  if v_finished then
    -- FINISHED path — status unchanged, so no trigger runs destructively. Just
    -- backdate the completion and recompute the breach.
    update work_orders
       set resolved_at                = p_completed_at,
           closed_at                  = case when status = 'closed' then p_completed_at else closed_at end,
           -- The resolution stage's own sticky flag, recomputed against the
           -- corrected instant rather than now() (0074). `or`'d with its own
           -- old value so a correction that moves the completion time earlier
           -- never un-sticks a genuinely-missed stage it isn't touching.
           sla_resolution_breached    = sla_resolution_breached
             or (sla_resolution_due_at is not null and sla_resolution_due_at < p_completed_at),
           -- `sla_breached` is the OR of all three sticky flags (0074), not
           -- the resolution deadline alone — ack/response are untouched by
           -- this path. Every bare column reference on the right of a
           -- single-table UPDATE's SET list reads OLD regardless of what
           -- else the same statement assigns, so `sla_resolution_breached`
           -- here would still read the pre-correction value; the resolution
           -- recomputation is restated in full rather than relying on the
           -- sibling assignment above.
           sla_breached               = sla_ack_breached or sla_response_breached
             or (sla_resolution_breached or (sla_resolution_due_at is not null and sla_resolution_due_at < p_completed_at)),
           timeline_corrected_by      = v_actor,
           timeline_corrected_at      = now(),
           timeline_correction_reason = v_reason,
           timeline_original_status   = w.status
     where id = p_work_order_id;

    perform set_config('si.allow_timeline_correction', 'off', true);

    insert into work_order_history
      (work_order_id, from_status, to_status, event_type,
       actor_id, actor_name, actor_role, remarks)
    values
      (p_work_order_id, w.status, w.status, 'timeline_correction',
       v_actor, coalesce(v_actor_name, 'Superuser'), 'admin',
       'Timeline corrected on a ' || w.status || ' work order: completion time set to '
         || to_char(p_completed_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI')
         || ', SLA recomputed. ' || v_reason);

    perform si_refresh_dashboard_stats();
    return;
  end if;

  -- UNDER-WAY path — 0065's behaviour, unchanged except for the same
  -- sla_breached fix as the FINISHED path above.
  v_note := 'Marked completed by ' || coalesce(v_actor_name, 'a Superuser')
            || ' (timeline correction). ' || v_reason;

  update work_orders
     set status                     = 'completed',
         resolution_notes           = coalesce(nullif(btrim(resolution_notes), ''), v_note),
         timeline_corrected_by      = v_actor,
         timeline_corrected_at      = now(),
         timeline_correction_reason = v_reason,
         timeline_original_status   = w.status
   where id = p_work_order_id;

  update work_orders
     set resolved_at             = p_completed_at,
         closed_at               = p_completed_at,
         -- Same fix as the FINISHED path: the resolution stage's own sticky
         -- flag recomputed against the corrected instant, then sla_breached
         -- read off all three (0074).
         sla_resolution_breached = sla_resolution_breached
           or (sla_resolution_due_at is not null and sla_resolution_due_at < p_completed_at),
         sla_breached            = sla_ack_breached or sla_response_breached
           or (sla_resolution_breached or (sla_resolution_due_at is not null and sla_resolution_due_at < p_completed_at))
   where id = p_work_order_id;

  perform set_config('si.allow_timeline_correction', 'off', true);

  update work_order_history
     set created_at = p_completed_at
   where work_order_id = p_work_order_id
     and event_type = 'transition'
     and from_status = 'completed'
     and to_status   = 'closed'
     and created_at  = now();

  insert into work_order_history
    (work_order_id, from_status, to_status, event_type,
     actor_id, actor_name, actor_role, remarks, created_at)
  values
    (p_work_order_id, w.status, 'completed', 'transition',
     v_actor, coalesce(v_actor_name, 'Superuser'), 'admin', v_note, p_completed_at);

  insert into work_order_history
    (work_order_id, from_status, to_status, event_type,
     actor_id, actor_name, actor_role, remarks)
  values
    (p_work_order_id, w.status, 'closed', 'timeline_correction',
     v_actor, coalesce(v_actor_name, 'Superuser'), 'admin',
     'Timeline corrected: forced from ' || w.status || ' to completed, completion time set to '
       || to_char(p_completed_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI')
       || '. ' || v_reason);

  perform si_refresh_dashboard_stats();
end;
$$;

revoke all on function si_correct_work_order_timeline(uuid, timestamptz, text) from public, anon;
grant execute on function si_correct_work_order_timeline(uuid, timestamptz, text) to authenticated;

comment on function si_correct_work_order_timeline(uuid, timestamptz, text) is
  'Superuser-only timeline fix. Under-way work orders (repairing/waiting/testing) are forced to completed then backdated (0065); finished ones (completed/closed, verified or not) are backdated in place with the per-stage breach recomputed and the status left where it is (0066); sla_breached is the OR of all three sticky stage flags rather than the resolution deadline alone (0074).';
