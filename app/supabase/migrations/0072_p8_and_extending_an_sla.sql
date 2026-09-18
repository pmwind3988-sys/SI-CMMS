-- ============================================================================
-- SI — Service Inside · 0072 P8, and an Administrator may extend an SLA
-- ============================================================================
-- ---------------------------------------------------------------------------
-- 1. P8 is a month, and it is a full priority
-- ---------------------------------------------------------------------------
-- Five days to assign, five more to start, twenty to finish: thirty days,
-- sequential like every priority since 0067. It arrives with an impact level of
-- its own ('scheduled' -> P8) because since 0036 nobody picks a priority, so a
-- priority with no impact deriving it would be a value the raise form could
-- never reach — and because 0051's override sets an impact to match a priority
-- and needs the map to stay 1:1.
--
-- Consequence, accepted rather than overlooked: requesters see "Scheduled work
-- (month-scale)" in the impact list. The alternative — extension-only, reachable
-- from nowhere else — was considered and declined.
--
-- Teal #0891B2. Every other candidate collides: violet is P7's, slate #64748B
-- is what priorityColor() returns when a lookup FAILS so a P8 badge would be
-- indistinguishable from a broken one, and green reads as completed.
--
-- The dashboard learns about P8 explicitly, because its priority row is
-- hardcoded keys rather than a loop over the table. Without the branch a P8
-- would be counted in total_open and in no band, the cards would visibly stop
-- adding up, and month-long work — exactly the kind that sits unattended —
-- would be the work with no figure watching it. Same trap 0050 documents.
--
-- ---------------------------------------------------------------------------
-- 2. Extending is 0051's machinery behind a second door
-- ---------------------------------------------------------------------------
-- Re-grading to a less urgent priority gives the OPEN STAGE a longer window,
-- which is what "extend" means once 0067 has made every stage sequential. So
-- this reuses 0051's override columns, 0051's guard and 0051's session-local
-- door, and differs in exactly three ways — which is what earns it a function
-- rather than a flag on si_override_work_order_priority:
--
--   * It refuses any target that is not STRICTLY LESS URGENT. Rank must
--     increase. Extending can only ever grant time; enforcing that in the body
--     means no client can turn "extend" into a covert escalation, and it is the
--     one rule 0051 must not have — a re-grade legitimately goes both ways.
--   * It generates its own remark instead of demanding a typed reason. The
--     action is a yes/no on a phone, and a ten-character floor on a confirm
--     dialog produces "asdfasdfasdf", which is worse evidence than a generated
--     sentence naming both priorities, the stage and the time granted.
--   * It writes event_type = 'sla_extension', so the timeline tells an
--     extension and a re-grade apart.
--
-- `sla_extension_count` joins the four priority_override columns in the guard's
-- protected set, so a direct PATCH of it is refused from anybody at any rank —
-- otherwise the count, which is the only thing on the row saying how many times
-- this has happened, would be the one part of the record anyone could edit.
--
-- The override columns are SHARED with 0051 rather than duplicated. "This work
-- order's priority is P3 regardless of its impact" is one standing decision
-- however it was reached; two parallel override columns would need
-- si_force_derived_priority to arbitrate between them, and the audit rows are
-- where the two routes are already told apart.
--
-- ---------------------------------------------------------------------------
-- 3. The at-risk gate, restated here because RLS does not apply inside
-- ---------------------------------------------------------------------------
-- The button appears when the open stage is overdue or in its last quarter.
-- canExtendSla() decides what to SHOW; this body decides what is allowed, and
-- the two disagreeing must produce an error rather than a silent success. The
-- 25% is si_sla_warning_sweep's, measured over the stage's own window.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. P8's three rows
-- ---------------------------------------------------------------------------
insert into priorities (id, code, label, color_hex, rank, description) values
  ('P8', 'P8', 'Scheduled', '#0891B2', 8,
   'Scheduled work on a month-long horizon. Nothing is stopped and nothing is degraded.')
on conflict (id) do update
  set code = excluded.code, label = excluded.label, color_hex = excluded.color_hex,
      rank = excluded.rank, description = excluded.description;

insert into impact_levels (code, label, suggests_priority, sort_order, description) values
  ('scheduled', 'Scheduled work (month-scale)', 'P8', 6,
   'Planned work with a month-long horizon — an overhaul, a staged upgrade, a deferred repair.')
on conflict (code) do update
  set label = excluded.label, suggests_priority = excluded.suggests_priority,
      sort_order = excluded.sort_order, description = excluded.description;

