# Multi-role Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one SI account hold several roles at once (Supervisor + Technician being the driving case), granting the union of their permissions.

**Architecture:** `users.role` becomes `users.roles si_role[]`. The access-token hook emits a `user_roles` claim alongside the existing `user_role`; every policy helper becomes a membership test over that array; rank becomes the maximum role held, so the existing hierarchy rules carry over unchanged. The status-transition trigger stops asking "what is this person" and computes the set of roles under which a given move is permitted, which also gives the audit trail the role a person acted under. Self-assignment is blocked for everyone including Admin.

**Tech Stack:** Postgres 17 (Supabase, RLS + triggers + SECURITY DEFINER functions), Supabase Edge Functions (Deno/TypeScript), Next.js 14 static export (`output: "export"`, every page `"use client"`), Tailwind, `@supabase/supabase-js` v2.

**Spec:** `docs/superpowers/specs/2026-08-19-multi-role-design.md` — read it before Task 1. This plan argues from it; where they appear to disagree, the spec states intent and this plan states sequencing.

---

## Global Constraints

Copied from the spec and CLAUDE.md. Every task's requirements implicitly include this section.

- **There is no test suite and no test runner.** CLAUDE.md is explicit. TDD's red/green cycle is therefore replaced throughout by concrete, runnable verification: SQL assertions executed through `scripts/_supabaseAdmin.js`, `npm run build` as the compile gate, and a manual dev-server pass in Task 9. Every task below states an exact command and its exact expected output. **Do not invent a test framework.**
- **`npm run lint` is broken** — Next 16 removed `next lint`. `npm run build` is the compile check.
- **Never run `npm run build` while `npm run dev` is live.** They share `.next`; the production build corrupts the dev cache and every chunk 500s with no error message. Stop the dev server first.
- **The database is the authorization boundary, not the client.** Client predicates in `src/lib/constants.js` decide what to *show*; the RLS policy decides what is *allowed*. Adding a predicate without the policy is a bug; loosening a policy to match a predicate is a worse one.
- **Components never import `supabase` directly.** They call `listenX(args, cb, onError)` from `src/lib/*` and get an unsubscribe back.
- **Any new function in `public` is anon-callable by default** — Postgres grants EXECUTE to PUBLIC and PostgREST publishes it. Migrations 0007, 0008 and 0011 exist because of this. Every function this plan creates must be followed by `revoke all ... from public, anon;` and an explicit `grant execute ... to authenticated, service_role;`.
- **Roles are lowercase snake_case**, matching the `si_role` enum: `requester`, `technician`, `supervisor`, `manager`, `admin`. There is no sixth value — Superuser is `is_protected` on top of `admin`.
- **`role` is reserved by Supabase** for the Postgres role PostgREST switches into. The application role travels as `user_role` / `user_roles`. Never write a claim called `role`.
- **A claim change takes effect only when the token is next issued** (~hourly, or sign out/in). Every verification step that depends on new claims must sign out and in first.
- **`SUPABASE_SERVICE_ROLE_KEY`** is read only by `app/scripts/*`. It bypasses RLS. Never set it in Vercel, never prefix it `NEXT_PUBLIC_`.
- **Commit after every task.** Do not squash tasks together.

## Deviation from the spec: expand/contract

Spec §1 adds `roles` and drops `role` in one migration, and §7 says one file, one transaction. **This plan splits that into two migrations**, and the reason is operational rather than aesthetic:

The app is live on Vercel with real users. The deployed bundle selects `users.role` in `AuthContext` and calls the `si_set_user_role` RPC. Dropping the column in the same migration that adds the array breaks every signed-in user from the moment the migration lands until a new build finishes deploying.

- **Migration 0020 (expand, Task 1)** adds `roles`, keeps `role` as a trigger-derived mirror, and keeps `si_set_user_role` as a wrapper over the new RPC. The currently-deployed app keeps working, unchanged, throughout.
- **Migration 0021 (contract, Task 9)** drops the mirror column, the sync trigger and the old function signatures, *after* the new client is built and deployed.

The spec's actual requirement — one source of truth in the end state — is met at Task 9. Each migration is internally consistent on its own, which is what §7's "one transaction" concern was protecting.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `app/supabase/migrations/0020_multi_role_expand.sql` | Everything server-side: column, claims, helpers, policies, triggers, RPCs |
| `app/supabase/migrations/0021_multi_role_contract.sql` | Drop `users.role`, the sync trigger, and the superseded function signatures |
| `app/src/components/dashboard/RoleSwitcher.jsx` | Links between the dashboards an account holds; renders nothing for single-role |

**Modified:** `app/src/lib/roles.js`, `app/src/context/AuthContext.js`, `app/src/components/RequireRole.jsx`, `app/src/lib/constants.js`, `app/src/lib/workOrders.js`, `app/src/components/workorders/AssignPanel.jsx`, `app/src/components/workorders/WorkflowPanel.jsx`, `app/src/components/workorders/WorkOrderList.jsx`, `app/src/components/dashboard/RoleDashboard.jsx`, `app/src/components/dashboard/DashboardModule.jsx`, `app/src/app/dashboard/page.jsx`, `app/src/app/technician/dashboard/page.jsx`, `app/src/app/supervisor/dashboard/page.jsx`, `app/src/components/AppShell.jsx`, `app/src/lib/admin.js`, `app/src/components/admin/UsersAdmin.jsx`, `app/supabase/functions/admin-users/index.ts`, `app/scripts/bootstrapUsers.js`, `CLAUDE.md`.

---

### Task 1: Migration 0020 — the server side

Everything in one migration file because the pieces are mutually dependent: the policies call the helpers, the helpers read the claim, the claim comes from the column.

**Files:**
- Create: `app/supabase/migrations/0020_multi_role_expand.sql`
- Modify: `app/src/lib/database.types.ts` (regenerated, not hand-edited)
- Verify: `app/scripts/` (ad-hoc `node -e`, nothing committed)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, for every later task —
  - SQL: `si_roles() → si_role[]`, `si_has_role(text) → boolean`, `si_role() → text` (highest), `si_roles_rank(si_role[]) → int`, `si_account_rank(si_role[], boolean) → int`, `si_caller_rank() → int`, `si_eligible_roles(si_role[], uuid, uuid) → si_role[]`, `si_set_user_roles(p_uid uuid, p_roles si_role[], p_department_id text, p_plant_ids text[]) → jsonb`
  - Column: `public.users.roles si_role[] not null`
  - Claim: `user_roles` (JSON array of role strings), alongside the existing `user_role`, `department_id`, `plant_ids`, `is_protected`

- [ ] **Step 1: Read the three migrations this one rewrites**

Read before writing anything. You are restating their functions, and a detail dropped here is a silent authorization hole.

```bash
sed -n '1,120p' app/supabase/migrations/0002_auth_and_rls.sql
sed -n '260,345p' app/supabase/migrations/0003_work_order_triggers.sql
cat app/supabase/migrations/0015_role_hierarchy_and_protected_accounts.sql
cat app/supabase/migrations/0017_hook_injects_is_protected.sql
```

