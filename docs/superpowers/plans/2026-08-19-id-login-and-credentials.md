# Employee-ID Sign-in and Credential Handling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a person sign in with their employee number as well as their email address, and make an account's state — active, and owing no password change — actually decide whether it works.

**Architecture:** Three small migrations in dependency order, with a verification gate between the second and everything else. 0025 adds two columns and the guard/trigger statements that police them. 0026 changes `custom_access_token_hook` and nothing else. 0027 adds the sign-in attempt table and the ID lookup. Authorization moves nowhere: the hook withholds role claims from an account that is inactive or owes a password change, and every existing policy already denies an account with no roles. Employee-ID sign-in resolves the number to an address inside a new Edge Function on the service-role key, so no lookup oracle reaches the browser.

**Tech Stack:** Postgres 15 (Supabase) with plpgsql triggers and RLS; Deno Edge Functions; Next.js 14 static export (`output: "export"`, every page `"use client"`); `@supabase/supabase-js` v2; Tailwind; lucide-react.

**Spec:** `docs/superpowers/specs/2026-08-19-id-login-and-credentials-design.md` — read it alongside this plan. Where the two disagree, the spec is the intent and this plan is wrong.

**Branch:** `id-login-and-credentials`, currently holding the two spec commits.

## Global Constraints

- **The database is the authorization boundary.** Predicates in `src/lib/constants.js` decide what to *show*; the RLS policy or trigger decides what is *allowed*. Adding a predicate without the matching server rule is a bug, and so is loosening a server rule to match a predicate.
- **Components never import `supabase` directly.** They call `listenX(args, cb, onError)` and the write functions from `src/lib/*`. Keep new code on that contract.
- **Three enforcement points for anything about users**, because two of them bypass RLS: the `users_*` policies, the `si_set_user_roles` RPC (SECURITY DEFINER), and `supabase/functions/admin-users` (service role). A rule added to one and not the others is a hole — the loosest path wins.
- **Every new function in `public` is an anon-callable RPC by default.** Revoke explicitly (`revoke all on function … from public, anon, authenticated`) and run the Supabase security advisor after any migration that adds one. Migrations 0007, 0008 and 0011 exist because of this default.
- **Never run `npm run build` while `npm run dev` is live.** They share `.next`, and the production build corrupts the dev cache — every chunk 500s and the page fails to hydrate silently.
- `npm run lint` is broken (Next 16 removed `next lint`). **`npm run build` is the compile check.**
- **`SUPABASE_SERVICE_ROLE_KEY` never leaves `app/.env.local` and Supabase's own function environment.** Never in Vercel, never prefixed `NEXT_PUBLIC_`, never printed.
- Roles are lowercase snake_case matching the `si_role` enum: `requester`, `technician`, `supervisor`, `manager`, `admin`. A Superuser is `admin` + `users.is_protected`, never a sixth enum value.
- Minimum password length is 8, currently defined in `admin-users/index.ts` as `MIN_PASSWORD_LENGTH` and again in `UsersAdmin.jsx`. Do not add a third definition.
- `describeError()` surfaces the server's message rather than replacing it. Do not wrap database errors in generic "try again" copy.
- Static export: no server routes, no API routes, no middleware. A redirect is client-side or it does not exist.
- The same `out/` is served by Vercel and packaged into the APK. **Rebuild the APK after any web change.**

## Verification model — read this before Task 1

**This repo has no test suite and no test runner.** There is no pytest, no jest, no `npm test`. Do not scaffold one as part of this plan; that is a separate decision and a large one.

TDD survives in the form the repo supports, and every task below follows it:

1. **Write the check first and watch it fail.** For SQL that is a `do $$ … raise exception … $$` assertion block; for the client it is a stated observation in the running app that is wrong before the change.
2. **Make the smallest change that flips it.**
3. **Re-run the identical check and watch it pass.**
4. **Commit.**

Where each kind of check runs:

- **SQL assertions** — Supabase Dashboard → SQL Editor, or `psql`. Both connect as `postgres`, which **bypasses RLS**: an assertion that must exercise a *policy* has to run in the app as a signed-in user instead, and every such step below says so explicitly.

  **On this machine there is no way to run one from the terminal.** No `psql`, no Docker, and no stored Supabase access token, so the `do $ … $` blocks below are for the SQL Editor only — paste them there, or substitute the behavioural equivalent. Tasks 1 and 2 were executed the second way and it turned out better, not worse:

  | Instead of | Do this | Why it is stronger |
  |---|---|---|
  | reading `pg_indexes` for `users_employee_id_key` | write two case/whitespace variants of one number and require `23505` on the second | proves the index *normalises*, not merely that it exists |
  | calling `custom_access_token_hook()` directly | mint a real token (below) and read its claims | tests what GoTrue actually issues, hook-enabled state included |
  | reading `information_schema` for a column | `select` it through PostgREST | a column PostgREST cannot see does not exist as far as the app is concerned |

  `supabase db push` **does** work here — it connects straight to the linked remote. It is `db diff` that needs Docker, for its shadow database.

- **Minting a fresh token without a password** — the refresh grant re-runs the hook, so it produces a genuinely freshly minted token from a session that is *already* signed in. This is how to test a claims change across several account states without anyone re-entering credentials, and without a service-role key. Paste once, then call `await window.__mint()` after each state change:
  ```js
  window.__mint = async () => {
    const K = Object.keys(localStorage).concat(Object.keys(sessionStorage))
      .find((k) => k.includes("auth-token"));
    const store = localStorage.getItem(K) ? localStorage : sessionStorage;
    const sess = JSON.parse(store.getItem(K));
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: "POST",
      headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: sess.refresh_token }),
    });
    const body = await res.json();
    if (!res.ok) return { error: `${res.status} ${JSON.stringify(body)}` };
    // Refresh tokens ROTATE. Write the new session back or the next call fails.
    store.setItem(K, JSON.stringify({ ...sess, ...body }));
    return JSON.parse(atob(body.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  };
  ```
  It cannot replace a real sign-out/sign-in for testing the *login page*, and it cannot mint for an account nobody is signed in as.
- **Compile** — `npm run build` from `app/`, with the dev server stopped.
- **Behaviour** — `npm run dev` from `app/`, signed in as the role the step names. **The person running the plan signs in themselves. Never ask for, type, or store anybody else's password.**
- **Claims** — **the app exposes no `supabase` client on `window`**, by design: components reach it only through `lib/*`. So read the session out of storage, where the adapter in `lib/supabase.js` puts it — `localStorage` when Remember Me was ticked, `sessionStorage` otherwise. In the browser console of the running app:
  ```js
  const K = Object.keys(localStorage).concat(Object.keys(sessionStorage))
    .find((k) => k.includes("auth-token"));
  const raw = localStorage.getItem(K) ?? sessionStorage.getItem(K);
  const tok = JSON.parse(raw).access_token;
  JSON.parse(atob(tok.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
  ```
  **A cached token proves nothing — sign out and in first, every time.**

- **A request as the signed-in user** — for the steps that must go through a policy or a guard rather than round the back of it, call PostgREST directly with that token. The anon key is `NEXT_PUBLIC_` and already in the bundle, so it is not a secret; take it from `app/.env.local`. A helper worth pasting once per session:
  ```js
  window.__as = async (path, init = {}) => {
    const K = Object.keys(localStorage).concat(Object.keys(sessionStorage))
      .find((k) => k.includes("auth-token"));
    const tok = JSON.parse(localStorage.getItem(K) ?? sessionStorage.getItem(K)).access_token;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(init.headers ?? {}),
      },
    });
    return { status: res.status, body: await res.text() };
  };
  ```
  Substitute the two constants from `app/.env.local`. **Do not use a service-role key here** — it bypasses RLS, which is the opposite of what these steps test.

## Applying a migration

`npm run db:push` requires Docker Desktop to be running. If it is not — a documented recurring condition on this machine — the repo's own precedent is migration 0024: run the file's contents in the Supabase SQL Editor, and record that fact in a comment at the top of the migration file so the next reader knows the file and the live schema were reconciled by hand.

Either way, afterwards: `npm run db:types`.

## File structure

**Created**

| File | Responsibility |
|---|---|
| `app/supabase/migrations/0025_employee_id_and_credentials.sql` | Two columns, the uniqueness index, and the two guard/trigger statements that police them. No authorization change. |
| `app/supabase/migrations/0026_account_state_claims.sql` | `custom_access_token_hook` and nothing else. |
| `app/supabase/migrations/0027_login_attempts.sql` | `login_attempts`, its grants, its sweep, and the employee-ID lookup function. |
| `app/supabase/functions/auth-signin/index.ts` | Resolve an employee ID to an address and exchange credentials for a session. Unauthenticated by design, so it shares no `if` with anything privileged. |
| `app/supabase/config.toml` | Per-function `verify_jwt`. The only reason this file needs to exist. |
| `app/src/app/change-password/page.jsx` | The one page a flagged account can use. Signed-in gate only, never `RequireRole`. |

**Modified**

| File | Change |
|---|---|
| `app/src/context/AuthContext.js` | `mustChangePassword` on the user shape; drop the `profile.roles` fallback that would resurrect withheld roles; `signIn` takes an identifier. |
| `app/src/components/RequireAuth.jsx` | Route a flagged account to `/change-password`. |
| `app/src/lib/constants.js` | `canSetUserPassword` → Superuser; new `canSendRecoveryLink`; `canChangeUserEmail` → self-or-Superuser. |
| `app/src/lib/admin.js` | `USER_SELECT` gains the two columns; new `sendRecoveryLink()`; `employee_id` on `createUser` and `updateUserProfile`. |
| `app/src/components/admin/UsersAdmin.jsx` | Employee ID shown, searchable, editable; Password button Superuser-only; Send-reset-link button; flagged marker. |
| `app/src/app/login/page.jsx` | One field accepting either identifier; domain check only when the value contains `@`; branch on `mustChangePassword`. |
| `app/supabase/functions/admin-users/index.ts` | `set_password` Superuser-only and flags *after* the password; `set_email` self-or-Superuser; new `send_recovery_link`; `employee_id` in `create_user`. |
| `app/src/lib/roles.js` | **Nothing.** Listed to be explicit: `hasRole`, `highestRole` and `accountRank` all need no change. |
| `CLAUDE.md`, `app/BUILD_AND_DEPLOY.md` | New sections; the new function secret. |

---

### Task 1: Migration 0025 — the columns and their guards

Adds two columns and the rules that stop the wrong people writing them. Observable behaviour does not change: `employee_id` is null everywhere, `must_change_password` is false everywhere, and nothing reads either yet.

**Files:**
- Create: `app/supabase/migrations/0025_employee_id_and_credentials.sql`
- Modify (regenerated): `app/src/lib/database.types.ts`

**Interfaces:**
- Consumes: `si_protected_override()` (migration 0013; EXECUTE granted to `postgres` only, callable here because every guard on this schema is SECURITY DEFINER and owned by `postgres`); `si_guard_user_self_update()` as migration 0020 left it; `si_sync_auth_user_activity()` as migration 0016 left it.
- Produces: `public.users.employee_id text` nullable; `public.users.must_change_password boolean not null default false`; unique index `users_employee_id_key on users (upper(btrim(employee_id))) where employee_id is not null`.

- [x] **Step 1: Write the failing assertion**

Run this in the SQL Editor and keep it — step 4 re-runs it unchanged.

```sql
-- Task 1 assertion. Every clause must hold after 0025.
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'users'
                    and column_name = 'employee_id' and data_type = 'text'
                    and is_nullable = 'YES') then
    raise exception 'FAIL: users.employee_id missing, or not nullable text';
  end if;

  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'users'
                    and column_name = 'must_change_password'
                    and data_type = 'boolean' and is_nullable = 'NO'
                    and column_default like '%false%') then
    raise exception 'FAIL: users.must_change_password missing, nullable, or not defaulted false';
  end if;

  if not exists (select 1 from pg_indexes
                  where schemaname = 'public' and indexname = 'users_employee_id_key') then
    raise exception 'FAIL: users_employee_id_key missing';
  end if;

  if exists (select 1 from public.users
              where employee_id is not null or must_change_password is not false) then
    raise exception 'FAIL: an existing row was given a value it should not have';
  end if;

  raise notice 'PASS: 0025 columns, index and defaults';
end $$;
```

- [x] **Step 2: Run it and confirm it fails**

Expected: `ERROR: FAIL: users.employee_id missing, or not nullable text`.

- [x] **Step 3: Write the migration**

Create `app/supabase/migrations/0025_employee_id_and_credentials.sql`:

```sql
-- ============================================================================
-- 0025 — Employee ID, and an account that owes a password change
--
-- Two columns and the rules that police them. NO authorization change: that is
-- migration 0026, deliberately on its own, because the hook decides access for
-- every account at once and its wrong versions deny silently rather than
-- erroring. See the design spec, §2 and §7.
--
-- Applying this changes nothing observable. employee_id is null on every
-- existing row, must_change_password is false on every existing row, and until
-- 0026 nothing reads either one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

-- Nullable, because it is an existing HR number typed in by an administrator:
-- every current row has none, and several accounts never will.
alter table users add column if not exists employee_id text;

alter table users add column if not exists must_change_password boolean not null default false;

/* Unique on the normalised form, partial so null does not collide with null.

   upper(btrim(...)) rather than the raw column: the number is copied off a
   badge or a payroll export, so " e1042 " and "E1042" are the same person, and
   allowing both to exist would make the lookup in auth-signin ambiguous at
   exactly the moment it must not be. */
create unique index if not exists users_employee_id_key
  on users (upper(btrim(employee_id))) where employee_id is not null;

comment on column users.employee_id is
  'The existing HR/payroll number. Nullable; unique case- and whitespace-insensitively. A second sign-in identifier, resolved to the auth email inside the auth-signin Edge Function.';
comment on column users.must_change_password is
  'This account was given its password by somebody else and owes a change. While true, custom_access_token_hook withholds its role claims (0026), so the database grants it nothing. Cleared by si_sync_auth_user_activity when the password actually changes.';

-- ---------------------------------------------------------------------------
-- 2. The self-update guard
-- ---------------------------------------------------------------------------
/* 0020's function, with the two new columns and one new door.

   THE NON-ADMIN BRANCH IS A DENY LIST, NOT AN ALLOW LIST. It names every column
   a non-admin may not move, so a column absent from it is permitted. Both new
   columns have to be named there or a Requester clears their own
   must_change_password with a PATCH on their own row and the feature is
   decorative.

   The two columns are NOT treated alike, and the difference is the point:

   - must_change_password is in the SELF branch as well, so nobody clears their
     own — Administrator and Superuser included. Same placement, same reason, as
     0015's self-role-change lock: a rule whose purpose is to stop you acting on
     yourself is worthless if the most privileged account is exempt.
   - employee_id is in the non-admin branch ONLY. An administrator may set their
     own. It is a directory attribute, not a privilege, and its one real abuse —
     claiming somebody else's number — is what the unique index already refuses.

   THE NEW DOOR. si_sync_auth_user_activity clears must_change_password on YOUR
   OWN row when YOU change YOUR OWN password, which is exactly what the self
   branch now forbids. si_protected_override() is the existing mechanism for a
   system-maintained write of these audit columns: migration 0016 opened it on
   si_guard_protected_user for the same trigger and the same reason. It reads a
   transaction-local GUC no client can set — set_config lives in pg_catalog, so
   PostgREST does not publish it — and the trigger switches it off again
   immediately after the write.

   Belt and braces, deliberately. auth.uid() is very probably already null
   inside that trigger, because GoTrue's own connection sets no JWT claims and
   this guard's first line returns early on a null uid. "Very probably" is not a
   basis for a rule that silently disables a security feature when it is wrong. */
create or replace function si_guard_user_self_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No JWT means this is not a client request: the auth-activity trigger (0012)
  -- writing last_login_at, or a service-role script.
  if auth.uid() is null then return new; end if;

  -- A deliberate system-maintained write, taking the same door 0016 uses.
  if si_protected_override() then return new; end if;

  if new.id = auth.uid() then
    if new.roles is distinct from old.roles then
      raise exception 'You cannot change your own roles. Ask someone above you, or change it in Supabase.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.status is distinct from old.status then
      raise exception 'You cannot change your own account status.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.must_change_password is distinct from old.must_change_password then
      raise exception 'You cannot clear your own password-change requirement. Change your password instead.'
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
     or new.employee_id is distinct from old.employee_id
     or new.must_change_password is distinct from old.must_change_password
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

-- ---------------------------------------------------------------------------
-- 3. Clearing the flag when the password actually changes
-- ---------------------------------------------------------------------------
/* 0016's function, with must_change_password folded into the write it already
   makes. Same override window, same immediate reset — see 0016's header for why
   the reset has to be explicit.

   THE ORDERING THIS CREATES IS LOAD-BEARING ELSEWHERE. Issuing a temporary
   password is itself a password change, so this trigger fires and clears the
   flag. Whatever sets the flag must therefore set it AFTER writing the password
   — see supabase/functions/admin-users, action set_password. Reversed, the
   account gets a temporary password and no obligation to change it, and nothing
   anywhere reports a problem. */
create or replace function si_sync_auth_user_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    perform set_config('si.allow_protected_write', 'on', true);
    update public.users
       set password_changed_at  = now(),
           must_change_password = false
     where id = new.id;
    perform set_config('si.allow_protected_write', 'off', true);
  end if;

  if new.last_sign_in_at is distinct from old.last_sign_in_at
     and new.last_sign_in_at is not null then
    perform set_config('si.allow_protected_write', 'on', true);
    update public.users set last_login_at = new.last_sign_in_at where id = new.id;
    perform set_config('si.allow_protected_write', 'off', true);
  end if;

  return new;
end;
$$;
revoke all on function si_sync_auth_user_activity() from public, anon, authenticated;
```

**No `users` policy changes, and that is not an omission.** The spec's §5 table
lists "`users` policies" beside the `employee_id` write; on inspection they
already say the right thing. `users_update`'s non-self branch is gated on
`si_is_admin()`, so a non-admin reaches no row but their own, and the deny list
above stops them touching either new column on it. Widening or restating a policy
here would add a second place for the rule to drift from.

- [x] **Step 4: Apply it, then re-run the step 1 assertion**

```bash
cd app && npm run db:push
```

If Docker is down, paste the file into the SQL Editor and add a comment at the top of the migration recording that, following migration 0024's precedent.

Expected from the assertion: `NOTICE: PASS: 0025 columns, index and defaults`, no error.

- [x] **Step 5: Prove the uniqueness index rejects a case variant**

```sql
do $$
declare a uuid; b uuid;
begin
  select id into a from public.users order by created_at limit 1;
  select id into b from public.users where id <> a order by created_at limit 1;
  if b is null then raise exception 'Need two users for this check'; end if;

  perform set_config('si.allow_protected_write', 'on', true);
  update public.users set employee_id = ' e1042 ' where id = a;
  begin
    update public.users set employee_id = 'E1042' where id = b;
    raise exception 'FAIL: the second row was allowed to claim the same number';
  exception when unique_violation then
    raise notice 'PASS: case- and whitespace-insensitive uniqueness holds';
  end;

  -- Leave the table as it was found.
  update public.users set employee_id = null where id in (a, b);
  perform set_config('si.allow_protected_write', 'off', true);
end $$;
```

Expected: `NOTICE: PASS: case- and whitespace-insensitive uniqueness holds`.

- [x] **Step 6: Prove a non-admin cannot clear the flag — in the app, not in SQL**

The SQL Editor runs as `postgres` and bypasses RLS, so this has to go through PostgREST. First, as `postgres`, give the Requester something to move:

```sql
do $$
begin
  perform set_config('si.allow_protected_write', 'on', true);
  update public.users set must_change_password = true
   where 'requester' = any(roles) and not is_protected
     and id = (select id from public.users where 'requester' = any(roles) limit 1);
  perform set_config('si.allow_protected_write', 'off', true);
end $$;
```

Then start the dev server, sign in as that Requester, and in the browser console:

```js
// uid is in the token's `sub` claim; decode it as the verification model shows.
await window.__as(`users?id=eq.${uid}`, {
  method: "PATCH",
  body: JSON.stringify({ must_change_password: false }),
});
```

Expected: an error containing `You may only change your own name, phone, and photo.`

Note: after 0026 lands, this account will not be able to sign in while the flag is set — which is why this check belongs here, in Task 1, and not later. Clear the flag again when done.

- [x] **Step 7: Regenerate types and confirm the compile**

```bash
cd app && npm run db:types && npm run build
```

Expected: the `database.types.ts` diff shows `employee_id` and `must_change_password` on `users`; the build succeeds. Nothing reads them yet, so no other file changes.

- [x] **Step 8: Commit**

```bash
git add app/supabase/migrations/0025_employee_id_and_credentials.sql app/src/lib/database.types.ts
git commit -m "Users: employee_id and must_change_password, with their guards"
```

---

### Task 2: Migration 0026 — the hook, alone

**This is the gate.** It decides authorization for every account in the plant. Nothing in Task 3 onwards may begin until step 6 passes.

**Files:**
- Create: `app/supabase/migrations/0026_account_state_claims.sql`

**Interfaces:**
- Consumes: `users.status`, `users.must_change_password`, `users.roles`, `users.department_id`, `users.plant_ids`, `users.is_protected`; `si_role_rank(text)`.
- Produces: for an account that is `status <> 'active'` **or** `must_change_password`, an access token carrying **neither** `user_roles` **nor** `user_role`; and in every case a `must_change_password: true|false` claim.

- [x] **Step 1: Write the failing assertion**

`custom_access_token_hook` takes the event jsonb, so it can be called directly as `postgres` — no sign-in needed to test its logic. Keep this block; step 4 re-runs it.

```sql
-- Task 2 assertion. Calls the hook for one real account in each of three
-- states and checks the claims it returns.
do $$
declare
  v_uid    uuid;
  v_status text;
  v_flag   boolean;
  c        jsonb;
  note     text := 'read the spec §2 trap before "fixing" this';
begin
  select id, status, must_change_password into v_uid, v_status, v_flag
    from public.users where 'admin' = any(roles) and not is_protected
    order by created_at limit 1;
  if v_uid is null then
    select id, status, must_change_password into v_uid, v_status, v_flag
      from public.users order by created_at limit 1;
  end if;
  if v_uid is null then raise exception 'FAIL: no users to test with'; end if;

  perform set_config('si.allow_protected_write', 'on', true);

  -- (a) active, unflagged: everything present, exactly as today.
  update public.users set status = 'active', must_change_password = false where id = v_uid;
  c := public.custom_access_token_hook(
         jsonb_build_object('user_id', v_uid::text, 'claims', '{}'::jsonb)) -> 'claims';
  if jsonb_typeof(c -> 'user_roles') <> 'array' or jsonb_array_length(c -> 'user_roles') = 0 then
    raise exception 'FAIL(a): an active unflagged account lost user_roles';
  end if;
  if c ->> 'user_role' is null then raise exception 'FAIL(a): lost user_role'; end if;
  if c ->> 'is_protected' is null then raise exception 'FAIL(a): lost is_protected'; end if;
  if c ->> 'must_change_password' <> 'false' then
    raise exception 'FAIL(a): must_change_password claim should be false, got %',
      c ->> 'must_change_password';
  end if;

  -- (b) inactive: BOTH role claims withheld. An empty array is NOT enough.
  update public.users set status = 'inactive' where id = v_uid;
  c := public.custom_access_token_hook(
         jsonb_build_object('user_id', v_uid::text, 'claims', '{}'::jsonb)) -> 'claims';
  if c ? 'user_roles' then
    raise exception 'FAIL(b): user_roles is still present (%). si_roles() array_aggs it to NULL and falls through to user_role, so the role comes back. %',
      c -> 'user_roles', note;
  end if;
  if c ? 'user_role' then
    raise exception 'FAIL(b): user_role is still present (%). %', c -> 'user_role', note;
  end if;

  -- (c) active but flagged: same withholding, plus the claim set true.
  update public.users set status = 'active', must_change_password = true where id = v_uid;
  c := public.custom_access_token_hook(
         jsonb_build_object('user_id', v_uid::text, 'claims', '{}'::jsonb)) -> 'claims';
  if c ? 'user_roles' or c ? 'user_role' then
    raise exception 'FAIL(c): a flagged account still carries role claims. %', note;
  end if;
  if c ->> 'must_change_password' <> 'true' then
    raise exception 'FAIL(c): must_change_password claim is not true';
  end if;

  update public.users set status = v_status, must_change_password = v_flag where id = v_uid;
  perform set_config('si.allow_protected_write', 'off', true);
  raise notice 'PASS: hook withholds both role claims in both states';
end $$;
```

- [x] **Step 2: Run it and confirm it fails**

Expected: `ERROR: FAIL(b): user_roles is still present (["admin"]) …`. That is today's hook behaving correctly for today's rules.

- [x] **Step 3: Write the migration**

Create `app/supabase/migrations/0026_account_state_claims.sql`:

