-- ============================================================================
-- SI — Service Inside · 0018 Deleting work orders, as a grantable capability
-- ============================================================================
-- 0002 shipped `work_orders_delete ... using (si_is_admin())` with the comment
-- "Admin's delete is break-glass only", and no UI ever offered it. This turns
-- that into a real, auditable operation whose *reach* is data rather than code:
--
--   role_permissions — one row per si_role value, one boolean per capability.
--                      Only a Superuser may write it. Seeded so that Admin can
--                      delete and nobody else can, which is where 0002 left it.
--
-- Two rules are deliberately NOT the toggle's to relax:
--
--   * Scope. A granted role still only reaches work orders it can already see.
--     The delete policy repeats work_orders_select's predicate rather than
--     trusting the capability alone, so granting a Supervisor deletion gives
--     them their own department, not the plant.
--   * The Superuser. si_can_delete_work_orders() is true for them regardless of
--     the table, so the account that administers the toggle cannot switch its
--     own way out of fixing a mistake.
--
-- Deletion is destructive in a way nothing else in this schema is — every other
-- "removal" is a status. So it leaves a record: si_archive_deleted_work_order
-- snapshots the whole row into work_order_deletions before it goes, and cleans
-- up the three child tables that reference work orders polymorphically and
-- would otherwise be orphaned (work_order_history has a real FK and cascades on
-- its own).
--
-- The trigger is SECURITY DEFINER and the delete itself is not: the caller's
-- own policy decides whether the row goes, and the trigger — which needs to
-- write an audit table nobody may insert into and to reach child rows across
-- three different policy sets — runs as the owner once that decision is made.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The capability table
-- ---------------------------------------------------------------------------
-- Keyed on si_role, so the row set is exactly the five roles the enum defines —
-- like the other enum-keyed reference tables (migration 0009), it is
-- relabellable but not extendable, and there is no insert or delete policy.
--
-- Superuser is absent on purpose. It is not a sixth enum value (see 0015), and
-- its capability is unconditional rather than stored.
create table if not exists role_permissions (
  role                   si_role primary key,
  can_delete_work_orders boolean     not null default false,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references users(id) on delete set null
);

comment on table role_permissions is
  'Per-role capability flags a Superuser grants. Read by policy helpers; never by the client for authorization.';

insert into role_permissions (role, can_delete_work_orders) values
  ('requester',  false),
  ('technician', false),
  ('supervisor', false),
  ('manager',    false),
  ('admin',      true)
on conflict (role) do nothing;

alter table role_permissions enable row level security;

-- Readable by everyone signed in: the client needs it to decide whether to show
-- a Delete button, and the contents are five booleans about roles, not about
-- people. The policies below are what actually enforce them.
create policy role_permissions_select on role_permissions
  for select to authenticated using (true);

create policy role_permissions_update on role_permissions
  for update to authenticated
  using (si_is_superuser())
  with check (si_is_superuser());

-- Stamp who changed what, and pin the key: an UPDATE that rewrote `role` would
-- silently move a grant from one role to another.
create or replace function si_stamp_role_permission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.role       := old.role;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function si_stamp_role_permission() from public, anon, authenticated;

drop trigger if exists role_permissions_stamp on role_permissions;
create trigger role_permissions_stamp
  before update on role_permissions
  for each row execute function si_stamp_role_permission();

-- ---------------------------------------------------------------------------
-- The capability helper
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so the policy's own read of role_permissions cannot be
-- turned off by a future tightening of role_permissions_select, and stable so
-- it is evaluated once per statement rather than once per row.
--
-- A caller with no usable role claim matches no row and gets false — the same
-- fail-closed direction as si_role_rank().
create or replace function si_can_delete_work_orders()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select si_is_superuser()
      or coalesce(
           (select can_delete_work_orders from role_permissions where role::text = si_role()),
           false
         );
$$;

revoke all on function si_can_delete_work_orders() from public, anon;
grant execute on function si_can_delete_work_orders() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The audit trail
-- ---------------------------------------------------------------------------
-- The columns are duplicated out of the snapshot rather than left inside it so
-- the list can be read, filtered and sorted without unpacking jsonb; `snapshot`
-- is the complete row, for the case where somebody needs the field the columns
-- did not anticipate.
create table if not exists work_order_deletions (
  id               uuid primary key default gen_random_uuid(),
  work_order_id    uuid        not null,
  wo_number        text,
  asset_name       text,
  department_id    text,
  status           text,
  priority         text,
  requester_name   text,
  assigned_to_name text,
  raised_at        timestamptz,
  deleted_at       timestamptz not null default now(),
  deleted_by       uuid,
  deleted_by_name  text,
  deleted_by_role  text,
  snapshot         jsonb       not null
);

create index if not exists wo_deletions_deleted_at_idx on work_order_deletions (deleted_at desc);

alter table work_order_deletions enable row level security;

-- Visible to the roles that oversee the system; written only by the trigger
-- below, which runs as the owner. No insert, update or delete policy exists, so
-- the trail cannot be forged or tidied up from a client — the same shape
-- work_order_history uses.
create policy wo_deletions_select on work_order_deletions
  for select to authenticated using (si_is_manager_or_admin());

-- ---------------------------------------------------------------------------
-- Archive + cascade
-- ---------------------------------------------------------------------------
-- attachments, comments and notifications reference a work order through
-- (entity_type, entity_id) with no foreign key, so nothing removes them on
-- their own. Storage objects are not reachable from here; the client removes
-- those on a best-effort basis before calling the delete.
create or replace function si_archive_deleted_work_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor users%rowtype;
begin
  select * into v_actor from users where id = auth.uid();

  insert into work_order_deletions (
    work_order_id, wo_number, asset_name, department_id, status, priority,
    requester_name, assigned_to_name, raised_at,
    deleted_by, deleted_by_name, deleted_by_role, snapshot
  ) values (
    old.id, old.wo_number, old.asset_name, old.department_id,
    old.status::text, old.priority::text,
    old.requester_name, old.assigned_to_name, old.created_at,
    auth.uid(), v_actor.name, coalesce(si_role(), v_actor.role::text),
    to_jsonb(old)
  );

  delete from attachments   where entity_type = 'work_order' and entity_id = old.id;
  delete from comments      where entity_type = 'work_order' and entity_id = old.id;
  delete from notifications where entity_type = 'work_order' and entity_id = old.id;

  return old;
end;
$$;

revoke all on function si_archive_deleted_work_order() from public, anon, authenticated;

drop trigger if exists work_orders_archive_delete on work_orders;
create trigger work_orders_archive_delete
  before delete on work_orders
  for each row execute function si_archive_deleted_work_order();

-- ---------------------------------------------------------------------------
-- The policy 0002 left as admin-only
-- ---------------------------------------------------------------------------
-- The second half is work_orders_select's predicate verbatim. It has to be
-- restated rather than deferred to: a DELETE consults only the DELETE policy,
-- so without it a granted Technician could delete a work order they were never
-- allowed to read.
drop policy if exists work_orders_delete on work_orders;
create policy work_orders_delete on work_orders
  for delete to authenticated
  using (
    si_can_delete_work_orders()
    and (
      si_is_admin()
      or si_is_manager()
      or si_in_same_department(department_id)
      or (si_is_technician() and assigned_to_id = auth.uid())
      or (si_is_requester()  and requester_id  = auth.uid())
    )
  );

-- Realtime, so a deletion disappears from every open board the way every other
-- change already does.
alter publication supabase_realtime add table role_permissions;
