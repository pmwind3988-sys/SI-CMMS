-- ============================================================================
-- SI — Service Inside · 0050 P7, and an SLA whose stages start when the last
--                            one finished
-- ============================================================================
-- P7 is a long-term task: planned work with no immediate production impact,
-- measured in days rather than minutes. It arrives with a production impact of
-- its own, because since 0036 nobody picks a priority — `priority` follows the
-- impact and a trigger overwrites whatever the client sends. Adding a priority
-- with no impact that derives it would have produced a value the raise form
-- could never reach.
--
--   impact_levels: 'long_term'  ->  suggests_priority 'P7'
--
-- The mapping stays exactly 1:1 the way 0006 left it (full_stoppage->P1,
-- reduced_capacity->P2, auxiliary->P3, none->P4), which is what lets 0051's
-- override set an impact to match a priority without ambiguity.
--
-- ---------------------------------------------------------------------------
-- 1. Its three targets are sequential, and only its
-- ---------------------------------------------------------------------------
-- P7's SLA is: acknowledged within 5 days, then work started within 3 days of
-- that, then resolved within 7 days of that. Each window opens when the
-- previous stage is actually reached, so the numbers stored below are *stage
-- durations*, not offsets from the raise time.
--
-- P1-P4 are not like that and are left alone. Their numbers were authored as
-- totals from creation — a P1 is 5 minutes to acknowledge and 4 hours to
-- resolve, both counted from the fault — and making them sequential would
-- silently make every one of them more generous than it has been since 0006.
--
-- Which model applies is therefore **data, not code**: `sla.targets_are_
-- sequential`. One code path, the row decides, the same way the permitted
-- transitions are 22 rows in `wo_status_transitions` and retirement is a flag.
-- The alternative — an `if priority = 'P7'` in two trigger bodies — is a second
-- definition of the same rule, and CLAUDE.md's standing complaint about
-- suggestPriority() vs si_derive_priority() is what two definitions cost.
--
-- ---------------------------------------------------------------------------
-- 2. "Acknowledge" and "response" now have to mean something exact
-- ---------------------------------------------------------------------------
-- The FSD defines acknowledge as "creation to the Supervisor/HOD assigning a
-- technician (i.e. leaving Open)" and resolution as "creation to Closed". It
-- never defined **response**: `sla.response_target_minutes` was added by 0009
-- as a third number the detail page prints, and nothing ever measured it.
--
-- Sequential targets make it load-bearing, so:
--
--   acknowledged_at  <- first time the work order reaches 'assigned'
--   responded_at     <- first time it reaches 'repairing' (work under way)
--
-- Both are `coalesce`d, so they record the FIRST arrival and never move. That
-- matters because this trail is deliberately non-monotonic (0038): a decline
-- sends 'assigned' back to 'open' and the next assignment must not restart the
-- acknowledge clock, and `testing -> repairing` on a second attempt must not
-- restart the resolution one. 'accepted' was the other candidate for response
-- and is the weaker one — on a long-term task it would start the 7-day
-- resolution window three days before anybody is at the machine.
--
-- Both columns are backfilled from `work_order_history`, first occurrence of
-- each status, filtered to `event_type = 'transition'` — 0043's photo-replaced
-- rows carry the work order's current status in `to_status`, so a photo swapped
-- while a job was assigned would otherwise be read as the moment it was
-- assigned. That is the same trap `lib/historyEvents.js` exists for.
--
-- ---------------------------------------------------------------------------
-- 3. A P7 has no resolution deadline until work starts, and that is correct
-- ---------------------------------------------------------------------------
-- `sla_resolution_due_at` is left NULL on a sequential priority until
-- `responded_at` is stamped. Nothing had to change to make that safe: the
-- breach sweep and the warning sweep in 0004 both already guard on
-- `sla_resolution_due_at is not null`, `si_dashboard_card_rows` already orders
-- `nulls last`, and si_stamp_work_order's `closed` branch already tests for
-- null before setting `sla_breached`. A deadline that has not started cannot be
-- missed, and inventing one from the raise time would be the from-creation
-- model wearing the sequential model's numbers.
--
-- ---------------------------------------------------------------------------
-- 4. si_sla_targets() keeps EXECUTE for `authenticated`, deliberately
-- ---------------------------------------------------------------------------
-- Every other function this project has added since 0033 is revoked from
-- `authenticated` when its only caller is a trigger body. This one must not be,
-- and the reason is the bug 0013 exists to fix: `si_stamp_work_order` is
-- SECURITY **INVOKER**, so a function it calls has its EXECUTE checked against
-- the signed-in user. Revoked, every status change in the app would fail with
-- *"permission denied for function si_sla_targets"* — for every role, exactly
-- as si_guard_protected_user did.
--
-- It discloses nothing: `sla_select` already publishes the same numbers to
-- every signed-in account, which is how ReferenceDataProvider prints them on
-- the raise form. Same reasoning as 0007's header gives for si_signed_in().
--
-- ---------------------------------------------------------------------------
-- 5. P7's colour is off-palette on purpose
-- ---------------------------------------------------------------------------
-- The design system is navy / amber / red / green / slate, and every in-palette
-- candidate collides with something: slate #64748B is what priorityColor()
-- returns when a lookup FAILS, so a P7 badge would be indistinguishable from a
-- broken one; both navies are P4's own family; green reads as completed. A
-- priority badge has one job, which is to be told apart at a glance in a list,
-- so P7 is violet. It is a seed value in an editable table — Admin -> Settings
-- can recolour it without a migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The reference rows. 0048 added the two enum labels; this is the first file
-- that may name them.
-- ---------------------------------------------------------------------------
insert into priorities (id, code, label, color_hex, rank, description) values
  ('P7', 'P7', 'Long-term', '#7C3AED', 7,
   'Planned long-term task; no immediate production impact. Measured in days.')