```sql
-- ============================================================================
-- 0026 — Account state decides what a token carries
--
-- ONE FUNCTION. Nothing else belongs in this file.
--
-- This is the only change in this sub-project that can lock every account out
-- of the app at once, and its failure mode is silence rather than an error:
-- every policy in the schema denies an account whose si_roles() is empty, so a
-- wrong hook signs everybody in to a blank app with nothing raised anywhere.
-- That has already happened once on this schema — 0002's hook omitted
-- is_protected and 0015 was written believing it was there.
--
-- WHAT CHANGES: an account that is not active, or that owes a password change,
-- gets a token with no role claims. Everything else follows without touching a
-- single policy, because "no roles" is already denied everywhere.
--
-- WHAT DOES NOT CHANGE: an account that is active and unflagged gets exactly
-- the claims 0020 gave it. si_is_superuser() is untouched, and needs to be:
-- with no roles si_has_role('admin') is false, so an inactive Superuser is not
-- one either.
--
-- ---------------------------------------------------------------------------
-- THE TRAP
-- ---------------------------------------------------------------------------
-- Emitting `user_roles: []` IS NOT ENOUGH, and the version that does it looks
-- right. si_roles() (0020) is:
--
--     coalesce(
--       (select array_agg(...) from jsonb_array_elements(... 'user_roles') ...),
--       case when auth.jwt() ->> 'user_role' ... end
--     )
--
-- array_agg over zero rows returns NULL, not '{}'. An empty user_roles array
-- therefore falls straight through the coalesce into the user_role branch and
-- the single highest role comes back. The account is denied nothing, and nothing
-- errors.
--
-- Both claims are REMOVED from the object rather than emptied. AuthContext.js
-- mirrors the same fallback chain on the client and gets the same treatment
-- there, including dropping its profile.roles leg — users_select lets an
-- account read its own row, so the client would otherwise refill exactly what
-- this function withholds.
--
-- ---------------------------------------------------------------------------
-- BEFORE YOU APPLY THIS
-- ---------------------------------------------------------------------------
-- The flagged half is inert today: nothing writes must_change_password until
-- the admin-users function is updated. The inactive half is live immediately,
-- and that is the intent rather than a side effect:
--
--     select id, name, email, status from public.users where status <> 'active';
--
-- Every row that returns loses access at its next token refresh. Look at the
-- list first. It should be a decision, not a discovery.
-- ============================================================================

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
  v_high text;
begin
  select roles, department_id, plant_ids, is_protected, status, must_change_password
    into u
    from public.users
   where id = (event ->> 'user_id')::uuid;

  if found then
    /* Entitled to act at all? Two conditions, one answer.

       Note what is deliberately absent: no status claim. The client needs to
       know "you owe a password change" to route somewhere useful, and it does
       not need to be told the account is inactive — that would put a second
       copy of an authorization input somewhere that only expires hourly. */
    if u.status = 'active' and not coalesce(u.must_change_password, false) then
      select r::text into v_high
        from unnest(u.roles) r
       order by si_role_rank(r::text) desc
       limit 1;

      claims := jsonb_set(claims, '{user_roles}',
        coalesce(to_jsonb(array(select r::text from unnest(u.roles) r)), '[]'::jsonb));
      claims := jsonb_set(claims, '{user_role}', coalesce(to_jsonb(v_high), 'null'::jsonb));
    else
      /* REMOVED, not emptied. See THE TRAP above: '[]' here restores the very
         access this branch exists to withhold, silently. */
      claims := claims - 'user_roles' - 'user_role';
    end if;

    -- Unconditional. department_id and plant_ids route notifications and group
    -- the dashboard; is_protected only adds a rank tier to an account that must
    -- already hold 'admin' for it to mean anything, so withholding it would buy
    -- nothing.
    claims := jsonb_set(claims, '{department_id}', coalesce(to_jsonb(u.department_id), 'null'::jsonb));
    claims := jsonb_set(claims, '{plant_ids}',     coalesce(to_jsonb(u.plant_ids), '[]'::jsonb));
    claims := jsonb_set(claims, '{is_protected}',  to_jsonb(coalesce(u.is_protected, false)));

    -- The reason, so the client can route to /change-password instead of
    -- presenting an empty app with no explanation.
    claims := jsonb_set(claims, '{must_change_password}',
                        to_jsonb(coalesce(u.must_change_password, false)));
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- Restated rather than relied upon, as 0017 and 0020 do: `create or replace`
-- keeps the existing ACL, but a hook the auth server cannot execute fails
-- closed on every single sign-in.
grant  usage   on schema   public to supabase_auth_admin;
grant  execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
grant  select  on public.users to supabase_auth_admin;
```

- [x] **Step 4: List the accounts this will cut off, then apply**

```sql
select id, name, email, status, must_change_password from public.users where status <> 'active';
```

Read the result before continuing. Then:

```bash
cd app && npm run db:push
```

Re-run the step 1 assertion. Expected: `NOTICE: PASS: hook withholds both role claims in both states`.

- [x] **Step 5: Confirm the hook is still enabled in the dashboard**

Supabase Dashboard → Authentication → Hooks → Customize Access Token. It must still name `public.custom_access_token_hook`. `create or replace` does not disturb this, but the failure if it is off is silent and total, so look rather than assume.

- [x] **Step 6: THE GATE — verify a freshly minted token in the running app**

`npm run dev`, sign out completely, sign in as an ordinary active user, decode the token as described in the verification model.

Expected: `user_roles` a non-empty array, `user_role` a string, `is_protected` present, `must_change_password` false. The app behaves exactly as before.

Then, as `postgres`:

```sql
update public.users set must_change_password = true where email = '<that account>';
```

Sign out, sign back in, decode again.

Expected: **no `user_roles` key and no `user_role` key**; `must_change_password: true`. If either role claim is present in any form — including as `[]` — stop and fix the hook. Set the flag back to false when done.

**Do not begin Task 3 until this step passes.**

- [x] **Step 7: Commit**

```bash
git add app/supabase/migrations/0026_account_state_claims.sql
git commit -m "Hook: an inactive or flagged account carries no role claims"
```

- [ ] **Step 8: Run the Supabase security advisor**

Dashboard → Advisors → Security. CLAUDE.md requires it after any migration touching functions. `custom_access_token_hook` must not appear as anon-callable — the revoke above is restated for exactly this.

#### What 0025 and 0026 were verified against (executed 2026-08-19)

Recorded here rather than in the migration files, because the CLI keeps each
applied migration's statements in `supabase_migrations.schema_migrations` and
editing a pushed file invites a history mismatch on the next push.

| Check | Result |
|---|---|
| 0025 columns present, defaulted, no row touched | pass |
| ` e1042 ` then `E1042` on a second row | `23505 … users_employee_id_key` |
| Requester clears own `must_change_password` | `403 42501` "You cannot clear your own password-change requirement." |
| Requester sets own `employee_id` | `403 42501` "You may only change your own name, phone, and photo." |
| Requester writes own `phone` | `200` — the guard is not a blanket refusal (cf. 0013) |
| **Pre-0026**, inactive account, fresh token | `user_roles ["requester"]`, `user_role "requester"` — status granted nothing |
| Post-0026, inactive | both role claims **absent**, claim `false` |
| Post-0026, active + unflagged | `["requester"]` / `"requester"`, claim `false` |
| Post-0026, active + flagged | both role claims **absent**, claim `true` |
| Roleless token: `work_orders`, `notifications` | `0` rows each |
| Roleless token: `users` | `1` row — its own, **still exposing `roles`**. This is the hole Task 3 closes. |
| Protected Superuser, fresh token | `user_roles ["admin"]`, `is_protected: true` — the 0017 failure mode ruled out |
| `role_permissions` no-op write as Superuser | `200`, 1 row — `si_is_superuser()` still true |
| Admin → Settings → Permissions | renders |

---

### Task 3: AuthContext — carry the flag, and stop resurrecting withheld roles

**This task closes a hole the spec does not mention.** `AuthContext` currently resolves roles as:

```js
claims.user_roles ?? (claims.user_role ? [claims.user_role] : profile.roles ?? [])
```

`users_select` lets any account read its own row, so a flagged or inactive account reads its real `roles` out of `profile` and the client hands them straight back — the client-side mirror of the `array_agg` trap 0026 just closed in SQL. Nothing is *granted*: the database still denies every query. What breaks is the app's account of itself. `hasRole()` returns true, `RequireRole` admits the user, every button renders, and every list comes back empty. The person sees a working app that does nothing, with no explanation anywhere.

That fallback was a migration-0020 rollout requirement, and every token predating 0021 expired months ago. It is dead in the good case and harmful in the new one.

**Files:**
- Modify: `app/src/context/AuthContext.js`

**Interfaces:**
- Consumes: the `must_change_password` claim from Task 2.
- Produces: `user.mustChangePassword: boolean`; `user.isSuperuser` now requires the `admin` role as well as the flag; `signIn(email, password, remember)` returning `{ user, roles, role, mustChangePassword }`. Tasks 4, 6 and 8 read these names.

- [x] **Step 1: Observe the wrong behaviour** — *done during Task 4, see note below*

With `must_change_password = true` on your test account (set as `postgres`), sign out and in with `npm run dev` running.

Expected today: you land on your role's dashboard as though nothing happened, because `profile.roles` refilled the set, and every list is empty. That is the bug.

- [x] **Step 2: Replace the role resolution in `resolve()`**

In `app/src/context/AuthContext.js`, replace the `resolvedRoles` block and the `setUser` call:

```js
        /**
         * The roles this account holds — CLAIMS ONLY.
         *
         * There is no fallback to profile.roles any more, and its absence is
         * load-bearing. users_select lets an account read its own row, so a
         * flagged or inactive account would read its real roles straight back
         * out of the profile and hand them to hasRole() — the client mirror of
         * the array_agg trap migration 0026 exists to close. The database would
         * still deny every query, so nothing is granted; what you get instead is
         * a complete app in which nothing works and nothing says why.
         *
         * The user_role leg stays. It costs nothing, it is what a token minted
         * before migration 0020 carries, and 0026 withholds both claims
         * together — so it cannot reopen the withholding.
         */
        const resolvedRoles =
          claims.user_roles ?? (claims.user_role ? [claims.user_role] : []);

        setUser({
          uid: session.user.id,
          email: session.user.email,
          name: profile.name || session.user.email,
          phone: profile.phone || "",
          roles: resolvedRoles,
          // The highest role held. Landing page and display only — never a
          // permission decision. Those ask hasRole()/hasAnyRole(), because
          // authorization is the union of every role held.
          role: highestRole(resolvedRoles),
          departmentId: claims.department_id || profile.department_id || null,
          plantIds: claims.plant_ids || profile.plant_ids || [],
          /**
           * A Superuser is 'admin' plus is_protected (migration 0015), so the
           * role half must be held for the flag to mean anything — which is
           * exactly what si_is_superuser() computes, since si_has_role('admin')
           * is false once 0026 has withheld the roles. Without the conjunction a
           * flagged Superuser would be offered every Superuser-only control on a
           * token the database grants nothing to.
           */
          isSuperuser: claims.is_protected === true && resolvedRoles.includes("admin"),
          /**
           * This account was given its password by somebody else. It is WHY the
           * roles above are empty, and it is what /change-password routes on.
           */
          mustChangePassword: claims.must_change_password === true,
        });
```

- [x] **Step 3: Return the same two facts from `signIn`**

Replace the tail of `signIn` (it still takes an email here; Task 8 widens it to an identifier):

```js
    const signInClaims = claimsFromSession(data.session);
    const roles =
      signInClaims.user_roles ?? (signInClaims.user_role ? [signInClaims.user_role] : []);
    return {
      user: data.user,
      roles,
      role: highestRole(roles),
      // Why `roles` can be empty even though the credentials were right. The
      // login page needs the distinction: one is a routing decision, the other
      // is a misconfiguration to report.
      mustChangePassword: signInClaims.must_change_password === true,
    };
```

- [x] **Step 4: Update the module docstring**

The header lists the `user` shape. Replace that bullet and add the reason the fallback is gone:

```js
 *  - Exposing a single `user` shape every component in this module reads:
 *      { uid, email, name, phone, roles, role, departmentId, plantIds,
 *        isSuperuser, mustChangePassword }
 *
 * `roles` comes from the token's claims and from nowhere else. An account that
 * is inactive or owes a password change is issued a token with no role claims
 * at all (migration 0026), and reading its own users row to fill the gap would
 * undo that — see the comment on resolvedRoles.
```

- [x] **Step 5: Re-run the step 1 observation** — *done during Task 4, see note below*

Sign out and in with the flag still true.

Expected: you are *not* on a dashboard. `RequireRole` computes `permitted` false and redirects to `dashboardPathForRole(null)`, which is `/login` — so you land back on the sign-in screen holding a live session. Ugly, and Task 4 fixes it. What matters here is that the claims are right; check in the console:

Decode the token as the verification model shows, and check `user_roles` is
absent and `must_change_password` is true.

- [x] **Step 6: Confirm the normal case is untouched**

Set the flag back to false, sign out and in.

Expected: your own dashboard, all lists populated, and every admin control that was there before still there — in particular, confirm the Superuser still sees Admin → Settings → Permissions, which is the one screen gated on `isSuperuser` and therefore the one the step 2 conjunction could have broken.

- [x] **Step 7: Compile and commit**

```bash
cd app && npm run build
git add app/src/context/AuthContext.js
git commit -m "Auth: roles come from claims only, and carry the password-change flag"
```

---

#### Steps 1 and 5 — deferred, then done during Task 4 (executed 2026-08-19)

**Outcome, recorded during Task 4:** with the flag set and the fix in place, the
account did *not* land on a dashboard. It stayed on the page it asked for and
rendered "0 of 0 work orders" above a full filter bar and an Export button, with
nothing anywhere explaining why — `roles` was `[]`, so the Task 3 fix was working
and the app had simply nothing to say about it. That screen is what Task 4
replaces, and it is a better argument for the redirect than the plan's own
prediction of a bounce to `/login`.

Both needed a signed-in session for an account that can actually be flagged, and
`si_guard_protected_user` refuses every write to the protected Superuser's row —
so the account we were signed in as could not be put into the failing state. Task
4 needs exactly that same setup to test the redirect, so one sign-in as the demo
Requester covers both, and doing it twice would prove nothing extra.

