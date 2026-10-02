-- ---------------------------------------------------------------------------
-- 0078 — Extend SLA adds a priority's time, and never moves the priority
-- ---------------------------------------------------------------------------
-- Extend SLA had two modes (0072 re-grade, 0075 top-up) beside Change priority
-- (0051), and the re-grade mode was Change priority by a second door. This
-- migration adds the one mode the dialog offers from now on: give the OPEN
-- stage any priority's full total (ack + response + resolution), keep the work
-- order's own priority, and — if the stage is already overdue — count the
-- amount from now rather than from the missed deadline.
--
--   absorbed = max(0, now - due)            (whole minutes, rounded up)
--   extra'   = extra + absorbed + amount    (0075 note 1: the extras survive
--   due'     = due + absorbed + amount       a later re-grade's recompute)
--            = max(now, due) + amount
--
-- PURELY ADDITIVE, and that is the release plan rather than tidiness. The live
-- site calls si_extend_work_order_sla(p_work_order_id, p_priority, p_top_up);
-- PostgREST resolves an RPC by argument-name set, so changing that function
-- would break every open tab the moment this is applied (measured 2026-09-19:
-- PGRST202). It is left exactly as 0075 wrote it. The new client calls
-- si_extend_sla_stage instead; retiring the old function is a later migration.
--
-- Every statement is re-runnable: production migrations go in through the SQL
-- Editor, and the next real db push re-runs the file.
-- ---------------------------------------------------------------------------


-- 1. Where the absorbed overdue time is recorded --------------------------
alter table work_orders add column if not exists sla_overdue_absorbed_mins int not null default 0;

comment on column work_orders.sla_overdue_absorbed_mins is
  'Total minutes of overdue time absorbed by si_extend_sla_stage across every extension: when a stage is extended while overdue, the amount counts from now and the gap is recorded here. Already included in sla_*_extra_mins; reported separately so a report can tell lateness from planned time. Written only by that RPC.';


-- 2. The guard protects the new column ------------------------------------
-- 0075's si_guard_priority_override reproduced in full (create or replace
-- replaces the whole body); the only change is sla_overdue_absorbed_mins in
-- both branches, so a direct PATCH of it is refused like the extras are.
create or replace function si_guard_priority_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  if auth.uid() is null then return new; end if;
  if si_priority_override() then return new; end if;

  if tg_op = 'INSERT' then
    v_changed := new.priority_override        is not null
              or new.priority_override_reason is not null
              or new.priority_overridden_by   is not null
              or new.priority_overridden_at   is not null
              or coalesce(new.sla_extension_count, 0)       <> 0
              or coalesce(new.sla_top_up_count, 0)          <> 0
              or coalesce(new.sla_ack_extra_mins, 0)        <> 0
              or coalesce(new.sla_response_extra_mins, 0)   <> 0
              or coalesce(new.sla_resolution_extra_mins, 0) <> 0
              or coalesce(new.sla_overdue_absorbed_mins, 0) <> 0;
  else
    v_changed := new.priority_override         is distinct from old.priority_override
              or new.priority_override_reason  is distinct from old.priority_override_reason
              or new.priority_overridden_by    is distinct from old.priority_overridden_by
              or new.priority_overridden_at    is distinct from old.priority_overridden_at
              or new.sla_extension_count       is distinct from old.sla_extension_count
              or new.sla_top_up_count          is distinct from old.sla_top_up_count
              or new.sla_ack_extra_mins        is distinct from old.sla_ack_extra_mins
              or new.sla_response_extra_mins   is distinct from old.sla_response_extra_mins
              or new.sla_resolution_extra_mins is distinct from old.sla_resolution_extra_mins
              or new.sla_overdue_absorbed_mins is distinct from old.sla_overdue_absorbed_mins;
  end if;

  if v_changed then
    raise exception 'Priority can only be changed by an Administrator, with a reason. Use Change priority or Extend SLA on the work order.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_priority_override() from public, anon, authenticated;


-- 3. si_fmt_minutes_approx — "10 days 2 hrs", "2 hrs 30 mins" -------------
-- si_fmt_minutes (0075) only prints exact units, which suits a priority's
-- authored targets and not an overdue gap: 14523 minutes would print as
-- "14523 mins". Two units, the larger first, the remainder below that dropped.
create or replace function si_fmt_minutes_approx(p_mins int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_mins is null then null
    when p_mins < 60 then p_mins::text || ' min' || case when p_mins = 1 then '' else 's' end
    when p_mins < 1440 then
      (p_mins / 60)::text || ' hr' || case when p_mins / 60 = 1 then '' else 's' end ||
      case when p_mins % 60 > 0
           then ' ' || (p_mins % 60)::text || ' min' || case when p_mins % 60 = 1 then '' else 's' end
           else '' end
    else
      (p_mins / 1440)::text || ' day' || case when p_mins / 1440 = 1 then '' else 's' end ||
      case when (p_mins % 1440) / 60 > 0
           then ' ' || ((p_mins % 1440) / 60)::text || ' hr' || case when (p_mins % 1440) / 60 = 1 then '' else 's' end
           else '' end
  end;
$$;

revoke all on function si_fmt_minutes_approx(int) from public, anon;
grant execute on function si_fmt_minutes_approx(int) to authenticated;


-- 4. si_extend_sla_stage --------------------------------------------------
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
  v_nth        int;
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
  v_nth := coalesce(w.sla_top_up_count, 0) + 1;

  v_remark := 'SLA extended (#' || v_nth || ' for this work order): ' || initcap(v_stage) || ' stage ' ||
              case when v_absorbed > 0
                   then 'was ' || si_fmt_minutes_approx(v_absorbed) || ' overdue; extended by '
                   else 'extended by ' end ||
              coalesce(v_by_label, p_by_priority::text) || ' (' || p_by_priority || '), ' ||
              si_fmt_minutes_approx(v_amount) || '. Now due ' ||
              to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI') ||
              '. Priority unchanged at ' || coalesce(v_own_label, w.priority::text) ||
              ' (' || w.priority || ').';

  perform set_config('si.allow_priority_override', 'on', true);

  /* status and the assignee are deliberately NOT named (0051 note 5), the
     priority_override columns are not touched (this overrides no priority),
     and the sticky breach flags are not reset: a stage that was missed was
     missed. */
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