insert into sla (id, priority_id, plant_id,
                 ack_target_minutes,        ack_target_label,
                 response_target_minutes,   response_target_label,
                 resolution_target_minutes, resolution_target_label,
                 targets_are_sequential) values
  ('P8', 'P8', null,
   7200,  '5 days',
   7200,  '5 days after assignment',
   28800, '20 days after work starts',
   true)
on conflict (id) do update
  set priority_id = excluded.priority_id, plant_id = excluded.plant_id,
      ack_target_minutes = excluded.ack_target_minutes,
      ack_target_label = excluded.ack_target_label,
      response_target_minutes = excluded.response_target_minutes,
      response_target_label = excluded.response_target_label,
      resolution_target_minutes = excluded.resolution_target_minutes,
      resolution_target_label = excluded.resolution_target_label,
      targets_are_sequential = excluded.targets_are_sequential;

-- ---------------------------------------------------------------------------
-- 2. The dashboard's P8 branch — see note 1
-- ---------------------------------------------------------------------------
-- si_compute_dashboard_stats: 0068's body with one key added.
create or replace function si_compute_dashboard_stats()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_open     si_wo_status[] := si_open_statuses();
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
    'p8_scheduled',         count(*) filter (where status = any (v_open) and priority = 'P8'),
    'completed_today',      count(*) filter (where verified_at >= date_trunc('day', now())),
    -- CHANGED: late right now, not ever late.
    'overdue',              count(*) filter (where status = any (v_open) and sla_stage_overdue),
    'avg_response_minutes', coalesce(round(v_response), 0),
    'avg_repair_minutes',   coalesce(round(avg(
                              extract(epoch from (resolved_at - created_at)) / 60
                            ) filter (where verified_at is not null
                                        and resolved_at is not null)), 0),
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
  v_limit    int := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_priority si_priority;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  if p_card in ('total_open', 'p1_critical', 'p2_high', 'p3_medium', 'p4_low',
                'p7_long_term', 'p8_scheduled', 'overdue') then
    v_priority := (case p_card
                     when 'p1_critical' then 'P1'
                     when 'p2_high'     then 'P2'
                     when 'p3_medium'   then 'P3'
                     when 'p4_low'      then 'P4'
                     when 'p7_long_term' then 'P7'
                     when 'p8_scheduled' then 'P8'
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
             round(extract(epoch from (si_open_stage_due_at(w) - now())) / 60)::numeric,
             w.created_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.status = any (v_open)
         and (v_priority is null or w.priority = v_priority)
         and (p_card <> 'overdue' or w.sla_stage_overdue)
       order by si_open_stage_due_at(w) asc nulls last
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
             round(extract(epoch from (w.resolved_at - w.created_at)) / 60)::numeric,
             w.verified_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.verified_at >= date_trunc('day', now())
       order by w.verified_at desc
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
             round(extract(epoch from (w.resolved_at - w.created_at)) / 60)::numeric,
             w.verified_at
        from work_orders w
        left join departments d on d.id = w.department_id
       where w.verified_at is not null
         and w.resolved_at is not null
       order by w.verified_at desc
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

-- ---------------------------------------------------------------------------
-- 3. The count, and the guard that protects it
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists sla_extension_count int not null default 0;

comment on column work_orders.sla_extension_count is
  'How many times an Administrator has extended this work order''s SLA. Written only by si_extend_work_order_sla; si_guard_priority_override refuses every other route.';

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
              or coalesce(new.sla_extension_count, 0) <> 0;
  else
    v_changed := new.priority_override        is distinct from old.priority_override
              or new.priority_override_reason is distinct from old.priority_override_reason
              or new.priority_overridden_by   is distinct from old.priority_overridden_by
              or new.priority_overridden_at   is distinct from old.priority_overridden_at
              or new.sla_extension_count      is distinct from old.sla_extension_count;
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
-- 4. The RPC
-- ---------------------------------------------------------------------------
create or replace function si_extend_work_order_sla(
  p_work_order_id uuid,
  p_priority      si_priority
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w             work_orders;
  v_actor       uuid := auth.uid();
  v_actor_name  text;
  v_stage       text;
  v_started     timestamptz;
  v_due         timestamptz;
  v_old_rank    int;
  v_new_rank    int;
  v_old_label   text;
  v_new_label   text;
  v_ack         int;
  v_resp        int;
  v_res         int;
  v_seq         boolean;
  v_ack_due     timestamptz;
  v_resp_due    timestamptz;
  v_res_due     timestamptz;
  v_new_due     timestamptz;
  v_remark      text;
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

  if p_priority is null then
    raise exception 'Choose the priority to extend this work order to.' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from priorities where id = p_priority and is_active) then
    raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
  end if;

  select rank, label into v_old_rank, v_old_label from priorities where id = w.priority;
  select rank, label into v_new_rank, v_new_label from priorities where id = p_priority;

  /* Rank ascending is severity descending, so less urgent is a GREATER rank.
     This is the one rule si_override_work_order_priority must NOT have: a
     re-grade legitimately moves in both directions, an extension never does. */
  if v_new_rank is null or v_old_rank is null or v_new_rank <= v_old_rank then
    raise exception 'Extending an SLA can only move a work order to a lower priority than % (%).',
      coalesce(v_old_label, w.priority::text), w.priority
      using errcode = 'check_violation';
  end if;

  v_stage   := si_open_sla_stage(w);
  v_started := si_open_stage_started_at(w);
  v_due     := si_open_stage_due_at(w);

  if v_stage is null then
    raise exception 'This work order has no SLA stage running, so there is nothing to extend.'
      using errcode = 'check_violation';
  end if;

  /* The gate canExtendSla() mirrors. Overdue, or inside the last quarter of the
     open stage's own window — si_sla_warning_sweep's threshold. */
  if v_due is null then
    raise exception 'This work order''s % stage has no deadline yet, so there is nothing to extend.', v_stage
      using errcode = 'check_violation';
  end if;

  if v_due > now() and (v_started is null or (v_due - now()) > (v_due - v_started) * 0.25) then
    raise exception 'This work order still has most of its % time left. An SLA is extended when it is running out, not before.', v_stage
      using errcode = 'check_violation';
  end if;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(p_priority);

  /* Recomputed from the raise time and the recorded stage moments, exactly as
     0051 does it — never from now(). The fault is as old as it is, and
     restarting the clock would reward extending a job that is already late. */
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

  v_new_due := case v_stage when 'acknowledge' then v_ack_due
                            when 'response'    then v_resp_due
                            when 'resolution'  then v_res_due end;

  select name into v_actor_name from users where id = v_actor;

  v_remark := 'SLA extended: ' || coalesce(v_old_label, w.priority::text) || ' (' || w.priority ||
              ') -> ' || coalesce(v_new_label, p_priority::text) || ' (' || p_priority ||
              '). ' || initcap(v_stage) || ' stage now due ' ||
              coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                       'when the stage starts') || '.';

  perform set_config('si.allow_priority_override', 'on', true);

  /* `status` and the assignee are deliberately NOT named — 0051 note 5. An
     extension changes what is expected of a work order, not who is doing it or
     how far along it is, and si_stamp_work_order's decline branch is three
     lines below a test this UPDATE must never reach.
     The three sticky breach flags are NOT reset either: a stage that was missed
     was missed, and granting more time afterwards does not un-miss it. Only
     sla_stage_overdue moves, because the stage may no longer be late. */
  update work_orders
     set priority_override        = p_priority,
         priority_override_reason = v_remark,
         priority_overridden_by   = v_actor,
         priority_overridden_at   = now(),
         sla_extension_count      = coalesce(sla_extension_count, 0) + 1,
         sla_ack_due_at           = v_ack_due,
         sla_response_due_at      = v_resp_due,
         sla_resolution_due_at    = v_res_due,
         sla_breached             = sla_ack_breached or sla_response_breached or sla_resolution_breached,
         sla_stage_overdue        = (v_new_due is not null and v_new_due < now()),
         sla_warning_sent         = case when v_new_due is not null and v_new_due > now()
                                         then false else sla_warning_sent end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

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
                    'SLA extended to ' || p_priority,
                    coalesce(w.wo_number, 'A work order') || ' has been extended to ' ||
                    coalesce(v_new_label, p_priority::text) || ' (' || p_priority || '), was ' ||
                    coalesce(v_old_label, w.priority::text) || ' (' || w.priority || '). ' ||
                    initcap(v_stage) || ' stage now due ' ||
                    coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                             'when the stage starts') || '.',
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

revoke all on function si_extend_work_order_sla(uuid, si_priority) from public, anon;
grant execute on function si_extend_work_order_sla(uuid, si_priority) to authenticated;

select si_compute_dashboard_stats();