The defect itself is not taken on trust. It was measured in Task 2: on a token
carrying no role claims, selecting `roles` from `users` returned `["requester"]`
for the account's own row — precisely what the removed fallback read.

What **was** verified here, as the protected Superuser: the normal path is
untouched. Admin → Settings → Permissions renders with its toggle grid, which is
the one screen gated on `isSuperuser` and therefore the thing the new
`&& roles.includes('admin')` conjunction could have broken. `role_permissions`
still accepts a write. Build clean.

One incidental finding worth carrying. Mid-task the app bounced to `/login` with a
valid, unexpired token still in storage — which looked exactly like the edit having
broken `resolve()`. It was `ERR_NAME_NOT_RESOLVED`, a transient DNS failure, with
the dev server compiling fine throughout. **A network blip and a broken
`AuthContext` present identically.** Read the console before believing the latter.
It did also show the failure path leading to the login screen rather than into a
half-rendered app, which is the right direction.

### Task 4: `/change-password` — the one page a flagged account can use

**Files:**
- Create: `app/src/app/change-password/page.jsx`
- Modify: `app/src/components/RequireAuth.jsx`

**Interfaces:**
- Consumes: `user.mustChangePassword` from Task 3; `supabase.auth.updateUser`; `highestRole` and `dashboardPathForRole` from `lib/roles.js`; `describeError` from `lib/errors.js`; `Field` / `inputClass` from `components/ui/Field`; `ErrorBanner` from `components/ui/Surfaces`; `Button` from `components/ui/Button`. **Check the exact import shapes against `src/app/reset-password/page.jsx` before writing** — it is the closest existing page and its imports are known-good.
- Produces: the route `/change-password/` (trailing slash, because `trailingSlash: true`), and a redirect to it from every `RequireAuth` page while the flag is set.

- [x] **Step 1: State the failing observation**

With the flag true, signing in leaves you bouncing to `/login` holding a live session and no explanation. `/change-password/` 404s.

- [x] **Step 2: Write the page**

Create `app/src/app/change-password/page.jsx`:

```jsx
"use client";

/**
 * SI — Service Inside · Authentication Module
 *
 * Change your own password. Two audiences, one form:
 *
 *   - an account whose password was issued by somebody else
 *     (users.must_change_password), which is sent here and can reach nothing
 *     else until it obliges;
 *   - anyone who simply wants to change their password.
 *
 * IT MUST NOT SIT BEHIND RequireRole. A flagged account is issued a token with
 * no role claims (migration 0026), so every role gate rejects it — including a
 * gate on the one page it has to reach, which would lock it out of the only
 * action available to it. A signed-in check is the whole requirement.
 *
 * Its own profile still reads: users_select permits `id = auth.uid()`
 * independently of any role, so the name and address render normally.
 *
 * The redirect here is a courtesy, not the enforcement. The enforcement is that
 * the token carries no roles, so the rest of the app is empty regardless —
 * getting past the redirect gains nothing.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, KeyRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { dashboardPathForRole, highestRole } from "../../lib/roles";
import { describeError } from "../../lib/errors";
import RequireAuth from "../../components/RequireAuth";
import Field, { inputClass } from "../../components/ui/Field";
import { ErrorBanner } from "../../components/ui/Surfaces";
import Button from "../../components/ui/Button";

const MIN_PASSWORD_LENGTH = 8;

/** The claims of a session token. Same decode as AuthContext's. */
function claimsOf(session) {
  const token = session?.access_token;
  if (!token) return {};
  try {
    return JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
  } catch {
    return {};
  }
}

function ChangePasswordForm() {
  const { user } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const forced = user?.mustChangePassword === true;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;

      /**
       * si_sync_auth_user_activity has just cleared must_change_password, but
       * the token in hand was minted before that write — claims only change when
       * a token is issued. refreshSession mints a new one now, so the roles come
       * back immediately instead of at the next hourly refresh, and
       * onAuthStateChange hands AuthContext the new claims on the way past.
       */
      const { data: fresh, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      const claims = claimsOf(fresh?.session);
      const roles = claims.user_roles ?? (claims.user_role ? [claims.user_role] : []);
      router.replace(dashboardPathForRole(highestRole(roles)));
    } catch (e) {
      setError(describeError(e, "Couldn't change your password."));
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-1 flex items-center gap-2 text-xl font-bold text-ink">
        <KeyRound size={18} /> Change your password
      </h1>
      <p className="mb-5 text-[13px] text-ink-soft">
        {forced
          ? "This password was set for you by an administrator. Choose your own before you can use the rest of the app."
          : "Choose a new password for your account."}
      </p>

      {error && <ErrorBanner message={error} />}

      <form onSubmit={submit}>
        <Field label="New password" required>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            required
          />
        </Field>
        <Field label="Confirm new password" required>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
            autoComplete="new-password"
            required
          />
        </Field>
        <p className="mb-4 text-[12px] text-ink-soft">
          At least {MIN_PASSWORD_LENGTH} characters. Nobody else can see it, your administrator
          included — if you forget it, it has to be reset.
        </p>
        <Button type="submit" icon={busy ? Loader2 : Check} disabled={busy}>
          {busy ? "Saving…" : "Change password"}
        </Button>
      </form>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <RequireAuth>
      <ChangePasswordForm />
    </RequireAuth>
  );
}
```

- [x] **Step 3: Send a flagged account here from anywhere**

`RequireAuth` wraps every protected page, which makes it the one place this belongs. In `app/src/components/RequireAuth.jsx`, add to the existing effect:

```jsx
export default function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const onChangePassword = (pathname || "").startsWith("/change-password");

  useEffect(() => {
    if (!loading && !user) {
      const search = typeof window !== "undefined" ? window.location.search : "";
      const target = `${pathname || "/"}${search}`;
      router.replace(`/login?next=${encodeURIComponent(target)}`);
      return;
    }
    /**
     * A password issued by somebody else buys access to exactly one page.
     *
     * The exclusion is what stops this being a loop: /change-password is itself
     * wrapped in RequireAuth, which is the point — that page needs a session
     * and nothing more, and a role gate would reject the very account it exists
     * for.
     */
    if (!loading && user?.mustChangePassword && !onChangePassword) {
      router.replace("/change-password/");
    }
  }, [loading, user, pathname, router, onChangePassword]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-ink-soft text-[13.5px]">
        Loading…
      </div>
    );
  }
  if (!user) return null;

  return <AppShell>{children}</AppShell>;
}
```

- [x] **Step 4: Verify the forced path end to end**

Set the flag as `postgres` on your test account, sign out, sign in.

Expected: you land on `/change-password/` with the "set for you by an administrator" copy. Navigate to `/work-orders/` — you come straight back. The AppShell renders (the page is inside `RequireAuth`) and its lists are empty, because the database grants nothing.

- [x] **Step 5: Verify the change clears it without a sign-out**

Set a new password in the form.

Expected: redirected to your role's dashboard with lists populated. Then confirm in SQL:

```sql
select email, must_change_password, password_changed_at from public.users where email = '<that account>';
```

`must_change_password` false and `password_changed_at` just now. That is Task 1's trigger statement firing, and it is also the proof the `si_protected_override()` door works — the write landed on your own row while you were signed in, which the self branch of the guard otherwise forbids.

- [x] **Step 6: Verify the voluntary path**

With the flag false, navigate to `/change-password/` directly.

Expected: the same form with the "Choose a new password" copy, no redirect, and a successful change lands you back on your dashboard.

- [x] **Step 7: Compile and commit**

```bash
cd app && npm run build
git add app/src/app/change-password/page.jsx app/src/components/RequireAuth.jsx
git commit -m "Add /change-password, and route a flagged account to it"
```

---

#### What Task 4 was verified against (executed 2026-08-19)

| Check | Result |
|---|---|
| `/work-orders/`, `/dashboard/`, `/admin/users/`, `/notifications/` while flagged | all → `/change-password/` |
| `/change-password/` itself, sampled repeatedly | stable, no loop |
| `/admin/users/` specifically | redirects — `RequireAuth` is the outer wrapper, so the flag check takes precedence over the inner role gate rather than racing it |
| Profile self-read on a roleless token | "Ravi Kumar" renders; role badge `—` |
| Nav while flagged | one item, "Change password" |
| Password changed in the form | `must_change_password` false, `password_changed_at` stamped, token re-minted with `user_roles ["requester"]`, landed on the Requester dashboard, **no sign-out** |
| `password_changed_at` vs new token `iat` | same second — the ordering holds |
| Voluntary path, flag clear | `/change-password/` reachable, "Choose a new password" copy, full nav, no redirect |
| Build | clean; `/change-password` present in the static export |

Two additions beyond the plan, both following from the page's claim to be the one
page a flagged account can use:

- **The home links pointed at `/login`.** `dashboardPathForRole(null)` returns
  that for a roleless account, and `/login` is not behind `RequireAuth` — so the
  logo and "Dashboard" would have dropped a flagged user on the sign-in form
  while their session was live, indistinguishable from being signed out. `AppShell`
  now routes all three through one `homeHref`.
- **The nav offered links that bounced.** Work Orders and Notifications rendered
  and threw you straight back, which is the same "nothing works and nothing says
  why" the redirect exists to remove.

Also note for Task 5: `npm run bootstrap:users` does **not** reset an existing
account's password — `password` is only passed on the create branch. Restoring a
demo account's seeded password means Admin → Users → Password as the Superuser.

### Task 5: `admin-users` — Superuser-only passwords, recovery links, locked addresses

**Files:**
- Modify: `app/supabase/functions/admin-users/index.ts`

**Interfaces:**
- Consumes: `callerRow.is_protected` (already selected); `rankOfAccount()`; `si_is_placeholder_email(text)` (migration 0012, EXECUTE granted to `service_role`).
- Produces:
  - `set_password { user_id, password }` — requires the caller `is_protected`; writes the password, **then** `must_change_password = true` unless the target is the caller.
  - `send_recovery_link { user_id }` — active admin, target strictly below the caller's rank, refuses a placeholder address.
  - `set_email { user_id, email }` — target is the caller, or the caller is `is_protected`.
  - `create_user { …, employee_id }` — optional, trimmed, uniqueness from the index.

- [ ] **Step 1: Set the new secret, and record the failing observations** — *SITE_URL still unset; the deployed origin is not recorded anywhere in the repo*

`send_recovery_link` needs an absolute redirect. `window.location.origin` is wrong for the same reason it is wrong in `AuthContext` — Capacitor serves the export from `https://localhost` — and an Edge Function has no window at all. Set a function secret to the deployed web origin:

Dashboard → Edge Functions → Secrets, or:

```bash
cd app && npx supabase secrets set SITE_URL=https://<the deployed origin>
```

Then, signed in as an **Administrator** (not the Superuser), record what is wrong today: the **Password** button is offered on a subordinate's row and works; **Edit** lets you change a subordinate's sign-in address; there is no way to send anyone a reset link.

- [x] **Step 2: Restrict `set_password`, and set the flag after it**

Replace the whole `if (action === "set_password") { … }` block:

```ts
  /* ---------------------------------------------------------------
     set_password — SUPERUSER ONLY.

     The rank rule is not enough here, and this is the decision the whole
     sub-project turns on: an Administrator who can set a subordinate's password
     holds that person's credential. Restricting it to the account that is
     administered only from Supabase means nobody in the app ever does.

     The cost is accepted knowingly: an account with no working mailbox and a
     forgotten password waits for the Superuser, night shift included. For
     everyone with a real address, send_recovery_link below is the answer.
  ----------------------------------------------------------------*/
  if (action === "set_password") {
    const userId = String(payload.user_id ?? "");
    const password = String(payload.password ?? "");

    if (!userId) return json({ error: "Which user?" }, 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` }, 400);
    }

    // Your own password needs no Superuser. That is /change-password, and this
    // branch keeps working for it.
    const isSelf = userId === caller.user.id;
    if (!isSelf && !callerRow.is_protected) {
      return json(
        {
          error:
            "Only the protected Superuser account can set someone else's password. " +
            "Use “Send reset link” instead, so they choose their own.",
        },
        403,
      );
    }

    if (!isSelf) {
      const { data: targetRow, error: targetError } = await admin
        .from("users")
        .select("roles, is_protected, name")
        .eq("id", userId)
        .maybeSingle();

      if (targetError) return json({ error: "Couldn't verify that account." }, 500);
      if (!targetRow) return json({ error: "No such user." }, 404);
      if (targetRow.is_protected) {
        return json(
          { error: "This account is protected. It can only be changed from the database." },
          403,
        );
      }
      // Kept although only a Superuser reaches here, and a Superuser outranks
      // everybody, so it cannot fire today. It is the line that keeps the rule
      // true if the check above is ever widened.
      if (rankOfAccount(targetRow) >= rankOfAccount(callerRow)) {
        return json(
          { error: "You can only set the password of someone below you in the hierarchy." },
          403,
        );
      }
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: error.message }, 400);

    /* THE FLAG GOES AFTER THE PASSWORD. NOT BEFORE.

       Writing a password IS a password change, so si_sync_auth_user_activity
       fires and clears must_change_password. Set it first and the trigger wipes
       it: the account gets a temporary password and no obligation to change it,
       with nothing anywhere reporting a problem. See migration 0025 §3. */
    if (!isSelf) {
      const { error: flagError } = await admin
        .from("users")
        .update({ must_change_password: true })
        .eq("id", userId);

      if (flagError) {
        // Reported, not swallowed. A password changed without the obligation
        // attached is the one outcome an administrator must not be allowed to
        // believe went fine.
        return json({
          ok: true,
          message:
            `Password updated, but this account was NOT marked as needing to change it: ` +
            `${flagError.message}. Set users.must_change_password = true by hand.`,
        });
      }
      return json({
        ok: true,
        message: "Temporary password set. They must change it the first time they sign in.",
      });
    }

    return json({ ok: true, message: "Password updated." });
  }
