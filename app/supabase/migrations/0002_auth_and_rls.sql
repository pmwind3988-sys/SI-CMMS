-- ============================================================================
-- SI — Service Inside · 0002 Auth claims + Row Level Security
-- ============================================================================
-- Ports firestore.rules. The original ruleset's central design decision was
-- that role and department_id are read from the caller's Auth custom claims,
-- never from a live document, so that a permission check never costs a read.
-- That decision carries over exactly: a Postgres access-token hook copies
-- users.role / department_id / plant_ids into the JWT at sign-in, and every
-- policy below reads them from auth.jwt() rather than joining to users.
--
-- ONE NAMING CONSTRAINT, and it is not optional: Supabase reserves the `role`
-- claim for the Postgres role PostgREST switches into (`authenticated`).
-- Writing "technician" there would make every request fail with an undefined
-- role. The application role therefore ships as `user_role`.
--
-- WHAT RLS CANNOT DO, and where the rest lives:
--   - A policy sees either the old row (USING) or the new row (WITH CHECK),
--     never both, so the (from_status -> to_status) matrix cannot be written
--     here. It lives in the BEFORE UPDATE trigger in 0003 — the direct
--     equivalent of the transition helper functions in firestore.rules.
--   - Firestore's diff().affectedKeys().hasOnly([...]) has no policy
--     equivalent either. Those four column-level restrictions are triggers at
--     the bottom of this file.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ACCESS TOKEN HOOK — the equivalent of Firebase custom claims.
--
-- Must be enabled after applying this migration:
--   Dashboard -> Authentication -> Hooks -> Customize Access Token (JWT) Claims
--   -> select public.custom_access_token_hook
-- Until it is enabled the claims are absent, si_role() returns null, and every
-- policy below denies. That is the intended failure direction.
-- ---------------------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  u      record;
begin
  select role, department_id, plant_ids
    into u
    from public.users
   where id = (event ->> 'user_id')::uuid;

  if found then
    claims := jsonb_set(claims, '{user_role}',     to_jsonb(u.role::text));
    claims := jsonb_set(claims, '{department_id}', coalesce(to_jsonb(u.department_id), 'null'::jsonb));
    claims := jsonb_set(claims, '{plant_ids}',     coalesce(to_jsonb(u.plant_ids), '[]'::jsonb));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant select on public.users to supabase_auth_admin;

-- ---------------------------------------------------------------------------
-- CLAIM HELPERS — one per helper function in firestore.rules.
-- ---------------------------------------------------------------------------

create or replace function si_role()
returns text language sql stable set search_path = public as $$
  select nullif(auth.jwt() ->> 'user_role', '');
$$;

create or replace function si_department_id()
returns text language sql stable set search_path = public as $$
  select nullif(auth.jwt() ->> 'department_id', '');
$$;

create or replace function si_signed_in()   returns boolean language sql stable as $$ select auth.uid() is not null $$;
create or replace function si_is_requester() returns boolean language sql stable as $$ select si_role() = 'requester' $$;
create or replace function si_is_technician() returns boolean language sql stable as $$ select si_role() = 'technician' $$;
create or replace function si_is_supervisor() returns boolean language sql stable as $$ select si_role() = 'supervisor' $$;
create or replace function si_is_manager()   returns boolean language sql stable as $$ select si_role() = 'manager' $$;
create or replace function si_is_admin()     returns boolean language sql stable as $$ select si_role() = 'admin' $$;

-- Manager and Admin both operate system-wide. They differ only in that Admin
-- additionally bypasses the transition matrix (0003) and may delete.
create or replace function si_is_manager_or_admin()
returns boolean language sql stable as $$ select si_role() in ('manager','admin') $$;

-- Supervisor scoped to exactly one department.
create or replace function si_in_same_department(dept text)
returns boolean language sql stable as $$
  select si_role() = 'supervisor' and dept is not distinct from si_department_id();
$$;

-- ---------------------------------------------------------------------------
-- ENABLE RLS EVERYWHERE. Tables with no policy below are thereby closed to
-- every client role — which is the intent for `counters`.
-- ---------------------------------------------------------------------------

alter table plants             enable row level security;
alter table departments        enable row level security;
alter table priorities         enable row level security;
alter table sla                enable row level security;
alter table users              enable row level security;
alter table technicians        enable row level security;
alter table assets             enable row level security;
alter table work_orders        enable row level security;
alter table work_order_history enable row level security;
alter table attachments        enable row level security;
alter table comments           enable row level security;
alter table notifications      enable row level security;
alter table stats              enable row level security;
alter table counters           enable row level security;
alter table apk_builds         enable row level security;

-- The hook runs as supabase_auth_admin, which is not the table owner, so it
-- needs an explicit read path through RLS.
create policy users_auth_admin_read on users
  for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------------------
-- WORK ORDERS
-- ---------------------------------------------------------------------------

