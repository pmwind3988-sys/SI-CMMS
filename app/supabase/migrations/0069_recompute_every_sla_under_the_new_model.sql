-- ============================================================================
-- SI — Service Inside · 0069 Recompute every SLA under the sequential model
-- ============================================================================
-- 0067 changed what the numbers mean. Every work order already in the table was
-- judged under the old one, so until this runs the deadlines on screen and the
-- targets behind them describe different promises.
--
-- **Everything is recomputed, closed and signed-off work included**, and every
-- verdict is decided by comparing two recorded instants — never by reading the
-- clock. A work order closed in June has its acknowledge stage judged by when
-- it was actually assigned against when it was actually due, so the answer is a
-- fact about June and will not drift again. now() appears only where a stage is
-- genuinely still open, which is the only case where "has it been missed" is a
-- question about the present.
--
-- Sign-off is untouched: `verified_at` and `verified_by` are not named in any
-- UPDATE here, nor are `status`, the assignee, `resolved_at`, `closed_at` or
-- `decline_count`. The omission is the mechanism, as in 0051 and 0064.
--
-- ---------------------------------------------------------------------------
-- 1. The stage moments come from history, filtered to transitions
-- ---------------------------------------------------------------------------
-- 0050 backfilled `acknowledged_at` and `responded_at` once. This re-derives
-- them for any row still missing one, by 0050's own rule: first occurrence of
-- `assigned` / `repairing` in work_order_history, `event_type = 'transition'`.
--
-- The filter is load-bearing and it is the trap lib/historyEvents.js exists
-- for: 0043's photo-replaced rows and 0051's priority-override rows carry the
-- work order's CURRENT status in `to_status`, so a photo swapped while a job
-- was assigned would otherwise read as the moment it was assigned. `coalesce`
-- on event_type, because every row written before 0043 has it null.
--
-- ---------------------------------------------------------------------------
-- 2. A stage whose predecessor never happened has no verdict
-- ---------------------------------------------------------------------------
-- No deadline, flag false, deadline column NULL. That is not "met" — it is
-- "never started", and si_open_sla_stage is what keeps such a work order
-- visible as overdue at the stage it is actually stuck in. Falling back to
-- created_at to fill the gap would be the from-creation reading of a
-- sequential stage, which is the exact arithmetic 0067 exists to remove.
--
-- ---------------------------------------------------------------------------
-- 3. Re-running it is a no-op
-- ---------------------------------------------------------------------------
-- Every value is derived from created_at, from history and from the sla table
-- — never from this migration's own previous output. The snapshot table is
-- written with `on conflict do nothing`, so the FIRST run's before-image is the
-- one kept.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The before-image. A permanent table, not a temp one: it is the evidence for
-- the review gate and the only way back to what the old model said.
-- ---------------------------------------------------------------------------
create table if not exists sla_backfill_0069 (
  work_order_id         uuid primary key references work_orders(id) on delete cascade,
  captured_at           timestamptz not null default now(),
  priority              si_priority,
  status                si_wo_status,
  created_at            timestamptz,
  acknowledged_at       timestamptz,
  responded_at          timestamptz,
  resolved_at           timestamptz,
  closed_at             timestamptz,
  sla_ack_due_at        timestamptz,
  sla_response_due_at   timestamptz,
  sla_resolution_due_at timestamptz,
  sla_breached          boolean,
  sla_warning_sent      boolean
);

alter table sla_backfill_0069 enable row level security;

-- Superuser only. It is an audit artefact of a one-off correction, and it holds
-- nothing a reader needs that work_orders does not already publish.
drop policy if exists sla_backfill_0069_select on sla_backfill_0069;
create policy sla_backfill_0069_select on sla_backfill_0069
  for select using (si_is_superuser());

insert into sla_backfill_0069 (
  work_order_id, priority, status, created_at, acknowledged_at, responded_at,
  resolved_at, closed_at, sla_ack_due_at, sla_response_due_at,
  sla_resolution_due_at, sla_breached, sla_warning_sent)
select id, priority, status, created_at, acknowledged_at, responded_at,
       resolved_at, closed_at, sla_ack_due_at, sla_response_due_at,
       sla_resolution_due_at, sla_breached, sla_warning_sent
  from work_orders
on conflict (work_order_id) do nothing;

-- ---------------------------------------------------------------------------
-- The recomputation
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
         coalesce(w.acknowledged_at, h.first_assigned)  as acked,
         coalesce(w.responded_at,    h.first_repairing) as responded,
         /* The resolution stage ends when the repair was declared finished.
            resolved_at first, closed_at as the fallback for rows closed by a
            route that never stamped it — 0062 found three. */
         coalesce(w.resolved_at, w.closed_at)           as resolved,
         t.ack, t.response, t.resolution
    from work_orders w
    left join hist h on h.work_order_id = w.id
    cross join lateral si_sla_targets(w.priority) t
),
calc as (
  select b.*,
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
       /* Completed stage -> compare the two stamps. Open stage -> compare the
          deadline with now(), which is the only honest reading of a question
          about the present. No deadline -> no verdict. */
       sla_ack_breached = case
         when c.ack_due is null then false
         when c.acked is not null then c.acked > c.ack_due
         else now() > c.ack_due end,
       sla_response_breached = case
         when c.resp_due is null then false
         when c.responded is not null then c.responded > c.resp_due
         else now() > c.resp_due end,
       sla_resolution_breached = case
         when c.res_due is null then false
         when c.resolved is not null then c.resolved > c.res_due
         else now() > c.res_due end
  from calc c
 where w.id = c.id;

-- The two derived columns, in a second statement so they read the values the
-- first one committed rather than the row's old ones.
update work_orders w
   set sla_breached      = w.sla_ack_breached
                        or w.sla_response_breached
                        or w.sla_resolution_breached,
       sla_stage_overdue = (si_open_stage_due_at(w) is not null
                            and si_open_stage_due_at(w) < now());

select si_compute_dashboard_stats();
