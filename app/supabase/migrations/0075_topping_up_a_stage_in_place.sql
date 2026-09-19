-- ---------------------------------------------------------------------------
-- 0075 — Extending an SLA no longer has to move the priority
-- ---------------------------------------------------------------------------
-- 0072 gave "extend" exactly one meaning: re-grade the work order to a LESS
-- urgent priority, which under 0067 hands the open stage that priority's own,
-- longer window. That is the right primitive and it is kept unchanged. What it
-- cannot express is the thing people actually ask for at the machine — "this
-- P7 overhaul needs another fortnight, it is still a P7" — and it runs out of
-- road in two places that have nothing to do with the judgement being made:
--
--   * a P7 can be extended exactly once, to P8, and never again;
--   * a P8 cannot be extended at all, because 0072's strict-rank-increase test
--     has nothing left to offer it. The dialog says so in as many words.
--
-- So `si_extend_work_order_sla` gains a second mode. A TOP-UP adds one more of
-- the work order's OWN priority's window to the stage it is sitting in, and
-- moves nothing else: not the priority, not the impact, not the assignee, not
-- the status.  Same button, same dialog, same at-risk gate, same Administrator.
--
-- Five things here are load-bearing.
--
-- 1. THE ADDED TIME IS A COLUMN, NOT A NEW DEADLINE.
--    The obvious implementation — push `sla_resolution_due_at` out and be done
--    — is silently wrong, because BOTH RPCs that touch an SLA recompute all
--    three deadlines from scratch out of `si_sla_targets` plus the recorded
--    stage moments (0051, 0072, 0074). A top-up written only into the due date
--    is therefore erased by the next priority re-grade, with no error and
--    nothing on the record saying the time was ever granted. Three
--    `sla_*_extra_mins` columns hold it instead, and every deadline
--    computation in both RPCs adds the stage's own extra back on. The re-grade
--    then preserves the top-up for free, which is the correct behaviour rather
--    than a happy accident: the two decisions are independent.
--
-- 2. `si_stamp_work_order` NEEDS NO CHANGE, AND THAT WAS CHECKED RATHER THAN
--    ASSUMED. It writes `sla_response_due_at` / `sla_resolution_due_at` only
--    when they are null (0067) — it fills a stage's deadline in as that stage
--    starts and never recomputes one that exists. A stage can only be topped
--    up while it is open, and an open stage's deadline is by definition
--    already set, so the trigger and the extras can never contend for the same
--    column. Were that `is null` guard ever loosened, this migration breaks.
--
-- 3. THE TIME IS ADDED TO THE STAGE'S EXISTING DEADLINE, NEVER TO `now()`.
--    It falls out of (1) for free — the extra is a term in the same
--    `created_at`/`acknowledged_at`/`responded_at` arithmetic 0051 and 0072
--    already use — and it is the rule those two state explicitly: the fault is
--    as old as it is, and restarting the clock would reward extending a job
--    that is already late. Consequence to expect rather than treat as a bug: a
--    stage ten days past a seven-day window is still overdue after one top-up,
--    and the dialog says so on the option before it is chosen.
--
-- 4. UNLIMITED, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. There is no
--    cap on how many times a stage may be topped up. The accepted cost, stated
--    plainly because it is real: `sla_stage_overdue` — and with it the
--    dashboard's Overdue card — can be driven to zero by topping up rather
--    than by fixing anything. What keeps the record honest is that the three
--    STICKY breach flags are not reset here any more than they are by 0072's
--    re-grade (a stage that was missed was missed), plus two things this
--    migration adds for the purpose: `sla_top_up_count`, and the minutes
--    themselves, which the export reports as hours. Friction is the client's
--    job — from the second top-up onward the dialog says which time this is
--    before the button will do anything.
--
-- 5. `sla_top_up_count` IS SEPARATE FROM `sla_extension_count`, deliberately.
--    The latter counts every extension of either kind and is what 0072's
--    export column reports; the former counts top-ups alone, and exists
--    because the dialog's "this is the 2nd time" disclaimer is a statement
--    about repeatedly buying time on one stage. Folding them together would
--    make a single unrelated priority re-grade announce a second top-up that
--    never happened — a heading meaning two things, which is the objection
--    0051 already raises against reusing `priority_touched`.
--
-- The function is DROPPED and recreated rather than `create or replace`d,
-- because its argument list changes. 0056 is the precedent and the reason:
-- `create or replace` matches on the argument list, so adding a parameter
-- creates an OVERLOAD and leaves the old function in place, after which
-- Postgres resolves every existing two-argument call to it in preference to
-- defaulting the new one. The migration pushes cleanly, the columns exist, and
-- the feature simply does not happen.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. Where the granted time lives
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists sla_ack_extra_mins        int not null default 0;
alter table work_orders add column if not exists sla_response_extra_mins   int not null default 0;
alter table work_orders add column if not exists sla_resolution_extra_mins int not null default 0;
alter table work_orders add column if not exists sla_top_up_count          int not null default 0;

