-- ===========================================================================
-- SI — Service Inside · migration 0055
-- The dashboard charts answer for a period you choose, at a granularity that
-- follows from it.
--
-- Until now all four charts answered exactly one question each and nobody
-- could ask a different one. The trend was the last 12 months by month; the
-- department, machine and technician breakdowns were ALL TIME, with nothing on
-- screen saying so. So "which machine is giving us trouble" could only ever be
-- answered about the entire history of the plant — a machine rebuilt last year
-- outranks one failing weekly, forever.
--
-- One control, one period, all four charts. The bucket is not a second thing
-- to choose: it follows from the span, because a day of work orders plotted
-- per month is one dot and a year plotted per hour is nine thousand.
--
--     a day     -> per hour
--     a week    -> per day
--     a month   -> per week
--     longer    -> per month
--
-- ---------------------------------------------------------------------------
-- 1. si_dashboard_charts_range(from, to, bucket)
-- ---------------------------------------------------------------------------
--
-- SECURITY INVOKER, deliberately, where si_compute_dashboard_stats is DEFINER.
-- That function writes ONE row into `stats` which every signed-in account can
-- read, so it cannot be scoped to a caller. This is computed per call, so RLS
-- is free to be the boundary — and that is the point: the two pages mounting
-- this module are Manager and Admin, both system-wide, so the numbers are
-- identical to the precomputed ones they replace. Anyone narrower who reaches
-- it sees their own rows and no error, which is the sanctioned direction
-- (showing less than the policy allows, never more).
--
-- Consequence to expect rather than to fix: it stays granted to
-- `authenticated` and will appear in the security advisor under the
-- signed-in-callable list. It is not SECURITY DEFINER, so it discloses nothing
-- work_orders_select does not already publish to that same caller.
--
-- Everything is bucketed in ASIA/KUALA_LUMPUR, not in UTC. `date_trunc('day',
-- created_at)` on a timestamptz truncates in the SERVER's zone, which is UTC —
-- so a fault raised at 07:00 in the plant files under the previous day, and a
-- per-hour chart of a shift comes out eight hours off the shift it describes.
-- Same argument lib/datetime.js makes for the range boundaries it computes;
-- this is the aggregation half of it.
--
-- `to` is EXCLUSIVE, matching dateRangePreset() exactly, and is compared with
-- `<`. An inclusive end drops whatever arrived in its last second and every
-- row whose timestamp carries milliseconds, which every now() default does.
--
-- EMPTY BUCKETS ARE FILLED, from generate_series rather than from the rows. A
-- line chart that simply omits a quiet Tuesday draws a straight line from
-- Monday to Wednesday, which reads as steady work rather than as none — the
-- gap is the finding, and dropping it is the one way a chart can lie without
-- containing a single wrong number. It also fixes the axis: without the spine,
-- the x-axis of a quiet week is whichever days happened to have work.
--
-- The three breakdowns are deliberately NOT filled. A department with no work
-- orders in the period has no slice, which is correct, and a top-ten bar chart
-- is a ranking rather than a timeline.
--
-- WHICH TIMESTAMP EACH CHART COUNTS ON is the other thing worth stating,
-- because they are not all the same and the charts now say so in their own
-- subtitles:
--
--   trend, department, machine -> created_at, "raised in this period"
--   technician                 -> closed_at,  "finished in this period"
--
-- A technician league table counting work RAISED in a window credits people
-- for jobs they have not done yet and drops the week-old job they closed
-- yesterday. avg_repair_minutes is taken over those same closures, so the
-- average and the count describe one set of work orders rather than two.
--
-- ---------------------------------------------------------------------------
-- 2. si_compute_dashboard_stats() loses its chart half
-- ---------------------------------------------------------------------------
--
-- Nothing reads `stats.dashboard_charts` once the client is on the RPC, and a
-- payload written every fifteen minutes and read by nobody is the shape of bug
-- this schema has already shipped twice (users.status deciding nothing, 0026;
-- a retirement that only filtered a dropdown, 0031). It goes, and the row with
-- it. The cards half is 0050's, byte for byte — restated because
-- `create or replace function` cannot amend one half of a body.
--
-- The cards themselves are untouched on purpose. They are current-state
-- counters — Total Open, Overdue, Active Technicians — and "how many are open"
-- does not take a period. Scoping them would produce "open work orders raised
-- in March", a different and much less useful figure than the one the card has
-- always shown.
-- ===========================================================================

