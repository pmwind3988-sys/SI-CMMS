-- ============================================================================
-- SI — Service Inside · 0065 A Superuser corrects a stuck work order's timeline
-- ============================================================================
-- A technician who does not know how to finish a job in `testing` can abandon
-- it: leave it sitting there, let its SLA breach, and move on. The record then
-- says the machine was never fixed and the plant missed its deadline, when
-- neither is true — the repair was done, the work order simply never moved.
--
-- This gives a **Superuser** an impromptu backend fix for exactly that: force
-- the work order to completed, set the real completion time (typically when
-- work was actually finished / when it entered `testing`), and let the SLA
-- breach and every downstream figure re-settle around the corrected time.
--
-- Superuser only, and a reason is required. Not a `role_permissions` toggle
-- like work-order delete (0018): rewriting a work order's lifecycle and clearing
-- a recorded SLA breach is closer to 0031's retire-reference-data and 0051's
-- priority re-grade — a judgement one trusted person makes and signs, not a
-- capability handed out.
--
-- ---------------------------------------------------------------------------
-- 1. It reuses the real completion path, then backdates — it does not fake one
-- ---------------------------------------------------------------------------
-- The obvious version — write `status = 'closed'` and a backdated `closed_at`
-- in one UPDATE — cannot work, because si_stamp_work_order (0061) is a BEFORE
-- trigger that overwrites `closed_at := now()` and recomputes `sla_breached`
-- against `now()` in that same statement. Whatever the RPC sets, the stamp
-- stomps.
--
-- So the correction is TWO writes, the same shape 0051 and 0064 use:
--
--   UPDATE #1  status -> 'completed'. This fires the whole audited machinery
--              exactly as a technician's real completion does: the transition
--              guard (admin-exempt, so a Superuser may make a move the matrix
--              does not list — the "stuck records" escape hatch 0003 built in),
--              si_stamp_work_order (stamps resolved_at), si_notify_work_order_
--              update (tells the requester "completed" and the HODs "needs
--              verifying"), and si_auto_close_completed (moves it to `closed`
--              and writes the completed -> closed history row itself, 0061).
--
--   UPDATE #2  status stays 'closed', so si_stamp_work_order,
--              si_notify_work_order_update and si_auto_close_completed all hit
--              their opening `new.status = old.status` / `<> 'completed'` early
--              returns and do nothing. Only THEN can the backdated resolved_at /
--              closed_at and the recomputed sla_breached be written and stick.
--
-- Reusing the completion path rather than replicating it is the point: the
-- notifications, the sign-off queue and the auto-close history row come out
-- byte-identical to a genuine completion, because they ARE one. "Make it as
-- completed" is taken literally.
--
-- ---------------------------------------------------------------------------
-- 2. The SLA breach is recomputed against the corrected time, not now
-- ---------------------------------------------------------------------------
-- The resolution DEADLINE is left exactly where it was — it was set when work
-- started (responded_at + target, 0050) and is the promise made then. What
-- moves is WHEN the work was finished: `sla_breached` is recomputed as
-- `sla_resolution_due_at < p_completed_at`. Backdating completion to when the
-- repair was actually done clears a breach that only existed because the record
-- sat unmoved. A sequential P7 whose resolution clock never started has a NULL
-- deadline and so is never a breach, which is already correct.
--
-- This is the same deliberate exception to the FSD's "a breach, once set, does
-- not clear itself" that 0051 made: what clears it is a named Superuser with a
-- recorded reason, which is the opposite of silent.
--
-- ---------------------------------------------------------------------------
-- 3. verified_at is left NULL — the HOD still signs it off
-- ---------------------------------------------------------------------------
-- The Superuser is undoing the abandonment, not doing the Head of Department's
-- job. 0061 already removed the verified_at stamp from the `closed` branch, so
-- the corrected work order lands in the HOD's sign-off queue (closed and not yet
-- verified) exactly like any other finished job. It counts as OPEN in no
-- dashboard figure and as SIGNED-OFF in none until an HOD verifies it — which is
-- 0059's rule, unchanged.
--
-- ---------------------------------------------------------------------------
-- 4. The timeline reads at the corrected time
-- ---------------------------------------------------------------------------
-- Two history rows are written at `p_completed_at` so the ladder reads
-- naturally — a `<stuck status> -> completed` transition row (which the direct
-- UPDATE path writes for nobody, unlike si_transition_work_order), and the
-- `completed -> closed` row auto-close just wrote is backdated from now() to
-- `p_completed_at`. A third row, `event_type = 'timeline_correction'`, carries
-- the audit line: who forced it, from what status, to what completion time, and
-- why. `event_type` is what keeps that row off the status ladder and out of the
-- export's reassignment arithmetic — the whole reason 0043 added the column.
--
-- ---------------------------------------------------------------------------
-- 5. The audit columns can only be written through the RPC — see 0051's note 6
-- ---------------------------------------------------------------------------
-- An Administrator can already force a status directly: the transition guard
-- bypasses the matrix for `admin`, and work_orders_update lets them write the
-- row. So this RPC is not a NEW way to change a status; it is the correct,
-- audited, SLA-aware way, and it is Superuser-only. What must not be forgeable
-- is the audit record itself, so the four `timeline_*` columns are guarded:
--
--   * si_guard_timeline_correction (BEFORE INSERT OR UPDATE) refuses any change
--     to those columns unless the RPC's door is open. A direct PATCH cannot
--     stamp a correction that did not happen, or attribute one to someone else.
--   * si_correct_work_order_timeline (SECURITY DEFINER) opens the door for its
--     own two statements and re-checks si_is_superuser() in its body, because
--     RLS does not apply inside it.
--   * The door is a session-local setting, a copy of si_priority_override()'s
--     shape (0051), which is a copy of si_protected_override()'s (0013/0016).
--     `set local` dies with the transaction, so a pooled connection cannot
--     carry it into the next statement.
--
-- The guard is named `a000_` so it fires among the other structural guards
-- ahead of 0036's `a00_derive_work_order_priority`. Every digit sorts below `_`
-- in ASCII — the same fact that stops a migration being numbered between two
-- existing ones.
--
-- ---------------------------------------------------------------------------
-- 6. The dashboard is refreshed on the spot
-- ---------------------------------------------------------------------------
-- The card figures (si_compute_dashboard_stats) recompute from the work_orders
-- table every 15 minutes on pg_cron; the charts (si_dashboard_charts_range) are
-- computed per call. So the change flows through on its own — but a Superuser
-- who just fixed a breach expects the Overdue count to drop now, not in fifteen
-- minutes, so the RPC calls si_refresh_dashboard_stats() before it returns.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The audit columns
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists timeline_corrected_by     uuid references users(id);
alter table work_orders add column if not exists timeline_corrected_at     timestamptz;
alter table work_orders add column if not exists timeline_correction_reason text;
alter table work_orders add column if not exists timeline_original_status  si_wo_status;