What you must carry across unchanged: the `is_protected` claim from 0017 (dropping it silently demotes the Superuser to a plain admin — 0017's whole header is about this); the four grant lines at the bottom of 0017; and 0019's no-supervisor fallback inside `si_department_supervisors`.

- [ ] **Step 2: Write the column and the derived mirror**

Create `app/supabase/migrations/0020_multi_role_expand.sql` starting with a header comment explaining expand/contract and pointing at the spec, then:

```sql
-- The column. Added nullable and tightened afterwards: `add column ... not null`
-- with no default fails on a table that already has rows. Left without a
-- default deliberately — `default '{}'` would satisfy not-null and then violate
-- the check below, turning a forgotten `roles` into a confusing constraint
-- error instead of a clear null violation.
alter table users add column if not exists roles si_role[];
update users set roles = array[role] where roles is null;
alter table users alter column roles set not null;
alter table users add constraint users_roles_not_empty check (cardinality(roles) >= 1);

-- Serves the `'supervisor' = any(roles)` lookups in the notification fan-out,
-- which run inside the SLA sweep once per overdue work order.
create index if not exists users_roles_gin on users using gin (roles);

-- `role` survives this migration as a DERIVED mirror so the deployed build,
-- which still selects it, keeps working until 0021 removes it. Nothing should
-- write it directly from here on; this trigger overwrites whatever was sent.
create or replace function si_sync_user_primary_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.role := (
    select r from unnest(new.roles) r
     order by si_role_rank(r::text) desc
     limit 1
  );
  return new;
end;
$$;
revoke all on function si_sync_user_primary_role() from public, anon, authenticated;

-- Named to sort last: BEFORE triggers fire in name order, and this must not
-- run before si_guard_user_self_update decides whether the write is allowed.
drop trigger if exists z_sync_user_primary_role on users;
create trigger z_sync_user_primary_role
  before insert or update on users
  for each row execute function si_sync_user_primary_role();

update users set roles = roles;   -- fire the trigger once to seed `role`
```

- [ ] **Step 3: Rewrite the access-token hook**

Append. This is 0017's function with `roles` replacing `role` and a `user_roles` claim added. Every other claim is preserved verbatim.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  claims  jsonb := coalesce(event -> 'claims', '{}'::jsonb);
  u       record;
  v_high  text;
begin
  select roles, department_id, plant_ids, is_protected
    into u
    from public.users
   where id = (event ->> 'user_id')::uuid;

  if found then
    select r::text into v_high
      from unnest(u.roles) r
     order by si_role_rank(r::text) desc
     limit 1;

    claims := jsonb_set(claims, '{user_roles}',
      coalesce(to_jsonb(array(select r::text from unnest(u.roles) r)), '[]'::jsonb));
    -- Retained: the highest role held. Anything not yet migrated keeps reading
    -- something true, and si_roles() falls back to it for tokens minted before
    -- this migration.
    claims := jsonb_set(claims, '{user_role}',      coalesce(to_jsonb(v_high), 'null'::jsonb));
    claims := jsonb_set(claims, '{department_id}',  coalesce(to_jsonb(u.department_id), 'null'::jsonb));
    claims := jsonb_set(claims, '{plant_ids}',      coalesce(to_jsonb(u.plant_ids), '[]'::jsonb));
    claims := jsonb_set(claims, '{is_protected}',   to_jsonb(coalesce(u.is_protected, false)));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant  usage   on schema   public to supabase_auth_admin;
grant  execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant  select  on public.users to supabase_auth_admin;
```

- [ ] **Step 4: Write the claim helpers**

Append. `si_roles()` carries the single most important line in this design — read the fallback comment before changing it.

```sql
/* The caller's roles.
   The coalesce is a rollout requirement, not defensiveness. Access tokens live
   up to an hour, so every user signed in when this migration lands is carrying
   a token minted by the old hook: `user_role` present, `user_roles` absent.
   Without the fallback si_roles() returns empty for them, every membership test
   below is false, and the entire plant is locked out until each token happens
   to refresh — silently, exactly as the missing is_protected claim failed
   before 0017. With it, a pre-migration token behaves as the single role it was
   issued for and gains the rest at its next refresh.
   No usable claim at all yields '{}', so an unknown caller can act on nothing. */
create or replace function si_roles()
returns si_role[]
language sql stable set search_path = public
as $$
  select coalesce(
    (select array_agg((value #>> '{}')::si_role)
       from jsonb_array_elements(
              case jsonb_typeof(auth.jwt() -> 'user_roles')
                when 'array' then auth.jwt() -> 'user_roles'
                else '[]'::jsonb
              end)
      where value #>> '{}' in (select unnest(enum_range(null::si_role))::text)),
    case
      when nullif(auth.jwt() ->> 'user_role', '') is null then '{}'::si_role[]
      when (auth.jwt() ->> 'user_role') in (select unnest(enum_range(null::si_role))::text)
        then array[(auth.jwt() ->> 'user_role')::si_role]
      else '{}'::si_role[]
    end
  );
$$;

/* Compared as text so an unrecognised argument returns false instead of raising
   an invalid-enum error. */
create or replace function si_has_role(p_role text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from unnest(si_roles()) r where r::text = p_role);
$$;

/* The highest role held. After this migration it has no authorization callers
   and must not gain any: it answers "what is this person", and every decision
   in this schema now asks "may this person do this". It exists for the hook's
   user_role claim and for the client's landing page and badges. */
create or replace function si_role()
returns text language sql stable set search_path = public as $$
  select r::text from unnest(si_roles()) r
   order by si_role_rank(r::text) desc limit 1;
$$;

create or replace function si_roles_rank(p_roles si_role[])
returns int language sql immutable set search_path = public as $$
  select coalesce((select max(si_role_rank(r::text)) from unnest(p_roles) r), 0);
$$;

create or replace function si_account_rank(p_roles si_role[], p_is_protected boolean)
returns int language sql immutable set search_path = public as $$
  select case when coalesce(p_is_protected, false) then 6 else si_roles_rank(p_roles) end;
$$;

create or replace function si_caller_rank()
returns int language sql stable set search_path = public as $$
  select case when si_is_superuser() then 6 else si_roles_rank(si_roles()) end;
$$;

create or replace function si_is_requester()  returns boolean language sql stable set search_path = public as $$ select si_has_role('requester')  $$;
create or replace function si_is_technician() returns boolean language sql stable set search_path = public as $$ select si_has_role('technician') $$;
create or replace function si_is_supervisor() returns boolean language sql stable set search_path = public as $$ select si_has_role('supervisor') $$;
create or replace function si_is_manager()    returns boolean language sql stable set search_path = public as $$ select si_has_role('manager')    $$;
create or replace function si_is_admin()      returns boolean language sql stable set search_path = public as $$ select si_has_role('admin')      $$;
create or replace function si_is_manager_or_admin()
returns boolean language sql stable set search_path = public as $$
  select si_has_role('manager') or si_has_role('admin');
$$;

/* Which of the caller's roles actually authorise this transition on this row.
   Shared by the trigger (to decide) and by si_transition_work_order (to stamp
   actor_role), so the two cannot disagree about who acted as what. */
create or replace function si_eligible_roles(
  p_transition_roles si_role[],
  p_assigned_to      uuid,
  p_requester        uuid
)
returns si_role[] language sql stable set search_path = public as $$
  select coalesce(array_agg(r), '{}'::si_role[])
    from unnest(si_roles()) r
   where r = any(p_transition_roles)
     and (r <> 'technician' or p_assigned_to is not distinct from auth.uid())
     and (r <> 'requester'  or p_requester   is not distinct from auth.uid());
$$;

revoke all on function si_roles()                              from public, anon;
revoke all on function si_has_role(text)                       from public, anon;
revoke all on function si_role()                               from public, anon;
revoke all on function si_roles_rank(si_role[])                from public, anon;
revoke all on function si_account_rank(si_role[], boolean)     from public, anon;
revoke all on function si_caller_rank()                        from public, anon;
revoke all on function si_eligible_roles(si_role[], uuid, uuid) from public, anon;
grant execute on function si_roles()                              to authenticated, service_role;
grant execute on function si_has_role(text)                       to authenticated, service_role;
grant execute on function si_role()                               to authenticated, service_role;
grant execute on function si_roles_rank(si_role[])                to authenticated, service_role;
grant execute on function si_account_rank(si_role[], boolean)     to authenticated, service_role;
grant execute on function si_caller_rank()                        to authenticated, service_role;
grant execute on function si_eligible_roles(si_role[], uuid, uuid) to authenticated, service_role;
```

- [ ] **Step 5: Rewrite the users policies and the self-update guard**

Append. Only the `si_account_rank` argument changes; the rank logic is 0015's, unchanged.

```sql
drop policy if exists users_select on users;
create policy users_select on users for select to authenticated
  using (
    (si_is_manager_or_admin() or si_is_supervisor() or id = auth.uid())
    and (id = auth.uid() or si_is_superuser() or not coalesce(is_protected, false))
  );

drop policy if exists users_update on users;
create policy users_update on users for update to authenticated
  using      (id = auth.uid() or (si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank()))
  with check (id = auth.uid() or (si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank()));

drop policy if exists users_insert on users;
create policy users_insert on users for insert to authenticated
  with check (si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank());

drop policy if exists users_delete on users;
create policy users_delete on users for delete to authenticated
  using (si_is_admin() and si_account_rank(roles, is_protected) < si_caller_rank());

/* 0015's guard with `roles` in place of `role`. The self-lock stays ABOVE the
   admin exemption: RLS always lets you write your own row, so this is the only
   place that hole closes, and it must close for Administrators and Superusers
   too. `role` is absent from the non-admin column list because it is derived by
   z_sync_user_primary_role now — guarding `roles` guards both. */
create or replace function si_guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;

  if new.id = auth.uid() then
    if new.roles is distinct from old.roles then
      raise exception 'You cannot change your own roles. Ask someone above you, or change it in Supabase.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from old.status then
      raise exception 'You cannot change your own account status.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if si_is_admin() then return new; end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.roles is distinct from old.roles
     or new.department_id is distinct from old.department_id
     or new.plant_ids is distinct from old.plant_ids
     or new.status is distinct from old.status
     or new.seed_source is distinct from old.seed_source
     or new.seed_name is distinct from old.seed_name
     or new.seed_phone is distinct from old.seed_phone
     or new.seeded_at is distinct from old.seeded_at
     or new.password_changed_at is distinct from old.password_changed_at
     or new.last_login_at is distinct from old.last_login_at then
    raise exception 'You may only change your own name, phone, and photo.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function si_guard_user_self_update() from public, anon, authenticated;
```

- [ ] **Step 6: Rewrite the transition trigger**

Append. This is the substantive behavioural change; read spec §4 alongside it.

```sql
create or replace function si_guard_work_order_transition()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  t          wo_status_transitions;
  v_eligible si_role[];
  v_field    text;
begin
  -- pg_cron, the service role and admin scripts are trusted, as before.
  if auth.uid() is null then return new; end if;

  /* Self-assignment, checked ABOVE the admin bypass so it is uniform for every
     role including Administrator and Superuser. Precedent: 0015 put the
     self-role-change lock above the same exemption, for the same reason — a
     rule whose entire purpose is to stop you acting on yourself is worthless
     if the most privileged account is exempt.
     Purely additive for single-role accounts: a Supervisor was never in the
     technicians roster and so could never have been assigned anything. */
  if new.assigned_to_id is distinct from old.assigned_to_id
     and new.assigned_to_id = auth.uid() then
    raise exception 'You cannot assign a work order to yourself. Ask another Supervisor or a Manager.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Administrator bypasses the matrix outright. Deliberate and narrow.
  if si_has_role('admin') then return new; end if;

  if cardinality(si_roles()) = 0 then
    raise exception 'Your account has no role assigned — sign out and back in.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into t from wo_status_transitions
   where from_status = old.status and to_status = new.status;

  if not found then
    raise exception '% is not a permitted transition from %.', new.status, old.status
      using errcode = 'check_violation';
  end if;

  v_eligible := si_eligible_roles(t.roles, old.assigned_to_id, old.requester_id);

  /* Two different refusals, because they send the reader to different places.
     Holding none of the transition's roles is "your job doesn't do this";
     holding one but failing its scope test is "not on this record". */
  if cardinality(v_eligible) = 0 then
    if not (si_roles() && t.roles) then
      raise exception 'A % may not perform "%" (% -> %).',
        array_to_string(array(select r::text from unnest(si_roles()) r), '/'),
        coalesce(t.label, 'this transition'), old.status, new.status
        using errcode = 'insufficient_privilege';
    elsif 'technician' = any(t.roles) and si_has_role('technician') then
      raise exception 'You can only act on work orders assigned to you.'
        using errcode = 'insufficient_privilege';
    else
      raise exception 'You can only act on work orders you raised.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if t.requires_assignee_change
     and new.assigned_to_id is not distinct from old.assigned_to_id then
    raise exception 'Reassigning a work order at status "%" requires a different technician.', old.status
      using errcode = 'check_violation';
  end if;

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
```

- [ ] **Step 7: Stamp the acting role on the audit trail**

Append. Open `app/supabase/migrations/0010_atomic_transition_rpc.sql` and restate `si_transition_work_order` **in full**, changing only how `v_actor_role` is derived: instead of `select name, role into v_actor_name, v_actor_role from users where id = auth.uid()`, read the name from `users` and the role from `si_eligible_roles(t.roles, wo.assigned_to_id, wo.requester_id)`, taking the highest-ranked entry and falling back to `si_role()::si_role` when the array is empty (the admin-bypass path, where no transition row constrains them).

Everything else in that function — the single transaction, the `p_via_status` two-row history write, `auth.uid()` as the actor — is unchanged and must be copied across verbatim.

- [ ] **Step 8: Update the remaining role readers**

Append.

```sql
/* 0019's fallback preserved: a department created from the raise form has no
   supervisor, and without the fallback its work orders notify nobody. */
create or replace function si_department_supervisors(p_department_id text)
returns setof uuid language sql stable security definer set search_path = public as $$
  with dept_supervisors as (
    select id from users
     where 'supervisor' = any(roles) and status = 'active'
       and department_id = p_department_id
  )
  select id from dept_supervisors
  union
  select id from users
   where 'supervisor' = any(roles) and status = 'active'
     and not exists (select 1 from dept_supervisors);
$$;

create or replace function si_managers()
returns setof uuid language sql stable security definer set search_path = public as $$
  select id from users where 'manager' = any(roles) and status = 'active';
$$;

/* Union: the capability is held if ANY role the caller holds has been granted
   it. Superuser stays unconditional — the account that administers the toggles
   must not be able to switch off its own way back. */
create or replace function si_can_delete_work_orders()
returns boolean language sql stable security definer set search_path = public as $$
  select si_is_superuser()
      or exists (
           select 1 from role_permissions rp
            where rp.role = any(si_roles())
              and rp.can_delete_work_orders
         );
$$;
```

Then open `app/supabase/migrations/0004_sweeps_stats_cron.sql`, find the caller gate in `si_refresh_dashboard_stats` (`if si_role() not in ('manager','admin')`), and restate that function with `if not si_is_manager_or_admin() then`.

- [ ] **Step 9: Add `si_set_user_roles`, keep `si_set_user_role` as a wrapper**

Append. SECURITY DEFINER, so every rule is restated — a rule added here and not to the policies and the Edge Function is a hole, and the loosest path wins.

```sql
create or replace function si_set_user_roles(
  p_uid uuid,
  p_roles si_role[],
  p_department_id text default null,
  p_plant_ids text[] default '{}'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller_rank int := si_caller_rank();
  v_target      record;
  r             si_role;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;
  if not (si_is_supervisor() or si_is_manager() or si_is_admin()) then
    raise exception 'Only a Supervisor, Manager, or Admin can set roles.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_roles is null or cardinality(p_roles) = 0 then
    raise exception 'An account must have at least one role.' using errcode = 'check_violation';
  end if;

  select id, roles, is_protected into v_target from users where id = p_uid;
  if not found then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;
  if coalesce(v_target.is_protected, false) then
    raise exception 'This account is protected. It can only be changed from the database.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_uid = auth.uid() then
    raise exception 'You cannot change your own roles.' using errcode = 'insufficient_privilege';
  end if;
  if si_account_rank(v_target.roles, v_target.is_protected) >= v_caller_rank then
    raise exception 'You can only change the roles of someone below you.'
      using errcode = 'insufficient_privilege';
  end if;

  -- EVERY role granted must be below the caller, not just the highest.
  foreach r in array p_roles loop
    if si_role_rank(r::text) >= v_caller_rank then
      raise exception 'You cannot grant the role "%" — it is at or above your own.', r
        using errcode = 'insufficient_privilege';
    end if;
  end loop;

  if si_is_supervisor() and not si_is_manager() and not si_is_admin()
     and p_department_id is distinct from si_department_id() then
    raise exception 'A Supervisor may only provision users within their own department.'
      using errcode = 'insufficient_privilege';
  end if;

  update users
     set roles = p_roles,
         department_id = p_department_id,
         plant_ids = coalesce(p_plant_ids, '{}')
   where id = p_uid;

  -- The technicians profile is created when the role is granted and LEFT IN
  -- PLACE when it is removed: it holds skills and certifications, which are
  -- facts about the person, not about their current role.
  if 'technician' = any(p_roles) then
    insert into technicians (user_id, name)
    select p_uid, name from users where id = p_uid
    on conflict (user_id) do nothing;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

/* Kept for exactly one release: the deployed bundle still calls it. 0021 drops
   it. Delegating rather than duplicating means it cannot enforce a weaker rule
   than the function above. */
create or replace function si_set_user_role(
  p_uid uuid, p_role si_role, p_department_id text default null, p_plant_ids text[] default '{}'
)
returns jsonb language sql security definer set search_path = public as $$
  select si_set_user_roles(p_uid, array[p_role], p_department_id, p_plant_ids);
$$;

revoke all on function si_set_user_roles(uuid, si_role[], text, text[]) from public, anon;
grant execute on function si_set_user_roles(uuid, si_role[], text, text[]) to authenticated;
revoke all on function si_set_user_role(uuid, si_role, text, text[]) from public, anon;
grant execute on function si_set_user_role(uuid, si_role, text, text[]) to authenticated;
```

- [ ] **Step 10: Apply the migration**

Docker is not required for `db:push` (it is for `db:diff`). Ensure `npm run dev` is not running.

```bash
cd app && npm run db:push
```

Expected: `Applying migration 0020_multi_role_expand.sql...` then `"message":"Finished supabase db push."` with no error.

- [ ] **Step 11: Verify the server side**

```bash
cd app && node -e "
const {admin}=require('./scripts/_supabaseAdmin.js');
(async()=>{const db=admin();
 const {data:u}=await db.from('users').select('name,role,roles').order('name');
 console.log('USERS:', JSON.stringify(u));
 const {data:e,error:ee}=await db.rpc('si_eligible_roles',{p_transition_roles:['supervisor'],p_assigned_to:null,p_requester:null});
 console.log('eligible(service role, no jwt):', JSON.stringify(e), ee?.message||'');
 const {data:d}=await db.rpc('si_department_supervisors',{p_department_id:'DEPT-ASSEMBLY'});
 console.log('assembly supervisors:', JSON.stringify(d));
})();"
```

Expected: every user shows `roles` as a one-element array matching `role` exactly (`{"name":"Priya Nair","role":"supervisor","roles":["supervisor"]}`). `eligible` is `[]` — the service role carries no JWT, so `si_roles()` is empty; that is the fail-closed direction, not a bug. `assembly supervisors` returns at least one id (0019's fallback still working).

- [ ] **Step 12: Regenerate types**

```bash
cd app && npm run db:types && grep -n "roles" src/lib/database.types.ts | head -5
```

Expected: `roles: Database["public"]["Enums"]["si_role"][]` appears in the `users` Row type.

- [ ] **Step 13: Confirm the deployed client still works**

The whole point of expand/contract. `role` must still be populated and the old RPC must still exist.

```bash
cd app && node -e "
const {admin}=require('./scripts/_supabaseAdmin.js');
(async()=>{const db=admin();
 const {count}=await db.from('users').select('id',{count:'exact',head:true}).is('role',null);
 console.log('users with null role (must be 0):', count);
 const {error}=await db.rpc('si_set_user_role',{p_uid:'00000000-0000-0000-0000-000000000000',p_role:'requester'});
 console.log('old RPC still callable:', error? error.message : 'ok');
})();"
```

Expected: `users with null role (must be 0): 0`, and the old RPC returns the message `No such user.` — proving it exists and reached its checks, rather than `function ... does not exist`.

- [ ] **Step 14: Commit**

```bash
git add app/supabase/migrations/0020_multi_role_expand.sql app/src/lib/database.types.ts
git commit -m "Multi-role: expand migration — users.roles, claims, helpers, policies"
```

---

### Task 2: The client auth contract

**Files:**
- Modify: `app/src/lib/roles.js`, `app/src/context/AuthContext.js`

**Interfaces:**
- Consumes: the `user_roles` claim and `users.roles` column from Task 1.
- Produces, for Tasks 3–8: `user = { uid, email, name, phone, roles: string[], role: string /* highest */, departmentId, plantIds, isSuperuser }`; and from `roles.js`: `hasRole(user, role) → boolean`, `hasAnyRole(user, roles[]) → boolean`, `highestRole(roles[]) → string|null`, `accountRank(account) → int` (now reading `roles`), `rolesLabel(roles[]) → string`.

- [ ] **Step 1: Add the role-set helpers to `roles.js`**

Keep `ROLES`, `ALL_ROLES`, `ROLE_RANK`, `SUPERUSER_RANK`, `roleRank`, `ROLE_LABELS`, `ROLE_DASHBOARD_PATH`, `dashboardPathForRole`, `ELEVATED_ROLES` exactly as they are. Add:

```js
/** The highest-ranked role in a set — what the app lands on and displays. */
export function highestRole(roles) {
  if (!roles?.length) return null;
  return [...roles].sort((a, b) => roleRank(b) - roleRank(a))[0];
}

/** Does this account hold this role? Authorization is a union of roles held. */
export function hasRole(account, role) {
  return Array.isArray(account?.roles) && account.roles.includes(role);
}

export function hasAnyRole(account, roles) {
  return roles.some((r) => hasRole(account, r));
}

/** "Supervisor · Technician", highest first. For badges and table cells. */
export function rolesLabel(roles) {
  if (!roles?.length) return "—";
  return [...roles]
    .sort((a, b) => roleRank(b) - roleRank(a))
    .map((r) => ROLE_LABELS[r] || r)
    .join(" · ");
}
```

Replace `accountRank` so it reads the set, and mirror `si_account_rank(si_role[], boolean)`:

```js
/**
 * The rank of an actual account: the HIGHEST role held, or 6 for a Superuser.
 * Mirrors si_account_rank(si_role[], boolean) in migration 0020. Accepts either
 * shape — a `users` row (`is_protected`) or the AuthContext user (`isSuperuser`).
 */
export function accountRank(account) {
  if (!account) return 0;
  if (account.is_protected || account.isSuperuser) return SUPERUSER_RANK;
  const roles = account.roles ?? (account.role ? [account.role] : []);
  return roles.reduce((max, r) => Math.max(max, roleRank(r)), 0);
}
```

The `?? [account.role]` is the client mirror of `si_roles()`'s claim fallback — it lets these helpers accept a row read before the migration, or a stale cached profile, without returning rank 0 and silently denying everything.

- [ ] **Step 2: Widen the user shape in `AuthContext.js`**

In the profile select, replace `role` with `roles` and keep everything else:

```js
.select("name, phone, roles, department_id, plant_ids, photo_url")
```

Then, where the user object is built, replace the single `role:` line with:

```js
// Same fallback as si_roles() in migration 0020, for the same reason: a token
// minted before that migration carries `user_role` and no `user_roles`, and it
// stays valid for up to an hour. Reading [] there would sign the user into an
// app where nothing is permitted.
roles: claims.user_roles ?? (claims.user_role ? [claims.user_role] : profile.roles ?? []),
// The highest role held. Landing page and display only — never a permission
// decision. Those ask hasRole()/hasAnyRole(), because permissions are the union.
role: highestRole(claims.user_roles ?? (claims.user_role ? [claims.user_role] : profile.roles ?? [])),
```

Extract that expression to a local `const resolvedRoles = …` above the `setUser` call rather than evaluating it twice. Import `highestRole` from `../lib/roles`.

- [ ] **Step 3: Return roles from `signIn`**

`signIn` currently returns `{ user, role }` and the login page redirects on it. Return both, so the login page keeps working unchanged and later tasks can use the set:

```js
const signInClaims = claimsFromSession(data.session);
const roles = signInClaims.user_roles ?? (signInClaims.user_role ? [signInClaims.user_role] : []);
return { user: data.user, roles, role: highestRole(roles) };
```

- [ ] **Step 4: Build**

```bash
cd app && npm run build 2>&1 | grep -iE "compiled|error|failed"
```

Expected: `✓ Compiled successfully`, no error lines.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/roles.js app/src/context/AuthContext.js
git commit -m "Multi-role: user.roles in the auth contract"
```

---

### Task 3: Client authorization predicates

Every predicate that decides what to *show* becomes a membership test, so it agrees with the policy it mirrors.

**Files:**
- Modify: `app/src/lib/constants.js`, `app/src/components/RequireRole.jsx`

**Interfaces:**
- Consumes: `hasRole`, `hasAnyRole`, `accountRank` from Task 2.
- Produces: unchanged signatures for `isAssigneeOf(wo, user)`, `isRequesterOf(wo, user)`, `isSupervisor(wo, user)`, `isManagerOrAdmin(user)`, `canAssign(user)`, `canEditWhileOpen(wo, user)`, `canDeleteWorkOrders(user, roleCan)`, `canDeleteWorkOrder(wo, user, roleCan)`, `canEditUser(target, me)`, `canChangeUserRole(target, me)`, `canSetUserPassword(target, me)`, `canChangeUserEmail(target, me)`, `assignableRoles(me)`. Only their internals change — call sites are untouched.

- [ ] **Step 1: Convert the predicates in `constants.js`**

Import `hasRole` alongside the existing imports, then:

```js
export function isAssigneeOf(wo, currentUser) {
  return hasRole(currentUser, ROLES.TECHNICIAN) && wo.assigned_to_id === currentUser.uid;
}
export function isRequesterOf(wo, currentUser) {
  return hasRole(currentUser, ROLES.REQUESTER) && wo.requester_id === currentUser.uid;
}
export function isSupervisor(wo, currentUser) {
  return hasRole(currentUser, ROLES.SUPERVISOR);
}
export function isManagerOrAdmin(currentUser) {
  return hasRole(currentUser, ROLES.MANAGER) || hasRole(currentUser, ROLES.ADMIN);
}
export function canAssign(currentUser) {
  return hasRole(currentUser, ROLES.SUPERVISOR) || isManagerOrAdmin(currentUser);
}
export function canEditWhileOpen(wo, currentUser) {
  return (
    (hasRole(currentUser, ROLES.REQUESTER) && wo.requester_id === currentUser.uid) ||
    isSupervisor(wo, currentUser) ||
    isManagerOrAdmin(currentUser)
  );
}
```

`canDeleteWorkOrders` becomes a union, mirroring `si_can_delete_work_orders()`:

```js
export function canDeleteWorkOrders(currentUser, roleCan) {
  if (!currentUser) return false;
  if (currentUser.isSuperuser) return true;
  return (currentUser.roles ?? []).some((r) => roleCan?.(r, "can_delete_work_orders") === true);
}
```

`canEditUser`, `canChangeUserRole`, `canSetUserPassword`, `canChangeUserEmail` and `assignableRoles` need **no change** — they already route through `accountRank`, which Task 2 taught to read the set. Add a one-line comment on `canEditUser` saying so, or the next reader will "fix" it.

- [ ] **Step 2: Make `RequireRole` membership-based**

```js
import { ELEVATED_ROLES, dashboardPathForRole } from "../lib/roles";
import { hasAnyRole } from "../lib/roles";

const permitted =
  user && (hasAnyRole(user, allow) || (includeElevated && hasAnyRole(user, ELEVATED_ROLES)));
```

The redirect target stays `dashboardPathForRole(user.role)` — landing is a single choice and `user.role` is the highest held.

- [ ] **Step 3: Build**

```bash
cd app && npm run build 2>&1 | grep -iE "compiled|error|failed"
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/constants.js app/src/components/RequireRole.jsx
git commit -m "Multi-role: client predicates become membership tests"
```

---

### Task 4: Work order scoping and the assign roster

**Files:**
- Modify: `app/src/lib/workOrders.js`, `app/src/components/workorders/AssignPanel.jsx`, `app/src/components/workorders/WorkflowPanel.jsx`, `app/src/components/workorders/WorkOrderList.jsx`

**Interfaces:**
- Consumes: `hasRole` (Task 2), the converted predicates (Task 3).
- Produces: `listenWorkOrderList(currentUser, cb, onError)` — unchanged signature, union scoping.

- [ ] **Step 1: Make `listenWorkOrderList` a union**

Replace the if/else chain (which after migration 0019 reads requester → technician → everyone else) with:

```js
export function listenWorkOrderList(currentUser, cb, onError) {
  const base = () =>
    supabase.from("work_orders").select(WO_SELECT).order("created_at", { ascending: false });

  // Supervisor, Manager and Admin are all system-wide since migration 0019, so
  // any of them means "everything" and no narrower filter can apply.
  const systemWide =
    hasRole(currentUser, ROLES.SUPERVISOR) ||
    hasRole(currentUser, ROLES.MANAGER) ||
    hasRole(currentUser, ROLES.ADMIN);

  let run;
  if (systemWide) {
    run = () => base().limit(300);
  } else {
    // Requester and/or Technician: the union of what each role can see. Kept as
    // an explicit filter rather than left to RLS so Postgres can use the
    // (requester_id, created_at) and (assigned_to_id, created_at) indexes.
    const clauses = [];
    if (hasRole(currentUser, ROLES.REQUESTER)) clauses.push(`requester_id.eq.${currentUser.uid}`);
    if (hasRole(currentUser, ROLES.TECHNICIAN)) clauses.push(`assigned_to_id.eq.${currentUser.uid}`);
    run = clauses.length ? () => base().or(clauses.join(",")) : () => base().limit(0);
  }

  return liveQuery({ table: "work_orders", run, cb, onError });
}
```

Import `hasRole` from `./roles`. The `limit(0)` branch is the no-usable-role case: show nothing rather than everything.

- [ ] **Step 2: Drop the signed-in user from the assign roster**

In `AssignPanel.jsx`, after the technician list arrives, filter out the current user:

```js
// You cannot assign a work order to yourself (migration 0020's trigger refuses
// it). Removing yourself from the roster means the rule is visible in the UI
// rather than discovered as an error after choosing.
const roster = (technicians ?? []).filter((t) => t.user_id !== user.uid);
```

Use `roster` everywhere the raw list was used. If `AssignPanel` does not already have `user` from `useAuth()`, add the import and hook.

- [ ] **Step 3: Convert the remaining role reads in the work order components**

`WorkflowPanel.jsx`: `const isSupervisorLike = hasRole(user, ROLES.SUPERVISOR) || isManagerOrAdmin(user);`
The line rendering `"As {user.role === ROLES.ADMIN ? "Admin" : "Manager"}"` becomes `hasRole(user, ROLES.ADMIN) ? "Admin" : "Manager"`.
The `actor` object keeps `role: user.role` — it feeds remark text only, and the audit role is now stamped server-side.

`WorkOrderList.jsx`: `needsMyResponse` gates on `hasRole(user, ROLES.TECHNICIAN)`; `canTriage` on `hasAnyRole(user, [ROLES.SUPERVISOR, ROLES.MANAGER, ROLES.ADMIN])`; the `user.role !== ROLES.TECHNICIAN` guard on the Raise button becomes `!hasRole(user, ROLES.TECHNICIAN) || hasAnyRole(user, [ROLES.REQUESTER, ROLES.SUPERVISOR, ROLES.MANAGER, ROLES.ADMIN])`. `TITLES[user.role]` and `EMPTY_MESSAGES[user.role]` stay keyed on the highest role — they are display.

- [ ] **Step 4: Build**

```bash
cd app && npm run build 2>&1 | grep -iE "compiled|error|failed"
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/workOrders.js app/src/components/workorders/
git commit -m "Multi-role: union work order scoping, self excluded from assign roster"
```

---

### Task 5: Dashboards and the role switcher

**Files:**
- Create: `app/src/components/dashboard/RoleSwitcher.jsx`
- Modify: `app/src/components/dashboard/RoleDashboard.jsx`, `app/src/components/dashboard/DashboardModule.jsx`, `app/src/app/dashboard/page.jsx`, `app/src/app/technician/dashboard/page.jsx`, `app/src/app/supervisor/dashboard/page.jsx`

**Interfaces:**
- Consumes: `hasRole`, `hasAnyRole`, `ROLE_DASHBOARD_PATH`, `ROLE_LABELS` (Task 2); `RequireRole` (Task 3).
- Produces: `<RoleDashboard viewRole={ROLES.X} />`; `<RoleSwitcher current={ROLES.X} />`.

- [ ] **Step 1: Create `RoleSwitcher.jsx`**

```jsx
"use client";

/**
 * SI — Service Inside · Role switcher
 *
 * An account may hold several roles (migration 0020), and their "waiting on
 * you" queues live on different dashboards: a Technician's assigned jobs, a
 * Supervisor's unassigned queue. This links between them.
 *
 * IT IS A VIEW CONTROL, NOT A SECURITY CONTROL. Permissions are the union of
 * every role held, enforced server-side, and none of that depends on which view
 * is open. Nothing here may ever gate a capability — the moment it does, a
 * security boundary is living in the browser.
 *
 * Renders nothing at all for a single-role account, which is almost everyone.
 */
import Link from "next/link";
import { useAuth } from "../../context/AuthContext";
import { ROLE_DASHBOARD_PATH, ROLE_LABELS, roleRank } from "../../lib/roles";

export default function RoleSwitcher({ current }) {
  const { user } = useAuth();
  const roles = (user?.roles ?? [])
    .filter((r) => ROLE_DASHBOARD_PATH[r])
    .sort((a, b) => roleRank(b) - roleRank(a));

  if (roles.length < 2) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[12px] text-ink-soft">Viewing as</span>
      {roles.map((r) => (
        <Link
          key={r}
          href={ROLE_DASHBOARD_PATH[r]}
          className={`rounded border px-3 py-1.5 text-[12.5px] font-semibold ${
            r === current ? "border-ink bg-ink text-white" : "border-[#D8DEE4] bg-white text-ink"
          }`}
        >
          {ROLE_LABELS[r] || r}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Parameterise `RoleDashboard`**

Change the signature to `export default function RoleDashboard({ viewRole })`, and replace the two `user?.role` lookups:

```js
// The role this screen is presenting, not the account's highest. A
// Supervisor+Technician has a queue under each and switches between them.
const view = viewRole ?? user?.role;
const attention = ATTENTION[view] ?? ATTENTION[ROLES.REQUESTER];
const headings = HEADINGS[view] ?? HEADINGS[ROLES.REQUESTER];
```

Also update: the `user?.role === ROLES.SUPERVISOR && user?.departmentId` department suffix, the requester/technician copy branch near the bottom, and the `ROLE_LABELS[user?.role]` footer line — all to `view`. Render `<RoleSwitcher current={view} />` immediately above the headings block.

- [ ] **Step 3: Pass the role from each page**

```jsx
// app/src/app/dashboard/page.jsx
<RequireRole allow={[ROLES.REQUESTER]}><RoleDashboard viewRole={ROLES.REQUESTER} /></RequireRole>

// app/src/app/technician/dashboard/page.jsx
<RequireRole allow={[ROLES.TECHNICIAN]}><RoleDashboard viewRole={ROLES.TECHNICIAN} /></RequireRole>

// app/src/app/supervisor/dashboard/page.jsx
<RequireRole allow={[ROLES.SUPERVISOR]}><RoleDashboard viewRole={ROLES.SUPERVISOR} /></RequireRole>
```

`RequireRole` is membership-based as of Task 3, so a Supervisor+Technician is admitted to both routes.

- [ ] **Step 4: Convert `DashboardModule`**

`const isAdmin = hasRole(user, ROLES.ADMIN);` and `const canRefresh = hasAnyRole(user, ELEVATED_ROLES);`. Render `<RoleSwitcher current={user?.role} />` at the top so a Manager+Supervisor can reach their other view.

- [ ] **Step 5: Build**

```bash
cd app && npm run build 2>&1 | grep -iE "compiled|error|failed"
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 6: Commit**

```bash
git add app/src/components/dashboard/ app/src/app/dashboard/ app/src/app/technician/ app/src/app/supervisor/
git commit -m "Multi-role: per-view dashboards and the role switcher"
```

---

### Task 6: AppShell navigation and badges

**Files:**
- Modify: `app/src/components/AppShell.jsx`

**Interfaces:**
- Consumes: `hasRole`, `rolesLabel` (Task 2).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Make the nav a union and show every role**

- `{ href: dashboardPathForRole(user.role), … }` stays — landing is the highest role.
- `...(user.role === ROLES.ADMIN ? [adminLinks] : [])` becomes `...(hasRole(user, ROLES.ADMIN) ? [adminLinks] : [])`.
- The sidebar identity line `ROLE_LABELS[user.role] || user.role` becomes `rolesLabel(user.roles)`, so a Supervisor+Technician reads "Supervisor · Technician".
- `<RoleBadge role={user.role} compact />` keeps the highest role: the badge is a compact chip and two roles will not fit. Add a `title={rolesLabel(user.roles)}` so the full set is available on hover.

- [ ] **Step 2: Build**

```bash
cd app && npm run build 2>&1 | grep -iE "compiled|error|failed"
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 3: Commit**

```bash
git add app/src/components/AppShell.jsx
git commit -m "Multi-role: union navigation, all roles shown in the identity line"
```

---

### Task 7: Admin — assigning role sets

**Files:**
- Modify: `app/src/lib/admin.js`, `app/src/components/admin/UsersAdmin.jsx`

**Interfaces:**
- Consumes: `si_set_user_roles` (Task 1); `assignableRoles`, `canChangeUserRole` (Task 3); `rolesLabel` (Task 2).
- Produces: `setUserRoles(userId, roles, departmentId, plantIds) → Promise<void>`; `createUser({ email, password, name, roles, departmentId, plantIds, phone })` — note **`roles`**, an array, replacing `role`.

- [ ] **Step 1: Replace `setUserRole` in `admin.js`**

```js
/**
 * Set a user's roles, department and plants together.
 *
 * The new roles reach their JWT only when their token is next refreshed, since
 * custom_access_token_hook runs at token-issue time. Supabase refreshes roughly
 * hourly, so a demotion is not instant — tell the user to sign out and back in
 * if it needs to take effect now.
 */
export async function setUserRoles(userId, roles, departmentId, plantIds) {
  const { error } = await supabase.rpc("si_set_user_roles", {
    p_uid: userId,
    p_roles: roles,
    p_department_id: departmentId || null,
    p_plant_ids: plantIds || [],
  });
  if (error) throw error;
}
```

Delete the old `setUserRole`. Update `USER_SELECT` to request `roles` in place of `role`. Change `createUser` to send `roles` instead of `role`.

- [ ] **Step 2: Make the role dialog multi-select**

In `UsersAdmin.jsx`'s `RoleDialog`, replace the single-value `<select>` with checkboxes over `assignableRoles(me)`, seeded from `user.roles`:

```jsx
const choices = Array.from(new Set([...assignableRoles(me), ...(user.roles ?? [])]));
const [roles, setRoles] = useState(user.roles ?? []);

function toggle(r) {
  setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));
}
```

Render one checkbox row per choice with `ROLE_LABELS[r]`. Disable Save when `roles.length === 0` and show "An account must have at least one role." — the same rule `si_set_user_roles` raises, stated before the round trip rather than after.

Keep including the user's current roles in `choices` even when above the caller's rank, matching the existing behaviour: the dialog shows what they have, and the RPC refuses a change that would grant it.

Submit with `await setUserRoles(user.id, roles, departmentId, plantIds)`.

- [ ] **Step 3: Show all roles in the list and the create dialog**

- The roles cell in the user table renders `rolesLabel(u.roles)`.
- Line 369's `user.role === me?.role ? "Same rank — not editable here"` becomes a rank comparison: `accountRank(user) === accountRank(me) ? … : …`.
- `CreateUserDialog` becomes multi-select the same way, defaulting to `[ROLES.REQUESTER]`, and passes `roles`.
- Line 767's `form.role === ROLES.TECHNICIAN` skills section becomes `form.roles.includes(ROLES.TECHNICIAN)`.

- [ ] **Step 4: Build**

```bash
cd app && npm run build 2>&1 | grep -iE "compiled|error|failed"
```

Expected: `✓ Compiled successfully`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/admin.js app/src/components/admin/UsersAdmin.jsx
git commit -m "Multi-role: assign role sets from Admin -> Users"
```

---

### Task 8: Edge Function and bootstrap script

The service-role path bypasses RLS entirely, so its rank rules are a restatement — and per CLAUDE.md, a rule added to one enforcement point and not the others is a hole, because the loosest path wins.

**Files:**
- Modify: `app/supabase/functions/admin-users/index.ts`, `app/scripts/bootstrapUsers.js`

**Interfaces:**
- Consumes: `users.roles` (Task 1).
- Produces: `create_user` accepts `roles: string[]`; `set_password` / `set_email` rank checks read `roles`.

- [ ] **Step 1: Convert the rank helpers in `index.ts`**

```ts
/** The rank of the highest role in a set. Mirrors si_roles_rank(). */
const rankOfRoles = (roles: string[] | null | undefined) =>
  (roles ?? []).reduce((max, r) => Math.max(max, ROLE_RANK[r] ?? 0), 0);

/**
 * The rank of an actual account. A Superuser is is_protected on top of admin,
 * outranking every role — which is what lets them, and only them, create an
 * Administrator here.
 */
const rankOfAccount = (row: { roles?: string[] | null; is_protected?: boolean | null } | null) =>
  row?.is_protected ? SUPERUSER_RANK : rankOfRoles(row?.roles);
```

Keep `rankOfRole` (singular) for checking one role being granted.

- [ ] **Step 2: Update every caller lookup and the create path**

- The caller check selects `roles, status, name, is_protected` and tests `callerRow.roles?.includes("admin")` in place of `callerRow.role !== "admin"`.
- `create_user` reads `payload.roles` as an array; rejects an empty array with "An account must have at least one role."; validates every member against `VALID_ROLES`; and rejects if **any** member satisfies `rankOfRole(r) >= rankOfAccount(callerRow)`.
- The `users` insert writes `roles`, not `role`.
- The technicians row is created when `roles.includes("technician")`.
- `set_password` and `set_email` select `roles, is_protected` for the target and compare with `rankOfAccount`.

- [ ] **Step 3: Deploy the function**

```bash
cd app && npx supabase functions deploy admin-users
```

Expected: `Deployed Functions on project …`. If the CLI asks to link, the project is already linked — check `app/supabase/.temp/project-ref`.

- [ ] **Step 4: Update the bootstrap script**

In `bootstrapUsers.js`, change each seed entry from `role: "technician"` to `roles: ["technician"]`, write `roles: u.roles` into the users insert, gate the technicians row on `u.roles.includes("technician")`, and update the console line to print the set. Update the header comment, which currently says the hook "reads public.users.role".

- [ ] **Step 5: Verify the Edge Function still authorises correctly**

```bash
cd app && node -e "
const {admin}=require('./scripts/_supabaseAdmin.js');
(async()=>{const db=admin();
 const {data}=await db.from('users').select('name,roles,is_protected').order('name');
 console.log(JSON.stringify(data,null,1));})();"
```

Expected: every account still lists its roles; the protected account still shows `is_protected: true`. Then, signed in as an Administrator in the browser, open Admin → Users and confirm the list renders — that read goes through the Edge Function's sibling policies and proves the caller check still passes.

- [ ] **Step 6: Commit**

```bash
git add app/supabase/functions/admin-users/index.ts app/scripts/bootstrapUsers.js
git commit -m "Multi-role: Edge Function and bootstrap script take role sets"
```

---

### Task 9: Contract migration, verification pass, docs

Only after Tasks 1–8 are built and the new bundle is deployed. Dropping `users.role` while an older build is live is the outage this plan's expand/contract split exists to avoid.

**Files:**
- Create: `app/supabase/migrations/0021_multi_role_contract.sql`
- Modify: `CLAUDE.md`, `app/src/lib/database.types.ts` (regenerated)

**Interfaces:** none — this task removes, it does not add.

- [ ] **Step 1: Confirm nothing still reads `users.role` or the old RPC**

```bash
cd app && grep -rn "\.role\b" src/ --include=*.js --include=*.jsx | grep -viE "user\.role|actor_role|author_role|uploaded_by_role|recipient_role|viewRole|roleRank|roleCan|ROLE_" ; grep -rn "si_set_user_role\b" src/ supabase/functions/ scripts/ ; grep -rn "\"role\"\|'role'" scripts/bootstrapUsers.js
```

Expected: no hits for `si_set_user_role`, and no remaining `users.role` selects. `user.role` (the highest, from the auth contract) is expected and fine. **Do not proceed while any hit remains.**

- [ ] **Step 2: Write the contract migration**

```sql
-- ============================================================================
-- SI — Service Inside · 0021 Multi-role, contract
-- ============================================================================
-- 0020 added users.roles and kept users.role as a derived mirror so the build
-- deployed at the time — which selected `role` and called si_set_user_role —
-- kept working across the migration. That build has been replaced. This removes
-- the mirror, so there is one source of truth again.
--
-- Do not apply this until the multi-role client is deployed. The failure is a
-- signed-in user whose profile read 400s on a column that no longer exists.
-- ============================================================================

drop trigger if exists z_sync_user_primary_role on users;
drop function if exists si_sync_user_primary_role();

drop function if exists si_set_user_role(uuid, si_role, text, text[]);

-- Superseded by si_account_rank(si_role[], boolean). Dropped rather than left
-- alongside: two overloads differing only in the first argument's arity is an
-- invitation for a future policy to call the wrong one and silently compare a
-- single role.
drop function if exists si_account_rank(text, boolean);

alter table users drop column role;
```

- [ ] **Step 3: Apply and regenerate types**

Ensure `npm run dev` is stopped.

```bash
cd app && npm run db:push && npm run db:types
```

Expected: `Applying migration 0021_multi_role_contract.sql...`, then `Finished supabase db push.`

- [ ] **Step 4: Run the nine verification checks from spec §9**

Start the dev server through the preview tooling, not `npm run dev` in a shell. Work through spec §9 in order:

1. Sign in as each single-role account; confirm landing page, nav, dashboard and work order list are unchanged, and **no role switcher appears**.
2. Grant Supervisor+Technician to one account (Admin → Users). Sign that account out and in — claims only change at token issue. Confirm it lands on the Supervisor dashboard and the switcher offers Technician.
3. As that account, assign a work order to a **different** technician. Confirm success, then check the history row:
   ```bash
   cd app && node -e "
   const {admin}=require('./scripts/_supabaseAdmin.js');
   (async()=>{const db=admin();
    const {data}=await db.from('work_order_history').select('from_status,to_status,actor_name,actor_role,created_at').order('created_at',{ascending:false}).limit(3);
    console.log(JSON.stringify(data,null,1));})();"
   ```
   Expected: the newest row shows `actor_role: "supervisor"`.
4. Attempt to assign a work order to **themselves**. Expected: their own name is absent from the roster. If reached another way, the trigger raises "You cannot assign a work order to yourself."
5. Have another supervisor (or an admin) assign them a job; accept it as that account. Expected: success, and the newest history row shows `actor_role: "technician"`.
6. Attempt a technician-only transition on a job assigned to **someone else**. Expected: "You can only act on work orders assigned to you." — *not* "a supervisor/technician may not perform …". Getting the wrong message here means the two-branch refusal in Task 1 Step 6 is inverted.
7. Confirm a Supervisor+Technician cannot edit a Supervisor (equal rank), and an Administrator still cannot edit another Administrator.
8. Revoke Technician; sign out and in; confirm the switcher disappears and technician capabilities are gone.
9. Confirm the `technicians` row survived the revoke:
   ```bash
   cd app && node -e "
   const {admin}=require('./scripts/_supabaseAdmin.js');
   (async()=>{const db=admin();
    const {data}=await db.from('technicians').select('user_id,name,skills');
    console.log(JSON.stringify(data));})();"
   ```
   Expected: the row is still present with its skills intact.

- [ ] **Step 5: Run the Supabase security advisor**

Required by CLAUDE.md after any migration adding functions. Supabase Dashboard → Advisors → Security. Expected: no new "Function Search Path Mutable" or "RLS Disabled" findings. Any new function flagged as anon-callable means a `revoke`/`grant` pair was missed in Task 1 Step 4.

- [ ] **Step 6: Update CLAUDE.md**

The role documentation is now wrong in three places and will actively mislead:

- "**The role claim**" section: `user_role` becomes `user_roles` (with `user_role` retained as the highest); note that an account holds a *set*.
- "**The role hierarchy**" section: rank is the **maximum** role held; `si_account_rank()` takes an array.
- Add a short "**Multi-role**" subsection: permissions are the union, always; the switcher is a view control and must never gate a capability; self-assignment is blocked for every role including Admin; `actor_role` now records the role a person acted under.
- The "Adding a feature" and "Known gaps" sections need no change.

- [ ] **Step 7: Commit**

```bash
git add app/supabase/migrations/0021_multi_role_contract.sql app/src/lib/database.types.ts CLAUDE.md
git commit -m "Multi-role: contract migration, drop users.role, update CLAUDE.md"
```

---

## Self-review

**Spec coverage.** §1 schema → Task 1 Steps 2 and Task 9 Step 2. §2 claims and fallback → Task 1 Steps 3–4, mirrored client-side in Task 2 Step 2. §3 semantics table → Task 1 Steps 4, 8. §3 policies → Task 1 Step 5. §4 trigger → Task 1 Step 6; audit stamping → Step 7; self-assignment → Step 6. §5 client table → Tasks 2–7, one row each. §5 "switcher is a view control" → Task 5 Step 1's header comment. §6 privileged paths → Task 1 Step 9 (RPC), Task 1 Step 5 (policies), Task 8 (Edge Function). §7 ordering → the task order, with the expand/contract deviation stated up front. §8 risks → the fallback (Task 1 Step 4), grants (Step 4), shared `si_eligible_roles` (Steps 6–7), overload drop (Task 9 Step 2). §9 verification → Task 9 Step 4, all nine.

**Placeholder scan.** No TBD/TODO. Every code step carries the code. Task 1 Step 7 and Task 8 Step 2 describe edits to long existing functions rather than reproducing them — both name the file, the exact identifier to change, and what must be copied verbatim; reproducing `si_transition_work_order` and a 320-line Deno handler in full would be transcription, not instruction.

**Type consistency.** `roles` is `si_role[]` in SQL and `string[]` in JS throughout. `hasRole(account, role)` / `hasAnyRole(account, roles)` / `highestRole(roles)` / `rolesLabel(roles)` are defined in Task 2 and used with those exact names in Tasks 3–7. `setUserRoles(userId, roles, departmentId, plantIds)` is defined in Task 7 and matches the `si_set_user_roles(p_uid, p_roles, p_department_id, p_plant_ids)` signature from Task 1. `si_eligible_roles(si_role[], uuid, uuid)` has one signature, used in Task 1 Steps 6 and 7. `viewRole` is the prop name in Task 5 Steps 2 and 3.

**Known gap, deliberate.** Task 1 Step 7 relies on the executor reading migration 0010 and restating it. That is the one place this plan asks for judgement rather than transcription; the alternative is a 110-line code block reproduced for a three-line change, which is more likely to be miscopied than the instruction is to be misread.
