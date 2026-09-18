-- ============================================================================
-- SI — Service Inside · 0068 "Overdue" means the stage it is sitting in
-- ============================================================================
-- 0067 added the columns; this is what writes and reads them.
--
-- ---------------------------------------------------------------------------
-- 1. The breach sweep works per stage, and notifies once per stage
-- ---------------------------------------------------------------------------
-- The old sweep's guard was `sla_breached = false`, which made it fire exactly
-- once per work order ever. Per stage that is wrong in both directions: a work
-- order late to be assigned AND later late to be fixed is two facts and two
-- notifications, and without a guard of its own the same late stage would
-- announce itself every five minutes forever.
--
-- So the guard is "this stage's own sticky flag is not set yet". It follows
-- that the sweep is idempotent, that the notification count per work order is
-- at most three, and that `sla_stage_overdue` is re-set on every pass of a
-- stage that is still late — which is what it must do, because
-- si_stamp_work_order clears it whenever the work order advances.
--
-- ---------------------------------------------------------------------------
-- 2. The warning window is the stage's, not the work order's
-- ---------------------------------------------------------------------------
-- `(due - created_at) * 0.25` described a window that no longer exists: on a
-- sequential priority the resolution deadline is measured from `responded_at`,
-- so subtracting `created_at` includes every stage before it and puts the
-- warning threshold somewhere nothing means. It becomes
-- `(due - stage_start) * 0.25`, which is what isStageAtRisk() computes on the
-- client, so the button, the banner and the notification agree.
--
-- `sla_warning_sent` stays one flag per work order rather than becoming three.
-- That is a deliberate non-change: it is a courtesy ping, `notifications` still
-- has no retention, and one warning per work order is the volume this table
-- was sized for. The consequence — a work order warned about its acknowledge
-- stage is not warned again about its resolution stage — is accepted.
--
-- ---------------------------------------------------------------------------
-- 3. The dashboard's Overdue card changes meaning, visibly and on purpose
-- ---------------------------------------------------------------------------
-- It counted `sla_breached`: ever late. It counts `sla_stage_overdue`: late
-- right now. On the day this lands the figure moves in both directions — work
-- stuck at an early stage appears that never did, and long-overdue work whose
-- stage has since advanced leaves. That is the card answering a better
-- question, and the per-stage flags are where "was ever late" still lives.
--
-- The drill-down's ORDER BY moves from `sla_resolution_due_at` to
-- si_open_stage_due_at(), and it had to: on a sequential priority the
-- resolution deadline is NULL until work starts, so the old ordering sent
-- every unstarted work order — exactly the ones an Overdue list is about — to
-- the bottom under `nulls last`.
-- ============================================================================

create or replace function si_sla_breach_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_sup   uuid;
  v_mgr   uuid;
  v_count int := 0;
begin
  for r in
    with open_stage as (
      select w.id,
             si_open_sla_stage(w)    as stage,
             si_open_stage_due_at(w) as due
        from work_orders w
       where w.status <> 'closed'
    ),
    late as (
      select id, stage
        from open_stage
       where stage is not null
         and due is not null
         and due < now()
    ),
    bumped as (
      update work_orders w
         set sla_stage_overdue       = true,
             sla_ack_breached        = w.sla_ack_breached        or l.stage = 'acknowledge',
             sla_response_breached   = w.sla_response_breached   or l.stage = 'response',
             sla_resolution_breached = w.sla_resolution_breached or l.stage = 'resolution',
             sla_breached            = true
        from late l
       where w.id = l.id
         /* Only rows whose verdict actually changes, so the loop below — and
            the notification in it — runs once per stage rather than every five
            minutes for the life of the work order. */
         and ((l.stage = 'acknowledge' and not w.sla_ack_breached)
           or (l.stage = 'response'    and not w.sla_response_breached)
           or (l.stage = 'resolution'  and not w.sla_resolution_breached))
      returning w.id, w.wo_number, w.asset_name, w.department_id, w.priority, l.stage
    )
    select * from bumped
  loop
    v_count := v_count + 1;

    for v_sup in select si_department_supervisors(r.department_id) loop
      perform si_notify(v_sup, 'supervisor', r.id, r.wo_number, 'sla_breach',
        'SLA breached',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' has passed its ' || r.stage || ' SLA');
    end loop;

    if r.priority = 'P1' then
      for v_mgr in select si_managers() loop
        perform si_notify(v_mgr, 'manager', r.id, r.wo_number, 'sla_breach',
          'P1 SLA breached',
          coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
          ' is critical and has passed its ' || r.stage || ' SLA');
      end loop;
    end if;
  end loop;

  /* Rows whose stage has advanced past a deadline they had already been
     flagged for. si_stamp_work_order clears the flag on every transition, so
     this only catches a row changed by a route that did not fire it. */
  update work_orders w
     set sla_stage_overdue = false
   where w.sla_stage_overdue
     and (si_open_stage_due_at(w) is null or si_open_stage_due_at(w) >= now());

  return v_count;
end;
$$;

revoke all on function si_sla_breach_sweep() from public, anon, authenticated;

create or replace function si_sla_warning_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_sup   uuid;
  v_mgr   uuid;
  v_count int := 0;
begin
  for r in
    with open_stage as (
      select w.id,
             si_open_sla_stage(w)        as stage,
             si_open_stage_started_at(w) as started,
             si_open_stage_due_at(w)     as due
        from work_orders w
       where w.status <> 'closed'
         and w.sla_warning_sent = false
    ),
    at_risk as (
      select id, stage
        from open_stage
       where stage is not null
         and due is not null
         and started is not null
         and due > now()
         and (due - now()) <= (due - started) * 0.25
    ),
    warned as (
      update work_orders w
         set sla_warning_sent = true
        from at_risk a
       where w.id = a.id
      returning w.id, w.wo_number, w.asset_name, w.department_id, w.priority,
                w.assigned_to_id, a.stage
    )
    select * from warned
  loop
    v_count := v_count + 1;

    if r.assigned_to_id is not null then
      perform si_notify(r.assigned_to_id, 'technician', r.id, r.wo_number, 'sla_warning',
        'SLA deadline approaching',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' is close to breaching its ' || r.stage || ' SLA');
    end if;

    for v_sup in select si_department_supervisors(r.department_id) loop
      perform si_notify(v_sup, 'supervisor', r.id, r.wo_number, 'sla_warning',
        'SLA deadline approaching',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' is close to breaching its ' || r.stage || ' SLA');
    end loop;

    if r.priority = 'P1' then
      for v_mgr in select si_managers() loop
        perform si_notify(v_mgr, 'manager', r.id, r.wo_number, 'sla_warning',
          'P1 SLA deadline approaching',
          coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
          ' is critical and close to breaching its ' || r.stage || ' SLA');
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function si_sla_warning_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The cards. 0059's body with one filter changed — see note 3.
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
    -- CHANGED: late right now, not ever late.
    'overdue',              count(*) filter (where status = any (v_open) and sla_stage_overdue),
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
             round(extract(epoch from (si_open_stage_due_at(w) - now())) / 60)::numeric,
             w.created_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_open)
         and (v_priority is null or w.priority = v_priority)
         and (p_card <> 'overdue' or w.sla_stage_overdue)
       order by si_open_stage_due_at(w) asc nulls last
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