comment on column work_orders.timeline_corrected_by is
  'Set only by si_correct_work_order_timeline: the Superuser who forced this work order to completed and set its completion time (migration 0065).';

-- ---------------------------------------------------------------------------
-- The door — a copy of si_priority_override()'s shape (0051), deliberately
-- ---------------------------------------------------------------------------
create or replace function si_timeline_correction()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_setting('si.allow_timeline_correction', true), 'off') = 'on';
$$;

revoke all on function si_timeline_correction() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Nothing writes the timeline_* columns except through the RPC — see note 5
-- ---------------------------------------------------------------------------
create or replace function si_guard_timeline_correction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  -- No JWT: a migration, a seed script, or the service role. Trusted, as
  -- everywhere else in this schema.
  if auth.uid() is null then return new; end if;

  -- The door, opened by si_correct_work_order_timeline for its own statements.
  if si_timeline_correction() then return new; end if;

  -- OLD is unassigned in a BEFORE INSERT trigger, so INSERT and UPDATE get
  -- separate branches — the shape si_guard_priority_override (0051) uses. A work
  -- order cannot arrive already carrying a correction.
  if tg_op = 'INSERT' then
    v_changed := new.timeline_corrected_by      is not null
              or new.timeline_corrected_at      is not null
              or new.timeline_correction_reason is not null
              or new.timeline_original_status   is not null;
  else
    v_changed := new.timeline_corrected_by      is distinct from old.timeline_corrected_by
              or new.timeline_corrected_at      is distinct from old.timeline_corrected_at
              or new.timeline_correction_reason is distinct from old.timeline_correction_reason
              or new.timeline_original_status   is distinct from old.timeline_original_status;
  end if;

  if v_changed then
    raise exception 'A work order''s timeline can only be corrected by a Superuser, with a reason. Use Correct timeline on the work order.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_timeline_correction() from public, anon, authenticated;

