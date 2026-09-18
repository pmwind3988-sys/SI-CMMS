-- ============================================================================
-- SI — Service Inside · 0067 Every SLA stage starts when the last one finished
-- ============================================================================
-- P1-P4 promised their three targets as offsets from the raise time, so three
-- hours spent finding a technician came out of the technician's four hours. P7
-- has not worked that way since 0050, and the split was never a design — it was
-- P7 arriving with a better model and the older four being left alone because
-- converting them looked like a change to the promise.
--
-- It is not, and that is the whole of section 1. The old numbers are CUMULATIVE
-- offsets; sequential numbers are stage DURATIONS; converting one to the other
-- is `stage(n) = cumulative(n) - cumulative(n-1)`. Every priority's headline
-- figure is the number it has had since 0006, and a work order whose stages all
-- complete exactly on time gets its resolution deadline at the same instant it
-- would have today.
--
--   P1  5 / 10  / 225   = 4 hrs        P3  30  / 210  / 1200  = 24 hrs
--   P2  15 / 45 / 420   = 8 hrs        P4  120 / 1320 / 5760  = 5 days
--
-- Accepted consequence, stated because it is the model rather than a rounding
-- error: a team that BEATS a stage target finishes earlier too. Respond to a P1
-- in two minutes and the repair is due at 3h47m from the fault, not 4h. It
-- never works the other way — an overrunning stage does not shorten the next
-- one, because the next one starts when the previous one actually completed.
--
-- ---------------------------------------------------------------------------
-- 2. Per-stage breach, and an overdue that clears
-- ---------------------------------------------------------------------------
-- `sla_breached` is a permanent record: the export reports it, the FSD forbids
-- clearing it by the passage of time, and 0051 treats clearing it as an
-- exception needing a named Administrator. The behaviour wanted on the
-- dashboard is the opposite — a work order nine minutes late to be assigned
-- should stop being "overdue" the moment it IS assigned, because the card
-- answers "what is late right now".
--
-- Those are two different facts, so they get two different sets of columns:
--
--   sla_ack_breached / sla_response_breached / sla_resolution_breached
--       STICKY. Set when that stage's deadline passed with the stage
--       unfinished, never cleared. This is what the work order's own SLA card
--       shows stage by stage and what the export reads.
--   sla_stage_overdue
--       TRANSIENT. True only while the stage the work order is CURRENTLY in is
--       past its deadline. This is what the dashboard's Overdue card counts.
--
-- `sla_breached` is kept and redefined as "any stage was ever missed", so every
-- existing reader keeps working and the export's heading does not churn.
--
-- ---------------------------------------------------------------------------
-- 3. Which stage is open — one definition, three readers
-- ---------------------------------------------------------------------------
-- si_open_sla_stage() states the chain once. The sweeps, the dashboard and the
-- extension RPC all call it rather than restating it, because two definitions
-- of one rule is what suggestPriority() vs si_derive_priority() already costs
-- this schema.
--
-- It tests the FINISHED statuses FIRST, before either timestamp. A work order
-- can reach `closed` with `acknowledged_at` never stamped — 0062 found three
-- such rows on the test project, closed by a route that never fired the stamp
-- trigger — and asking about its acknowledge stage would report a job finished
-- in June as currently late, forever.
--
-- ---------------------------------------------------------------------------
-- 4. si_stamp_work_order recomputes sla_stage_overdue rather than clearing it
-- ---------------------------------------------------------------------------
-- The obvious version is `if the stage advanced then sla_stage_overdue :=
-- false`. Recomputing from the new stage's own deadline is strictly better and
-- no longer: it is correct when the stage advances INTO one that is already
-- late (reachable whenever a stage target is shorter than the sweep's five
-- minutes — P1's response stage is ten), and it needs no comparison of old to
-- new. The sweep then only has to handle the passage of time.
--
-- The sticky flags are set on the stage being LEFT, judged against that stage's
-- own stored deadline and the moment it actually completed — never against
-- now(), which would make a late assignment look punctual if the trigger
-- happened to run later.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The targets. Cumulative -> incremental; the totals are unchanged.
-- ---------------------------------------------------------------------------
update sla set ack_target_minutes = 5,   ack_target_label        = '5 min',
               response_target_minutes = 10,  response_target_label   = '10 min after assignment',
               resolution_target_minutes = 225, resolution_target_label = '3 hrs 45 min after work starts',
               targets_are_sequential = true
 where priority_id = 'P1';

update sla set ack_target_minutes = 15,  ack_target_label        = '15 min',
               response_target_minutes = 45,  response_target_label   = '45 min after assignment',
               resolution_target_minutes = 420, resolution_target_label = '7 hrs after work starts',
               targets_are_sequential = true
 where priority_id = 'P2';

update sla set ack_target_minutes = 30,  ack_target_label        = '30 min',
               response_target_minutes = 210, response_target_label   = '3 hrs 30 min after assignment',
               resolution_target_minutes = 1200, resolution_target_label = '20 hrs after work starts',
               targets_are_sequential = true
 where priority_id = 'P3';

update sla set ack_target_minutes = 120, ack_target_label        = '2 hrs',
               response_target_minutes = 1320, response_target_label   = '22 hrs after assignment',
               resolution_target_minutes = 5760, resolution_target_label = '4 days after work starts',
               targets_are_sequential = true
 where priority_id = 'P4';

-- P7's numbers were authored sequentially in 0050 and are untouched. Stated
-- rather than skipped so the flag is true on every row without exception.
update sla set targets_are_sequential = true where priority_id = 'P7';

-- ---------------------------------------------------------------------------
-- si_sla_targets: the fallbacks follow the seeds, and `sequential` is now
-- unconditional. The fallbacks matter — a priority with no `sla` row at all
-- would otherwise silently get 0050's from-creation numbers under a sequential
-- reading, which is the one combination nothing in this schema means.
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
         coalesce(s.targets_are_sequential, true)
    into ack, response, resolution, sequential
    from sla s
   where s.priority_id = p and s.plant_id is null
   limit 1;

  if ack is null then
    ack := case p when 'P1' then 5 when 'P2' then 15 when 'P3' then 30
                  when 'P7' then 7200 else 120 end;
  end if;

  if response is null then
    response := case p when 'P1' then 10 when 'P2' then 45 when 'P3' then 210
                       when 'P7' then 4320 else 1320 end;
  end if;

  if resolution is null then
    resolution := case p when 'P1' then 225 when 'P2' then 420 when 'P3' then 1200
                         when 'P7' then 10080 else 5760 end;
  end if;

  -- Every priority is sequential now. Left as an assignment rather than
  -- deleted so the column stays the thing that decides, which is what keeps
  -- the model data instead of an `if` in two trigger bodies.
  if sequential is null then sequential := true; end if;
end;
$$;

revoke all on function si_sla_targets(si_priority) from public, anon;
grant execute on function si_sla_targets(si_priority) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The four columns
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists sla_ack_breached        boolean not null default false;
alter table work_orders add column if not exists sla_response_breached   boolean not null default false;
alter table work_orders add column if not exists sla_resolution_breached boolean not null default false;
alter table work_orders add column if not exists sla_stage_overdue       boolean not null default false;

comment on column work_orders.sla_stage_overdue is
  'TRANSIENT: the stage this work order is currently in is past its deadline. Cleared when it advances. The dashboard Overdue card counts this; sla_*_breached are the permanent record.';

comment on column work_orders.sla_breached is
  'Any stage was ever missed — the OR of the three sla_*_breached columns. Never cleared by the passage of time.';

-- ---------------------------------------------------------------------------
-- 3. Which stage is open, when it started, when it is due
-- ---------------------------------------------------------------------------
create or replace function si_open_sla_stage(w work_orders)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when w.status in ('completed', 'closed') then null
           when w.acknowledged_at is null then 'acknowledge'
           when w.responded_at is null then 'response'
           else 'resolution'
         end;
$$;

revoke all on function si_open_sla_stage(work_orders) from public, anon;
grant execute on function si_open_sla_stage(work_orders) to authenticated, service_role;

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
-- 4. The stamp trigger — 0050's body, with the stage verdicts added
--
-- Still SECURITY INVOKER, as 0003 left it, which is what decides
-- si_sla_targets' grant (see 0050 note 4) and now si_open_sla_stage's too.
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

  -- First arrival only, never moved again — 0050 note 2.
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

  /* The verdict on each stage as it is LEFT, judged against that stage's own
     stored deadline and the moment it actually completed. Never against now():
     the trigger runs in the same statement, but reading the clock instead of
     the stamp is the habit that makes a backfill wrong, and this body and
     0069's backfill have to agree exactly. `or` so a flag set once stays set —
     a stage cannot be un-missed, and a work order CAN re-enter a status. */
  if new.acknowledged_at is not null and old.acknowledged_at is null then
    new.sla_ack_breached := new.sla_ack_breached
      or (new.sla_ack_due_at is not null and new.acknowledged_at > new.sla_ack_due_at);
  end if;

  if new.responded_at is not null and old.responded_at is null then
    new.sla_response_breached := new.sla_response_breached
      or (new.sla_response_due_at is not null and new.responded_at > new.sla_response_due_at);
  end if;

  if new.status = 'completed' then
    new.resolved_at := now();
    /* The resolution stage ends at `completed`, not at `closed`: since 0061
       closure is automatic and happens in the same breath, so judging it at
       `closed` would measure the trigger's own second UPDATE. */
    new.sla_resolution_breached := new.sla_resolution_breached
      or (new.sla_resolution_due_at is not null and now() > new.sla_resolution_due_at);
  end if;

  if new.status = 'closed' then
    new.closed_at := now();
    /* Repeated for a work order that reaches `closed` without passing through
       `completed`. Idempotent, because of the `or`. `verified_at` is NOT
       stamped here — 0061 removed that line and closure no longer means
       verified. */
    new.sla_resolution_breached := new.sla_resolution_breached
      or (new.sla_resolution_due_at is not null and now() > new.sla_resolution_due_at);
  end if;

  -- The permanent record is the OR of the three. One place computes it.
  new.sla_breached := new.sla_ack_breached
                   or new.sla_response_breached
                   or new.sla_resolution_breached;

  /* Recomputed, not cleared — see note 4. Correct when the work order advances
     into a stage that is ALREADY late, which P1's ten-minute response stage
     reaches inside one sweep interval. */
  new.sla_stage_overdue := (si_open_stage_due_at(new) is not null
                            and si_open_stage_due_at(new) < now());

  return new;
end;
$$;