comment on column work_orders.sla_ack_extra_mins is
  'Minutes added to the acknowledge stage by si_extend_work_order_sla in top-up mode. Added on top of si_sla_targets whenever this work order''s deadlines are recomputed, so a later priority re-grade preserves it. Written only by that RPC; si_guard_priority_override refuses every other route.';
comment on column work_orders.sla_response_extra_mins is
  'Minutes added to the response stage. See sla_ack_extra_mins.';
comment on column work_orders.sla_resolution_extra_mins is
  'Minutes added to the resolution stage. See sla_ack_extra_mins.';
comment on column work_orders.sla_top_up_count is
  'How many times this work order''s open stage has been topped up in place, as distinct from sla_extension_count, which also counts re-grades to a lower priority. Drives the dialog''s "this is the Nth time" disclaimer.';


-- ---------------------------------------------------------------------------
-- 2. si_fmt_minutes — "7 days", "4 hrs", "45 mins"
-- ---------------------------------------------------------------------------
-- The generated remark is the whole of this feature's audit trail, so it has
-- to read like a sentence a person wrote. `10080 minutes` is arithmetic
-- homework; `7 days` is the promise that was actually made. Chooses the
-- largest unit that divides exactly, so nothing is ever rounded away.
-- ---------------------------------------------------------------------------
create or replace function si_fmt_minutes(p_mins int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_mins is null      then null
    when p_mins = 0          then '0 mins'
    when p_mins % 1440 = 0   then (p_mins / 1440)::text || ' day'  || case when p_mins / 1440 = 1 then '' else 's' end
    when p_mins % 60 = 0     then (p_mins / 60)::text   || ' hr'   || case when p_mins / 60   = 1 then '' else 's' end
    else                          p_mins::text          || ' min'  || case when p_mins        = 1 then '' else 's' end
  end;
$$;

revoke all on function si_fmt_minutes(int) from public, anon;
grant execute on function si_fmt_minutes(int) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. The guard learns about the four new columns
-- ---------------------------------------------------------------------------
-- Reproduced from 0072 in full — `create or replace function` replaces the
-- entire definition, so the unchanged parts have to be restated. The four new
-- columns join `sla_extension_count` and the four priority_override columns in
-- the protected set, for the reason 0072 gave about the count: the minutes and
-- the counts are the only things on the row saying how much time was bought
-- and how often, so they must not be the one part of the record anybody can
-- PATCH directly.
-- ---------------------------------------------------------------------------
create or replace function si_guard_priority_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  -- No JWT: a migration, a seed script, or the service role. Trusted, as
  -- everywhere else in this schema.
  if auth.uid() is null then return new; end if;
  if si_priority_override() then return new; end if;

  /* OLD is unassigned in a BEFORE INSERT trigger, so the two operations get
     separate branches rather than one expression relying on `or` to short
     circuit — the same shape si_guard_retired_reference uses. A work order
     cannot arrive already overridden. */
  if tg_op = 'INSERT' then
    v_changed := new.priority_override        is not null
              or new.priority_override_reason is not null
              or new.priority_overridden_by   is not null
              or new.priority_overridden_at   is not null
              or coalesce(new.sla_extension_count, 0)       <> 0
              or coalesce(new.sla_top_up_count, 0)          <> 0
              or coalesce(new.sla_ack_extra_mins, 0)        <> 0
              or coalesce(new.sla_response_extra_mins, 0)   <> 0
              or coalesce(new.sla_resolution_extra_mins, 0) <> 0;
  else
    v_changed := new.priority_override         is distinct from old.priority_override
              or new.priority_override_reason  is distinct from old.priority_override_reason
              or new.priority_overridden_by    is distinct from old.priority_overridden_by
              or new.priority_overridden_at    is distinct from old.priority_overridden_at
              or new.sla_extension_count       is distinct from old.sla_extension_count
              or new.sla_top_up_count          is distinct from old.sla_top_up_count
              or new.sla_ack_extra_mins        is distinct from old.sla_ack_extra_mins
              or new.sla_response_extra_mins   is distinct from old.sla_response_extra_mins
              or new.sla_resolution_extra_mins is distinct from old.sla_resolution_extra_mins;
  end if;

  if v_changed then
    raise exception 'Priority can only be changed by an Administrator, with a reason. Use Change priority or Extend SLA on the work order.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_priority_override() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. si_override_work_order_priority: add the extras back on
-- ---------------------------------------------------------------------------
-- Reproduced from 0074 in full. Exactly three lines change — the three
-- `make_interval` calls each gain the stage's own `sla_*_extra_mins` — and
-- that is the whole of note 1 above: without them, re-grading a work order
-- silently destroys every minute an Administrator has ever topped it up by.
-- Everything else, including 0074's assignment rules for the sticky flags and
-- 0051's deliberate omission of `status` and the assignee, is untouched.
-- ---------------------------------------------------------------------------
create or replace function si_override_work_order_priority(
  p_work_order_id uuid,
  p_priority      si_priority,
  p_reason        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w            work_orders;
  v_reason     text := btrim(coalesce(p_reason, ''));
  v_actor      uuid := auth.uid();
  v_actor_name text;
  v_old_label  text;
  v_new_label  text;
  v_target     si_priority;
  v_impact     si_impact;
  v_ack        int;
  v_resp       int;
  v_res        int;
  v_seq        boolean;
  v_ack_due    timestamptz;
  v_resp_due   timestamptz;
  v_res_due    timestamptz;
  v_stage      text;
  v_new_due    timestamptz;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  -- RLS does not apply inside a SECURITY DEFINER function, so the rank rule is
  -- restated here rather than assumed from the grant.
  if not si_is_admin() then
    raise exception 'Only an Administrator can change a work order''s priority.'
      using errcode = 'insufficient_privilege';
  end if;

  if length(v_reason) < 10 then
    raise exception 'Give a reason of at least 10 characters. It is recorded on the work order and shown to whoever is working on it.'
      using errcode = 'check_violation';
  end if;

  select * into w from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  if w.status in ('verified', 'closed') then
    raise exception 'This work order is finished, so its priority is part of the record now and cannot be changed.'
      using errcode = 'check_violation';
  end if;

  if p_priority is not null then
    if not exists (select 1 from priorities where id = p_priority and is_active) then
      raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
    end if;
  end if;

  -- What the priority will actually become: the override if there is one, the
  -- derivation if there is not. Computed here rather than read back after the
  -- UPDATE because the SLA has to be recomputed in the same statement.
  v_target := coalesce(p_priority,
                       si_derive_priority(w.impact, w.safety_risk, w.environmental_risk),
                       w.priority);

  if v_target = w.priority and p_priority is not distinct from w.priority_override then
    raise exception 'That is already this work order''s priority.' using errcode = 'check_violation';
  end if;

  -- Only P7 and P8 move the impact — see this file's header. Note the absence
  -- of `status` and `assigned_to_id` from the UPDATE below: see 0051 note 5.
  v_impact := case when p_priority = 'P7' then 'long_term'::si_impact
                    when p_priority = 'P8' then 'scheduled'::si_impact
                    else w.impact end;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(v_target);

  -- The three `+ coalesce(w.sla_*_extra_mins, 0)` terms are 0075's only change
  -- to this function. A re-grade replaces the PRIORITY's contribution to each
  -- deadline; it has nothing to say about time an Administrator granted on top
  -- of it, and dropping that time here would erase it with no error and no
  -- trace. See 0075 note 1.
  v_ack_due := w.created_at + make_interval(mins => v_ack + coalesce(w.sla_ack_extra_mins, 0));

  if v_seq then
    v_resp_due := case when w.acknowledged_at is not null
                       then w.acknowledged_at + make_interval(mins => v_resp + coalesce(w.sla_response_extra_mins, 0)) end;
    v_res_due  := case when w.responded_at is not null
                       then w.responded_at + make_interval(mins => v_res + coalesce(w.sla_resolution_extra_mins, 0)) end;
  else
    v_resp_due := w.created_at + make_interval(mins => v_resp + coalesce(w.sla_response_extra_mins, 0));
    v_res_due  := w.created_at + make_interval(mins => v_res + coalesce(w.sla_resolution_extra_mins, 0));
  end if;

  -- Which stage is currently open (unaffected by this UPDATE — status,
  -- acknowledged_at and responded_at all stay put) and what it is now due,
  -- under the recomputed deadlines above. Both sla_stage_overdue and
  -- sla_warning_sent below key on THIS — the open stage's new deadline — not
  -- on the resolution deadline alone, the same pre-0067 shape 0074 exists to
  -- remove. si_extend_work_order_sla uses the same v_new_due for both.
  v_stage := si_open_sla_stage(w);
  v_new_due := case v_stage when 'acknowledge' then v_ack_due
                            when 'response'    then v_resp_due
                            when 'resolution'  then v_res_due end;

  select label into v_old_label from priorities where id = w.priority;
  select label into v_new_label from priorities where id = v_target;
  select name  into v_actor_name from users where id = v_actor;

  -- The door, for this statement only. `set local` dies with the transaction,
  -- so a pooled connection cannot carry it into the next one.
  perform set_config('si.allow_priority_override', 'on', true);

  update work_orders
     set priority_override        = p_priority,
         priority_override_reason = v_reason,
         priority_overridden_by   = v_actor,
         priority_overridden_at   = now(),
         impact                   = v_impact,
         sla_ack_due_at           = v_ack_due,
         sla_response_due_at      = v_resp_due,
         sla_resolution_due_at    = v_res_due,
         -- The permanent record is the OR of the three sticky flags, not the
         -- resolution deadline alone (0074) — an override does not move the
         -- sticky flags (bare references on the right read OLD), it can only
         -- leave `sla_breached` correctly true when an earlier stage already
         -- missed its own deadline, which the pre-0074 line silently cleared.
         sla_breached             = sla_ack_breached or sla_response_breached or sla_resolution_breached,
         -- TRANSIENT: recomputed against the open stage's new deadline (0074),
         -- the same shape si_extend_work_order_sla already uses — otherwise
         -- the dashboard's Overdue card carries a stale verdict until the next
         -- sweep, up to five minutes after the very deadline it is about just
         -- moved.
         sla_stage_overdue        = (v_new_due is not null and v_new_due < now()),
         -- Only reset when the open stage's new deadline is still ahead: a
         -- work order already past its recomputed deadline has nothing left
         -- to warn about, and re-arming it there would send a warning after
         -- the breach. Keyed on v_new_due (0074), not the resolution deadline
         -- alone — a work order overdue at ack with no resolution deadline
         -- yet must not have this reset to false.
         sla_warning_sent         = case when v_new_due is not null and v_new_due < now()
                                          then w.sla_warning_sent else false end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

  /* On the timeline, not merely in a column.
     from_status = to_status = the status it is sitting in, which on this schema
     is NOT a way of saying "not a transition" — ('assigned','assigned') is row
     3 of 0003's matrix. `event_type` is what says so, which is the whole reason
     0043 added the column. */
  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks, event_type)
  values
    (p_work_order_id, w.status, w.status, v_actor, v_actor_name, 'admin',
     coalesce(v_old_label, w.priority::text) || ' (' || w.priority || ') -> ' ||
     coalesce(v_new_label, v_target::text)   || ' (' || v_target  || '). ' || v_reason,
     'priority_override');

  /* Told to the two people it changes something for, and to neither if they
     are the one who did it. Deliberately NOT the whole ops chain the way 0038
     fans accept and decline out: `notifications` still has no retention and no
     per-account mute, and a re-grade is not a routing problem anybody else has
     to act on. `distinct` because on a small site the requester and the
     assignee can be the same person, and one notification is enough. */
  perform si_notify(r.id, r.role, p_work_order_id, coalesce(w.wo_number, 'Work order'),
                    'priority_changed',
                    'Priority changed to ' || v_target,
                    coalesce(w.wo_number, 'A work order') || ' is now ' ||
                    coalesce(v_new_label, v_target::text) || ' (' || v_target || '), was ' ||
                    coalesce(v_old_label, w.priority::text) || ' (' || w.priority || '). ' || v_reason)
    from (select w.assigned_to_id as id, 'technician'::si_role as role
           where w.assigned_to_id is not null
             and w.assigned_to_id is distinct from v_actor
             and w.assigned_to_id is distinct from w.requester_id
          union all
          select w.requester_id, 'requester'::si_role
           where w.requester_id is distinct from v_actor) r;
end;
$$;

revoke all on function si_override_work_order_priority(uuid, si_priority, text) from public, anon;
grant execute on function si_override_work_order_priority(uuid, si_priority, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. si_extend_work_order_sla: two modes, one door
-- ---------------------------------------------------------------------------
-- DROP first. See this file's header — `create or replace` would create an
-- overload and every existing two-argument call would keep resolving to the
-- old function. A plpgsql body is not linked to the functions it calls until
-- it runs, so dropping one that other bodies reference is safe.
--
-- BOTH signatures are dropped, and the second line is not redundant. Dropping
-- only the old two-argument form makes this file fail on its SECOND run with
-- *"function si_extend_work_order_sla already exists with same argument
-- types"* — the three-argument function created by the first run is still
-- there and `create function` collides with it. That matters in three places:
-- the check script re-applies this file inside a transaction to exercise it;
-- the dashboard SQL Editor is how a migration reaches production on this
-- project, and pasting is easy to do twice; and a fresh project re-runs
-- everything. Every other statement in this file is already idempotent
-- (`add column if not exists`, `create or replace`), so this was the one line
-- standing between the file and being safe to run twice.
-- ---------------------------------------------------------------------------
drop function if exists si_extend_work_order_sla(uuid, si_priority);
drop function if exists si_extend_work_order_sla(uuid, si_priority, boolean);

create function si_extend_work_order_sla(
  p_work_order_id uuid,
  p_priority      si_priority default null,
  p_top_up        boolean     default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w                  work_orders;
  v_actor            uuid    := auth.uid();
  v_top_up           boolean := coalesce(p_top_up, false);
  v_actor_name       text;
  v_stage            text;
  v_started          timestamptz;
  v_due              timestamptz;
  v_old_rank         int;
  v_new_rank         int;
  v_old_label        text;
  v_new_label        text;
  v_target           si_priority;
  v_impact           si_impact;
  v_old_impact_label text;
  v_new_impact_label text;
  v_ack              int;
  v_resp             int;
  v_res              int;
  v_seq              boolean;
  v_x_ack            int;
  v_x_resp           int;
  v_x_res            int;
  v_grant            int;
  v_ack_due          timestamptz;
  v_resp_due         timestamptz;
  v_res_due          timestamptz;
  v_new_due          timestamptz;
  v_remark           text;
  v_nth              int;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  if not si_is_admin() then
    raise exception 'Only an Administrator can extend a work order''s SLA.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into w from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  if w.status in ('completed', 'verified', 'closed') then
    raise exception 'This work order is finished, so its SLA is part of the record now and cannot be extended.'
      using errcode = 'check_violation';
  end if;

  /* The two modes are mutually exclusive by argument, not by precedence. A
     call naming both a priority and a top-up is a caller that has not decided
     which thing it is doing, and guessing for it is how a re-grade ships
     wearing an extension's audit trail. */
  if v_top_up then
    if p_priority is not null then
      raise exception 'Topping up keeps this work order at its own priority, so no priority is given. Use Change priority to re-grade it instead.'
        using errcode = 'check_violation';
    end if;
  else
    if p_priority is null then
      raise exception 'Choose the priority to extend this work order to.' using errcode = 'check_violation';
    end if;

    if not exists (select 1 from priorities where id = p_priority and is_active) then
      raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
    end if;
  end if;

  select rank, label into v_old_rank, v_old_label from priorities where id = w.priority;

  if not v_top_up then
    select rank, label into v_new_rank, v_new_label from priorities where id = p_priority;

    /* Rank ascending is severity descending, so less urgent is a GREATER rank.
       This is the one rule si_override_work_order_priority must NOT have: a
       re-grade legitimately moves in both directions, an extension never does.
       A top-up moves no priority at all, so the comparison has nothing to
       compare and is skipped rather than made to pass trivially. */
    if v_new_rank is null or v_old_rank is null or v_new_rank <= v_old_rank then
      raise exception 'Extending an SLA can only move a work order to a lower priority than % (%).',
        coalesce(v_old_label, w.priority::text), w.priority
        using errcode = 'check_violation';
    end if;
  else
    v_new_label := v_old_label;
  end if;

  v_stage   := si_open_sla_stage(w);
  v_started := si_open_stage_started_at(w);
  v_due     := si_open_stage_due_at(w);

  if v_stage is null then
    raise exception 'This work order has no SLA stage running, so there is nothing to extend.'
      using errcode = 'check_violation';
  end if;

  /* The gate canExtendSla() mirrors. Overdue, or inside the last quarter of the
     open stage's own window — si_sla_warning_sweep's threshold. Shared by both
     modes deliberately: buying time is worth recording when the clock is
     running out, whichever way the time is bought. */
  if v_due is null then
    raise exception 'This work order''s % stage has no deadline yet, so there is nothing to extend.', v_stage
      using errcode = 'check_violation';
  end if;

  if v_due > now() and (v_started is null or (v_due - now()) > (v_due - v_started) * 0.25) then
    raise exception 'This work order still has most of its % time left. An SLA is extended when it is running out, not before.', v_stage
      using errcode = 'check_violation';
  end if;

  v_target := case when v_top_up then w.priority else p_priority end;

  -- Only P7 and P8 move the impact — same rule, same reason, as
  -- si_override_work_order_priority above. A top-up moves no priority, so it
  -- can never move the impact either: `v_target = w.priority` makes both
  -- branches of the case irrelevant, but the test is written on `v_top_up`
  -- rather than left to that coincidence, because a work order that is ALREADY
  -- P7 would otherwise have its impact rewritten by an action that changed
  -- nothing about its grading.
  v_impact := case when v_top_up          then w.impact
                   when p_priority = 'P7' then 'long_term'::si_impact
                   when p_priority = 'P8' then 'scheduled'::si_impact
                   else w.impact end;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(v_target);

  v_x_ack  := coalesce(w.sla_ack_extra_mins, 0);
  v_x_resp := coalesce(w.sla_response_extra_mins, 0);
  v_x_res  := coalesce(w.sla_resolution_extra_mins, 0);

  /* A top-up grants the OPEN stage one more of the work order's own window —
     a P7 resolution stage gets another 7 days, however many times it is asked
     for. Added to the stage's stored extra rather than to its deadline: see
     0075 note 1 for why the deadline alone cannot hold it. */
  if v_top_up then
    v_grant := case v_stage when 'acknowledge' then v_ack
                            when 'response'    then v_resp
                            when 'resolution'  then v_res end;

    if v_grant is null or v_grant <= 0 then
      raise exception 'This work order''s % stage has no target to add, so there is nothing to top up.', v_stage
        using errcode = 'check_violation';
    end if;

    if    v_stage = 'acknowledge' then v_x_ack  := v_x_ack  + v_grant;
    elsif v_stage = 'response'    then v_x_resp := v_x_resp + v_grant;
    elsif v_stage = 'resolution'  then v_x_res  := v_x_res  + v_grant;
    end if;
  end if;

  /* Recomputed from the raise time and the recorded stage moments, exactly as
     0051 does it — never from now(). The fault is as old as it is, and
     restarting the clock would reward extending a job that is already late.
     The extras are terms in that same arithmetic, which is what makes a
     top-up add to the stage's existing deadline rather than to the clock. */
  v_ack_due := w.created_at + make_interval(mins => v_ack + v_x_ack);

  if v_seq then
    v_resp_due := case when w.acknowledged_at is not null
                       then w.acknowledged_at + make_interval(mins => v_resp + v_x_resp) end;
    v_res_due  := case when w.responded_at is not null
                       then w.responded_at + make_interval(mins => v_res + v_x_res) end;
  else
    v_resp_due := w.created_at + make_interval(mins => v_resp + v_x_resp);
    v_res_due  := w.created_at + make_interval(mins => v_res + v_x_res);
  end if;

  v_new_due := case v_stage when 'acknowledge' then v_ack_due
                            when 'response'    then v_resp_due
                            when 'resolution'  then v_res_due end;

  select name into v_actor_name from users where id = v_actor;

  v_nth := coalesce(w.sla_top_up_count, 0) + 1;

  if v_top_up then
    v_remark := 'SLA topped up (#' || v_nth || ' for this work order): ' ||
                initcap(v_stage) || ' stage given another ' || si_fmt_minutes(v_grant) ||
                ', priority unchanged at ' || coalesce(v_old_label, w.priority::text) ||
                ' (' || w.priority || '). Stage now due ' ||
                coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                         'when the stage starts') || '.';
  else
    v_remark := 'SLA extended: ' || coalesce(v_old_label, w.priority::text) || ' (' || w.priority ||
                ') -> ' || coalesce(v_new_label, p_priority::text) || ' (' || p_priority ||
                '). ' || initcap(v_stage) || ' stage now due ' ||
                coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                         'when the stage starts') || '.';
  end if;

  -- Named only when the impact actually changed — an extension to P3 or any
  -- other severity never touches it, and a top-up never touches it at all, so
  -- the remark stays silent about a move that did not happen.
  if v_impact is distinct from w.impact then
    select label into v_old_impact_label from impact_levels where code = w.impact;
    select label into v_new_impact_label from impact_levels where code = v_impact;
    v_remark := v_remark || ' Production impact moved from "' ||
                coalesce(v_old_impact_label, w.impact::text) || '" to "' ||
                coalesce(v_new_impact_label, v_impact::text) || '".';
  end if;

  perform set_config('si.allow_priority_override', 'on', true);

  /* `status` and the assignee are deliberately NOT named — 0051 note 5. An
     extension changes what is expected of a work order, not who is doing it or
     how far along it is, and si_stamp_work_order's decline branch is three
     lines below a test this UPDATE must never reach.
     The three sticky breach flags are NOT reset either, in either mode: a
     stage that was missed was missed, and granting more time afterwards does
     not un-miss it. Only sla_stage_overdue moves, because the stage may no
     longer be late.
     The four priority_override columns are written by the RE-GRADE mode only.
     A top-up overrides no priority, so it leaves them reading whatever the
     last actual re-grade said — bare column references on the right-hand side
     read OLD, the same shape 0074 relies on for the sticky flags. Writing the
     top-up's own name and time there instead would file it as a priority
     override, which is the one thing it is not. */
  update work_orders
     set priority_override        = case when v_top_up then priority_override        else p_priority end,
         priority_override_reason = case when v_top_up then priority_override_reason else v_remark   end,
         priority_overridden_by   = case when v_top_up then priority_overridden_by   else v_actor    end,
         priority_overridden_at   = case when v_top_up then priority_overridden_at   else now()      end,
         sla_extension_count      = coalesce(sla_extension_count, 0) + 1,
         sla_top_up_count         = coalesce(sla_top_up_count, 0) + case when v_top_up then 1 else 0 end,
         sla_ack_extra_mins       = v_x_ack,
         sla_response_extra_mins  = v_x_resp,
         sla_resolution_extra_mins = v_x_res,
         impact                   = v_impact,
         sla_ack_due_at           = v_ack_due,
         sla_response_due_at      = v_resp_due,
         sla_resolution_due_at    = v_res_due,
         sla_breached             = sla_ack_breached or sla_response_breached or sla_resolution_breached,
         sla_stage_overdue        = (v_new_due is not null and v_new_due < now()),
         sla_warning_sent         = case when v_new_due is not null and v_new_due > now()
                                         then false else sla_warning_sent end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

  /* One event type for both modes. A top-up and a re-grade are both "somebody
     bought this work order more time", which is what the timeline is being
     asked; the remark says which, and 0072's `sla_extension` label already
     reads correctly for either. A second event type would split one question
     across two filters for no reader's benefit. */
  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks, event_type)
  values
    (p_work_order_id, w.status, w.status, v_actor, v_actor_name, 'admin', v_remark, 'sla_extension');

  /* The two people it changes something for, and neither of them if they are
     the one who did it. `distinct` because on a small site the requester and
     the assignee can be the same person. Deliberately not the ops chain: an
     extension is not a routing problem anybody else has to act on, and
     notifications still has no retention. */
  perform si_notify(r.id, r.role, p_work_order_id, coalesce(w.wo_number, 'Work order'),
                    'priority_changed',
                    case when v_top_up
                         then 'More time on ' || v_stage
                         else 'SLA extended to ' || p_priority end,
                    case when v_top_up
                         then coalesce(w.wo_number, 'A work order') || ' has been given another ' ||
                              si_fmt_minutes(v_grant) || ' on its ' || v_stage || ' stage. It stays ' ||
                              coalesce(v_old_label, w.priority::text) || ' (' || w.priority || '). ' ||
                              initcap(v_stage) || ' stage now due ' ||
                              coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                                       'when the stage starts') || '.'
                         else coalesce(w.wo_number, 'A work order') || ' has been extended to ' ||
                              coalesce(v_new_label, p_priority::text) || ' (' || p_priority || '), was ' ||
                              coalesce(v_old_label, w.priority::text) || ' (' || w.priority || '). ' ||
                              initcap(v_stage) || ' stage now due ' ||
                              coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                                       'when the stage starts') || '.' end,
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

revoke all on function si_extend_work_order_sla(uuid, si_priority, boolean) from public, anon;
grant execute on function si_extend_work_order_sla(uuid, si_priority, boolean) to authenticated;

select si_compute_dashboard_stats();
