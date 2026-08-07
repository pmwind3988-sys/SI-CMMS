-- ============================================================================
-- SI — Service Inside · 0004 Scheduled sweeps, dashboard stats, RPCs
-- ============================================================================
-- Ports the four remaining Cloud Functions:
--   slaBreachSweep        -> si_sla_breach_sweep()      + pg_cron, every 5 min
--   slaWarningSweep       -> si_sla_warning_sweep()     + pg_cron, every 5 min
--   recomputeDashboardStats -> si_compute_dashboard_stats() + pg_cron, every 15 min
--   refreshDashboardStats -> si_refresh_dashboard_stats() RPC
--   setUserRoleClaims     -> si_set_user_role() RPC
--
-- These four are the ones that were entirely dead on the Firebase Spark plan,
-- which had no Cloud Functions at all. pg_cron is part of Postgres, so on
-- Supabase's free tier they simply run.
--
-- Every function here is SECURITY DEFINER: they write to notifications and
-- stats, which no client role may insert into. The two RPCs re-check the
-- caller's role internally, exactly as the onCall handlers did.
-- ============================================================================

create extension if not exists pg_cron;

-- Statuses counted as "still in flight" / "done", from schema.js.
create or replace function si_open_statuses() returns si_wo_status[]
language sql immutable as $$
  select array['open','assigned','accepted','on_the_way','on_site',
               'repairing','waiting_spare_part','testing']::si_wo_status[];
$$;

create or replace function si_terminal_statuses() returns si_wo_status[]
language sql immutable as $$
  select array['completed','verified','closed']::si_wo_status[];
$$;

-- ---------------------------------------------------------------------------
-- SLA BREACH SWEEP
-- Flags newly-breached work orders and notifies that department's Supervisors
-- once per breach, not on every sweep. P1 breaches escalate to every Manager
-- system-wide — the one case severe enough to warrant it.
-- ---------------------------------------------------------------------------

create or replace function si_sla_breach_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_sup  uuid;
  v_mgr  uuid;
  v_count int := 0;
begin
  for r in
    with breached as (
      update work_orders
         set sla_breached = true
       where sla_breached = false
         and sla_resolution_due_at is not null
         and sla_resolution_due_at < now()
         and status <> 'closed'
      returning id, wo_number, asset_name, department_id, priority
    )
    select * from breached
  loop
    v_count := v_count + 1;

    for v_sup in select si_department_supervisors(r.department_id) loop
      perform si_notify(v_sup, 'supervisor', r.id, r.wo_number, 'sla_breach',
        'SLA breached',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' has passed its resolution SLA');
    end loop;

    if r.priority = 'P1' then
      for v_mgr in select si_managers() loop
        perform si_notify(v_mgr, 'manager', r.id, r.wo_number, 'sla_breach',
          'P1 SLA breached',
          coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
          ' is critical and has passed its resolution SLA');
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- SLA WARNING SWEEP
-- Fires BEFORE the deadline, once per work order (guarded by sla_warning_sent),
-- when less than 25% of the total resolution window remains. Notifies the
-- assigned Technician and the department's Supervisors always; escalates to
-- every Manager only for P1, the same threshold used for breaches.
-- ---------------------------------------------------------------------------

create or replace function si_sla_warning_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r      record;
  v_sup  uuid;
  v_mgr  uuid;
  v_count int := 0;
begin
  for r in
    with warned as (
      update work_orders
         set sla_warning_sent = true
       where sla_warning_sent = false
         and sla_breached = false
         and status <> 'closed'
         and sla_resolution_due_at is not null
         and sla_resolution_due_at > now()
         and (sla_resolution_due_at - now())
             <= (sla_resolution_due_at - created_at) * 0.25
      returning id, wo_number, asset_name, department_id, priority, assigned_to_id
    )
    select * from warned
  loop
    v_count := v_count + 1;

    if r.assigned_to_id is not null then
      perform si_notify(r.assigned_to_id, 'technician', r.id, r.wo_number, 'sla_warning',
        'SLA deadline approaching',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' is close to breaching its resolution SLA');
    end if;

    for v_sup in select si_department_supervisors(r.department_id) loop
      perform si_notify(v_sup, 'supervisor', r.id, r.wo_number, 'sla_warning',
        'SLA deadline approaching',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' is close to breaching its resolution SLA');
    end loop;

    if r.priority = 'P1' then
      for v_mgr in select si_managers() loop
        perform si_notify(v_mgr, 'manager', r.id, r.wo_number, 'sla_warning',
          'P1 SLA deadline approaching',
          coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
          ' is critical and close to breaching its resolution SLA');
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- DASHBOARD STATS
-- computeDashboardStats read every work order into Node and looped. Here the
-- same aggregates are plain SQL, which is both faster and shorter. The two
-- output payloads keep their exact JSON shape so the dashboard client is
-- unchanged.
--
-- The original carried a comment flagging that the full-collection read should
-- become incremental counters or a BigQuery export at scale. That pressure is
-- much lower here — this is an indexed aggregate over one table, not 15 000
-- document reads — but the note stands for very large volumes.
-- ---------------------------------------------------------------------------

create or replace function si_compute_dashboard_stats()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open     si_wo_status[] := si_open_statuses();
  v_terminal si_wo_status[] := si_terminal_statuses();
  v_cards    jsonb;
  v_charts   jsonb;
  v_response numeric;
