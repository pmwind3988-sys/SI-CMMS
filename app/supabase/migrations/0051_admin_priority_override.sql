-- ============================================================================
-- SI — Service Inside · 0051 An Administrator may re-prioritise, with a reason
-- ============================================================================
-- Since 0036 `work_orders.priority` is derived from the production impact and a
-- BEFORE trigger overwrites whatever arrives, so nobody could change it: not
-- the requester who raised the fault, not the supervisor triaging it, not an
-- Administrator. That is right for the first three and wrong for the fourth.
-- A job whose real urgency the derivation cannot see — one that turns out to be
-- a long-term rebuild rather than a breakdown, or the reverse — had no way to
-- be re-graded at all.
--
-- **Administrator only, and a reason is required.** Not a `role_permissions`
-- toggle like work-order delete (0018): the priority is what the SLA clock is
-- computed from, so this is closer to 0031's retire-reference-data than to a
-- capability that gets handed out.
--
-- ---------------------------------------------------------------------------
-- 1. An override column, not a writable `priority`
-- ---------------------------------------------------------------------------
-- The obvious implementation is "let an Administrator write `priority` and make
-- the derive trigger leave it alone". It cannot work, because the trigger has
-- no way to tell an Administrator's deliberate value from the same value
-- arriving in `updateWorkOrderFields()`'s arbitrary `fields` object — which is
-- exactly why 0036 fires on every UPDATE rather than `update of impact, …`.
--
-- So the override is its own column and si_force_derived_priority() reads it:
--
--   new.priority := coalesce(new.priority_override, si_derive_priority(...))
--
-- Which makes the override *sticky* for free, and it has to be. Editing the
-- work order later re-derives from the new impact and the override still wins,
-- until an Administrator clears it. The alternative — an escape hatch inside
-- the trigger keyed on who is calling — would put an authorization decision in
-- a place with no policy behind it.
--
-- The second tempting shortcut was to skip the column entirely and have the
-- Administrator set the *impact*, letting the existing derivation carry the
-- priority. That is unsound in one direction: the safety and environmental
-- escalations are `least()` caps, so a work order flagged for a high safety
-- risk derives P1 whatever its impact says, and an Administrator asking for P7
-- on it would silently get P1 with no error. Setting the impact reaches only
-- the priorities the flags allow; an override has to reach all of them.
--
-- ---------------------------------------------------------------------------
-- 2. Overriding to P7 moves the impact with it — and only to P7
-- ---------------------------------------------------------------------------
-- P7 is not a severity, it is a *kind of work*: planned, long-term, measured in
-- days (0050). A work order reading "Full production stoppage · P7" is not a
-- re-graded job, it is a contradiction, so an override to P7 sets
-- `impact = 'long_term'` in the same statement.
--
-- Overrides between P1 and P4 leave the impact exactly as the requester chose
-- it. Those four ARE severities, and the requester's answer to "what is this
-- doing to production" is a fact they observed at the machine — a fact the
-- Administrator is disagreeing with the *grading* of, not the observation. The
-- reason is where the disagreement is recorded. Rewriting their answer would
-- destroy the input the derivation is computed from and make the override
-- unreviewable: nothing left on the row would show it had ever happened
-- differently.
--
-- The impact that was displaced is kept in the audit row either way.
--
-- ---------------------------------------------------------------------------
-- 3. Live work orders only
-- ---------------------------------------------------------------------------
-- Refused at `verified` and `closed`. At that point the work order is a
-- finished record and its SLA outcome has been decided — re-prioritising it
-- would move a deadline that has already been met or missed and rewrite the
-- breach flag on a closed job. Same line 0043 drew for replacing a photo, for
-- the same reason.
--
-- ---------------------------------------------------------------------------
-- 4. The SLA is recomputed from the raise time
-- ---------------------------------------------------------------------------
-- The FSD says both SLA timestamps are "computed once at creation and never
-- recalculated afterward", and adds that changing a running deadline "is an
-- edge case requiring an explicit product decision, not something to handle
-- silently". This is that decision, made explicitly: the point of an override
-- is to change what is expected of the work order, and a P7 still measured
-- against a P3's 24-hour deadline would show as breached within a day of being
-- re-graded as long-term work.
--
-- Recomputed from `created_at`, not from now. A work order raised on Monday and
-- re-graded on Wednesday gets P7's day-5 / day-8 / day-15 marks counted from
-- Monday — the fault is as old as it is, and restarting the clock would reward
-- re-grading a job that is already late.
--
-- Sequential priorities (0050) keep their staged shape: the response deadline
-- is computed from `acknowledged_at` and the resolution deadline from
-- `responded_at`, so a stage that has not been reached yet stays NULL rather
-- than being invented from the raise time.
--
-- `sla_breached` is recomputed too, in both directions, and `sla_warning_sent`
-- is reset when the new deadline is still ahead so the warning sweep can fire
-- against the new promise. This is a deliberate exception to the FSD's "once
-- set, does not clear itself": that rule protects a breach from being erased by
-- the passage of time, and what clears it here is a named Administrator with a
-- recorded reason, which is the opposite of silent.
--
-- ---------------------------------------------------------------------------
-- 5. Three enforcement points, because two of them bypass RLS
-- ---------------------------------------------------------------------------
-- `work_orders` has an UPDATE policy that has to stay open for every
-- transition and every edit, so "no UPDATE policy" — 0043's answer for
-- `attachments` — is not available here. Instead:
--
--   * si_guard_priority_override (BEFORE INSERT OR UPDATE) refuses ANY change
--     to the four override columns unless the RPC's door is open. A direct
--     PATCH from an Administrator's own token is refused, so the reason and the
--     audit row cannot be skipped by anyone, at any rank.
--   * si_override_work_order_priority (SECURITY DEFINER) is that door. It
--     re-checks si_is_admin() in its own body, because RLS does not apply
--     inside it.
--   * The door is a session-local setting read back by
--     si_priority_override(), mirroring si_protected_override() from 0013/0016
--     exactly. `set local` means it dies with the transaction, so it cannot
--     leak to the next statement on a pooled connection.
--
-- The guard sits at `a000_` so it is the first BEFORE trigger to fire, ahead of
-- 0036's `a00_derive_work_order_priority` which reads the column it protects.
-- Every digit sorts below `_` in ASCII, which is the same fact that stops a
-- migration being numbered between two existing ones.
-- ============================================================================

