-- ============================================================================
-- SI — Service Inside · 0070 The open stage is what the status says
-- ============================================================================
-- Fix round 1 on 0069's own arithmetic. 0067 and 0069 are already applied to
-- test and an applied migration is never re-run, so the corrections ship as a
-- new file rather than an edit to either.
--
-- ---------------------------------------------------------------------------
-- Ruling 1 — the open stage is decided by STATUS, not by the two timestamps
-- ---------------------------------------------------------------------------
-- si_open_sla_stage() keyed on `acknowledged_at`/`responded_at` being null.
-- Measured on test before this fix: that parked 33 of the 45 work orders at
-- `acknowledge`, including rows sitting in `repairing` and `testing` — which
-- have provably left that stage, since a status only moves forward through
-- wo_status_transitions. The status is the work order's actual state and is
-- never null; the two stamps are denormalised conveniences that CAN be
-- missing — 0062 found three closed rows with neither.
--
-- `si_wo_status` is `('open','assigned','accepted','on_the_way','on_site',
-- 'repairing','waiting_spare_part','testing','completed','verified','closed')`
-- — every value is covered below. `on_the_way`/`on_site` are retired (0039)
-- but rows still carry them, so they still need a stage.
--
-- Deliberate consequence, and it is correct: a declined work order returns to
-- `open` with `acknowledged_at` already set from its first assignment, so it
-- re-enters the acknowledge stage against its ORIGINAL deadline and reads as
-- overdue until somebody reassigns it. Nothing here clears that stamp, and
-- nothing should — the deadline it is being held to is the one that was
-- actually missed.
--
-- `si_open_stage_started_at` / `si_open_stage_due_at` need no logic change —
-- they switch on whatever si_open_sla_stage returns — but they are replaced
-- here too, unchanged, so this file is a complete statement of the corrected
-- contract rather than relying on a `create or replace` two migrations back
-- to still be the live definition of a function they call.
--
-- ---------------------------------------------------------------------------
-- Ruling 2 — a stage with no completion stamp, on a work order that has
-- moved past it, is unknowable rather than missed
-- ---------------------------------------------------------------------------
-- 0069's breach arithmetic read `else now() > due` whenever a stage's
-- completion stamp was null. On an open work order that is "still running"
-- and is right. On a CLOSED one it means "we have no record this stage
-- completed", and answering with the clock wrote `sla_breached = true` onto
-- six closed work orders that had no way to ever clear it again:
-- WO-2026-000038, -000027, -000016, -000014, -000046 and -000008. The client
-- already answers this correctly — `slaStages()` calls such a stage
-- `unstamped` with `met: null`, not failed.
--
-- So the clock is consulted only for the stage the work order is ACTUALLY
-- sitting in right now (by status, the same mapping as Ruling 1). Every other
-- unstamped stage is left with no verdict — false, the same as "never
-- started" — because a row that has moved past a stage with no completion
-- stamp is not evidence the stage was missed, only that nothing was recorded.
--
-- Each verdict is now three-way:
--   deadline is null                -> false   (never started, no verdict)
--   completion stamp is not null    -> stamp > deadline
--   this stage is the OPEN stage    -> now() > deadline
--   else (moved past, unstamped)    -> false   (unknowable)
--
-- ---------------------------------------------------------------------------
-- What else is in this file
-- ---------------------------------------------------------------------------
-- - sla_backfill_0070: its own snapshot, same shape as 0069's, plus the three
--   per-stage flags and sla_stage_overdue, so the correction is auditable per
--   stage rather than only in aggregate. It also captures verified_at,
--   verified_by, assigned_to_id and decline_count, which 0069's snapshot does
--   not — those four are never written by either backfill, but the review
--   gate's own "did anything else move" check needs a before-image that
--   actually holds them to check them against.
-- - Both snapshot tables get `grant select on ... to authenticated` alongside
--   their RLS policy: a policy with no table grant can fail closed with a
--   permission error rather than returning rows, and Superuser is still who
--   the policy restricts it to.
-- - si_open_stage_due_at(w) was evaluated twice in 0069's final UPDATE
--   (`is not null and ... < now()`); this file computes it once.
-- - Everything is recomputed unconditionally, exactly as 0069 did: derived
--   from created_at, history and the sla table, never from either backfill's
--   own prior output, so re-running this file is a no-op and it clears the
--   six wrong flags regardless of how many times 0069 or this file has run.
-- - The two-statement split (sla_breached/sla_stage_overdue read what the
--   first UPDATE just committed) and the `coalesce(event_type,'transition')`
--   history filter are unchanged from 0069.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The before-image, this migration's own. Captures the four columns 0069's
-- snapshot does not, because none of them are touched by either backfill and
-- the review gate needs a before-image that actually holds them.
-- ---------------------------------------------------------------------------
create table if not exists sla_backfill_0070 (
  work_order_id           uuid primary key references work_orders(id) on delete cascade,
  captured_at             timestamptz not null default now(),
  priority                si_priority,
  status                  si_wo_status,
  created_at              timestamptz,
  acknowledged_at         timestamptz,
  responded_at            timestamptz,
  resolved_at             timestamptz,
  closed_at               timestamptz,
  verified_at             timestamptz,
  verified_by             uuid,
  assigned_to_id          uuid,
  decline_count           int,
  sla_ack_due_at          timestamptz,
  sla_response_due_at     timestamptz,
  sla_resolution_due_at   timestamptz,
  sla_ack_breached        boolean,
  sla_response_breached   boolean,
  sla_resolution_breached boolean,
  sla_breached            boolean,
  sla_stage_overdue       boolean,
  sla_warning_sent        boolean
);