begin
  -- Average minutes from raise to technician acceptance, taken from the audit
  -- trail rather than from the work order itself.
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
    'completed_today',      count(*) filter (where closed_at >= date_trunc('day', now())),
    'overdue',              count(*) filter (where status = any (v_open) and sla_breached),
    'avg_response_minutes', coalesce(round(v_response), 0),
    'avg_repair_minutes',   coalesce(round(avg(
                              extract(epoch from (closed_at - created_at)) / 60
                            ) filter (where status = any (v_terminal) and closed_at is not null)), 0),
    'active_technicians',   count(distinct assigned_to_id) filter (
                              where status = any (v_open) and assigned_to_id is not null)
  )
  into v_cards
  from work_orders;

  select jsonb_build_object(
    'monthly_work_orders', coalesce((
      select jsonb_agg(jsonb_build_object('month', label, 'count', n) order by bucket)
        from (
          select date_trunc('month', created_at) as bucket,
                 to_char(date_trunc('month', created_at), 'Mon YY') as label,
                 count(*) as n
            from work_orders
           where created_at >= date_trunc('month', now()) - interval '11 months'
           group by 1, 2
        ) m
    ), '[]'::jsonb),

    'department_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('department', name, 'count', n) order by n desc)
        from (
          select coalesce(d.name, w.department_id) as name, count(*) as n
            from work_orders w
            left join departments d on d.id = w.department_id
           group by 1
        ) x
    ), '[]'::jsonb),

    'machine_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('asset', name, 'count', n) order by n desc)
        from (
          select coalesce(w.asset_name, w.asset_id) as name, count(*) as n
            from work_orders w
           group by 1
           order by count(*) desc
           limit 10
        ) x
    ), '[]'::jsonb),

    'technician_performance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'technician', name,
               'completed', completed,
               'avg_repair_minutes', avg_minutes
             ) order by completed desc)
        from (
          select coalesce(w.assigned_to_name, w.assigned_to_id::text) as name,
                 count(*) filter (where w.status = any (v_terminal)) as completed,
                 coalesce(round(avg(
                   extract(epoch from (w.closed_at - w.created_at)) / 60
                 ) filter (where w.status = any (v_terminal) and w.closed_at is not null)), 0) as avg_minutes
            from work_orders w
           where w.assigned_to_id is not null
           group by 1
           order by count(*) filter (where w.status = any (v_terminal)) desc
           limit 10
        ) x
    ), '[]'::jsonb)
  )
  into v_charts;

  insert into stats (id, data, updated_at)
  values ('dashboard_cards', v_cards, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();

  insert into stats (id, data, updated_at)
  values ('dashboard_charts', v_charts, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs — the two onCall handlers.
-- ---------------------------------------------------------------------------

-- Manager/Admin only, matching the original onCall rule.
create or replace function si_refresh_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;
  if si_role() not in ('manager','admin') then
    raise exception 'Only a Manager or Admin can refresh dashboard stats on demand.'
      using errcode = 'insufficient_privilege';
  end if;

  perform si_compute_dashboard_stats();
  return jsonb_build_object('ok', true);
end;
$$;

-- Replaces setUserRoleClaims. Firebase needed a callable because custom claims
-- lived outside Firestore; here the claim is derived from users.role by the
-- access-token hook, so this is a plain row update with the same authorization
-- checks. The caller's own JWT picks up a changed role on its next refresh —
-- call supabase.auth.refreshSession() client-side to make that immediate.
create or replace function si_set_user_role(
  p_uid uuid,
  p_role si_role,
  p_department_id text default null,
  p_plant_ids text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text := si_role();
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;
  if v_caller_role not in ('supervisor','manager','admin') then
    raise exception 'Only a Supervisor, Manager, or Admin can set roles.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_caller_role = 'supervisor'
     and p_department_id is distinct from si_department_id() then
    raise exception 'A Supervisor may only provision users within their own department.'
      using errcode = 'insufficient_privilege';
  end if;

  update users
     set role = p_role,
         department_id = p_department_id,
         plant_ids = coalesce(p_plant_ids, '{}')
   where id = p_uid;

  if not found then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  -- Keep the technicians profile in step with the role.
  if p_role = 'technician' then
    insert into technicians (user_id, name)
    select p_uid, name from users where id = p_uid
    on conflict (user_id) do nothing;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function si_refresh_dashboard_stats() to authenticated;
grant execute on function si_set_user_role(uuid, si_role, text, text[]) to authenticated;

-- The sweeps and the stats computation are cron-driven only; no client may call
-- them directly.
revoke execute on function si_sla_breach_sweep()       from authenticated, anon, public;
revoke execute on function si_sla_warning_sweep()      from authenticated, anon, public;
revoke execute on function si_compute_dashboard_stats() from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- SCHEDULE — the three onSchedule functions.
-- ---------------------------------------------------------------------------

select cron.schedule('si-sla-breach-sweep',  '*/5 * * * *',  $$select si_sla_breach_sweep()$$);
select cron.schedule('si-sla-warning-sweep', '*/5 * * * *',  $$select si_sla_warning_sweep()$$);
select cron.schedule('si-dashboard-stats',   '*/15 * * * *', $$select si_compute_dashboard_stats()$$);