alter table work_orders add column if not exists priority_override        si_priority;
alter table work_orders add column if not exists priority_override_reason text;
alter table work_orders add column if not exists priority_overridden_by   uuid references users(id);
alter table work_orders add column if not exists priority_overridden_at   timestamptz;

comment on column work_orders.priority_override is
  'Set only by si_override_work_order_priority. When present it IS the priority — si_force_derived_priority coalesces it over the derived value.';

-- ---------------------------------------------------------------------------
-- The door — a copy of si_protected_override()'s shape, deliberately
-- ---------------------------------------------------------------------------
create or replace function si_priority_override()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(current_setting('si.allow_priority_override', true), 'off') = 'on';
$$;

revoke all on function si_priority_override() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Nothing writes those four columns except through the RPC — see note 5
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

  -- The door, opened by si_override_work_order_priority for its own statement.
  if si_priority_override() then return new; end if;

  /* OLD is unassigned in a BEFORE INSERT trigger, so the two operations get
     separate branches rather than one expression relying on `or` to short
     circuit — the same shape si_guard_retired_reference uses. A work order
     cannot arrive already overridden. */
  if tg_op = 'INSERT' then
    v_changed := new.priority_override        is not null
              or new.priority_override_reason is not null
              or new.priority_overridden_by   is not null
              or new.priority_overridden_at   is not null;
  else
    v_changed := new.priority_override        is distinct from old.priority_override
              or new.priority_override_reason is distinct from old.priority_override_reason
              or new.priority_overridden_by   is distinct from old.priority_overridden_by
              or new.priority_overridden_at   is distinct from old.priority_overridden_at;
  end if;

  if v_changed then
    raise exception 'Priority can only be changed by an Administrator, with a reason. Use Change priority on the work order.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_priority_override() from public, anon, authenticated;

drop trigger if exists a000_guard_priority_override on work_orders;
create trigger a000_guard_priority_override
  before insert or update on work_orders
  for each row execute function si_guard_priority_override();

-- ---------------------------------------------------------------------------
-- 0036's trigger body, with the override coalesced over the derivation
-- ---------------------------------------------------------------------------
create or replace function si_force_derived_priority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_priority si_priority;
begin
  if new.priority_override is not null then
    -- An Administrator's recorded decision outranks the derivation, and goes on
    -- outranking it through every later edit of the impact — see note 1.
    new.priority := new.priority_override;
  else
    v_priority := si_derive_priority(new.impact, new.safety_risk, new.environmental_risk);
    if v_priority is not null then
      new.priority := v_priority;
    end if;
  end if;

  -- False unconditionally, including when nothing could be derived. The column
  -- means "the requester overrode the suggestion", and nobody can now — so it
  -- is a statement about the person, not about whether the derivation fired.
  -- An Administrator's override is recorded in priority_override, not here:
  -- 0036 kept this column so the export's "Priority Overridden" heading would
  -- not churn, and repurposing it would make that column mean two things.
  new.priority_touched := false;

  return new;
end;
$$;

revoke all on function si_force_derived_priority() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The RPC
--
-- `p_priority => null` clears the override and hands the work order back to the
-- derivation. A reason is still required: going back to the derived value is a
-- decision too, and the audit row is the only place it is recorded.
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
  v_breached   boolean;
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

  -- Only P7 moves the impact — see note 2.
  v_impact := case when p_priority = 'P7' then 'long_term'::si_impact else w.impact end;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(v_target);

  v_ack_due := w.created_at + make_interval(mins => v_ack);

  if v_seq then
    v_resp_due := case when w.acknowledged_at is not null
                       then w.acknowledged_at + make_interval(mins => v_resp) end;
    v_res_due  := case when w.responded_at is not null
                       then w.responded_at + make_interval(mins => v_res) end;
  else
    v_resp_due := w.created_at + make_interval(mins => v_resp);
    v_res_due  := w.created_at + make_interval(mins => v_res);
  end if;

  v_breached := v_res_due is not null and v_res_due < now();

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
         sla_breached             = v_breached,
         -- Only reset when the new deadline is still ahead: a work order that
         -- is already past its recomputed deadline has nothing left to warn
         -- about, and re-arming it there would send a warning after the breach.
         sla_warning_sent         = case when v_breached then w.sla_warning_sent else false end
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