alter table sla_backfill_0070 enable row level security;

drop policy if exists sla_backfill_0070_select on sla_backfill_0070;
create policy sla_backfill_0070_select on sla_backfill_0070
  for select using (si_is_superuser());

grant select on sla_backfill_0070 to authenticated;
grant select on sla_backfill_0069 to authenticated;

insert into sla_backfill_0070 (
  work_order_id, priority, status, created_at, acknowledged_at, responded_at,
  resolved_at, closed_at, verified_at, verified_by, assigned_to_id,
  decline_count, sla_ack_due_at, sla_response_due_at, sla_resolution_due_at,
  sla_ack_breached, sla_response_breached, sla_resolution_breached,
  sla_breached, sla_stage_overdue, sla_warning_sent)
select id, priority, status, created_at, acknowledged_at, responded_at,
       resolved_at, closed_at, verified_at, verified_by, assigned_to_id,
       decline_count, sla_ack_due_at, sla_response_due_at, sla_resolution_due_at,
       sla_ack_breached, sla_response_breached, sla_resolution_breached,
       sla_breached, sla_stage_overdue, sla_warning_sent
  from work_orders
on conflict (work_order_id) do nothing;

-- ---------------------------------------------------------------------------
-- Ruling 1's fix
-- ---------------------------------------------------------------------------
create or replace function si_open_sla_stage(w work_orders)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when w.status in ('completed', 'verified', 'closed') then null
           when w.status = 'open' then 'acknowledge'
           when w.status in ('assigned', 'accepted', 'on_the_way', 'on_site') then 'response'
           else 'resolution'
         end;
$$;

revoke all on function si_open_sla_stage(work_orders) from public, anon;
grant execute on function si_open_sla_stage(work_orders) to authenticated, service_role;

-- Unchanged logic, replayed here so this file is a complete statement of the
-- corrected contract rather than depending on 0067's definitions still being
-- live two migrations later.
create or replace function si_open_stage_started_at(w work_orders)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case si_open_sla_stage(w)
           when 'acknowledge' then w.created_at
           when 'response'    then w.acknowledged_at
           when 'resolution'  then w.responded_at
         end;
$$;