```

- [x] **Step 3: Add `send_recovery_link`**

Insert immediately after the `set_password` block:

```ts
  /* ---------------------------------------------------------------
     send_recovery_link — how an administrator helps someone who is locked out.
     Supabase emails them a link and they set their own password, so no
     administrator ever holds a credential belonging to somebody else.

     Sent through an ANON client on purpose. resetPasswordForEmail is a public
     endpoint — /forgot-password already calls it from the browser with any
     address you like — so routing it through here grants nothing new. What this
     function adds is the part the public endpoint cannot: the rank check, a
     refusal on an address that cannot receive mail, and a definite answer to the
     administrator about which of those happened.
  ----------------------------------------------------------------*/
  if (action === "send_recovery_link") {
    const userId = String(payload.user_id ?? "");
    if (!userId) return json({ error: "Which user?" }, 400);

    const SITE_URL = Deno.env.get("SITE_URL") ?? "";
    if (!SITE_URL) {
      return json(
        {
          error:
            "SITE_URL is not set on this function, so the reset link would point nowhere. " +
            "Set it in Edge Functions → Secrets to the deployed web address.",
        },
        500,
      );
    }

    const { data: targetRow, error: targetError } = await admin
      .from("users")
      .select("email, name, roles, is_protected")
      .eq("id", userId)
      .maybeSingle();

    if (targetError) return json({ error: "Couldn't verify that account." }, 500);
    if (!targetRow) return json({ error: "No such user." }, 404);
    if (targetRow.is_protected) {
      return json(
        { error: "This account is protected. It can only be changed from the database." },
        403,
      );
    }
    if (userId !== caller.user.id && rankOfAccount(targetRow) >= rankOfAccount(callerRow)) {
      return json(
        { error: "You can only send a reset link to someone below you in the hierarchy." },
        403,
      );
    }

    /* LOUDLY, not silently. resetPasswordForEmail succeeds against
       tech.arun@example.com and delivers nothing, and an administrator who is
       told it worked believes the person has been helped. That is the worst
       available outcome, so it is the one refusal spelled out in full. */
    const { data: isPlaceholder, error: placeholderError } = await admin.rpc(
      "si_is_placeholder_email",
      { p_email: targetRow.email },
    );

    if (placeholderError) return json({ error: "Couldn't check that address." }, 500);
    if (isPlaceholder === true) {
      return json(
        {
          error:
            `${targetRow.email} is a placeholder address — nothing is delivered to it, so a ` +
            `reset link would silently go nowhere. Give this account a real address first ` +
            `(Edit → Email), or ask the Superuser to set a temporary password.`,
        },
        400,
      );
    }

    // trailingSlash: true in next.config.js, and Supabase matches its redirect
    // allow-list on the exact URL — /reset-password without the slash is a
    // redirect and will not match.
    const redirectTo = `${SITE_URL.replace(/\/+$/, "")}/reset-password/`;

    const anon = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: sendError } = await anon.auth.resetPasswordForEmail(targetRow.email, {
      redirectTo,
    });
    if (sendError) return json({ error: sendError.message }, 400);

    return json({
      ok: true,
      message: `Reset link sent to ${targetRow.email}. It expires — tell them to use it now.`,
    });
  }
```

- [x] **Step 4: Lock other people's addresses to the Superuser**

Inside the `set_email` block's `if (userId !== caller.user.id) { … }`, keep the `is_protected` refusal and replace the rank check with:

```ts
      /* Superuser-only, matching set_password, because the two are the same
         privilege wearing different clothes: repoint a subordinate's sign-in
         address at a mailbox you control, run the public self-service reset, and
         you have their password without ever calling set_password. Leaving the
         rank rule here would have left that bypass wide open beside a
         Superuser-only set_password. Your own address stays yours to change —
         that is not an escalation. */
      if (!callerRow.is_protected) {
        return json(
          {
            error:
              "Only the protected Superuser account can change someone else's sign-in address. " +
              "You can change your own.",
          },
          403,
        );
      }
      if (rankOfAccount(targetRow) >= rankOfAccount(callerRow)) {
        return json(
          { error: "You can only change the email address of someone below you in the hierarchy." },
          403,
        );
      }
```

- [x] **Step 5: Accept `employee_id` on `create_user`**

Beside the other payload reads:

```ts
    // Trimmed only. The unique index normalises with upper(btrim(...)), so it is
    // the index — not this line — that decides two numbers are the same, and
    // storing what the administrator typed keeps the display honest.
    const employeeIdRaw = payload.employee_id ? String(payload.employee_id).trim() : "";
    const employeeId = employeeIdRaw || null;
```

Add **two** fields to the `admin.from("users").insert({ … })` object:

```ts
      employee_id: employeeId,
      /* A new account's password was chosen by the administrator creating it, so
         it is owed a change for exactly the reason a reset one is. The spec's §5
         table lists only set_password; creating an account is issuing a
         credential somebody else knows, and leaving it unflagged would mean every
         account provisioned through this screen keeps an admin-known password
         indefinitely — the requirement this sub-project exists to satisfy,
         missed on the most common path to a new account.

         Safe in the insert, unlike set_password's separate write:
         si_sync_auth_user_activity is an UPDATE trigger on auth.users, and
         createUser INSERTs there. Nothing fires, so nothing clears it. */
      must_change_password: true,
```

And say so in the success message, which currently promises only that they can
sign in:

```ts
    return json({
      ok: true,
      user_id: created.user.id,
      message: `${name} can now sign in with that password, and must change it the first time.`,
    });
```

Then name the collision in the existing rollback branch:

```ts
    if (profileError) {
      // Roll the auth account back rather than leaving an account that can sign
      // in but has no roles and therefore no access to anything.
      await admin.auth.admin.deleteUser(created.user.id);
      const hint = /users_employee_id_key/.test(profileError.message)
        ? ` Employee ID "${employeeIdRaw}" is already used by another account.`
        : "";
      return json({ error: `Couldn't create the profile: ${profileError.message}.${hint}` }, 400);
    }
```

- [x] **Step 6: Update the function's header docstring**

The header enumerates what the function does and why. Replace the "Why this exists at all" list's coverage of these actions:

```ts
 *   - set_password       -> SUPERUSER ONLY. An administrator who can set a
 *                           subordinate's password holds their credential.
 *   - set_email          -> your own, or SUPERUSER ONLY. Paired with the above
 *                           deliberately: an address you can repoint at a
 *                           mailbox you control, plus the public self-service
 *                           reset, IS a password reset.
 *   - send_recovery_link -> any active admin, target strictly below their rank.
 *                           What an administrator uses instead. Refuses a
 *                           placeholder address loudly, because succeeding and
 *                           delivering nothing is the worst outcome available.
