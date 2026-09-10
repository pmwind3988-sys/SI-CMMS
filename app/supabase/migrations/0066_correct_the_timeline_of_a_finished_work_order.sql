-- ============================================================================
-- SI — Service Inside · 0066 The timeline fix reaches a finished work order too
-- ============================================================================
-- 0065 let a Superuser rescue a work order abandoned *mid-work* — one still
-- sitting in repairing / waiting_spare_part / testing. But an abandonment is
-- often not noticed until after someone has closed the job: the record then says
-- it breached, the breach counts, and there was no way to put it right because
-- 0065 refused anything already finished.
--
-- This widens `si_correct_work_order_timeline` to accept `completed` and
-- `closed` as well — **including a work order an HOD has already signed off**.
-- Rewriting the SLA outcome of a finished, verified record is the most
-- consequential thing this schema lets anyone do, which is exactly why it stays
-- what 0065 made it: Superuser only, a reason required, and every correction
-- written to the audit columns, to the timeline, and to the dashboard.
--
-- ---------------------------------------------------------------------------
-- Two paths, chosen by whether work is still under way
-- ---------------------------------------------------------------------------
-- UNDER WAY (repairing / waiting_spare_part / testing) — unchanged from 0065:
--   force it to completed through the real completion path, then backdate. The
--   two-UPDATE shape and every note in 0065 still apply.
--
-- FINISHED (completed / closed) — new, and simpler because there is nothing to
--   force: the job is already done. A single UPDATE that leaves the status where
--   it is backdates `resolved_at` (and `closed_at`, when it is closed) to the
--   corrected time and recomputes `sla_breached` against it. Because the status
--   does not move, si_stamp_work_order, si_notify_work_order_update and
--   si_auto_close_completed all hit their `new.status = old.status` early
--   returns and do nothing — the same mechanism 0051 and 0064 rely on. No
--   transition history rows are written or rewritten: the Completed/Closed rungs
--   already happened and their timestamps are the real record of when. Only the
--   `timeline_correction` audit row is added, and it carries the corrected time
--   and the reason.
--
-- `verified_at` is deliberately left untouched on the finished path. Correcting
-- when a job finished, or clearing a spurious breach, is not un-signing it off —
-- the Head of Department still verified it, and that stands.
--
-- ---------------------------------------------------------------------------
-- Nothing else changes
-- ---------------------------------------------------------------------------
-- The guard (si_guard_timeline_correction), the door (si_timeline_correction)
-- and the four audit columns are 0065's and are untouched. The function
-- signature is identical, so no client type regenerates. The door is still
-- opened only for the correction's own statements and closed straight after.
-- ============================================================================

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
           sla_breached               = (sla_resolution_due_at is not null and sla_resolution_due_at < p_completed_at),
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

  -- UNDER-WAY path — 0065's behaviour, unchanged.
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
     set resolved_at  = p_completed_at,
         closed_at    = p_completed_at,
         sla_breached = (sla_resolution_due_at is not null and sla_resolution_due_at < p_completed_at)
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
  'Superuser-only timeline fix. Under-way work orders (repairing/waiting/testing) are forced to completed then backdated (0065); finished ones (completed/closed, verified or not) are backdated in place with the breach recomputed and the status left where it is (migration 0066).';
