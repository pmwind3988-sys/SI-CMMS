-- ============================================================================
-- SI — Service Inside · 0019 Area, and the end of department scoping
-- ============================================================================
-- Three changes that arrived together because the second and third are the same
-- change seen from two sides.
--
--   1. work_orders.area — free text for where in the plant the fault is. The
--      asset says which machine; this says where to walk to.
--
--   2. A Supervisor is no longer confined to their own department. Equipment is
--      pickable from anywhere, so a work order can legitimately name a machine
--      the raiser has nothing to do with, and the supervisor who has to triage
--      it is not selected by the raiser's department. Every supervisor now sees
--      and acts on every work order; Technician and Requester scoping is
--      untouched.
--
--   3. Any signed-in user may add a department, because the raise form now
--      offers it inline.
--
-- WHY THE TRIGGER IS IN HERE. Widening work_orders_select on its own produces
-- the worst possible outcome: a Supervisor can *see* another department's work
-- order and then fails to assign it, because si_guard_work_order_transition
-- (0003) carries its own department check that RLS knows nothing about. Policy
-- and trigger are two halves of one rule and have to move together. The same
-- goes for work_orders_delete (0018), whose second half is a verbatim copy of
-- work_orders_select's predicate — a copy is only correct while it is kept in
-- step.
--
-- department_id itself stays, on every table and every work order. It is the
-- dimension the dashboard breaks down by and it still routes notifications; it
-- simply no longer decides who may look.
--
-- si_in_same_department() is left defined. Nothing calls it after this
-- migration, but 0007 sets its search_path and dropping it would need that
-- amended for no gain.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Area
-- ---------------------------------------------------------------------------
-- Nullable and unconstrained: every existing work order predates the field, and
-- a required field that nobody can retrofit is a field that blocks edits to old
-- records. The client treats blank as "not recorded" and hides the row.
alter table work_orders
  add column if not exists area text;

comment on column work_orders.area is
  'Free-text location of the fault within the plant (line, bay, floor). Optional; the asset identifies the machine, this identifies where it is.';

-- ---------------------------------------------------------------------------
-- 2. Work order scope — the four policies
-- ---------------------------------------------------------------------------
-- In each one the supervisor branch changes from si_in_same_department(...) to
-- a bare si_is_supervisor(). Nothing else moves.

drop policy if exists work_orders_select on work_orders;
create policy work_orders_select on work_orders
  for select to authenticated
  using (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or (si_is_technician() and assigned_to_id = auth.uid())
    or (si_is_requester()  and requester_id  = auth.uid())
  );

-- A Supervisor raising on someone's behalf is no longer confined to their own
-- department either — they could otherwise see a machine in the picker and be
-- refused when they filed against it.
drop policy if exists work_orders_insert on work_orders;
create policy work_orders_insert on work_orders
  for insert to authenticated
  with check (
    status = 'open'
    and assigned_to_id is null
    and (
      si_is_admin()
      or si_is_manager()
      or si_is_supervisor()
      or requester_id = auth.uid()
    )
  );

drop policy if exists work_orders_update on work_orders;
create policy work_orders_update on work_orders
  for update to authenticated
  using (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or (si_is_technician() and assigned_to_id = auth.uid())
    or (si_is_requester()  and requester_id  = auth.uid())
  )
  with check (
    si_is_admin()
    or si_is_manager()
    or si_is_supervisor()
    or si_is_technician()
    or si_is_requester()
  );

-- 0018's second half restates work_orders_select. Restated again here, with the
-- same substitution, so the two do not drift. The capability half is unchanged:
-- no role but Admin holds it by default, so this widens nothing today — it
-- keeps the reach of a *future* grant equal to what that role can see.
drop policy if exists work_orders_delete on work_orders;
create policy work_orders_delete on work_orders
  for delete to authenticated
  using (
    si_can_delete_work_orders()
    and (
      si_is_admin()
      or si_is_manager()
      or si_is_supervisor()
      or (si_is_technician() and assigned_to_id = auth.uid())
      or (si_is_requester()  and requester_id  = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 2b. The trigger half of the same rule
-- ---------------------------------------------------------------------------
-- Identical to 0003's function with one block removed: the supervisor
-- department check. The technician and requester checks stay — those scopes did
-- not change, and they are the reason this trigger cannot simply defer to RLS
-- (a policy sees OLD or NEW, never both, and these read OLD).
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

  -- Cross-cutting scope checks. Manager and Supervisor are both system-wide as
  -- of this migration and skip them, but are still held to the same matrix
  -- below.
  if v_role = 'technician' and old.assigned_to_id is distinct from auth.uid() then
    raise exception 'You can only act on work orders assigned to you.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_role = 'requester' and old.requester_id is distinct from auth.uid() then
    raise exception 'You can only act on work orders you raised.'
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

-- ---------------------------------------------------------------------------
-- 3. Anyone may add a department
-- ---------------------------------------------------------------------------
-- The raise form offers "+ Add new" in the department picker, so the person on
-- the floor filing against a bay nobody registered can name it without waiting
-- for an Administrator.
--
-- INSERT only. departments_update and departments_delete stay Manager+/Admin,
-- so a Requester can bring a department into existence but cannot rename one
-- out from under existing work orders or remove it. Renaming is the dangerous
-- half — the id is what work_orders reference, and the name is what the
-- dashboard groups by.
drop policy if exists departments_insert on departments;
create policy departments_insert on departments
  for insert to authenticated
  with check (si_signed_in());

-- ---------------------------------------------------------------------------
-- 4. The notification hole that opens with it
-- ---------------------------------------------------------------------------
-- si_department_supervisors() is the fan-out target for a new work order, an
-- SLA warning, an SLA breach and a reopen. A department created from the raise
-- form has no supervisor assigned to it, so under the original definition every
-- one of those notified precisely nobody — silently, since an empty loop is not
-- an error.
--
-- The targeted fan-out is kept: notifying all supervisors about every work order
-- is how a notification list gets ignored. The fallback fires only when the
-- department genuinely has nobody, which is the case where "too many people
-- heard about it" beats "nobody did".
create or replace function si_department_supervisors(p_department_id text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  with dept_supervisors as (
    select id
      from users
     where role = 'supervisor'
       and status = 'active'
       and department_id = p_department_id
  )
  select id from dept_supervisors
  union
  select id
    from users
   where role = 'supervisor'
     and status = 'active'
     and not exists (select 1 from dept_supervisors);
$$;

comment on function si_department_supervisors(text) is
  'Active Supervisors of one department, falling back to every active Supervisor when that department has none — otherwise a department created from the raise form would notify nobody.';