create or replace function si_dashboard_charts_range(
  p_from   timestamptz,
  p_to     timestamptz,
  p_bucket text default 'month'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $fn$
declare
  v_terminal si_wo_status[] := si_terminal_statuses();
  v_tz   constant text := 'Asia/Kuala_Lumpur';
  v_step interval;
  v_fmt  text;
  v_out  jsonb;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    raise exception 'A chart period needs a start and an end, with the end after the start.';
  end if;

  -- The bucket is validated rather than interpolated: p_bucket reaches
  -- date_trunc as a value settled here and never as the caller's own string.
  case p_bucket
    when 'hour'  then v_step := interval '1 hour';  v_fmt := 'HH24:00';
    when 'day'   then v_step := interval '1 day';   v_fmt := 'DD Mon';
    when 'week'  then v_step := interval '1 week';  v_fmt := 'DD Mon';
    when 'month' then v_step := interval '1 month'; v_fmt := 'Mon YY';
    else raise exception 'Unknown chart bucket "%". Expected hour, day, week or month.', p_bucket;
  end case;

  with
  raised as (
    select w.id, w.department_id, w.asset_id, w.asset_name,
           date_trunc(p_bucket, w.created_at at time zone v_tz) as bucket
      from work_orders w
     where w.created_at >= p_from
       and w.created_at <  p_to
  ),
  closed as (
    select w.assigned_to_id, w.assigned_to_name, w.created_at, w.closed_at
      from work_orders w
     where w.closed_at is not null
       and w.closed_at >= p_from
       and w.closed_at <  p_to
       and w.status = any (v_terminal)
  ),
  spine as (
    select g as bucket
      from generate_series(
             date_trunc(p_bucket, p_from at time zone v_tz),
             date_trunc(p_bucket, (p_to - interval '1 microsecond') at time zone v_tz),
             v_step
           ) g
  ),
  trend as (
    select s.bucket,
           to_char(s.bucket, v_fmt) as label,
           count(r.id) as n
      from spine s
      left join raised r on r.bucket = s.bucket
     group by s.bucket
  )
  select jsonb_build_object(
    'work_orders_trend', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'count', n) order by bucket)
        from trend
    ), '[]'::jsonb),

    'department_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('department', name, 'count', n) order by n desc)
        from (
          select coalesce(d.name, r.department_id) as name, count(*) as n
            from raised r
            left join departments d on d.id = r.department_id
           group by 1
        ) x
    ), '[]'::jsonb),

    'machine_breakdown', coalesce((
      select jsonb_agg(jsonb_build_object('asset', name, 'count', n) order by n desc)
        from (
          select coalesce(r.asset_name, r.asset_id) as name, count(*) as n
            from raised r
           group by 1
           order by count(*) desc
           limit 10
        ) x
    ), '[]'::jsonb),

    -- Grouped on assigned_to_name, the denormalised copy (0001), so the table
    -- still reads correctly for a technician whose account has since gone.
    'technician_performance', coalesce((
      select jsonb_agg(jsonb_build_object(
               'technician', name,
               'completed', completed,
               'avg_repair_minutes', avg_minutes
             ) order by completed desc)
        from (
          select coalesce(c.assigned_to_name, c.assigned_to_id::text) as name,
                 count(*) as completed,
                 coalesce(round(avg(
                   extract(epoch from (c.closed_at - c.created_at)) / 60
                 )), 0) as avg_minutes
            from closed c
           where c.assigned_to_id is not null
           group by 1
           order by count(*) desc
           limit 10
        ) x
    ), '[]'::jsonb),

    'bucket', p_bucket,
    'from',   p_from,
    'to',     p_to
  )
  into v_out;

  return v_out;
end;
$fn$;

revoke all on function si_dashboard_charts_range(timestamptz, timestamptz, text) from public, anon;
grant execute on function si_dashboard_charts_range(timestamptz, timestamptz, text) to authenticated;

comment on function si_dashboard_charts_range(timestamptz, timestamptz, text) is
  'The four dashboard chart series for one period, bucketed hour/day/week/month in Asia/Kuala_Lumpur. SECURITY INVOKER, so RLS is the boundary. `to` is exclusive; empty time buckets are filled with zeroes.';

-- ---------------------------------------------------------------------------
-- The cards half, alone. 0050's body with the chart block and v_charts
-- removed; nothing else altered.
-- ---------------------------------------------------------------------------
create or replace function si_compute_dashboard_stats()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_open     si_wo_status[] := si_open_statuses();
  v_terminal si_wo_status[] := si_terminal_statuses();
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
    'completed_today',      count(*) filter (where closed_at >= date_trunc('day', now())),
    'overdue',              count(*) filter (where status = any (v_open) and sla_breached),
    'avg_response_minutes', coalesce(round(v_response), 0),
    'avg_repair_minutes',   coalesce(round(avg(
                              extract(epoch from (closed_at - created_at)) / 60
                            ) filter (where status = any (v_terminal) and closed_at is not null)), 0),
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

delete from stats where id = 'dashboard_charts';