drop trigger if exists a000_guard_timeline_correction on work_orders;
create trigger a000_guard_timeline_correction
  before insert or update on work_orders
  for each row execute function si_guard_timeline_correction();

-- ---------------------------------------------------------------------------
-- The RPC
--
-- Correctable statuses are the "work underway" ones — repairing,
-- waiting_spare_part, testing. `open`, `assigned` and `accepted` are excluded
-- because nothing has been worked on yet, so there is no completion to backdate;
-- `completed`, `closed` and any verified record are finished already.
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
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- RLS does not apply inside a SECURITY DEFINER function, so the rule is
  -- restated here rather than assumed from the grant. Superuser only — stricter
  -- than the transition guard's `admin` bypass, deliberately.
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

  if w.status not in ('repairing', 'waiting_spare_part', 'testing') then
    raise exception 'Only a work order that is under way (repairing, waiting for a part, or testing) can be corrected this way — this one is %.', w.status
      using errcode = 'check_violation';
  end if;

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

  v_note := 'Marked completed by ' || coalesce(v_actor_name, 'a Superuser')
            || ' (timeline correction). ' || v_reason;

  -- The door, for this correction's statements only. `set local` dies with the
  -- transaction, so a pooled connection cannot carry it into the next one.
  perform set_config('si.allow_timeline_correction', 'on', true);

  -- UPDATE #1 — the real completion path (see note 1). resolution_notes is set
  -- if the technician left none, so the record does not read as empty. The
  -- audit columns are stamped here, which is why the door is open.
  update work_orders
     set status                     = 'completed',
         resolution_notes           = coalesce(nullif(btrim(resolution_notes), ''), v_note),
         timeline_corrected_by      = v_actor,
         timeline_corrected_at      = now(),
         timeline_correction_reason = v_reason,
         timeline_original_status   = w.status
   where id = p_work_order_id;
  -- si_auto_close_completed has now moved it to 'closed' and written the
  -- completed -> closed history row at now().

  -- UPDATE #2 — status stays 'closed', so the stamp/notify/auto-close triggers
  -- all early-return and these backdated values stick (see note 2).
  update work_orders
     set resolved_at  = p_completed_at,
         closed_at    = p_completed_at,
         sla_breached = (sla_resolution_due_at is not null and sla_resolution_due_at < p_completed_at)
   where id = p_work_order_id;

  perform set_config('si.allow_timeline_correction', 'off', true);

  -- The timeline, at the corrected time (see note 4). now() is constant across a
  -- transaction, so the auto-close row this transaction just wrote is the one
  -- carrying created_at = now(); backdate it.
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

  -- The Overdue card and the open-work bands should drop this the moment the
  -- Superuser looks, not on the next 15-minute sweep (see note 6).
  perform si_refresh_dashboard_stats();
end;
$$;

revoke all on function si_correct_work_order_timeline(uuid, timestamptz, text) from public, anon;
grant execute on function si_correct_work_order_timeline(uuid, timestamptz, text) to authenticated;

comment on function si_correct_work_order_timeline(uuid, timestamptz, text) is
  'Superuser-only impromptu fix for a work order abandoned mid-work: forces it to completed, backdates resolved_at/closed_at to the given completion time, recomputes sla_breached against it, writes the timeline and an audit row, and refreshes the dashboard. Reuses the real completion path then backdates (migration 0065).';