revoke all on function si_open_stage_started_at(work_orders) from public, anon;
grant execute on function si_open_stage_started_at(work_orders) to authenticated, service_role;

create or replace function si_open_stage_due_at(w work_orders)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case si_open_sla_stage(w)
           when 'acknowledge' then w.sla_ack_due_at
           when 'response'    then w.sla_response_due_at
           when 'resolution'  then w.sla_resolution_due_at
         end;
$$;

revoke all on function si_open_stage_due_at(work_orders) from public, anon;
grant execute on function si_open_stage_due_at(work_orders) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Ruling 2's fix — the full recomputation, corrected
-- ---------------------------------------------------------------------------
with hist as (
  select work_order_id,
         min(created_at) filter (where to_status = 'assigned')  as first_assigned,
         min(created_at) filter (where to_status = 'repairing') as first_repairing
    from work_order_history
   where coalesce(event_type, 'transition') = 'transition'
   group by work_order_id
),
base as (
  select w.id,
         w.created_at,
         w.status,
         coalesce(w.acknowledged_at, h.first_assigned)  as acked,
         coalesce(w.responded_at,    h.first_repairing) as responded,
         coalesce(w.resolved_at, w.closed_at)           as resolved,
         t.ack, t.response, t.resolution
    from work_orders w
    left join hist h on h.work_order_id = w.id
    cross join lateral si_sla_targets(w.priority) t
),
calc as (
  select b.*,
         -- The same mapping as si_open_sla_stage, restated here as a value
         -- rather than a per-row function call so the CASE below stays plain
         -- comparisons.
         case
           when b.status in ('completed', 'verified', 'closed') then null
           when b.status = 'open' then 'acknowledge'
           when b.status in ('assigned', 'accepted', 'on_the_way', 'on_site') then 'response'
           else 'resolution'
         end as open_stage,
         b.created_at + make_interval(mins => b.ack) as ack_due,
         case when b.acked is not null
              then b.acked + make_interval(mins => b.response) end as resp_due,
         case when b.responded is not null
              then b.responded + make_interval(mins => b.resolution) end as res_due
    from base b
)
update work_orders w
   set acknowledged_at       = c.acked,
       responded_at          = c.responded,
       sla_ack_due_at        = c.ack_due,
       sla_response_due_at   = c.resp_due,
       sla_resolution_due_at = c.res_due,
       -- No deadline -> no verdict. A completed stamp -> compare the two
       -- stamps, which can never move again. No stamp, but this IS the stage
       -- the work order is sitting in right now -> compare against now(),
       -- the only honest reading of a question about the present. No stamp,
       -- and the work order has moved past this stage -> unknowable, not
       -- missed: false, the same answer as "never started".
       sla_ack_breached = case
         when c.ack_due is null then false
         when c.acked is not null then c.acked > c.ack_due
         when c.open_stage = 'acknowledge' then now() > c.ack_due
         else false end,
       sla_response_breached = case
         when c.resp_due is null then false
         when c.responded is not null then c.responded > c.resp_due
         when c.open_stage = 'response' then now() > c.resp_due
         else false end,
       sla_resolution_breached = case
         when c.res_due is null then false
         when c.resolved is not null then c.resolved > c.res_due
         when c.open_stage = 'resolution' then now() > c.res_due
         else false end
  from calc c
 where w.id = c.id;

-- The two derived columns, in a second statement so they read the values the
-- first one committed rather than the row's old ones. si_open_stage_due_at(w)
-- is evaluated once per row here (the `due` CTE), fixing 0069's double
-- evaluation of it inline in the SET list.
with due as (
  select id, si_open_stage_due_at(work_orders) as due_at from work_orders
)
update work_orders w
   set sla_breached      = w.sla_ack_breached
                        or w.sla_response_breached
                        or w.sla_resolution_breached,
       sla_stage_overdue = coalesce(d.due_at < now(), false)
  from due d
 where d.id = w.id;

select si_compute_dashboard_stats();
