-- SI — Service Inside · migration 0034
--
-- 0033 was too broad by one word: `or`.
--
-- It stamped is_test_data when the requester OR the assignee was a fixture, and
-- measured against the live project that turned out to catch a real work order:
-- WO-2026-000003, raised by Amirul (a real Administrator) against Conveyor B-2 in
-- Assembly, assigned to Meera Iyer — a fixture. Every statistic on the plant
-- dropped it, and since the only other work order is the demo seed, the entire
-- dashboard read zero.
--
-- The distinction 0033 missed is WHOSE data the statistic is about:
--
--   - Raised by a fixture      -> the work order itself is invented. There was no
--                                 fault, no machine down, no demand. Excluded
--                                 from everything.
--   - Raised by a real person,
--     assigned to a fixture    -> the FAULT was real. A conveyor really did have
--                                 a light out, and the plant really does have an
--                                 open P3. Only the choice of technician was a
--                                 test.
--
-- So is_test_data narrows to the requester alone, and the two outputs whose
-- SUBJECT is the technician — technician_performance and active_technicians —
-- additionally skip a fixture assignee. Volume, department and machine
-- breakdowns, open counts and SLA all count the row, because the demand was
-- real.
--
-- One consequence recorded rather than hidden: avg_response_minutes and
-- avg_repair_minutes still include a row a fixture worked, because they measure
-- the work order's journey rather than crediting a person. If somebody signs
-- into a fixture and closes a real work order in four minutes, that four minutes
-- lands in the average. The alternative — excluding it — loses a genuine
-- resolution from the timing stats instead, and there is no reading of that pair
-- where both are right. Raise it to a requester-only rule if the averages ever
-- matter more than the completeness.

-- ---------------------------------------------------------------------------
-- is_test_data: the requester alone.
-- ---------------------------------------------------------------------------
create or replace function si_stamp_work_order_test_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The assignee is deliberately not consulted. See the header: a real fault
  -- assigned to a fixture is still a real fault. Where the assignee matters is
  -- inside the two technician-subject queries, which test it directly.
  new.is_test_data := si_is_test_account(new.requester_id);
  return new;
end;
$$;

revoke all on function si_stamp_work_order_test_data() from public, anon, authenticated;

comment on function si_stamp_work_order_test_data() is
  'Recomputes work_orders.is_test_data from the REQUESTER only (0034 narrowed 0033). '
  'Fires on every UPDATE rather than on a column list, because RLS grants rows and a '
  'client could otherwise clear the flag in a statement touching neither id.';

comment on column work_orders.is_test_data is
  'Was this work order RAISED by a test fixture (users.is_test_account)? Stamped by '
  'c_stamp_work_order_test_data, never by a client. Excluded from every statistic. A real '
  'work order merely ASSIGNED to a fixture is not marked — it is excluded from the two '
  'technician-subject charts only (0034). Still returned by work_orders_select, so demo '
  'rows stay findable.';

-- The re-stamp trigger on users keeps working unchanged, but its own expression
-- has to narrow with the trigger it mirrors, or marking an account would write a
-- value the work_orders trigger then overwrites — two definitions of the same
-- rule, disagreeing for one statement.
create or replace function si_restamp_test_data_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_test_account is not distinct from old.is_test_account then
    return new;
  end if;

  update work_orders w
     set is_test_data = si_is_test_account(w.requester_id)
   where w.requester_id = new.id
     and w.is_test_data is distinct from si_is_test_account(w.requester_id);

  return new;
end;
$$;

revoke all on function si_restamp_test_data_for_user() from public, anon, authenticated;

comment on function si_restamp_test_data_for_user() is
  'Re-stamps work_orders.is_test_data when a Superuser marks or unmarks a fixture, so the '
  'work that account RAISED leaves or rejoins the statistics (0034: requester only).';

-- Re-backfill under the narrowed rule. Guarded, so only the rows whose flag
-- actually moves get their updated_at bumped by touch_work_orders.
update work_orders w
   set is_test_data = si_is_test_account(w.requester_id)
 where w.is_test_data is distinct from si_is_test_account(w.requester_id);