-- requester  -> own; technician -> assigned to them; supervisor -> own
-- department; manager/admin -> everything.
create policy work_orders_select on work_orders
  for select to authenticated
  using (
    si_is_admin()
    or si_is_manager()
    or si_in_same_department(department_id)
    or (si_is_technician() and assigned_to_id = auth.uid())
    or (si_is_requester()  and requester_id  = auth.uid())
  );

-- Any signed-in role may raise one under their own identity. Supervisor is
-- confined to their own department; Manager/Admin may raise on anyone's behalf.
create policy work_orders_insert on work_orders
  for insert to authenticated
  with check (
    status = 'open'
    and assigned_to_id is null
    and (
      si_is_admin()
      or si_is_manager()
      or (si_is_supervisor() and department_id = si_department_id())
      or requester_id = auth.uid()
    )
  );

-- USING decides who may touch the row; WITH CHECK stops a row being moved out
-- of the writer's own scope (e.g. a Supervisor reassigning a work order into
-- another department to escape review). WHICH transition is legal for WHICH
-- role is the trigger's job — see si_guard_work_order_transition in 0003.
create policy work_orders_update on work_orders
  for update to authenticated
  using (
    si_is_admin()
    or si_is_manager()
    or si_in_same_department(department_id)
    or (si_is_technician() and assigned_to_id = auth.uid())
    or (si_is_requester()  and requester_id  = auth.uid())
  )
  with check (
    si_is_admin()
    or si_is_manager()
    or si_in_same_department(department_id)
    or si_is_technician()
    or si_is_requester()
  );

-- Closing is a status, not a deletion. Admin's delete is break-glass only.
create policy work_orders_delete on work_orders
  for delete to authenticated using (si_is_admin());

-- ---------------------------------------------------------------------------
-- WORK ORDER HISTORY — immutable audit trail.
--
-- Read scope mirrors the parent work order by *deferring* to it: the EXISTS
-- subquery is itself filtered by work_orders_select above, so the two can
-- never drift apart the way the four hand-copied get() calls in
-- firestore.rules could. No UPDATE or DELETE policy exists, for any role
-- including admin, which is how `allow update, delete: if false` is expressed.
-- ---------------------------------------------------------------------------

create policy wo_history_select on work_order_history
  for select to authenticated
  using (exists (select 1 from work_orders w where w.id = work_order_id));

-- Tightened from the original `allow create: if signedIn()`: the writer must
-- stamp themselves as the actor. Every caller in src/lib/workOrders.js already
-- passes its own uid, so this costs nothing and closes audit-trail forgery.
create policy wo_history_insert on work_order_history
  for insert to authenticated
  with check (actor_id = auth.uid() or si_is_admin());

-- ---------------------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------------------

create policy users_select on users
  for select to authenticated
  using (si_is_manager_or_admin() or si_is_supervisor() or id = auth.uid());

create policy users_insert on users for insert to authenticated with check (si_is_admin());
create policy users_update on users for update to authenticated
  using (si_is_admin() or id = auth.uid())
  with check (si_is_admin() or id = auth.uid());
create policy users_delete on users for delete to authenticated using (si_is_admin());

-- ---------------------------------------------------------------------------
-- TECHNICIANS — readable system-wide because the assignment picker needs the
-- full roster regardless of who is looking.
-- ---------------------------------------------------------------------------

create policy technicians_select on technicians for select to authenticated using (si_signed_in());
create policy technicians_insert on technicians for insert to authenticated with check (si_is_admin());
create policy technicians_update on technicians
  for update to authenticated
  using (si_role() in ('admin','manager','supervisor') or user_id = auth.uid())
  with check (si_role() in ('admin','manager','supervisor') or user_id = auth.uid());
create policy technicians_delete on technicians for delete to authenticated using (si_is_admin());

-- ---------------------------------------------------------------------------
-- ASSETS / DEPARTMENTS / PLANTS / PRIORITIES / SLA
-- ---------------------------------------------------------------------------

create policy assets_select on assets for select to authenticated using (si_signed_in());
create policy assets_insert on assets for insert to authenticated
  with check (si_is_manager_or_admin() or si_is_supervisor());
create policy assets_update on assets for update to authenticated
  using (si_is_manager_or_admin() or si_is_supervisor())
  with check (si_is_manager_or_admin() or si_is_supervisor());
create policy assets_delete on assets for delete to authenticated using (si_is_admin());

create policy departments_select on departments for select to authenticated using (si_signed_in());
create policy departments_insert on departments for insert to authenticated with check (si_is_manager_or_admin());
create policy departments_update on departments for update to authenticated
  using (si_is_manager_or_admin()) with check (si_is_manager_or_admin());
create policy departments_delete on departments for delete to authenticated using (si_is_admin());

create policy plants_select on plants for select to authenticated using (si_signed_in());
create policy plants_write  on plants for all    to authenticated
  using (si_is_admin()) with check (si_is_admin());

