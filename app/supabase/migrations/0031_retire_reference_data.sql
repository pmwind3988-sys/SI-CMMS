-- SI — Service Inside · migration 0031
--
-- Retiring reference data, and removing it outright.
--
-- Admin → Settings could relabel and recolour, and could delete a department.
-- Everything else was permanent: migration 0009 gave the enum-keyed lookup
-- tables no DELETE policy at all, on the grounds that "a status with no
-- transition rows would be a broken status". That reasoning is still right about
-- deleting. It is not an argument against ever taking a value out of use.
--
-- The two are different operations and this migration adds both:
--
--   RETIRE  — the row stays. Every existing work order keeps its label and its
--             colour, forever. The value simply stops being offered for new
--             work. Reversible: restore puts it back.
--
--   REMOVE  — the row goes. Only possible when nothing has ever referenced it,
--             which is the case for a department somebody typed by mistake and
--             for essentially nothing else. Refused with a sentence naming what
--             is still pointing at it, in the shape 0030 used for accounts.
--
-- Retire is what the enum-keyed tables get to use in practice. It is also why
-- 0009's "no delete policy" stands unchanged in spirit: deleting P1 would strip
-- the label off every P1 work order ever raised, because work_orders.priority is
-- an enum column with no foreign key onto priorities — Postgres would not stop
-- it and nothing would look wrong until someone opened a board. Retiring P1
-- takes it off the raise form and leaves those work orders exactly as they are.
--
-- SIX TABLES, and the three that are deliberately excluded:
--
--   priorities, impact_levels, wo_types, safety_severities, departments, assets
--
--   wo_statuses      — nobody picks a status. The workflow moves a work order
--                      through them, so "stop offering this for new work" has no
--                      meaning; the equivalent is removing rows from
--                      wo_status_transitions, which is a different change with
--                      different consequences.
--   sla              — one row per priority, not an item in its own right.
--                      Retiring P4 takes its SLA row out of use with it.
--   role_permissions — one row per si_role. The boolean already is the switch.
--
-- WHO. Retiring is Superuser-only, like the 0018 permission toggles and the
-- 0030 account delete. It has to be a trigger rather than a policy: RLS grants
-- or refuses a whole row, and departments_update is si_is_manager_or_admin()
-- while assets_update is si_is_admin() — both need to stay open for ordinary
-- edits, so the flag is the only column that needs guarding and only a trigger
-- can see one column.
--
-- THE FLAG IS NOT ADVISORY. `users.status` decided nothing for four migrations
-- because it was written by the admin screen and read by no policy, trigger or
-- predicate (0026 header). A retirement that only filtered a dropdown would be
-- exactly that bug again — anything speaking to PostgREST directly would carry
-- on using the retired value. si_guard_retired_reference() on work_orders is
-- where it is actually enforced.
--
-- assets already had somewhere to record this: `status si_asset_status` has
-- existed since 0001 with a 'decommissioned' value, read by nothing. That is the
-- flag for equipment. A second boolean beside it would be a second truth.

-- ---------------------------------------------------------------------------
-- 1. The flag
-- ---------------------------------------------------------------------------
alter table priorities        add column if not exists is_active boolean not null default true;
alter table impact_levels     add column if not exists is_active boolean not null default true;
alter table wo_types          add column if not exists is_active boolean not null default true;
alter table safety_severities add column if not exists is_active boolean not null default true;
alter table departments       add column if not exists is_active boolean not null default true;

comment on column priorities.is_active is
  'False = retired: keeps its label on existing work orders, no longer offered for new ones. Superuser-only (0031).';
comment on column impact_levels.is_active is
  'False = retired. See priorities.is_active.';
comment on column wo_types.is_active is
  'False = retired. See priorities.is_active.';
comment on column safety_severities.is_active is
  'False = retired. See priorities.is_active.';
comment on column departments.is_active is
  'False = retired. See priorities.is_active.';
comment on column assets.status is
  'Lifecycle. ''active'' is offerable on the raise form; anything else is retired equipment (0031). Was written by 0001 and read by nothing until then.';

