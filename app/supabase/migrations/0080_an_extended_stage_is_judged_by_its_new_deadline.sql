-- ---------------------------------------------------------------------------
-- 0080 — An extended stage is judged against its new deadline
-- ---------------------------------------------------------------------------
-- 0078 left the sticky breach flag set when a stage was extended ("a stage
-- that was missed was missed"). Extending a stage that was already late
-- therefore showed "Missed" forever, even when the work then finished inside
-- the time the Administrator granted. From here on the extended stage is
-- judged afresh against its NEW stored deadline:
--
--   * finishes (or is still running) within it  -> not missed, "Extended"
--   * the new deadline passes too               -> the breach sweep sets the
--     flag again, sends the normal breach notification, sla_stage_overdue
--     goes true, and Extend SLA can be used again.
--
-- Only the OPEN stage's flag is cleared; the other two stay as they were, and
-- sla_breached is recomputed as the OR of the three AFTER that change.
--
-- VERIFIED, not assumed, that the two writers re-fire correctly:
--   * si_sla_breach_sweep (latest definition: 0068) guards each stage on "this
--     stage's own sticky flag is not set yet" and compares the stored stage
--     deadline (si_open_stage_due_at), which an extension moves. With the flag
--     cleared it fires again once the new deadline passes - and only once.
--   * si_stamp_work_order (latest definition: 0067) sets each sticky flag on
--     the stage being LEFT by comparing the completion instant with the stored
--     due column (ack: acknowledged_at, response: responded_at, resolution:
--     now() at `completed`/`closed`, i.e. resolved_at/closed_at).
-- Neither needed changing.
--
-- The remark now leads with how much and who. The "(#n for this work order)"
-- count is left out (the dialog already warns); no typed reason is involved.
-- Existing history rows keep their text.
--
-- Every statement is re-runnable.
-- ---------------------------------------------------------------------------

-- Same reason as 0078: the statements below briefly lock work_orders. If a
-- long transaction is open, give up after five seconds (nothing is applied;
-- run it again) rather than queue every user's request behind it.
set lock_timeout = '5s';


-- 1. si_extend_sla_stage ---------------------------------------------------
create or replace function si_extend_sla_stage(
  p_work_order_id uuid,
  p_by_priority   si_priority
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w            work_orders;
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_stage      text;
  v_started    timestamptz;
  v_due        timestamptz;
  v_own_label  text;
  v_by_label   text;
  v_ack        int;
  v_resp       int;
  v_res        int;
  v_amount     int;
  v_absorbed   int;
  v_add        int;
  v_new_due    timestamptz;
  v_remark     text;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- Administrators are system-wide on work orders, so there is no narrower
  -- visibility to restate here (same as 0075).
  if not si_is_admin() then
    raise exception 'Only an Administrator can extend a work order''s SLA.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_by_priority is null then
    raise exception 'Choose how much time to add.' using errcode = 'check_violation';
  end if;

  select * into w from work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  if w.status in ('completed', 'verified', 'closed') then
    raise exception 'This work order is finished, so its SLA is part of the record now and cannot be extended.'
      using errcode = 'check_violation';
  end if;

  if not exists (select 1 from priorities where id = p_by_priority and is_active) then
    raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
  end if;

  v_stage   := si_open_sla_stage(w);
  v_started := si_open_stage_started_at(w);
  v_due     := si_open_stage_due_at(w);

  if v_stage is null then
    raise exception 'This work order has no SLA stage running, so there is nothing to extend.'
      using errcode = 'check_violation';
  end if;
  if v_due is null then
    raise exception 'This work order''s % stage has no deadline yet, so there is nothing to extend.', v_stage
      using errcode = 'check_violation';
  end if;

  -- The at-risk gate canExtendSla() mirrors: overdue, or in the last quarter
  -- of the stage's own window (si_sla_warning_sweep's threshold).
  if v_due > now() and (v_started is null or (v_due - now()) > (v_due - v_started) * 0.25) then
    raise exception 'This work order still has most of its % time left. An SLA is extended when it is running out, not before.', v_stage
      using errcode = 'check_violation';
  end if;

  -- The amount is the chosen priority's FULL total — "P8 is a month" — not one
  -- stage's window. Any active priority may be chosen; every choice only adds.
  select ack, response, resolution into v_ack, v_resp, v_res from si_sla_targets(p_by_priority);
  v_amount := coalesce(v_ack, 0) + coalesce(v_resp, 0) + coalesce(v_res, 0);
  if v_amount <= 0 then
    raise exception '% has no SLA targets set, so it cannot be used to extend.', p_by_priority
      using errcode = 'check_violation';
  end if;

  -- Rounded UP to the minute so the new deadline is never short of now + amount.
  v_absorbed := greatest(0, ceil(extract(epoch from (now() - v_due)) / 60.0))::int;
  v_add      := v_absorbed + v_amount;
  v_new_due  := v_due + make_interval(mins => v_add);

  select label into v_own_label from priorities where id = w.priority;
  select label into v_by_label  from priorities where id = p_by_priority;
  select name  into v_actor_name from users where id = v_actor;

  v_remark := 'Extended ' || si_fmt_minutes_approx(v_amount) || ' by ' ||
              coalesce(v_actor_name, 'an Administrator') ||
              ' (' || coalesce(v_by_label, p_by_priority::text) || ', ' || p_by_priority || '). ' ||
              case when v_absorbed > 0
                   then initcap(v_stage) || ' stage was ' || si_fmt_minutes_approx(v_absorbed) || ' overdue. '
                   else '' end ||
              'Now due ' ||
              to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI') ||
              '. Priority unchanged at ' || coalesce(v_own_label, w.priority::text) ||
              ' (' || w.priority || ').';

  perform set_config('si.allow_priority_override', 'on', true);

  /* status and the assignee are deliberately NOT named (0051 note 5) and the
     priority_override columns are not touched (this overrides no priority).
     0080: the OPEN stage's sticky flag is cleared so that stage is judged
     against its new deadline; the other two flags are left exactly as they
     were. Bare column names on the right of `sla_breached` would read OLD, so
     it repeats the three CASEs. */
  update work_orders
     set sla_extension_count       = coalesce(sla_extension_count, 0) + 1,
         sla_top_up_count          = coalesce(sla_top_up_count, 0) + 1,
         sla_overdue_absorbed_mins = coalesce(sla_overdue_absorbed_mins, 0) + v_absorbed,
         sla_ack_extra_mins        = coalesce(sla_ack_extra_mins, 0)        + case when v_stage = 'acknowledge' then v_add else 0 end,
         sla_response_extra_mins   = coalesce(sla_response_extra_mins, 0)   + case when v_stage = 'response'    then v_add else 0 end,
         sla_resolution_extra_mins = coalesce(sla_resolution_extra_mins, 0) + case when v_stage = 'resolution'  then v_add else 0 end,
         sla_ack_due_at            = case when v_stage = 'acknowledge' then v_new_due else sla_ack_due_at end,
         sla_response_due_at       = case when v_stage = 'response'    then v_new_due else sla_response_due_at end,
         sla_resolution_due_at     = case when v_stage = 'resolution'  then v_new_due else sla_resolution_due_at end,
         sla_ack_breached          = case when v_stage = 'acknowledge' then false else sla_ack_breached end,
         sla_response_breached     = case when v_stage = 'response'    then false else sla_response_breached end,
         sla_resolution_breached   = case when v_stage = 'resolution'  then false else sla_resolution_breached end,
         sla_breached              = (case when v_stage = 'acknowledge' then false else sla_ack_breached end)
                                  or (case when v_stage = 'response'    then false else sla_response_breached end)
                                  or (case when v_stage = 'resolution'  then false else sla_resolution_breached end),
         sla_stage_overdue         = (v_new_due < now()),
         sla_warning_sent          = case when v_new_due > now() then false else sla_warning_sent end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks, event_type)
  values
    (p_work_order_id, w.status, w.status, v_actor, v_actor_name, 'admin', v_remark, 'sla_extension');

  -- Same two recipients as 0075, neither of them if they did it themselves.
  perform si_notify(r.id, r.role, p_work_order_id, coalesce(w.wo_number, 'Work order'),
                    'priority_changed',
                    'More time on ' || v_stage,
                    coalesce(w.wo_number, 'A work order') || ' has been given ' ||
                      si_fmt_minutes_approx(v_amount) || ' more on its ' || v_stage ||
                      ' stage. It stays ' || coalesce(v_own_label, w.priority::text) || ' (' || w.priority ||
                      '). Now due ' || to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI') || '.',
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

revoke all on function si_extend_sla_stage(uuid, si_priority) from public, anon;
grant execute on function si_extend_sla_stage(uuid, si_priority) to authenticated;


-- 2. Backfill: work orders extended before this migration ------------------
-- CLEAR (never set) a stage's sticky flag when that stage was extended and is
-- within its current deadline: it is the open stage with a deadline still in
-- the future, or it is NOT open any more (si_open_sla_stage says so - a decline
-- re-opens acknowledge with acknowledged_at still set, a rework re-opens
-- resolution with resolved_at/closed_at still set) and its end instant is at or
-- before the deadline. End instants are the ones si_stamp_work_order judges
-- with: acknowledge = acknowledged_at, response = responded_at, resolution =
-- resolved_at (stamped at `completed`) else closed_at. The guard does not
-- protect the sticky flags (only the override/extension columns) and status is
-- unchanged, so si_stamp_work_order and si_notify_work_order_update return at
-- their first line: no history row, no notification.
-- Re-runnable and a no-op the second time: the WHERE matches only rows whose
-- flag WILL be cleared, so a second run touches zero rows (no updated_at bump,
-- no Realtime event).
with decided as (
  select w.id,
         (w.sla_ack_breached and w.sla_ack_extra_mins > 0
          and ((si_open_sla_stage(w) = 'acknowledge' and w.sla_ack_due_at > now())
            or (si_open_sla_stage(w) is distinct from 'acknowledge'
                and w.acknowledged_at is not null and w.sla_ack_due_at is not null
                and w.acknowledged_at <= w.sla_ack_due_at))) as clr_ack,
         (w.sla_response_breached and w.sla_response_extra_mins > 0
          and ((si_open_sla_stage(w) = 'response' and w.sla_response_due_at > now())
            or (si_open_sla_stage(w) is distinct from 'response'
                and w.responded_at is not null and w.sla_response_due_at is not null
                and w.responded_at <= w.sla_response_due_at))) as clr_resp,
         (w.sla_resolution_breached and w.sla_resolution_extra_mins > 0
          and ((si_open_sla_stage(w) = 'resolution' and w.sla_resolution_due_at > now())
            or (si_open_sla_stage(w) is distinct from 'resolution'
                and coalesce(w.resolved_at, w.closed_at) is not null and w.sla_resolution_due_at is not null
                and coalesce(w.resolved_at, w.closed_at) <= w.sla_resolution_due_at))) as clr_res
    from work_orders w
   where (w.sla_ack_breached        and w.sla_ack_extra_mins        > 0)
      or (w.sla_response_breached   and w.sla_response_extra_mins   > 0)
      or (w.sla_resolution_breached and w.sla_resolution_extra_mins > 0)
)
update work_orders w
   set sla_ack_breached        = w.sla_ack_breached        and not coalesce(d.clr_ack, false),
       sla_response_breached   = w.sla_response_breached   and not coalesce(d.clr_resp, false),
       sla_resolution_breached = w.sla_resolution_breached and not coalesce(d.clr_res, false)
  from decided d
 where d.id = w.id
   and (coalesce(d.clr_ack, false) or coalesce(d.clr_resp, false) or coalesce(d.clr_res, false));

-- sla_breached is the OR of the three; recompute it for rows still carrying an
-- extension, only where it disagrees (so a re-run touches nothing).
update work_orders w
   set sla_breached = (w.sla_ack_breached or w.sla_response_breached or w.sla_resolution_breached)
 where (w.sla_ack_extra_mins > 0 or w.sla_response_extra_mins > 0 or w.sla_resolution_extra_mins > 0)
   and w.sla_breached is distinct from (w.sla_ack_breached or w.sla_response_breached or w.sla_resolution_breached);
