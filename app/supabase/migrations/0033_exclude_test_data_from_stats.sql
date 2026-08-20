-- SI — Service Inside · migration 0033
--
-- Test data stops counting, and a deleted work order stops counting at once.
--
-- Two complaints about the same screen — the Manager/Admin dashboard, the only
-- one that renders charts — with two unrelated causes.
--
-- ---------------------------------------------------------------------------
-- 1. si_compute_dashboard_stats() never excluded anything.
-- ---------------------------------------------------------------------------
-- It aggregates `from work_orders` with no predicate at all, and `npm run
-- seed:demo` walks one work order raised by requester@example.com and assigned
-- to tech.arun@example.com — both fixtures under 0028 — the whole way to
-- `closed`. So it fed completed_today, avg_response_minutes, avg_repair_minutes,
-- monthly_work_orders, department_breakdown, machine_breakdown and
-- technician_performance, which groups by assigned_to_name: the fixture's NAME,
-- rendered on the chart. That is the side door 0029 closed on the technicians
-- roster, reopened somewhere nobody thought to look, and visible to every
-- Manager and Administrator rather than only to someone querying PostgREST by
-- hand.
--
-- The key is `users.is_test_account`, NOT `users.si_dummy_flags`. The dashboard
-- already carries a demo-accounts warning card built on si_dummy_flags, and it
-- would have been the tempting thing to reuse — but that column is a HEURISTIC
-- (placeholder email, still on the seeded password, profile never edited). A
-- real person who has not yet changed the password they were given would have
-- had their work quietly dropped out of every statistic on the plant. 0028's
-- mark is deliberate, set only by a Superuser, and is the only safe key.
--
-- ---------------------------------------------------------------------------
-- 2. A deleted work order sat in the charts for up to fifteen minutes.
-- ---------------------------------------------------------------------------
-- deleteWorkOrder() hard-deletes the row (0018), so a RECOMPUTED aggregate is
-- already correct — `stats` is a full rebuild, not an incremental one. Nothing
-- recomputed on delete, and pg_cron only comes round every fifteen minutes. So
-- this needs no new arithmetic, only a trigger.
--
-- It has to be server-side. The client could call si_refresh_dashboard_stats()
-- after deleting, but that RPC re-checks for Manager/Admin, and 0018 lets a
-- Superuser grant deletion to a Supervisor — who would then delete a work order
-- and be refused the refresh. A trigger does not care who the caller was.
--
-- ---------------------------------------------------------------------------
-- Why a denormalised column rather than a join
-- ---------------------------------------------------------------------------
-- The aggregate is SECURITY DEFINER, so it could have joined `users` and read
-- is_test_account directly. The column exists because the CLIENT cannot: 0028's
-- users_select hides a fixture's row from everyone but its holder and the
-- Superuser, so no client-side filter is even expressible. RoleDashboard
-- computes the Supervisor's stat cards from listenWorkOrderList() — scope
-- `() => true` since 0019 — and had no way to tell a demo work order from a real
-- one. So does the export. One column answers all three, and answers them the
-- same way.
--
-- The rule it implements, stated once: STATISTICS EXCLUDE TEST DATA; LISTS SHOW
-- EVERYTHING, TAGGED. work_orders_select is untouched, deliberately — a demo
-- work order that vanished from the list would also be one nobody could find to
-- delete. A card reading 4 beside a list of 5 is only confusing if the list does
-- not say which row is which, so WorkOrderList tags it.

-- ---------------------------------------------------------------------------
-- The column.
-- ---------------------------------------------------------------------------
-- No index. Every reader of this column is a full-table aggregate that scans
-- regardless, and a partial index on the rare `true` side would not serve
-- `where not is_test_data` anyway.
alter table work_orders
  add column if not exists is_test_data boolean not null default false;

comment on column work_orders.is_test_data is
  'Was this work order raised by, or assigned to, a test fixture (users.is_test_account)? '
  'Stamped by c_stamp_work_order_test_data, never by a client. Excluded from every '
  'statistic (0033) and still returned by work_orders_select, so demo rows stay findable.';