-- ---------------------------------------------------------------------------
-- The aggregate.
-- ---------------------------------------------------------------------------
-- Identical to 0033 except in the two technician-subject places, which now also
-- test the assignee. `not si_is_test_account(assigned_to_id)` rather than a
-- column: there is no denormalised copy of the assignee's mark, and adding one
-- would be a second thing to keep in step for the sake of two call sites.
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
     and h.created_at >= w.created_at
     and not w.is_test_data;

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
    -- "Active technicians" is a headcount OF TECHNICIANS, so a fixture holding
    -- an open work order must not be one of them.
    'active_technicians',   count(distinct assigned_to_id) filter (
                              where status = any (v_open)
                                and assigned_to_id is not null
                                and not si_is_test_account(assigned_to_id))
  )
  into v_cards
  from work_orders
  where not is_test_data;

  select jsonb_build_object(
    'monthly_work_orders', coalesce((
      select jsonb_agg(jsonb_build_object('month', label, 'count', n) order by bucket)
        from (
          select date_trunc('month', created_at) as bucket,
                 to_char(date_trunc('month', created_at), 'Mon YY') as label,
                 count(*) as n
            from work_orders
           where created_at >= date_trunc('month', now()) - interval '11 months'
             and not is_test_data
           group by 1, 2
        ) m
    ), '[]'::jsonb),

    'department_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('department', name, 'count', n) order by n desc)
        from (
          select coalesce(d.name, w.department_id) as name, count(*) as n
            from work_orders w
            left join departments d on d.id = w.department_id
           where not w.is_test_data
           group by 1
        ) x
    ), '[]'::jsonb),

    'machine_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('asset', name, 'count', n) order by n desc)
        from (
          select coalesce(w.asset_name, w.asset_id) as name, count(*) as n
            from work_orders w
           where not w.is_test_data
           group by 1
           order by count(*) desc
           limit 10
        ) x
    ), '[]'::jsonb),

    -- Named-technician league table: excludes a fixture assignee as well as a
    -- fixture requester. This is the query that used to render "Arun Kumar" on
    -- the chart, and the narrowed is_test_data alone would not have stopped it —
    -- a real requester's work order assigned to a fixture would have put the
    -- fixture's denormalised name straight back.
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
             and not w.is_test_data
             and not si_is_test_account(w.assigned_to_id)
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

revoke execute on function si_compute_dashboard_stats() from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- The drill-down, kept in step.
-- ---------------------------------------------------------------------------
-- Only the active_technicians branch differs from 0033: it is the one whose rows
-- ARE technicians. The other five list work orders, and a real work order
-- assigned to a fixture belongs in them now.
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
  v_terminal si_wo_status[] := si_terminal_statuses();
  v_limit    int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_priority si_priority;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  if p_card in ('total_open', 'p1_critical', 'p2_high', 'p3_medium', 'p4_low', 'overdue') then
    v_priority := (case p_card
                     when 'p1_critical' then 'P1'
                     when 'p2_high'     then 'P2'
                     when 'p3_medium'   then 'P3'
                     when 'p4_low'      then 'P4'
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
             round(extract(epoch from (w.sla_resolution_due_at - now())) / 60)::numeric,
             w.created_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_open)
         and not w.is_test_data
         and (v_priority is null or w.priority = v_priority)
         and (p_card <> 'overdue' or w.sla_breached)
       order by w.sla_resolution_due_at asc nulls last
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
             round(extract(epoch from (w.closed_at - w.created_at)) / 60)::numeric,
             w.closed_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.closed_at >= date_trunc('day', now())
         and not w.is_test_data
       order by w.closed_at desc
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
         and not w.is_test_data
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
             round(extract(epoch from (w.closed_at - w.created_at)) / 60)::numeric,
             w.closed_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_terminal)
         and w.closed_at is not null
         and not w.is_test_data
       order by w.closed_at desc
       limit v_limit;

  -- One row per technician, so the fixture test applies here and not to the five
  -- branches above. This is also the branch where a fixture's name escaped
  -- despite 0028: `left join users u` returns null for a row the caller may not
  -- see, and the coalesce falls through to max(w.assigned_to_name), the
  -- denormalised copy.
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
         and not w.is_test_data
         and not si_is_test_account(w.assigned_to_id)
       group by w.assigned_to_id, u.name, t.skills, u.department_id
       order by count(*) desc
       limit v_limit;

  else
    raise exception 'Unknown dashboard card: %', p_card
      using errcode = 'invalid_parameter_value';
  end if;
end;
$$;

revoke all on function si_dashboard_card_rows(text, int) from public, anon;
grant execute on function si_dashboard_card_rows(text, int) to authenticated, service_role;

-- True now, not at the next quarter-hour.
select si_compute_dashboard_stats();
