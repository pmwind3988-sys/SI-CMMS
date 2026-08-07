-- ============================================================================
-- SI — Service Inside · 0003 Work order triggers
-- ============================================================================
-- Ports functions/index.js onWorkOrderCreate and onWorkOrderUpdated, plus the
-- transition matrix that firestore.rules expressed as helper functions.
--
-- Three things change for the better in the move, and they are worth knowing:
--
--   1. The Cloud Functions ran AFTER the write and then issued a SECOND write
--      to stamp wo_number, the SLA timestamps, resolved_at, closed_at and
--      decline_count. Here those are set in BEFORE triggers, in the same row
--      write. One write instead of two: no window where a work order exists
--      without a wo_number, and no phantom realtime event for the correction.
--
--   2. The transition matrix is a TABLE, not code. schema.js already carried
--      STATUS_TRANSITIONS as data and firestore.rules carried it again as
--      boolean expressions; keeping two copies in sync by hand is what
--      schema.js's own header warns about. The trigger is now a lookup.
--
--   3. wo_number allocation was a Firestore transaction; here it is a single
--      INSERT .. ON CONFLICT DO UPDATE .. RETURNING, which is atomic without
--      a retry loop.
--
-- WHO BYPASSES THE MATRIX:
--   - auth.uid() IS NULL  -> the caller is pg_cron, the service role, or an
--     admin script. Equivalent to the Admin SDK bypassing security rules.
--   - si_is_admin()       -> the deliberate narrow exception firestore.rules
--     granted to Administrator alone.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- THE TRANSITION MATRIX
--
-- Rows where from_status = to_status are not no-ops; they are the two
-- status-preserving paths the original ruleset allowed:
--   open   -> open   : the "edit core fields while still Open" clause
--   others -> itself : mid-flight reassignment (FSD Business Rule 6 — ownership
--                      changes, the flow does not restart)
--
-- Role scoping (technician must be the assignee, requester must be the owner,
-- supervisor must be in the same department) is cross-cutting and enforced in
-- the trigger, not per row.
-- ---------------------------------------------------------------------------

create table wo_status_transitions (
  from_status              si_wo_status not null,
  to_status                si_wo_status not null,
  roles                    si_role[] not null,
  requires                 text[] not null default '{}',
  requires_assignee_change boolean not null default false,
  label                    text,
  primary key (from_status, to_status)
);

alter table wo_status_transitions enable row level security;

create policy wo_transitions_select on wo_status_transitions
  for select to authenticated using (si_signed_in());

insert into wo_status_transitions (from_status, to_status, roles, requires, requires_assignee_change, label) values
  -- assignment
  ('open','assigned',                    '{supervisor,manager,admin}',           '{assigned_to_id}',   false, 'Assign technician'),
  -- technician field-service flow
  ('assigned','accepted',                '{technician,manager,admin}',           '{}',                 false, 'Accept'),
  ('assigned','open',                    '{technician,manager,admin}',           '{decline_reason}',   false, 'Decline'),
  ('accepted','on_the_way',              '{technician,manager,admin}',           '{}',                 false, 'Start travel'),
  ('on_the_way','on_site',               '{technician,manager,admin}',           '{}',                 false, 'Arrive on site'),
  ('on_site','repairing',                '{technician,manager,admin}',           '{}',                 false, 'Start repair'),
  ('repairing','waiting_spare_part',     '{technician,manager,admin}',           '{spare_part_reason}',false, 'Waiting for spare part'),
  ('waiting_spare_part','repairing',     '{technician,manager,admin}',           '{}',                 false, 'Resume repair'),
  ('repairing','testing',                '{technician,manager,admin}',           '{}',                 false, 'Start testing'),
  ('testing','repairing',                '{technician,manager,admin}',           '{test_fail_reason}', false, 'Test failed'),
  ('testing','completed',                '{technician,manager,admin}',           '{resolution_notes}', false, 'Mark completed'),
  -- requester verification
  ('completed','closed',                 '{requester,manager,admin}',            '{verified_by}',      false, 'Verify and close'),
  ('completed','repairing',              '{requester,manager,admin}',            '{reopen_reason}',    false, 'Reopen'),
  -- status-preserving: edit while open
  ('open','open',                        '{requester,supervisor,manager,admin}', '{}',                 false, 'Edit core fields'),
  -- status-preserving: reassignment
  ('assigned','assigned',                '{supervisor,manager,admin}',           '{assigned_to_id}',   false, 'Reassign (pre-acceptance)'),
  ('accepted','accepted',                '{supervisor,manager,admin}',           '{assigned_to_id}',   true,  'Reassign mid-flight'),
  ('on_the_way','on_the_way',            '{supervisor,manager,admin}',           '{assigned_to_id}',   true,  'Reassign mid-flight'),
  ('on_site','on_site',                  '{supervisor,manager,admin}',           '{assigned_to_id}',   true,  'Reassign mid-flight'),
  ('repairing','repairing',              '{supervisor,manager,admin}',           '{assigned_to_id}',   true,  'Reassign mid-flight'),
  ('waiting_spare_part','waiting_spare_part','{supervisor,manager,admin}',       '{assigned_to_id}',   true,  'Reassign mid-flight'),
  ('testing','testing',                  '{supervisor,manager,admin}',           '{assigned_to_id}',   true,  'Reassign mid-flight');