```

- [ ] **Step 7: Deploy, then test each rule** — *deployed; 5 of 6 rows tested — only the recovery-link send is left, blocked on SITE_URL*

```bash
cd app && npx supabase functions deploy admin-users
```

The UI for these lands in Task 6, so call them from the browser console meanwhile:

```js
// Same token as the verification model's helper reads.
await fetch(`${SUPABASE_URL}/functions/v1/admin-users`, {
  method: "POST",
  headers: {
    apikey: ANON_KEY,
    Authorization: `Bearer ${tok}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    action: "set_password",
    user_id: "<uuid>",
    password: "<a temp password you choose>",
  }),
}).then((r) => r.json());
```

| As | Action | Expected |
|---|---|---|
| Administrator | `set_password` on a subordinate | 403 naming the Superuser and pointing at Send reset link |
| Administrator | `set_email` on a subordinate | 403 "Only the protected Superuser account can change someone else's sign-in address." |
| Administrator | `set_email` on themselves | succeeds |
| Administrator | `send_recovery_link` on a placeholder-address account | 400 naming the address and both alternatives |
| Administrator | `send_recovery_link` on a real address below them | succeeds; the mail arrives |
| Superuser | `set_password` on a subordinate | succeeds; message says they must change it |
| Administrator | `create_user` with a password they chose | account created **and** `must_change_password` true in the database |

- [x] **Step 8: Prove the ordering trap is closed — this is the whole test**

After the Superuser's successful `set_password`:

```sql
select email, must_change_password, password_changed_at from public.users where id = '<uuid>';
```

Expected: `must_change_password` **true**. If it is false, the flag was written before the password and the trigger cleared it — re-read step 2.

- [x] **Step 9: Commit**

```bash
git add app/supabase/functions/admin-users/index.ts
git commit -m "admin-users: passwords and others' addresses are Superuser-only; add send_recovery_link"
```

---

#### What Task 5 was verified against (executed 2026-08-19)

**A hole found while working out how to test this, not by looking for it.** 0026
enforces `must_change_password` by withholding role claims, which covers every
RLS policy and `si_set_user_roles` (it reads `si_roles()`). This function is the
deliberate exception — it re-reads roles from the *database* so a stale token
cannot be used — and that walked straight past the withholding. An Administrator
holding a password somebody else had just chosen could set other people's
passwords before changing their own. `status` was already checked here; the new
flag was not. Three enforcement points, and the loosest wins.

As a **flagged** Administrator (holds `admin`, `status=active`, so the old code
would have allowed all four):

| Call | Result |
|---|---|
| `set_password` | 403 "Change your own password first…" |
| `set_email` | 403 same |
| `create_user` | 403 same |
| `send_recovery_link` | 403 same |
| Side effects | **none** — no address changed, no account created, no stray `auth.users` row |

As an **ordinary** Administrator (unflagged, active, not protected):

| Call | Result |
|---|---|
| `set_password` on someone else | 403 "Only the protected Superuser account can set someone else's password." |
| `set_email` on someone else | 403 "Only the protected Superuser account can change someone else's sign-in address." |
| `set_email` on **self** | 200 — self is still allowed, so the lock is not overreach |
| `create_user` granting `admin` | 403 "…it is at or above your own rank." Nothing created. |
| `send_recovery_link` | 500 SITE_URL not set — the configuration guard fires |
| Stray rows | none |

**The ordering trap (step 8), through the real UI as the Superuser:** Admin →
Users → Password on a demo technician. `must_change_password` read **true** 27
seconds after `password_changed_at` — the flag survived the trigger, so the write
order is right.

That needed testing separately from `create_user`'s flagging even though both set
the same column. `create_user` sets it *inside its INSERT*, which is safe
structurally because `si_sync_auth_user_activity` only fires on UPDATE of
`auth.users`. `set_password` writes it in a separate UPDATE *after* the password,
which is the one path ordering can defeat: reversed, the trigger clears it and the
account gets an administrator-chosen password with no obligation attached, and
nothing anywhere reports a problem.

**Still not verified:** a recovery link actually sending, and the
placeholder-address refusal — which sits after the SITE_URL check, so the secret
blocks both. Everything else in this task is tested.

**Note on running step 8:** the tester cannot supply the password. It goes through
Admin → Users → Password with a human choosing it, which is the more realistic
path anyway. Afterwards the target is flagged and confined to
`/change-password`; clearing the flag with the service role leaves the account
usable without anyone having to change the password again.

#### How these were run, and why it matters for the rest of the plan

`javascript_tool` executes in an isolated world whose **cross-origin requests are
blocked here**, so console-driven `fetch` to Supabase fails while the app's own
requests succeed — the giveaway is the sidebar rendering the account's *name*,
which only a successful `public.users` read can produce. Diagnosing that as a
network outage wastes time; there is also a genuine, separate DNS fault in this
browser where that one Supabase hostname fails to resolve while `example.com` and
Node both succeed.

The workaround, which the remaining tasks should reuse: a small Node listener on
`127.0.0.1:8787`, the page POSTs its access token to it, and **Node** makes the
Supabase calls. Keeps the bearer token off the wire and out of any transcript, and
sidesteps both faults. Two traps in writing one: a script under the scratchpad
cannot `require("@supabase/supabase-js")` — Node resolves from the script's own
directory upward — so reach the project's `scripts/_supabaseAdmin.js` by absolute
path instead; and `.env.local` values are quoted, so strip the quotes or the URL
fails to parse.

### Task 6: The admin client — predicates, data layer, and the Users screen

**Files:**
- Modify: `app/src/lib/constants.js`
- Modify: `app/src/lib/admin.js`
- Modify: `app/src/components/admin/UsersAdmin.jsx`

**Interfaces:**
- Consumes: the four actions from Task 5; `si_dummy_flags` (already in `USER_SELECT`), whose `placeholder_email` code is the client mirror of the function's refusal.
- Produces: `canSetUserPassword(target, me)`, `canSendRecoveryLink(target, me)`, `canChangeUserEmail(target, me)` in `constants.js`; `sendRecoveryLink(userId)` in `admin.js`; `employee_id` readable, searchable and writable.

- [x] **Step 1: State the failing observation**

Signed in as an Administrator, Admin → Users still shows a **Password** button on every editable row, and clicking it now fails with Task 5's 403. A predicate that offers a control the server refuses is exactly the mismatch CLAUDE.md forbids. There is no employee ID anywhere, and no way to send a reset link.

- [x] **Step 2: Rewrite the three predicates**

In `app/src/lib/constants.js`, replace `canSetUserPassword` and `canChangeUserEmail`, and add the new one between them:

```js
/**
 * Setting somebody else's password is Superuser-only, so no Administrator ever
 * holds a credential belonging to another person. Your own is not: that is
 * /change-password, and the Edge Function allows the self case.
 *
 * `isSuperuser` is true only when the account both carries is_protected and
 * holds 'admin' (see AuthContext) — the same conjunction si_is_superuser()
 * computes, so a flagged Superuser is offered nothing its token can do.
 */
export function canSetUserPassword(target, me) {
  if (!me || !target) return false;
  if (target.id === me.uid) return true;
  return me.isSuperuser === true && canEditUser(target, me);
}

/**
 * What an Administrator uses instead: Supabase emails the person a link and they
 * choose their own password. Ordinary rank rule, because nothing about it puts a
 * credential in the sender's hands.
 *
 * A placeholder address is excluded here as well as refused server-side. The
 * refusal is the boundary; this only avoids offering a button whose one possible
 * outcome is that refusal.
 */
export function canSendRecoveryLink(target, me) {
  if (!canEditUser(target, me)) return false;
  return !(target.si_dummy_flags ?? []).includes("placeholder_email");
}

/**
 * Paired with canSetUserPassword, and it has to be: an address you can repoint
 * at a mailbox you control, plus the public self-service reset, IS a password
 * reset. Leaving this on the rank rule beside a Superuser-only password would
 * have left the bypass open. Your own stays yours — changing your own address is
 * not an escalation.
 */
export function canChangeUserEmail(target, me) {
  if (!me || !target) return false;
  if (target.id === me.uid) return canEditUser(target, me);
  return me.isSuperuser === true && canEditUser(target, me);
}
```

- [x] **Step 3: Extend the data layer**

In `app/src/lib/admin.js`:

```js
const USER_SELECT =
  "id, name, email, phone, employee_id, must_change_password, roles, department_id, " +
  "plant_ids, status, created_at, last_login_at, is_protected, seed_source, " +
  "password_changed_at, si_dummy_flags";
```

Add beside the other Edge Function calls:

```js
/**
 * Email someone a password-recovery link.
 *
 * Not `supabase.auth.resetPasswordForEmail` from here, even though that would
 * work and is what /forgot-password does. The function adds the three things
 * this screen needs and the public endpoint cannot give: the rank check, a
 * refusal on an address that cannot receive mail, and a message saying which of
 * those happened. A silent success on a placeholder address is the failure this
 * exists to prevent.
 */
export async function sendRecoveryLink(userId) {
  return invokeAdminFunction({ action: "send_recovery_link", user_id: userId });
}
```

Widen the two writes:

```js
/** Edit the display fields on someone else's profile. */
export async function updateUserProfile(userId, { name, phone, employeeId }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (phone !== undefined) patch.phone = phone;
  // An empty string is a deliberate clear, so `undefined` is the only skip. The
  // column is nullable and the unique index is partial, so null is how an
  // account has no number — rather than an empty string competing with others.
  if (employeeId !== undefined) patch.employee_id = employeeId?.trim() ? employeeId.trim() : null;
  if (Object.keys(patch).length === 0) return;
  const { error } = await supabase.from("users").update(patch).eq("id", userId);
  if (error) throw error;
}

export async function createUser({
  email, password, name, roles, departmentId, plantIds, phone, employeeId,
}) {
  return invokeAdminFunction({
    action: "create_user",
    email,
    password,
    name,
    roles,
    department_id: departmentId || null,
    plant_ids: plantIds || [],
    phone: phone || "",
    employee_id: employeeId?.trim() || null,
  });
}
```

- [x] **Step 4: Update `UserActions` in `UsersAdmin.jsx`**

Add `canSetUserPassword` and `canSendRecoveryLink` to the `constants` import, `sendRecoveryLink` to the `admin` import, and `Mail` to the lucide-react import. Then in `UserActions`, above the return:

```jsx
  const maySetPassword = canSetUserPassword(user, me);
  const maySendLink = canSendRecoveryLink(user, me);
  const placeholderEmail = (user.si_dummy_flags ?? []).includes("placeholder_email");
```

Replace the unconditional Password button with:

```jsx
      {maySetPassword && (
        <Button
          size="sm"
          variant="ghost"
          icon={KeyRound}
          title="Set a temporary password. They must change it the first time they sign in."
          onClick={() => setPanel({ kind: "password", user })}
        >
          Password
        </Button>
      )}
      {maySendLink && (
        <Button
          size="sm"
          variant="ghost"
          icon={Mail}
          title={`Email ${user.email} a link to set their own password`}
          onClick={() => onSendRecoveryLink(user)}
        >
          Send reset link
        </Button>
      )}
      {/* Neither is available, and the reason is worth saying out loud: the
          address cannot receive mail, and that is fixable through Edit. */}
      {!maySetPassword && !maySendLink && placeholderEmail && (
        <span className="text-[11.5px] text-ink-soft">
          No real email address — ask the Superuser for a temporary password
        </span>
      )}
```

Add `onSendRecoveryLink` to `UserActions`' props, thread it through **both** call sites — the desktop row and the mobile card — exactly as `onToggleStatus` already is, and add the handler beside the others in the component body:

```jsx
  async function handleSendRecoveryLink(u) {
    setError(null);
    try {
      const res = await sendRecoveryLink(u.id);
      flash(res?.message || `Reset link sent to ${u.email}.`);
    } catch (e) {
      setError(describeError(e, "Couldn't send that reset link."));
    }
  }
```

- [x] **Step 5: Show, search and edit the employee ID**

In `filtered`, add the number to the search — an administrator holding a badge is the reason the column exists:

```jsx
      return (
        u.name?.toLowerCase().includes(needle) ||
        u.email?.toLowerCase().includes(needle) ||
        u.employee_id?.toLowerCase().includes(needle) ||
        u.department_id?.toLowerCase().includes(needle)
      );
```

In the desktop row and the mobile card, replace the email line with:

```jsx
              <div className="text-[12px] text-ink-soft truncate">
                {u.email}
                {u.employee_id && <span> · #{u.employee_id}</span>}
              </div>
              {u.must_change_password && (
                <div className="mt-0.5 text-[11.5px] text-[#92400E]">
                  Must change password at next sign-in
                </div>
              )}
```

In `ProfileDialog`, add the state, the field and the write:

```jsx
  const [employeeId, setEmployeeId] = useState(user.employee_id || "");
```

```jsx
        <Field label="Employee ID">
          <input
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={inputClass}
            autoComplete="off"
          />
        </Field>
        <p className="mb-4 text-[12px] text-ink-soft">
          Their existing HR or payroll number. Optional, and it becomes a second way for them
          to sign in — case and spaces do not matter. Leave it blank if they do not have one.
        </p>
```

```jsx
      await updateUserProfile(user.id, {
        name: name.trim(),
        phone: phone.trim(),
        employeeId,
      });
```

Do the same three things in `CreateUserDialog`, passing `employeeId` into its
`createUser({ … })` call, and adjust the note beside its password field to say
what now happens to it:

```jsx
        <p className="mb-4 text-[12px] text-ink-soft">
          A starting password. Pass it on yourself — they will be asked to choose their own
          the first time they sign in, and until they do they can reach nothing else.
        </p>
```

A duplicate number arrives as a unique-violation from Postgres, and `describeError` already surfaces the server's message — **verify** that in step 6 rather than assuming it. If the raw constraint text is filtered into the friendly stand-in instead, add a named case for `users_employee_id_key` in `src/lib/errors.js` saying which number is taken.

- [x] **Step 6: Verify each change in the running app**

| As | Check | Expected |
|---|---|---|
| Administrator | a subordinate's row | no **Password**; **Send reset link** present |
| Administrator | Edit a subordinate | Email disabled with the "own account, or ask the Superuser" note; Employee ID editable |
| Administrator | Edit self | Email editable |
| Administrator | a placeholder-address account | no reset-link button; the "No real email address" line instead |
| Superuser | a subordinate's row | both **Password** and **Send reset link** |
| Administrator | set an employee ID, then search for it | the row is found by number |
| Administrator | set a number another account already holds | a visible error naming the duplicate, not a silent no-op |
| Administrator | a flagged account's row | "Must change password at next sign-in" |
| any | the mobile card layout at a narrow width | the same buttons and lines as the desktop row |

- [x] **Step 7: Compile and commit**

```bash
cd app && npm run build
git add app/src/lib/constants.js app/src/lib/admin.js app/src/components/admin/UsersAdmin.jsx
git commit -m "Admin: employee IDs, reset links, and Superuser-only credential controls"
```

---

#### What Task 6 was verified against (executed 2026-08-19)

As the **Superuser**:

| Check | Result |
|---|---|
| Amirul, real `@pmw-group.com` address | `Password` + `Send reset link` |
| every `@example.com` account | `Password` only — `canSendRecoveryLink` excludes placeholder addresses |
| ID typed `"  e1042 "` | stored `"e1042"` — client trims, index normalises |
| search `"E1042"` | matches only Ravi |
| same number, other case, second account | refused |
| flagged-row marker | renders |
| mobile cards at 375px | employee ID, marker and buttons all present, no horizontal overflow |

As an **ordinary Administrator** (the non-protected test admin) — every row a
different rule:

| Row | Result |
|---|---|
| peer Administrator | "Same rank — not editable here" (0015's rank rule) |
| five subordinates, placeholder addresses | "No real email address — ask the Superuser for a temporary password", plus `Role` and `Edit`. **No `Password`. No `Send reset link`.** |
| self | `Password` and `Edit`, no `Role` — own password is allowed, own role never is |
| the protected Superuser | **absent** — `users_select` hides it, which is also why the count reads 7 here and 8 for the Superuser |
| employee ID | `requester@example.com · #e1042` visible to an ordinary admin |

**One fix the plan only anticipated as a possibility.** The duplicate-ID refusal
first surfaced as "That already exists." — `describeError`'s generic 23505
stand-in — which on a four-field form makes the reader guess which field. So
`describeError` gained a **named-constraint table**, checked before the SQLSTATE
table because a constraint name is more specific than the class of error it
belongs to. `users_employee_id_key` now answers with the field *and* the
normalisation rule. That table is the reusable part; this is its first entry.

**Four pieces of copy were left contradicting the new rules** and are updated:
the password dialog and the create form now say the recipient must replace the
password, the email note explains that only the Superuser can change someone
else's and why, and the search placeholder mentions employee IDs now that it
matches them.

### Task 7: Migration 0027 and the `auth-signin` function

**Files:**
- Create: `app/supabase/migrations/0027_login_attempts.sql`
- Create: `app/supabase/functions/auth-signin/index.ts`
- Create: `app/supabase/config.toml`

**Interfaces:**
- Consumes: `users.employee_id`, `users.email`; `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all injected into Edge Functions automatically).
- Produces: `public.login_attempts` (service-role only); `si_email_by_employee_id(text) returns text` (SECURITY DEFINER, `service_role` only); cron job `si-sweep-login-attempts`; `POST /functions/v1/auth-signin { identifier, password }` → `{ session }` or `{ error: "Those details didn't match." }`.

- [x] **Step 1: Write the failing assertion**

```sql
do $$
begin
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'login_attempts') then
    raise exception 'FAIL: login_attempts missing';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'login_attempts'
                and grantee in ('anon', 'authenticated', 'public')) then
    raise exception 'FAIL: login_attempts is reachable by a client role';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'si_email_by_employee_id') then
    raise exception 'FAIL: si_email_by_employee_id missing';
  end if;
  if has_function_privilege('anon', 'public.si_email_by_employee_id(text)', 'execute') then
    raise exception 'FAIL: si_email_by_employee_id is anon-callable — it is a staff directory';
  end if;
  if not exists (select 1 from cron.job where jobname = 'si-sweep-login-attempts') then
    raise exception 'FAIL: the sweep is not scheduled';
  end if;
  raise notice 'PASS: login_attempts, the lookup, its grants and the sweep';
end $$;
```

- [x] **Step 2: Run it and confirm it fails**

Expected: `ERROR: FAIL: login_attempts missing`.

- [x] **Step 3: Write the migration**

Create `app/supabase/migrations/0027_login_attempts.sql`:

```sql
-- ============================================================================
-- 0027 — Signing in by employee number: the lookup, and the attempt delay
--
-- ---------------------------------------------------------------------------
-- THE LOOKUP
-- ---------------------------------------------------------------------------
-- One definition of "same employee number", shared by the unique index in 0025
-- and by the auth-signin function. Doing this in the function with .ilike()
-- would NOT match: ilike ignores case but not the whitespace the index
-- normalises, and it treats % and _ in user input as wildcards. Two disagreeing
-- notions of sameness, at the one moment sign-in must be unambiguous.
--
-- SECURITY DEFINER and granted to service_role ONLY. Every function in `public`
-- is an anon-callable RPC by default (Postgres grants EXECUTE to PUBLIC,
-- PostgREST publishes it), and this one maps an employee number to an email
-- address: published, it is a staff directory and a credential-stuffing target
-- list, walkable in a loop. Migrations 0007, 0008 and 0011 exist because of that
-- default.
--
-- IT DOES NOT FILTER ON status. See the function's header: filtering here would
-- make an inactive account fail at resolution while a wrong password fails at
-- GoTrue, and the two would become distinguishable. An inactive account
-- authenticates normally and is denied by carrying no roles (0026).
-- ---------------------------------------------------------------------------

create or replace function si_email_by_employee_id(p_employee_id text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email
    from public.users u
   where u.employee_id is not null
     and upper(btrim(u.employee_id)) = upper(btrim(p_employee_id))
   limit 1;
$$;
revoke all     on function si_email_by_employee_id(text) from public, anon, authenticated;
grant  execute on function si_email_by_employee_id(text) to service_role;

-- ---------------------------------------------------------------------------
-- THE ATTEMPT DELAY
-- ---------------------------------------------------------------------------
-- GoTrue throttles by origin. Every employee-ID sign-in reaches it from the
-- auth-signin function's egress address, so its per-IP counter sees one client
-- for the whole plant: it either throttles everybody at once or protects
-- nobody. Adding the function without this makes brute-force protection worse
-- than not having the function at all — a regression disguised as a feature.
--
-- An Edge Function is stateless, so the counter lives here.
--
-- WHY A DELAY AND NOT A LOCKOUT. The key is an identifier anyone can read off a
-- badge, so a lockout an administrator has to lift is a denial-of-service
-- dressed as a security control. This is a short delay that expires on its own
-- and that nobody has to clear.
-- ---------------------------------------------------------------------------

create table if not exists login_attempts (
  identifier   text        primary key,          -- lower(btrim(...)), as typed
  failed_count int         not null default 0,
  first_failed timestamptz not null default now(),
  locked_until timestamptz
);

comment on table login_attempts is
  'Failed sign-in counter for the auth-signin Edge Function. Written only with the service-role key. Rows are transient and swept daily.';

-- Written only with the service-role key, which bypasses RLS entirely. RLS is
-- still enabled and there are no policies: a table in `public` with RLS on and
-- no policies is unreachable from PostgREST even if a grant is added by mistake.
alter table login_attempts enable row level security;
revoke all on table login_attempts from public, anon, authenticated;

-- Nothing older than a day tells us anything, and this table would otherwise
-- grow a row per typo forever. Alongside the sweeps 0004 already schedules.
select cron.unschedule('si-sweep-login-attempts')
 where exists (select 1 from cron.job where jobname = 'si-sweep-login-attempts');

select cron.schedule(
  'si-sweep-login-attempts',
  '17 3 * * *',
  $sweep$
    delete from public.login_attempts
     where first_failed < now() - interval '1 day'
       and (locked_until is null or locked_until < now());
  $sweep$
);
```

- [x] **Step 4: Apply and re-run the assertion**

```bash
cd app && npm run db:push && npm run db:types
```

Expected: `NOTICE: PASS: login_attempts, the lookup, its grants and the sweep`.

Then confirm the lookup agrees with the index, as `postgres`:

```sql
do $$
declare a uuid; e text;
begin
  select id into a from public.users order by created_at limit 1;
  perform set_config('si.allow_protected_write', 'on', true);
  update public.users set employee_id = 'E1042' where id = a;

  if si_email_by_employee_id(' e1042 ') is null then
    raise exception 'FAIL: the lookup does not normalise the way the index does';
  end if;
  if si_email_by_employee_id('E10%') is not null then
    raise exception 'FAIL: the lookup is pattern-matching — % was treated as a wildcard';
  end if;

  update public.users set employee_id = null where id = a;
  perform set_config('si.allow_protected_write', 'off', true);
  raise notice 'PASS: exact match, normalised the same way as the index';
end $$;
```

- [x] **Step 5: Write the function**

Create `app/supabase/functions/auth-signin/index.ts`:

```ts
/**
 * SI — Service Inside · auth-signin Edge Function
 *
 * Sign in with an employee number instead of an email address.
 *
 * WHY IT IS A SEPARATE FUNCTION. admin-users would have been fewer files, and
 * its very first act is verifying that the caller is an active Administrator. An
 * unauthenticated action inside it would sit one `if` away from every privileged
 * operation in the module. Separate function, separate blast radius.
 *
 * WHY THE LOOKUP IS SERVER-SIDE. The anon key ships inside the browser bundle,
 * so anything granted to `anon` is a public endpoint. A function mapping
 * employee ID to email address is then a staff directory and a
 * credential-stuffing target list, walkable in a loop. Exact match, rate limits
 * and hashing all still leave an oracle: the caller learns which IDs exist.
 * Here the service-role key never leaves Supabase, and a wrong ID is
 * indistinguishable from a wrong password.
 *
 * ONE MESSAGE FOR EVERY FAILURE. Unknown number, wrong password, no number set,
 * inactive account, rate-limited — all "Those details didn't match." Any branch
 * that says more turns this back into the oracle above. The direct email path in
 * AuthContext must match it, or the leak simply moves.
 *
 * THE LOOKUP DOES NOT FILTER ON status, and si_email_by_employee_id does not
 * either. Adding it is the obvious defensive move and it breaks the design: an
 * inactive account would fail at resolution while a wrong password fails at
 * GoTrue, and the two become distinguishable. An inactive account authenticates
 * normally here and is denied by carrying no roles (migration 0026), which is
 * the only place that decision belongs.
 *
 * THE PASSWORD IS FORWARDED AND NEVER LOGGED. No console.log of the request
 * body, ever. That is the review item for this file.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Every failure, without exception. */
const GENERIC = "Those details didn't match.";

// Five free attempts, then a delay that doubles and caps at eight minutes. It
// expires by itself; nobody has to lift it.
const FREE_ATTEMPTS = 5;
const BASE_DELAY_SECONDS = 15;
const MAX_DELAY_SECONDS = 480;
const WINDOW_HOURS = 1;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function delayFor(failedCount: number) {
  const over = failedCount - FREE_ATTEMPTS;
  if (over <= 0) return 0;
  return Math.min(BASE_DELAY_SECONDS * 2 ** (over - 1), MAX_DELAY_SECONDS);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  let payload: { identifier?: unknown; password?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Expected a JSON body." }, 400);
  }

  const identifier = String(payload.identifier ?? "").trim();
  const password = String(payload.password ?? "");
  if (!identifier || !password) return json({ error: GENERIC }, 400);

  const key = identifier.toLowerCase();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- the delay, before anything else is spent on this request -------------
  const { data: attempt } = await admin
    .from("login_attempts")
    .select("failed_count, first_failed, locked_until")
    .eq("identifier", key)
    .maybeSingle();

  const now = Date.now();
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > now) {
    return json({ error: GENERIC }, 400);
  }

  // A counter older than the window is stale — start again rather than holding
  // yesterday's typos against somebody.
  const withinWindow = Boolean(
    attempt?.first_failed &&
      now - new Date(attempt.first_failed).getTime() < WINDOW_HOURS * 3600_000,
  );
  const priorFailures = withinWindow ? (attempt?.failed_count ?? 0) : 0;

  async function recordFailure() {
    const failed = priorFailures + 1;
    const delay = delayFor(failed);
    await admin.from("login_attempts").upsert(
      {
        identifier: key,
        failed_count: failed,
        first_failed: withinWindow ? attempt!.first_failed : new Date(now).toISOString(),
        locked_until: delay ? new Date(now + delay * 1000).toISOString() : null,
      },
      { onConflict: "identifier" },
    );
  }

  // --- resolve the identifier ----------------------------------------------
  let email: string | null = null;
  if (identifier.includes("@")) {
    email = identifier.toLowerCase();
  } else {
    // One definition of sameness, shared with the unique index. See 0027.
    const { data: found } = await admin.rpc("si_email_by_employee_id", {
      p_employee_id: identifier,
    });
    email = typeof found === "string" && found ? found : null;
  }

  if (!email) {
    await recordFailure();
    return json({ error: GENERIC }, 400);
  }

  // --- exchange the credentials -------------------------------------------
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    await recordFailure();
    return json({ error: GENERIC }, 400);
  }

  const session = await res.json();
  // Success clears the counter outright: a correct credential is the end of the
  // matter, and leaving the row would carry the delay into the next typo.
  await admin.from("login_attempts").delete().eq("identifier", key);

  return json({ session });
});
```

- [x] **Step 6: Deploy with `verify_jwt` off**

Create `app/supabase/config.toml`:

```toml
# Per-function settings. The only reason this file exists.
[functions.admin-users]
verify_jwt = true