-- One shared reader, so "is this row retired" is answered the same way by the
-- three triggers below and by anything added later. to_jsonb() rather than a
-- column reference because the six tables key on four different column names
-- and two different flags; naming them per table here is what keeps the trigger
-- functions generic.
create or replace function si_reference_is_retired(p_table text, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_retired boolean;
begin
  if p_key is null then return false; end if;

  case p_table
    when 'priorities'        then select not is_active into v_retired from priorities        where id   = p_key::si_priority;
    when 'impact_levels'     then select not is_active into v_retired from impact_levels     where code = p_key::si_impact;
    when 'wo_types'          then select not is_active into v_retired from wo_types          where code = p_key::si_wo_type;
    when 'safety_severities' then select not is_active into v_retired from safety_severities where code = p_key;
    when 'departments'       then select not is_active into v_retired from departments       where id   = p_key;
    when 'assets'            then select status <> 'active' into v_retired from assets       where id   = p_key;
    else raise exception '% is not a retirable reference table', p_table;
  end case;

  -- No row: not retired. A value with no reference row is a labelling problem,
  -- not a retirement, and refusing it here would turn one into the other.
  return coalesce(v_retired, false);
exception
  -- An unknown enum label cannot be retired because it cannot exist. The cast
  -- raises rather than returning no row, and that must not become a refusal.
  when invalid_text_representation then return false;
end;
$$;

revoke all on function si_reference_is_retired(text, text) from public, anon;
grant execute on function si_reference_is_retired(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Only a Superuser retires or restores
-- ---------------------------------------------------------------------------
-- Reads the flag out of to_jsonb(old/new) rather than by name so that one
-- function serves all six tables; assets carries its state in `status` and the
-- other five in `is_active`, and both collapse to the same boolean here.
create or replace function si_guard_reference_retire()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_was_active boolean;
  v_now_active boolean;
  v_remaining  int;
begin
  -- No JWT: a migration, a seed script, or the service role. Trusted, as
  -- everywhere else in this schema.
  if auth.uid() is null then return new; end if;

  if tg_table_name = 'assets' then
    v_was_active := (to_jsonb(old) ->> 'status') = 'active';
    v_now_active := (to_jsonb(new) ->> 'status') = 'active';
  else
    v_was_active := coalesce((to_jsonb(old) ->> 'is_active')::boolean, true);
    v_now_active := coalesce((to_jsonb(new) ->> 'is_active')::boolean, true);
  end if;

  if v_now_active is not distinct from v_was_active then
    return new;                       -- an ordinary edit; nothing to guard
  end if;

  if not si_is_superuser() then
    raise exception 'Only the Superuser can retire or restore reference data.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Retiring the last one standing would empty a picker on the raise form for
  -- everybody, and the way out would be a Superuser noticing and restoring it.
  -- Cheaper to refuse. Only the four tables the form must always be able to
  -- offer something from; a plant with no departments or no equipment
  -- registered is a real starting state, which is why 0009's `ready` gate
  -- excludes those two as well.
  if not v_now_active and tg_table_name in
     ('priorities', 'impact_levels', 'wo_types', 'safety_severities') then
    execute format('select count(*) from %I where is_active', tg_table_name)
      into v_remaining;
    if v_remaining <= 1 then
      raise exception
        'That is the last one still in use. At least one has to stay active, or the raise form has nothing to offer.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function si_guard_reference_retire() from public, anon, authenticated;

drop trigger if exists si_guard_reference_retire_trg on priorities;
create trigger si_guard_reference_retire_trg before update on priorities
  for each row execute function si_guard_reference_retire();

drop trigger if exists si_guard_reference_retire_trg on impact_levels;
create trigger si_guard_reference_retire_trg before update on impact_levels
  for each row execute function si_guard_reference_retire();

drop trigger if exists si_guard_reference_retire_trg on wo_types;
create trigger si_guard_reference_retire_trg before update on wo_types
  for each row execute function si_guard_reference_retire();

drop trigger if exists si_guard_reference_retire_trg on safety_severities;
create trigger si_guard_reference_retire_trg before update on safety_severities
  for each row execute function si_guard_reference_retire();

drop trigger if exists si_guard_reference_retire_trg on departments;
create trigger si_guard_reference_retire_trg before update on departments
  for each row execute function si_guard_reference_retire();

drop trigger if exists si_guard_reference_retire_trg on assets;
create trigger si_guard_reference_retire_trg before update on assets
  for each row execute function si_guard_reference_retire();

-- ---------------------------------------------------------------------------
-- 3. A retired value cannot be put on a work order
-- ---------------------------------------------------------------------------
-- The half that makes retirement real rather than cosmetic. Without it the flag
-- would be filtering a dropdown and nothing else, which is the state
-- users.status was in before 0026.
--
-- Only values that ARE BEING SET are checked. An existing work order carrying a
-- retired priority has to stay workable — accepting it, repairing it, closing it
-- are all UPDATEs, and refusing them would strand the very records retirement
-- exists to protect.
create or replace function si_guard_retired_reference()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_severity text;
  v_severity_changed boolean;
  v_priority_changed boolean;
  v_type_changed     boolean;
  v_impact_changed   boolean;
  v_dept_changed     boolean;
  v_asset_changed    boolean;
begin
  if auth.uid() is null then return new; end if;

  -- The account that retired it can still use it. Nothing in this schema locks
  -- the top account out of undoing its own decision, and the alternative is a
  -- Superuser having to restore a row to fix one record.
  if si_is_superuser() then return new; end if;

  v_new_severity := case when coalesce((new.safety_risk ->> 'flag')::boolean, false)
                         then new.safety_risk ->> 'severity' end;

  /* OLD is unassigned in a BEFORE INSERT trigger — referencing old.priority
     there raises "record old is not assigned yet", so the two operations get
     separate branches rather than one expression relying on `or` to short
     circuit. On INSERT every value is being set; on UPDATE only the changed
     ones are, which is what keeps an existing work order carrying a retired
     priority workable right through to closed. */
  if tg_op = 'INSERT' then
    v_priority_changed := true;
    v_type_changed     := true;
    v_impact_changed   := true;
    v_dept_changed     := true;
    v_asset_changed    := true;
    v_severity_changed := true;
  else
    v_priority_changed := new.priority      is distinct from old.priority;
    v_type_changed     := new.type          is distinct from old.type;
    v_impact_changed   := new.impact        is distinct from old.impact;
    v_dept_changed     := new.department_id is distinct from old.department_id;
    v_asset_changed    := new.asset_id      is distinct from old.asset_id;
    v_severity_changed := v_new_severity is distinct from
      (case when coalesce((old.safety_risk ->> 'flag')::boolean, false)
            then old.safety_risk ->> 'severity' end);
  end if;

  if v_priority_changed and si_reference_is_retired('priorities', new.priority::text) then
    raise exception 'That priority has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_type_changed and si_reference_is_retired('wo_types', new.type::text) then
    raise exception 'That work order type has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_impact_changed and si_reference_is_retired('impact_levels', new.impact::text) then
    raise exception 'That impact level has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_dept_changed and si_reference_is_retired('departments', new.department_id) then
    raise exception 'That department has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_asset_changed and si_reference_is_retired('assets', new.asset_id) then
    raise exception 'That equipment has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  if v_severity_changed and si_reference_is_retired('safety_severities', v_new_severity) then
    raise exception 'That safety severity has been retired and can no longer be chosen. Pick another one.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_retired_reference() from public, anon, authenticated;

-- Named to sort before a_guard_work_order_transition (0003): a work order
-- pointing at a retired department is refused on the grounds of the department,
-- not on whatever the transition guard would have said next.
drop trigger if exists a0_guard_retired_reference on work_orders;
create trigger a0_guard_retired_reference
  before insert or update on work_orders
  for each row execute function si_guard_retired_reference();

-- ---------------------------------------------------------------------------
-- 4. Removing a row outright
-- ---------------------------------------------------------------------------
-- 0002 and 0009 gave the four lookup tables no DELETE policy, with the comment
-- "Never deleted — historical work orders reference them." The guard below is
-- what makes that true rather than merely intended: the reason those rows must
-- not go is that something points at them, and now that is measured and said out
-- loud instead of being enforced by the absence of a policy.
--
-- Superuser only, matching the 0030 account delete. departments_delete and
-- assets_delete stay si_is_admin() where 0002 left them — an Administrator has
-- been able to remove an unused department since the first release and there is
-- no reason for this migration to take that away.
drop policy if exists priorities_delete on priorities;
create policy priorities_delete on priorities
  for delete to authenticated using (si_is_superuser());

drop policy if exists impact_levels_delete on impact_levels;
create policy impact_levels_delete on impact_levels
  for delete to authenticated using (si_is_superuser());

drop policy if exists wo_types_delete on wo_types;
create policy wo_types_delete on wo_types
  for delete to authenticated using (si_is_superuser());

drop policy if exists safety_severities_delete on safety_severities;
create policy safety_severities_delete on safety_severities
  for delete to authenticated using (si_is_superuser());

-- Counts what still points at the row and refuses with a sentence, because
-- describeError() surfaces server messages verbatim so a trigger can be the
-- copy. The alternative is what 23503 produces on its own — "That refers to
-- something that no longer exists" — which is unhelpful and, here, backwards.
--
-- Four of the six are not protected by a foreign key at all: work_orders.status,
-- .priority, .type and .impact are enum columns, and safety severity lives
-- inside a jsonb blob. For those this trigger is not a better message than the
-- constraint, it is the only thing standing there.
create or replace function si_guard_reference_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key   text := to_jsonb(old) ->> (case tg_table_name
                                       when 'priorities'  then 'id'
                                       when 'departments' then 'id'
                                       when 'assets'      then 'id'
                                       else 'code' end);
  v_label text := coalesce(to_jsonb(old) ->> 'name', to_jsonb(old) ->> 'label', v_key);
  v_parts text[] := '{}';
  v_n     int;
begin
  case tg_table_name
    when 'priorities' then
      select count(*) into v_n from work_orders where priority = v_key::si_priority;
      if v_n > 0 then v_parts := v_parts || format('%s work order%s', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from sla where priority_id = v_key::si_priority;
      if v_n > 0 then v_parts := v_parts || 'its SLA targets'; end if;
      select count(*) into v_n from impact_levels where suggests_priority = v_key::si_priority;
      if v_n > 0 then v_parts := v_parts || format('%s impact level%s', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from safety_severities where escalates_to_priority = v_key::si_priority;
      if v_n > 0 then v_parts := v_parts || format('%s safety severit%s', v_n, case when v_n = 1 then 'y' else 'ies' end); end if;

    when 'impact_levels' then
      select count(*) into v_n from work_orders where impact = v_key::si_impact;
      if v_n > 0 then v_parts := v_parts || format('%s work order%s', v_n, case when v_n = 1 then '' else 's' end); end if;

    when 'wo_types' then
      select count(*) into v_n from work_orders where type = v_key::si_wo_type;
      if v_n > 0 then v_parts := v_parts || format('%s work order%s', v_n, case when v_n = 1 then '' else 's' end); end if;

    when 'safety_severities' then
      select count(*) into v_n from work_orders where safety_risk ->> 'severity' = v_key;
      if v_n > 0 then v_parts := v_parts || format('%s work order%s', v_n, case when v_n = 1 then '' else 's' end); end if;

    when 'departments' then
      select count(*) into v_n from work_orders where department_id = v_key;
      if v_n > 0 then v_parts := v_parts || format('%s work order%s', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from assets where department_id = v_key;
      if v_n > 0 then v_parts := v_parts || format('%s piece%s of equipment', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from users where department_id = v_key;
      if v_n > 0 then v_parts := v_parts || format('%s user%s', v_n, case when v_n = 1 then '' else 's' end); end if;

    when 'assets' then
      select count(*) into v_n from work_orders where asset_id = v_key;
      if v_n > 0 then v_parts := v_parts || format('%s work order%s', v_n, case when v_n = 1 then '' else 's' end); end if;

    -- A plpgsql CASE with no ELSE raises CASE_NOT_FOUND. Unreachable while the
    -- trigger is attached to these six tables and only these six; the branch is
    -- what keeps attaching it to a seventh from failing as a bare "case not
    -- found" with no indication of which table.
    else null;
  end case;

  if array_length(v_parts, 1) is not null then
    raise exception
      '% is still used by %. Removing it would leave those records without a label, so it is refused. Retire it instead — that takes it off the form and leaves the records as they are.',
      v_label, array_to_string(v_parts, ', ')
      using errcode = 'foreign_key_violation';
  end if;

  return old;
end;
$$;

revoke all on function si_guard_reference_delete() from public, anon, authenticated;

drop trigger if exists si_guard_reference_delete_trg on priorities;
create trigger si_guard_reference_delete_trg before delete on priorities
  for each row execute function si_guard_reference_delete();

drop trigger if exists si_guard_reference_delete_trg on impact_levels;
create trigger si_guard_reference_delete_trg before delete on impact_levels
  for each row execute function si_guard_reference_delete();

drop trigger if exists si_guard_reference_delete_trg on wo_types;
create trigger si_guard_reference_delete_trg before delete on wo_types
  for each row execute function si_guard_reference_delete();

drop trigger if exists si_guard_reference_delete_trg on safety_severities;
create trigger si_guard_reference_delete_trg before delete on safety_severities
  for each row execute function si_guard_reference_delete();

drop trigger if exists si_guard_reference_delete_trg on departments;
create trigger si_guard_reference_delete_trg before delete on departments
  for each row execute function si_guard_reference_delete();

drop trigger if exists si_guard_reference_delete_trg on assets;
create trigger si_guard_reference_delete_trg before delete on assets
  for each row execute function si_guard_reference_delete();