-- ---------------------------------------------------------------------------
-- SLA TARGETS — reads the sla table so the values are genuinely configurable
-- (which is what seeding that collection was for), falling back to the
-- constants that were hardcoded in functions/index.js and src/lib/constants.js.
-- ---------------------------------------------------------------------------

create or replace function si_sla_target_minutes(
  p in si_priority,
  ack out int,
  resolution out int
)
language plpgsql
stable
set search_path = public
as $$
begin
  select ack_target_minutes, resolution_target_minutes
    into ack, resolution
    from sla
   where priority_id = p and plant_id is null
   limit 1;

  if ack is null then
    ack := case p when 'P1' then 5 when 'P2' then 15 when 'P3' then 30 else 120 end;
    resolution := case p when 'P1' then 240 when 'P2' then 480 when 'P3' then 1440 else 7200 end;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- NOTIFICATION HELPERS — SECURITY DEFINER so they can write to notifications,
-- which no client role may insert into.
-- ---------------------------------------------------------------------------

create or replace function si_notify(
  p_recipient_id uuid,
  p_recipient_role si_role,
  p_entity_id uuid,
  p_entity_label text,
  p_type text,
  p_title text,
  p_body text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into notifications (recipient_id, recipient_role, entity_type, entity_id,
                             entity_label, type, title, body, status)
  values (p_recipient_id, p_recipient_role, 'work_order', p_entity_id,
          p_entity_label, p_type, p_title, p_body, 'sent');
$$;

-- Supervisors scoped to one department: the primary triage owners. Manager and
-- Admin see everything through the Dashboard instead of a per-work-order
-- notice, so they are deliberately excluded here.
create or replace function si_department_supervisors(p_department_id text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from users
   where role = 'supervisor'
     and department_id = p_department_id
     and status = 'active';
$$;

-- Every Manager, system-wide. Used only for P1 escalation, not routine traffic.
create or replace function si_managers()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from users where role = 'manager' and status = 'active';
$$;

-- ============================================================================
-- CREATE PATH — replaces onWorkOrderCreate
-- ============================================================================

-- BEFORE INSERT: allocate wo_number and compute the SLA deadlines, in the same
-- write as the row itself. The counter is one global sequence per year, not per
-- department or plant, matching the original format WO-{year}-{6 digits}.
create or replace function si_before_work_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year text := to_char(now(), 'YYYY');
  v_next bigint;
  v_ack int;
  v_res int;
begin
  if new.wo_number is null then
    insert into counters (id, last_value)
    values ('WO-' || v_year, 1)
    on conflict (id) do update set last_value = counters.last_value + 1
    returning last_value into v_next;

    new.wo_number := 'WO-' || v_year || '-' || lpad(v_next::text, 6, '0');
  end if;

  select ack, resolution into v_ack, v_res from si_sla_target_minutes(new.priority);

  new.sla_ack_due_at        := coalesce(new.sla_ack_due_at,        now() + make_interval(mins => v_ack));
  new.sla_resolution_due_at := coalesce(new.sla_resolution_due_at, now() + make_interval(mins => v_res));
  new.sla_breached          := false;
  new.sla_warning_sent      := false;
  new.decline_count         := 0;

  -- Denormalized asset_name, previously the client's job to remember.
  if new.asset_name is null then
    select name into new.asset_name from assets where id = new.asset_id;
  end if;

  return new;
end;
$$;

create trigger before_work_order_insert
  before insert on work_orders
  for each row execute function si_before_work_order_insert();

-- AFTER INSERT: the opening history row, plus the two notifications. "New work
-- order" is one of the two triggers that notifies both sides of the same event:
-- the Supervisor needs to act on it, the Requester just needs to know it landed.
create or replace function si_after_work_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supervisor uuid;
begin
  insert into work_order_history (work_order_id, from_status, to_status,
                                  actor_id, actor_name, actor_role, remarks)
  values (new.id, null, 'open', new.requester_id, new.requester_name,
          'requester', 'Work order raised');

  perform si_notify(
    new.requester_id, 'requester', new.id, new.wo_number, 'submitted',
    'Work order submitted',
    new.wo_number || ' — ' || coalesce(new.asset_name, 'equipment') ||
      ' has been received and will be triaged shortly.'
  );

  for v_supervisor in select si_department_supervisors(new.department_id) loop
    perform si_notify(
      v_supervisor, 'supervisor', new.id, new.wo_number, 'needs_assignment',
      'New work order needs a technician',
      new.wo_number || ' — ' || coalesce(new.asset_name, 'equipment') ||
        ' (' || new.priority || ')'
    );
  end loop;

  return null;
end;
$$;

create trigger after_work_order_insert
  after insert on work_orders
  for each row execute function si_after_work_order_insert();

-- ============================================================================
-- UPDATE PATH
-- ============================================================================

-- BEFORE UPDATE (1/2): the transition matrix. This is the direct replacement
-- for assignmentTransition() / technicianWorkflowTransition() /
-- requesterVerificationTransition() in firestore.rules.
create or replace function si_guard_work_order_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := si_role();
  t      wo_status_transitions;
  v_field text;
begin
  -- pg_cron, the service role, and admin scripts are trusted, exactly as the
  -- Admin SDK bypassed security rules.
  if auth.uid() is null then return new; end if;

  -- Administrator bypasses the matrix outright. Deliberate and narrow; policy,
  -- not this trigger, is what keeps it used sparingly.
  if v_role = 'admin' then return new; end if;

  if v_role is null then
    raise exception 'Your account has no role assigned — sign out and back in.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Cross-cutting scope checks. Manager is system-wide and skips them, but is
  -- still held to the same matrix below.
  if v_role = 'technician' and old.assigned_to_id is distinct from auth.uid() then
    raise exception 'You can only act on work orders assigned to you.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'requester' and old.requester_id is distinct from auth.uid() then
    raise exception 'You can only act on work orders you raised.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'supervisor' and old.department_id is distinct from si_department_id() then
    raise exception 'You can only act on work orders in your own department.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t
    from wo_status_transitions
   where from_status = old.status and to_status = new.status;

  if not found then
    raise exception '% is not a permitted transition from %.', new.status, old.status
      using errcode = 'check_violation';
  end if;

  if not (v_role::si_role = any (t.roles)) then
    raise exception 'A % may not perform "%" (% -> %).',
      v_role, coalesce(t.label, 'this transition'), old.status, new.status
      using errcode = 'insufficient_privilege';
  end if;

  if t.requires_assignee_change
     and new.assigned_to_id is not distinct from old.assigned_to_id then
    raise exception 'Reassigning a work order at status "%" requires a different technician.', old.status
      using errcode = 'check_violation';
  end if;

  -- Required fields must be present and non-empty, the equivalent of the
  -- `x is string && x.size() > 0` checks throughout firestore.rules.
  foreach v_field in array t.requires loop
    if coalesce(to_jsonb(new) ->> v_field, '') = '' then
      raise exception '"%" is required for "%" (% -> %).',
        v_field, coalesce(t.label, 'this transition'), old.status, new.status
        using errcode = 'not_null_violation';
    end if;
  end loop;

  return new;
end;
$$;

create trigger a_guard_work_order_transition
  before update on work_orders
  for each row execute function si_guard_work_order_transition();

-- BEFORE UPDATE (2/2): the stamping the Cloud Function did as a second write.
create or replace function si_stamp_work_order()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = old.status then return new; end if;

  -- Decline: assigned -> open with the assignee cleared.
  if old.status = 'assigned' and new.status = 'open' then
    new.decline_count := old.decline_count + 1;
    new.assigned_to_id := null;
    new.assigned_to_name := null;
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

create trigger b_stamp_work_order
  before update on work_orders
  for each row execute function si_stamp_work_order();

-- AFTER UPDATE: the notification fan-out from onWorkOrderUpdated. Every branch
-- below is keyed off the status transition, and only status transitions.
create or replace function si_notify_work_order_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_supervisor uuid;
  v_asset text := coalesce(new.asset_name, 'equipment');
  v_ref   text := coalesce(new.wo_number, 'This work order');
begin
  if new.status = old.status then return null; end if;

  if new.status = 'assigned' and new.assigned_to_id is not null then
    perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
      'assigned', 'You''ve been assigned a work order',
      v_ref || ' — ' || v_asset);
  end if;

  if old.status = 'assigned' and new.status = 'open' then
    for v_supervisor in select si_department_supervisors(new.department_id) loop
      perform si_notify(v_supervisor, 'supervisor', new.id, new.wo_number,
        'declined', 'Technician declined — needs reassignment',
        v_ref || ' — ' || v_asset);
    end loop;
  end if;

  if old.status = 'assigned' and new.status = 'accepted' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'status_change', 'Technician accepted your work order',
      coalesce(new.assigned_to_name, 'A technician') || ' has accepted ' || v_ref ||
      ' and will be on their way shortly.');
  end if;

  if old.status = 'on_the_way' and new.status = 'on_site' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'status_change', 'Technician has arrived',
      coalesce(new.assigned_to_name, 'A technician') || ' is now on site for ' || v_ref || '.');
  end if;

  if new.status = 'completed' then
    perform si_notify(new.requester_id, 'requester', new.id, new.wo_number,
      'completed', 'Your work order was completed — please verify',
      v_ref || ' — ' || v_asset);
  end if;

  -- Reopening is operationally significant enough that the department's
  -- Supervisor should know too, not just the technician doing the work. Unlike
  -- Decline, this is not asking them to act, only to be aware.
  if old.status = 'completed' and new.status = 'repairing' then
    if new.assigned_to_id is not null then
      perform si_notify(new.assigned_to_id, 'technician', new.id, new.wo_number,
        'reopened', 'Work order reopened by requester',
        v_ref || ' — ' || v_asset);
    end if;
    for v_supervisor in select si_department_supervisors(new.department_id) loop
      perform si_notify(v_supervisor, 'supervisor', new.id, new.wo_number,
        'reopened', 'Work order reopened by requester',
        v_ref || ' — ' || v_asset || ' was not fixed and has been reopened.');
    end loop;
  end if;

  return null;
end;
$$;

create trigger after_work_order_update
  after update on work_orders
  for each row execute function si_notify_work_order_update();