on conflict (id) do update
  set code        = excluded.code,
      label       = excluded.label,
      color_hex   = excluded.color_hex,
      rank        = excluded.rank,
      description = excluded.description;

insert into impact_levels (code, label, suggests_priority, sort_order, description) values
  ('long_term', 'Long-term task (planned, no immediate impact)', 'P7', 5,
   'Improvement, upgrade or planned work. Nothing is stopped and nothing is degraded.')
on conflict (code) do update
  set label             = excluded.label,
      suggests_priority = excluded.suggests_priority,
      sort_order        = excluded.sort_order,
      description       = excluded.description;

-- Stage durations, not offsets from creation — see note 1. The labels say so,
-- because the detail page prints them next to P1-P4's, which are offsets.
alter table sla add column if not exists targets_are_sequential boolean not null default false;

insert into sla (id, priority_id, plant_id,
                 ack_target_minutes,      ack_target_label,
                 response_target_minutes, response_target_label,
                 resolution_target_minutes, resolution_target_label,
                 targets_are_sequential) values
  ('P7', 'P7', null,
   7200,  '5 days',
   4320,  '3 days after assignment',
   10080, '7 days after work starts',
   true)
on conflict (id) do update
  set priority_id               = excluded.priority_id,
      plant_id                  = excluded.plant_id,
      ack_target_minutes        = excluded.ack_target_minutes,
      ack_target_label          = excluded.ack_target_label,
      response_target_minutes   = excluded.response_target_minutes,
      response_target_label     = excluded.response_target_label,
      resolution_target_minutes = excluded.resolution_target_minutes,
      resolution_target_label   = excluded.resolution_target_label,
      targets_are_sequential    = excluded.targets_are_sequential;

-- ---------------------------------------------------------------------------
-- The stage moments, and the deadline that follows each — see note 2
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists acknowledged_at     timestamptz;
alter table work_orders add column if not exists responded_at        timestamptz;
alter table work_orders add column if not exists sla_response_due_at timestamptz;