# The sign-in endpoint. verify_jwt MUST be false: the caller has no session yet
# — obtaining one is the entire point. Authorization happens inside, against
# GoTrue, on the credentials supplied.
[functions.auth-signin]
verify_jwt = false
```

```bash
cd app && npx supabase functions deploy auth-signin --no-verify-jwt
```

The flag is passed explicitly as well as configured, because a function deployed with JWT verification on rejects every sign-in with a 401 *before its code runs*, and the symptom looks nothing like the cause.

- [x] **Step 7: Test the function directly, before any client change** — *failure paths only; the success path needs a real password and lands in Task 8*

Set an employee ID on a test account first (Admin → Users → Edit).

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/auth-signin" -H "Content-Type: application/json" -H "apikey: <anon key>" -d '{"identifier":"E1042","password":"<your own test account password>"}'
```

Use your own test account's password. Do not ask anybody else for theirs.

| Input | Expected |
|---|---|
| right number, right password | `{"session":{"access_token":…}}` |
| right number, wrong password | `{"error":"Those details didn't match."}` |
| unknown number | byte-identical to the line above |
| `" e1042 "` and `"E1042"` | both succeed — index and lookup agree |
| an email address as `identifier` | succeeds, via the `@` branch |
| an inactive account, right password | a session, with no role claims in it — **not** an error |
| 6+ wrong attempts in a row | the same message; then the *right* password also fails until the delay expires, and succeeds after |

- [x] **Step 8: Confirm the delay is recorded and cleared**

```sql
select * from public.login_attempts;
```

Expected: a row while failing, with `locked_until` in the future; **no row** after a success.

- [x] **Step 9: Commit**

```bash
git add app/supabase/migrations/0027_login_attempts.sql app/supabase/functions/auth-signin/index.ts app/supabase/config.toml app/src/lib/database.types.ts
git commit -m "Sign in by employee ID, with its own attempt delay"
```

- [x] **Step 10: Run the security advisor again**

0027 adds a function. Dashboard → Advisors → Security; confirm `si_email_by_employee_id` is not reported as anon-callable.

---

#### What Task 7 was verified against (executed 2026-08-19)

**The lookup agrees with the index, which is the reason it is an RPC:**

| Input | Resolves to |
|---|---|
| `e1042`, `E1042`, `"  E1042  "` | all → `requester@example.com` |
| `E10%` | `null` — no wildcard match, which `.ilike()` would have given |
| `nosuch` | `null` |

**Grants:** anon calling `si_email_by_employee_id` → `401 42501 permission denied`;
anon reading or inserting `login_attempts` → `401 42501`; the service role can do
both. Enum-published-by-default is the trap 0007/0008/0011 exist for, and this
migration adds a function that maps a badge number to an email address.

**Indistinguishability:** four different reasons — known number + wrong password,
unknown number, known email + wrong password, unknown email — return **one**
byte-identical response.

**A TIMING ORACLE, found by measuring rather than by reading the code.** The single
error message is not sufficient on its own:

| | median |
|---|---|
| before: unknown number | 684ms |
| before: known number, wrong password | 977ms |
| **gap** | **293ms, and in the dangerous direction — faster means "does not exist"** |
| after the fix | −49ms, distributions overlapping |

An unknown number stops at the lookup; a known one goes on to GoTrue. It cannot be
fixed by equalising the work, because **GoTrue is itself slower when the account
exists** — that is when it has a hash to verify. So every refusal leaves through
one padded exit with a 1000ms floor. Successes are not padded: the caller already
knows whether they got a session.

**The delay:** five free attempts, then 15s doubling to a cap. Two properties
worth having tested:

- A **held** request does not increment the counter, so a third party cannot
  extend somebody's delay indefinitely by hammering a number they read off a
  badge. It still escalates across windows: the next real attempt after the delay
  expires increments as normal.
- **Unknown** identifiers accrue counters too (`z9999`, `y8888`,
  `nobody@example.com` all recorded), so enumeration is not free.

**Untested:** the success path, which needs a real password. It arrives naturally
in Task 8, when someone signs in by number through the login page.

### Task 8: The login screen — one field, two identifiers

**Files:**
- Modify: `app/src/context/AuthContext.js`
- Modify: `app/src/app/login/page.jsx`

**Interfaces:**
- Consumes: `auth-signin` from Task 7; `mustChangePassword` from Task 3; `rememberMe(flag, identifier)` from `lib/supabase.js`, unchanged — its second argument is already documented as "an identifier, not a credential".
- Produces: `signIn(identifier, password, remember)` accepting either form.