-- ---------------------------------------------------------------------------
-- Stamping it.
-- ---------------------------------------------------------------------------
-- Two things here are load-bearing and look like mistakes.
--
-- FIRST: `before insert or update`, with NO column list. `update of requester_id,
-- assigned_to_id` is the obvious form and it leaves the column wide open — RLS
-- grants ROWS, not columns, so any client that may write a work order could send
-- `is_test_data: false` in a statement touching neither of those columns and the
-- trigger would never fire. updateWorkOrderFields() forwards an arbitrary
-- `fields` object, so that is a live path, not a hypothetical one. Recomputing
-- on every update costs two indexed lookups; the alternative is a column the
-- admin screen writes and nothing enforces, which is precisely what
-- users.status was for four migrations before 0026.
--
-- SECOND: the `c_` prefix. Postgres fires BEFORE triggers in alphabetical order,
-- which is why 0003 named its two `a_guard_work_order_transition` and
-- `b_stamp_work_order`. b_stamp CLEARS assigned_to_id on a decline, so a stamp
-- running before it would compute test-ness from the technician who is being
-- declined away and leave the flag set on a work order that no longer has an
-- assignee. `c_` puts this third, after both, and still before touch_work_orders.
create or replace function si_stamp_work_order_test_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_test_data :=
       si_is_test_account(new.requester_id)
    or (new.assigned_to_id is not null and si_is_test_account(new.assigned_to_id));
  return new;
end;
$$;

revoke all on function si_stamp_work_order_test_data() from public, anon, authenticated;

comment on function si_stamp_work_order_test_data() is
  'Recomputes work_orders.is_test_data from the requester and assignee. Fires on every '
  'UPDATE rather than on a column list, because RLS grants rows and a client could '
  'otherwise clear the flag in a statement touching neither id.';

drop trigger if exists c_stamp_work_order_test_data on work_orders;
create trigger c_stamp_work_order_test_data
  before insert or update on work_orders
  for each row execute function si_stamp_work_order_test_data();

-- ---------------------------------------------------------------------------
-- Keeping it true when the mark itself changes.
-- ---------------------------------------------------------------------------
-- Without this, a Superuser marking an existing account as a fixture leaves
-- every work order that account already touched counted forever, and unmarking
-- one never gives its work back.
--
-- `is distinct from` on the computed value is not an optimisation:
-- touch_work_orders (0001) bumps updated_at on every UPDATE, and a blanket
-- re-stamp would rewrite "last updated" on every work order the person ever
-- touched, including the rows whose flag did not move. Only genuinely changed
-- rows are written.
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
                     or (w.assigned_to_id is not null and si_is_test_account(w.assigned_to_id))
   where (w.requester_id = new.id or w.assigned_to_id = new.id)
     and w.is_test_data is distinct from (
           si_is_test_account(w.requester_id)
        or (w.assigned_to_id is not null and si_is_test_account(w.assigned_to_id))
         );

  return new;
end;
$$;

revoke all on function si_restamp_test_data_for_user() from public, anon, authenticated;

comment on function si_restamp_test_data_for_user() is
  'Re-stamps work_orders.is_test_data when a Superuser marks or unmarks a fixture, so '
  'the work that account already touched leaves or rejoins the statistics.';

drop trigger if exists users_restamp_test_data on users;
create trigger users_restamp_test_data
  after update of is_test_account on users
  for each row execute function si_restamp_test_data_for_user();

-- ---------------------------------------------------------------------------
-- Backfill.
-- ---------------------------------------------------------------------------
-- Guarded the same way and for the same reason: unguarded, this would bump
-- updated_at on every work order in the table.
update work_orders w
   set is_test_data = si_is_test_account(w.requester_id)
                   or (w.assigned_to_id is not null and si_is_test_account(w.assigned_to_id))
 where w.is_test_data is distinct from (
         si_is_test_account(w.requester_id)
      or (w.assigned_to_id is not null and si_is_test_account(w.assigned_to_id))
       );