-- Never deleted — historical work orders reference them. No DELETE policy.
create policy priorities_select on priorities for select to authenticated using (si_signed_in());
create policy priorities_insert on priorities for insert to authenticated with check (si_is_admin());
create policy priorities_update on priorities for update to authenticated
  using (si_is_admin()) with check (si_is_admin());

create policy sla_select on sla for select to authenticated using (si_signed_in());
create policy sla_insert on sla for insert to authenticated with check (si_is_admin());
create policy sla_update on sla for update to authenticated
  using (si_is_admin()) with check (si_is_admin());

-- ---------------------------------------------------------------------------
-- ATTACHMENTS + COMMENTS
-- ---------------------------------------------------------------------------

create policy attachments_select on attachments for select to authenticated using (si_signed_in());
create policy attachments_insert on attachments for insert to authenticated
  with check (uploaded_by_id = auth.uid());
-- No UPDATE policy: immutable once written.
create policy attachments_delete on attachments for delete to authenticated
  using (si_is_manager_or_admin());

create policy comments_select on comments for select to authenticated using (si_signed_in());
create policy comments_insert on comments for insert to authenticated
  with check (author_id = auth.uid());
create policy comments_update on comments for update to authenticated
  using (author_id = auth.uid() or si_is_admin())
  with check (author_id = auth.uid() or si_is_admin());
create policy comments_delete on comments for delete to authenticated
  using (author_id = auth.uid() or si_is_manager_or_admin());

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS — recipient-scoped regardless of role. Inserts come from the
-- SECURITY DEFINER trigger functions in 0003, which bypass RLS; the admin
-- policy here covers manual correction only.
-- ---------------------------------------------------------------------------

create policy notifications_select on notifications for select to authenticated
  using (recipient_id = auth.uid() or si_is_admin());
create policy notifications_insert on notifications for insert to authenticated
  with check (si_is_admin());
create policy notifications_update on notifications for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());
create policy notifications_delete on notifications for delete to authenticated
  using (si_is_admin());

-- ---------------------------------------------------------------------------
-- STATS — every signed-in user reads; the UI decides which cards to surface
-- per role. Nobody writes from a client; si_compute_dashboard_stats() is
-- SECURITY DEFINER.
-- ---------------------------------------------------------------------------

create policy stats_select on stats for select to authenticated using (si_signed_in());

-- ---------------------------------------------------------------------------
-- COUNTERS — deliberately no policies at all. Sequence integrity depends on
-- this being reachable only from the SECURITY DEFINER trigger that allocates
-- wo_number.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- APK BUILDS — readable by every role including requester: an outdated APK is
-- a problem for whoever is holding the phone, not just for elevated staff.
-- ---------------------------------------------------------------------------

create policy apk_builds_select on apk_builds for select to authenticated using (si_signed_in());
create policy apk_builds_write  on apk_builds for all    to authenticated
  using (si_is_admin()) with check (si_is_admin());

-- ============================================================================
-- COLUMN-LEVEL RESTRICTIONS
-- The four places firestore.rules used diff().affectedKeys().hasOnly([...]).
-- A policy cannot express these because it cannot compare old to new, so each
-- is a BEFORE UPDATE trigger that raises rather than silently reverting —
-- a rejected write should look like a rejected write to the client.
-- ============================================================================

-- users: self-service edits are limited to display fields.
create or replace function si_guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if si_is_admin() then return new; end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.role is distinct from old.role
     or new.department_id is distinct from old.department_id
     or new.plant_ids is distinct from old.plant_ids
     or new.status is distinct from old.status then
    raise exception 'You may only change your own name, phone, and photo.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger guard_user_self_update
  before update on users for each row execute function si_guard_user_self_update();

-- notifications: the recipient may only flip status to 'read'.
create or replace function si_guard_notification_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if si_is_admin() then return new; end if;

  if new.status <> 'read' then
    raise exception 'A notification may only be marked read.'
      using errcode = 'insufficient_privilege';
  end if;
  if (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
    raise exception 'Only the status of a notification may be changed.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger guard_notification_update
  before update on notifications for each row execute function si_guard_notification_update();

-- comments: the author may edit the text, nothing else.
create or replace function si_guard_comment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if si_is_admin() then return new; end if;

  if (to_jsonb(new) - 'text' - 'edited_at') <> (to_jsonb(old) - 'text' - 'edited_at') then
    raise exception 'Only the text of a comment may be edited.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger guard_comment_update
  before update on comments for each row execute function si_guard_comment_update();

-- technicians: a technician may set their own availability and nothing else.
-- Supervisor/Manager/Admin are unrestricted, matching the original rule.
create or replace function si_guard_technician_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if si_role() in ('admin','manager','supervisor') then return new; end if;

  if (to_jsonb(new) - 'availability_status' - 'updated_at')
     <> (to_jsonb(old) - 'availability_status' - 'updated_at') then
    raise exception 'You may only change your own availability status.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger guard_technician_update
  before update on technicians for each row execute function si_guard_technician_update();