- [ ] **Step 1: State the failing observation**

The login field is `type="email"`, so the browser's own validation refuses to submit a bare number before any of this code runs. `isCompanyEmail` rejects it too.

- [ ] **Step 2: Widen `signIn` in `AuthContext`**

Replace the whole `signIn` callback:

```js
  /**
   * Sign in with a company email address or an employee number.
   *
   * TWO PATHS ON PURPOSE, and the split is the point. An email goes straight to
   * GoTrue as it always has. A number goes through the auth-signin Edge
   * Function, because resolving it to an address needs the service-role key.
   * Routing everything through the function would be more uniform and would make
   * it a single point of failure for all access; splitting means an outage costs
   * employee-ID sign-ins only, and the accounts most likely to have a mailbox
   * are the ones still able to get in.
   *
   * Both paths must produce the same failure message — see friendlyError() on
   * the login page. The direct path leaks "user not found" for an email address
   * unless that is handled, and the whole indistinguishability argument for the
   * function path is worth nothing next to a leak on the other one.
   */
  const signIn = useCallback(async (identifier, password, remember) => {
    const trimmed = (identifier ?? "").trim();
    const byEmail = trimmed.includes("@");

    // Before either call: it decides which store the session lands in. See the
    // storage adapter in lib/supabase.js.
    persistRememberMe(remember);

    let session;
    let authUser;

    if (byEmail) {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: trimmed,
        password,
      });
      if (signInError) throw signInError;
      session = data.session;
      authUser = data.user;
    } else {
      const { data, error: fnError } = await supabase.functions.invoke("auth-signin", {
        body: { identifier: trimmed, password },
      });
      // supabase-js collapses any non-2xx into a generic message and hides the
      // real one in error.context. Unwrap it — the function only ever sends the
      // one generic string, so there is nothing to leak by showing it.
      if (fnError) {
        let detail = null;
        try {
          detail = (await fnError.context?.json())?.error;
        } catch {
          // Not JSON — fall through to the generic message.
        }
        throw new Error(detail || "Those details didn't match.");
      }
      if (data?.error) throw new Error(data.error);
      if (!data?.session?.access_token) throw new Error("Those details didn't match.");

      // setSession is what puts it in the store the flag above selected.
      const { data: set, error: setError } = await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (setError) throw setError;
      session = set.session;
      authUser = set.user;
    }

    // The identifier only after the credentials were accepted, so a rejected
    // attempt leaves no typo waiting in the field. Stored AS TYPED: someone who
    // signs in by number is offered the number next time.
    if (remember) persistRememberMe(true, trimmed);

    const signInClaims = claimsFromSession(session);
    const roles =
      signInClaims.user_roles ?? (signInClaims.user_role ? [signInClaims.user_role] : []);
    return {
      user: authUser,
      roles,
      role: highestRole(roles),
      mustChangePassword: signInClaims.must_change_password === true,
    };
  }, []);
```

- [ ] **Step 3: Update the login page**

Rename the state, gate the domain check, and change the input:

```jsx
  const [identifier, setIdentifier] = useState("");
```

```jsx
/**
 * Only applies to something that is actually an email address. Without the
 * guard, configuring a company domain would reject every employee number.
 */
function isCompanyEmail(value) {
  if (!COMPANY_EMAIL_DOMAIN) return true;
  if (!value.includes("@")) return true;
  return value.toLowerCase().endsWith(`@${COMPANY_EMAIL_DOMAIN.toLowerCase()}`);
}
```

```jsx
            <Field label="Company email or employee ID" required>
              {/* type="text", not "email": the browser's own validation rejects a
                  bare employee number before any of this code runs. */}
              <input
                type="text"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputClass}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </Field>
```

The subtitle under "Sign in":

```jsx
          <p className="text-[13.5px] text-ink-soft mb-5">
            {COMPANY_EMAIL_DOMAIN
              ? `Use your @${COMPANY_EMAIL_DOMAIN} email address, or your employee ID.`
              : "Use your company email address, or your employee ID."}
          </p>
```

The prefill effect keeps `rememberedEmail()` — it reads the right key and the value is now whatever was typed:

```jsx
    const saved = rememberedEmail();
    if (saved) setIdentifier(saved);
```

And `handleSubmit`, which now has three outcomes to tell apart:

```jsx
    if (!isCompanyEmail(identifier)) {
      setError(`Please sign in with your company email address (@${COMPANY_EMAIL_DOMAIN}).`);
      return;
    }

    setStatus("checking");
    try {
      const { role, mustChangePassword } = await signIn(identifier, password, rememberMe);

      /**
       * Ordered by what the person can actually do about it.
       *
       * A password issued by somebody else is WHY the roles are empty, so it is
       * checked first — otherwise it reads as the misconfiguration below and
       * sends an administrator hunting for a broken hook.
       */
      if (mustChangePassword) {
        setStatus("success");
        router.replace("/change-password/");
        return;
      }
      if (!role) {
        /**
         * Credentials accepted, no roles in the token. Three causes, and the
         * person signing in cannot tell them apart: the account is inactive
         * (migration 0026), it has no row in public.users, or the access-token
         * hook is not enabled in the Supabase dashboard. All three are an
         * administrator's problem and none of them is a typo — which is why this
         * does not say "check your password".
         */
        setStatus("idle");
        setError(
          "Signed in, but this account has no access. It may have been deactivated, " +
            "or it has no role assigned. Contact your administrator.",
        );
        return;
      }
      setStatus("success");
      router.replace(dashboardPathForRole(role));
    } catch (e) {
      setStatus("idle");
      setError(friendlyError(e));
    }
```

In `friendlyError`, make both credential branches match the function's single message:

```jsx
      case "invalid_credentials":
      case "user_not_found":
        // Byte-identical to the auth-signin function's message. Two paths that
        // phrase a rejection differently are a way to tell an unknown identifier
        // from a wrong password, which is what the function route exists to
        // prevent.
        return "Those details didn't match.";
```

and the two status-code branches (`400`, `422`) return that same string. Leave the `validation_failed`, `user_banned`, `email_not_confirmed`, rate-limit and `AuthRetryableFetchError` branches exactly as they are: none of them distinguishes a known identifier from an unknown one, and each tells the person something they can act on.

- [ ] **Step 4: Verify both paths and the copy**

`npm run dev`, sign out.

| Input | Expected |
|---|---|
| employee number + right password | lands on the right dashboard |
| email + right password | the same dashboard |
| number + wrong password | "Those details didn't match." |
| unknown number | the identical message |
| an email at another domain, `COMPANY_EMAIL_DOMAIN` set | the company-domain message, before any network call |
| a bare number, `COMPANY_EMAIL_DOMAIN` set | no domain complaint — it reaches the function |
| Remember me ticked, signed in by number | the number is prefilled next visit |
| a flagged account, either identifier | lands on `/change-password/` |
| a deactivated account, right password | the "no access … deactivated" message |

- [ ] **Step 5: Compile and commit**

```bash
cd app && npm run build
git add app/src/context/AuthContext.js app/src/app/login/page.jsx
git commit -m "Login: accept a company email or an employee ID"
```

---

### Task 9: Documentation, and the two things that ship separately

**Files:**
- Modify: `CLAUDE.md`
- Modify: `app/BUILD_AND_DEPLOY.md`
- Modify: `docs/superpowers/specs/2026-08-19-id-login-and-credentials-design.md` (status line only)

- [ ] **Step 1: Add two sections to CLAUDE.md**

Immediately after the multi-role section, because they modify what it describes:

```markdown
### Account state (migrations 0025, 0026)

**`users.status` and `users.must_change_password` decide access, and they do it
in the token rather than in a policy.** `custom_access_token_hook` withholds
`user_roles` *and* `user_role` from an account that is not `active` or that owes
a password change; every policy already denies an account whose `si_roles()` is
empty, so one mechanism covers both without a single policy changing. Before
0026, `status` gated nothing anywhere — "Deactivate" did not revoke access.

Both claims, not one. `si_roles()` wraps `array_agg` in a `coalesce`, and
`array_agg` over zero rows returns NULL — so `user_roles: []` falls through to
the `user_role` branch and the role comes back. An empty array denies nothing and
raises nothing. `AuthContext` mirrors the same chain and had the same hole
through `profile.roles`, which is why that fallback is gone: `users_select` lets
an account read its own row, so the client would have refilled precisely what
the hook withheld — a complete app in which nothing works and nothing says why.

Deactivation is not immediate. Tokens live about an hour, the same latency a role
change already has.

`must_change_password` is cleared by `si_sync_auth_user_activity` when the
password actually changes, so **anything that sets the flag must set it after
writing the password.** Reversed, the trigger clears it and the account gets a
temporary password with no obligation attached, silently.
`si_guard_user_self_update` refuses to let anyone clear their own flag, Superuser
included, and takes `si_protected_override()`'s door for that trigger's own
write — the same door 0016 opened on the protection guard.

`/change-password` is the only page a flagged account can use, and it must never
sit behind `RequireRole`: the account holds no roles, so a role gate would reject
it from the one thing it is allowed to do.

### Signing in (migration 0027)

Two identifiers, two paths, deliberately. An email address goes straight to
GoTrue from the browser. An employee number goes through the `auth-signin` Edge
Function, which resolves it with `si_email_by_employee_id` on the service-role
key — an anon-callable lookup would be a public staff directory and a
credential-stuffing target list, and no amount of rate limiting removes the
oracle.

Every failure returns one message, on both paths. Neither the function nor the
lookup filters on `status`: adding it would make an inactive account fail at
resolution while a wrong password fails at GoTrue, and the two would become
distinguishable. Inactive accounts authenticate normally and are denied by
carrying no roles.

`login_attempts` exists because GoTrue throttles by origin and every ID sign-in
shares the function's egress address — without it, adding the function would
make brute-force protection worse than not having it. It is a self-expiring
delay, not a lockout, because keying on a number anyone can read off a badge
would make a lockout a denial-of-service.

Setting someone else's password and changing someone else's sign-in address are
both Superuser-only, paired deliberately: an address you can repoint at a mailbox
you control, plus the public self-service reset, *is* a password reset.
Administrators use `send_recovery_link`, which refuses a placeholder address
loudly, because succeeding and delivering nothing is the worst outcome available.
```

- [ ] **Step 2: Correct the "Admin operations" section**

It currently says `set_email` "applies the same rank rule". That is no longer true. Replace that paragraph with the Superuser-only rule and the reason it is paired with `set_password`. Leave the rest of the section — the three-mechanism description is still accurate.

- [ ] **Step 3: Record the new secret**

In `app/BUILD_AND_DEPLOY.md`, beside the existing environment notes: `SITE_URL` is an **Edge Function** secret (Edge Functions → Secrets), not a Vercel variable. It holds the same value as `NEXT_PUBLIC_SITE_URL`, must also be listed under Authentication → URL Configuration → Redirect URLs, and `send_recovery_link` refuses to send without it rather than emailing a link to nowhere.

- [ ] **Step 4: Flip the spec's status line**

`**Status:** approved, not yet implemented` → `**Status:** implemented (migrations 0025–0027)`.

- [ ] **Step 5: Rebuild the APK**

The same `out/` is packaged into Android, and the login screen changed.

```bash
cd app && npm run apk && npm run apk:record
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md app/BUILD_AND_DEPLOY.md docs/superpowers/specs/2026-08-19-id-login-and-credentials-design.md
git commit -m "Docs: account state, the two sign-in paths, and the SITE_URL secret"
```

---

## Final verification — the spec's §9, in this plan's order

Run this after Task 9. Sign in yourself for each role.

- [ ] A fresh token for an active, unflagged account carries `user_roles`, `user_role`, `is_protected`, `must_change_password: false`. **Sign out and in — a cached token proves nothing.**
- [ ] Deactivate an account, sign it out and in: an empty app, not its dashboard. **Read the claims, not the screen** — an empty dashboard can be empty for other reasons. Reactivate; access returns.
- [ ] Flag an account by hand, sign out and in: no role claims, the claim true, redirected to `/change-password`. Clear it; roles return. This is the step that catches a hook which handles `status` and forgets the flag.
- [ ] Two accounts, the same number in different case: the second is refused.
- [ ] Sign in by number and by email; the same dashboard both ways.
- [ ] Wrong number, and right number with wrong password: byte-identical messages. Check the email path's wording too.
- [ ] Superuser sets a temporary password → `must_change_password` is **true** in the database. This is the ordering trap; true here is the whole test.
- [ ] An Administrator creates an account → `must_change_password` is **true** on it, and its first sign-in lands on `/change-password`.
- [ ] Sign in with that password: `/change-password`, the rest of the app empty. Change it; roles appear with no sign-out.
- [ ] An Administrator: no Password button, Send reset link present, refused loudly on a placeholder address.
- [ ] An Administrator cannot change another account's sign-in address; can change their own.
- [ ] Trip the delay; confirm the generic message, and that a correct credential works again once it expires.
- [ ] Supabase security advisor clean for `custom_access_token_hook` and `si_email_by_employee_id`.
- [ ] `npm run build` succeeds with the dev server stopped.
- [ ] The APK is rebuilt and recorded.