-- ---------------------------------------------------------------------------
-- All four targets in one lookup, replacing si_sla_target_minutes()'s two.
--
-- The old function is left in place rather than dropped: nothing in this
-- repository calls it any more, but it has been granted to PUBLIC since 0003
-- and dropping a function is not the way to find out what else reaches it.
--
-- Each fallback is independent, unlike 0003's, which set `resolution` inside
-- `if ack is null`. `sla.response_target_minutes` was added by 0009 with no
-- default and no not-null, so a row can legitimately exist with that one column
-- empty — under the old shape it would have stayed null and make_interval would
-- have produced a null deadline.
-- ---------------------------------------------------------------------------
create or replace function si_sla_targets(
  p           in  si_priority,
  ack         out int,
  response    out int,
  resolution  out int,
  sequential  out boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  select s.ack_target_minutes,
         s.response_target_minutes,
         s.resolution_target_minutes,
         coalesce(s.targets_are_sequential, false)
    into ack, response, resolution, sequential
    from sla s
   where s.priority_id = p and s.plant_id is null
   limit 1;

  if ack is null then
    ack := case p when 'P1' then 5 when 'P2' then 15 when 'P3' then 30
                  when 'P7' then 7200 else 120 end;
  end if;

  if response is null then
    response := case p when 'P1' then 15 when 'P2' then 60 when 'P3' then 240
                       when 'P7' then 4320 else 1440 end;
  end if;

  if resolution is null then
    resolution := case p when 'P1' then 240 when 'P2' then 480 when 'P3' then 1440
                         when 'P7' then 10080 else 7200 end;
  end if;

  -- No row at all: only P7 is sequential, which is what the seed above says.
  if sequential is null then sequential := (p = 'P7'); end if;
end;
$$;

revoke all on function si_sla_targets(si_priority) from public, anon;
grant execute on function si_sla_targets(si_priority) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CREATE PATH — 0003's function, with the SLA block replaced. wo_number
-- allocation is byte-identical.
-- ---------------------------------------------------------------------------
create or replace function si_before_work_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_next bigint;
  v_ack  int;
  v_resp int;
  v_res  int;
  v_seq  boolean;
begin
  if new.wo_number is null then
    insert into counters (id, last_value)
    values ('WO-' || v_year, 1)
    on conflict (id) do update set last_value = counters.last_value + 1
    returning last_value into v_next;

    new.wo_number := 'WO-' || v_year || '-' || lpad(v_next::text, 6, '0');
  end if;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(new.priority);

  new.sla_ack_due_at := coalesce(new.sla_ack_due_at, now() + make_interval(mins => v_ack));

  if v_seq then
    -- Neither clock has started — see note 3. Set unconditionally rather than
    -- coalesced: on a sequential priority a resolution deadline computed at
    -- insert time is not a promise anybody made, whoever supplied it.
    new.sla_response_due_at   := null;
    new.sla_resolution_due_at := null;
  else
    new.sla_response_due_at   := coalesce(new.sla_response_due_at,   now() + make_interval(mins => v_resp));
    new.sla_resolution_due_at := coalesce(new.sla_resolution_due_at, now() + make_interval(mins => v_res));
  end if;

  new.sla_breached     := false;
  new.sla_warning_sent := false;
  new.decline_count    := 0;

  -- Denormalized asset_name, previously the client's job to remember.
  if new.asset_name is null then
    select name into new.asset_name from assets where id = new.asset_id;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- TRANSITION PATH — 0003's b_stamp_work_order, plus the two stage moments and
-- the deadlines that follow them.
--
-- The sequential block sits ABOVE the `completed` / `closed` stamps on purpose:
-- the `closed` branch decides `sla_breached` by reading
-- `new.sla_resolution_due_at`, and on a work order being closed out of order it
-- has to read the value this statement just computed rather than the one the
-- row arrived with.
--
-- Still SECURITY INVOKER, as 0003 left it — see note 4 for why that decides
-- si_sla_targets' grant.
-- ---------------------------------------------------------------------------
create or replace function si_stamp_work_order()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ack  int;
  v_resp int;
  v_res  int;
  v_seq  boolean;
begin
  if new.status = old.status then return new; end if;

  -- Decline: assigned -> open with the assignee cleared.
  if old.status = 'assigned' and new.status = 'open' then
    new.decline_count := old.decline_count + 1;
    new.assigned_to_id := null;
    new.assigned_to_name := null;
  end if;

  -- First arrival only, never moved again — see note 2.
  if new.status = 'assigned' then
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
  end if;

  if new.status = 'repairing' then
    new.responded_at := coalesce(new.responded_at, now());
  end if;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(new.priority);

  if v_seq then
    if new.acknowledged_at is not null and new.sla_response_due_at is null then
      new.sla_response_due_at := new.acknowledged_at + make_interval(mins => v_resp);
    end if;
    if new.responded_at is not null and new.sla_resolution_due_at is null then
      new.sla_resolution_due_at := new.responded_at + make_interval(mins => v_res);
    end if;
  end if;

  if new.status = 'completed' then
    new.resolved_at := now();
  end if;

  if new.status = 'closed' then
    new.closed_at := now();
    new.sla_breached := (new.sla_resolution_due_at is not null
                         and new.sla_resolution_due_at < now());
    new.verified_at := coalesce(new.verified_at, now());
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill — see note 2 for the event_type filter
-- ---------------------------------------------------------------------------
update work_orders w
   set acknowledged_at = h.first_at
  from (select work_order_id, min(created_at) as first_at
          from work_order_history
         where to_status = 'assigned'
           and coalesce(event_type, 'transition') = 'transition'
         group by work_order_id) h
 where h.work_order_id = w.id
   and w.acknowledged_at is null;

update work_orders w
   set responded_at = h.first_at
  from (select work_order_id, min(created_at) as first_at
          from work_order_history
         where to_status = 'repairing'
           and coalesce(event_type, 'transition') = 'transition'
         group by work_order_id) h
 where h.work_order_id = w.id
   and w.responded_at is null;

-- Every work order that exists right now is P1-P4, so its response target was
-- always an offset from creation — the same thing the detail page has been
-- printing. Filling it in keeps the column meaning one thing rather than
-- "either a real deadline or not recorded yet".
update work_orders w
   set sla_response_due_at = w.created_at
                             + make_interval(mins => (si_sla_targets(w.priority)).response)
 where w.sla_response_due_at is null
   and not (si_sla_targets(w.priority)).sequential;

-- ---------------------------------------------------------------------------
-- The dashboard learns about P7
--
-- Both functions are 0047's definitions with one line added to each and
-- nothing else altered, and both re-issue their grants immediately afterwards:
-- a later create-or-replace resets what an earlier grant or `alter function`
-- set, which is the trap 0034's header records.
--
-- The priority row on the dashboard is four hardcoded keys, not a loop over the
-- table, so a fifth priority is invisible there until it is named. Leaving it
-- out would have made the four priority cards stop adding up to `total_open` —
-- a P7 work order counted in the total and in no band — which is the kind of
-- half-landed feature CLAUDE.md's `users.status` note is about.
--
-- The card function's `order by w.sla_resolution_due_at asc nulls last` already
-- does the right thing with a P7 whose resolution clock has not started: it
-- sorts to the bottom rather than to the top, which a plain `asc` would do.
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
    'p7_long_term',         count(*) filter (where status = any (v_open) and priority = 'P7'),
    'completed_today',      count(*) filter (where closed_at >= date_trunc('day', now())),
    'overdue',              count(*) filter (where status = any (v_open) and sla_breached),
    'avg_response_minutes', coalesce(round(v_response), 0),
    'avg_repair_minutes',   coalesce(round(avg(
                              extract(epoch from (closed_at - created_at)) / 60
                            ) filter (where status = any (v_terminal) and closed_at is not null)), 0),
    -- "Active technicians" is a headcount OF TECHNICIANS: distinct people, not
    -- work orders.
    'active_technicians',   count(distinct assigned_to_id) filter (
                              where status = any (v_open)
                                and assigned_to_id is not null)
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

    -- Named-technician league table. Grouped on assigned_to_name, the
    -- denormalised copy (0001), so it still reads correctly for a technician
    -- whose account has since been deleted.
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
  v_terminal si_wo_status[] := si_terminal_statuses();
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
             round(extract(epoch from (w.sla_resolution_due_at - now())) / 60)::numeric,
             w.created_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_open)
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
       order by w.closed_at desc
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

revoke all on function si_dashboard_card_rows(text, int) from public, anon;
grant execute on function si_dashboard_card_rows(text, int) to authenticated, service_role;