-- ---------------------------------------------------------------------------
-- The aggregate, with the predicate added in nine places.
-- ---------------------------------------------------------------------------
-- Unchanged from 0004 apart from `and not w.is_test_data` / `where not
-- is_test_data`: the response-time join, the cards query, and all four chart
-- subqueries. Reproduced in full rather than patched because that is the only
-- way `create or replace function` works, and because 0007 pins search_path by
-- `alter function` for some of these — replacing a body resets options an
-- earlier alter set, so the header here states them explicitly.
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
    'active_technicians',   count(distinct assigned_to_id) filter (
                              where status = any (v_open) and assigned_to_id is not null)
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
-- The drill-down, with the same predicate in all six branches.
-- ---------------------------------------------------------------------------
-- This function exists (0012) so the modal and the number it opened from share
-- ONE definition of "open" or "completed today". Adding the test-data predicate
-- to the aggregate and not here would have produced exactly the disagreement it
-- was written to prevent: a card reading 4 opening a list of 5.
--
-- Still `security invoker`, so RLS keeps scoping the rows to what the caller may
-- see. si_is_test_account() is not called here and does not need to be — the
-- predicate is a plain column on the row, which is the other reason the column
-- earns its keep: a SECURITY INVOKER function reading `users` would have been
-- filtered by users_select and failed open, the 0029 trap exactly.
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

  -- total_open / p1..p4 / overdue are one query: the open set, optionally
  -- narrowed by priority or to the breached ones. Matches the
  -- count(*) filter (where status = any (v_open) and ...) expressions in
  -- si_compute_dashboard_stats.
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

  -- completed_today counts closed_at >= midnight, not status = 'completed'.
  -- Keeping the same predicate here is the whole point of this function.
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

  -- The response-time average is taken from the audit trail, so its detail is
  -- history rows: one per acceptance, which means a reassigned-then-reaccepted
  -- work order legitimately contributes twice, here and in the average.
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

  -- count(distinct assigned_to_id) over the open set — so the detail is one row
  -- per technician, carrying the open load that made them count as active.
  --
  -- This branch is also where a fixture's NAME used to escape even though 0028
  -- hides the row: `left join users u` returns null for an account the caller
  -- may not see, and the coalesce falls through to max(w.assigned_to_name),
  -- which is the denormalised copy. Excluding test work orders closes it.
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

-- ---------------------------------------------------------------------------
-- Recompute the moment a work order is deleted.
-- ---------------------------------------------------------------------------
-- `for each statement`, not `for each row`: deleting ten work orders should
-- rebuild the aggregate once, not ten times. The trigger takes no interest in
-- which rows went, because si_compute_dashboard_stats() is a full rebuild.
--
-- It fires AFTER delete, so the rows are already gone when the aggregate runs —
-- which is the whole point. si_archive_deleted_work_order (0018) is the BEFORE
-- DELETE trigger on the same table and is unaffected; the two do not interact.
create or replace function si_recompute_dashboard_stats_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform si_compute_dashboard_stats();
  return null;
end;
$$;

revoke all on function si_recompute_dashboard_stats_on_delete() from public, anon, authenticated;

comment on function si_recompute_dashboard_stats_on_delete() is
  'Rebuilds the dashboard aggregate as soon as a work order is deleted, instead of '
  'leaving it in the charts until pg_cron next runs (0033). Statement-level, and '
  'independent of the deleter role — a Supervisor granted deletion under 0018 cannot '
  'call si_refresh_dashboard_stats() themselves.';

drop trigger if exists work_orders_recompute_stats_delete on work_orders;
create trigger work_orders_recompute_stats_delete
  after delete on work_orders
  for each statement execute function si_recompute_dashboard_stats_on_delete();

-- ---------------------------------------------------------------------------
-- Make it true now rather than at the next quarter-hour.
-- ---------------------------------------------------------------------------
select si_compute_dashboard_stats();
