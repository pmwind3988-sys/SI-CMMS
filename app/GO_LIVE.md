# SI — Service Inside · Go Live, A to Z

Everything between a fresh clone and a working system, in order.

The backend is Supabase, hosting is Vercel. Firebase was removed on 2026-08-07.

> **Account setup** — creating the GitHub repo, signing into Supabase and Vercel
> with GitHub, and importing the project — lives in `../SETUP_SUPABASE_VERCEL.md`.
> This file picks up from "the project exists" and covers the operational steps.

---

## Read this first — the two things that trip everyone up

**1. Vercel's Root Directory must be `app`.**
The Next app is in `app/`, not at the repo root. Leave Root Directory empty and
the build fails with "no Next.js version detected".

**2. The access-token hook must be enabled, or every policy silently denies.**
Supabase reserves the `role` JWT claim for the Postgres role PostgREST assumes,
so this app ships its application role as **`user_role`**, injected by
`public.custom_access_token_hook`. Enable it at
**Authentication → Hooks → Customize Access Token**. Without it, users sign in
successfully and then see nothing, because `si_role()` returns null and every RLS
policy evaluates false.

---

## Part A — Local configuration

### A1. Fill in `app/.env.local`

```
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
NEXT_PUBLIC_COMPANY_EMAIL_DOMAIN=
```

All four come from **Project Settings → API**. Leave the domain blank to allow
any email address.

> `SUPABASE_SERVICE_ROLE_KEY` **bypasses Row Level Security entirely.** It has no
> `NEXT_PUBLIC_` prefix on purpose — that prefix is what puts a value into the
> browser bundle. It is read only by the scripts in `scripts/`, which run on your
> machine. Never commit it and never set it in Vercel.

### A2. Confirm it can't leak

```bash
git check-ignore -v app/.env.local .mcp.json
```

Both must print a matching rule. If either prints nothing, **stop**.

### A3. Install and build

```bash
cd app && npm install && npm run build
```

---

## Part B — Database

Migrations in `supabase/migrations/` are applied in filename order:

| File | What it creates |
|---|---|
| `0001_schema.sql` | 16 tables, 14 enums, indexes |
| `0002_auth_and_rls.sql` | the access-token hook, 46 RLS policies, column guards |
| `0003_work_order_triggers.sql` | WO numbering, SLA computation, the transition matrix |
| `0004_sweeps_stats_cron.sql` | SLA sweeps, dashboard stats, 3 pg_cron jobs |
| `0005_storage_and_realtime.sql` | the private `attachments` bucket, Realtime publication |
| `0006_seed_reference_data.sql` | plant, departments, assets, priorities, SLA |
| `0007_harden_function_grants.sql` | revokes EXECUTE from anon on trigger functions |
| `0008_revoke_anon_rpc.sql` | revokes the two admin RPCs from anon |
| `0009_reference_tables.sql` | statuses, impact levels, WO types, safety severities |
| `0010_atomic_transition_rpc.sql` | `si_transition_work_order()` |

Apply them:

```bash
cd app && npx supabase db push
```

(Needs Docker. On this machine they were applied through the Supabase MCP server
instead, which talks to the hosted project directly.)

Then deploy the Edge Function that lets an Administrator set passwords:

```bash
cd app && npx supabase functions deploy admin-users
```

### Verify the hook actually fires

This is worth doing explicitly, because a disabled hook looks like a permissions
bug rather than a configuration one. Sign in over the API and decode the token:

```bash
curl -s -X POST "https://<ref>.supabase.co/auth/v1/token?grant_type=password" -H "apikey: <anon key>" -H "Content-Type: application/json" -d '{"email":"admin@example.com","password":"<password>"}'
```

The decoded `access_token` payload must contain `"user_role": "admin"` alongside
`"role": "authenticated"`. If `user_role` is missing, the hook is not enabled.

---

## Part C — Accounts

```bash
cd app && npm run bootstrap:users
```

Creates six accounts, one per role, all in `DEPT-MACHINING` / `PLT001`:

| Email | Role |
|---|---|
| `requester@example.com` | Requester |
| `tech.arun@example.com` | Technician |
| `tech.meera@example.com` | Technician |
| `supervisor@example.com` | Supervisor |
| `manager@example.com` | Maintenance Manager |
| `admin@example.com` | Administrator |

All share the password `ChangeMe123!`.

**Change them before anyone real uses this.** Sign in as `admin@example.com` and
use **Users → Password** on each account. That screen is the supported way; it
calls the `admin-users` Edge Function, which is the only thing holding a
service-role key.

Optionally seed a demo work order that walks the real transition path:

```bash
cd app && npm run seed:demo
```

---

## Part D — Deploy the web app

Push to `main`. Vercel builds automatically.

Set exactly two environment variables in Vercel — `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. Because this is a static export, those values are
**baked into the bundle at build time**, so changing one later needs a redeploy.

---

## Part E — Auth URLs

Once you have the deployment URL, set it in Supabase under
**Authentication → URL Configuration**:

- **Site URL**: `https://<your-app>.vercel.app`
- **Redirect URLs**:
  ```
  https://<your-app>.vercel.app/**
  https://*-<your-app>.vercel.app/**
  http://localhost:3000/**
  ```

The wildcard line covers Vercel's per-branch preview deployments, which each get
a unique hostname. The `localhost` line keeps `npm run dev` working.

**This is what makes password reset work.** The recovery email links back to
`/reset-password/` in your app; if that URL isn't listed, Supabase refuses the
redirect and the link dies.

---

## Part F — Verify, in this order

1. **Sign in** as `admin@example.com`. Landing on `/admin/dashboard/` means the
   hook is working and role-based routing is correct.
2. **Raise a work order** as `requester@example.com`. It should get a
   `WO-YYYY-NNNNNN` number and an SLA countdown immediately — both come from
   triggers, so this proves the database automation is live.
3. **Assign it** as `supervisor@example.com`. The technician roster loads from the
   `technicians` table.
4. **Accept and advance it** as the assigned technician. Try an illegal jump; the
   database should refuse it with a readable message.
5. **Upload a photo.** It should render from a signed URL, proving the private
   bucket and on-read signing work.
6. **Check `/notifications`** — the triggers fan out notifications on each
   transition.
7. **Reset a password** through **Users → Password** as admin.

---

## Part G — Android

```bash
cd app && npm run apk
```

See `BUILD_AND_DEPLOY.md` §5 for install, signing and the release keystore. The
APK embeds a snapshot of the web build, so **rebuild it after any web change** —
a Vercel deploy does not update the app on a phone.

---

## What runs on its own

Three `pg_cron` jobs, installed by migration 0004:

| Job | Schedule | What it does |
|---|---|---|
| SLA breach sweep | every 5 min | flags overdue work orders, notifies supervisors |
| SLA warning sweep | every 5 min | warns at 25% of the window remaining |
| Dashboard stats | every 15 min | recomputes the Manager/Admin dashboard rows |

Managers and Admins can also force a stats refresh from the dashboard, which
calls `si_refresh_dashboard_stats()`.

---

## If something is wrong

| Symptom | Cause |
|---|---|
| Signs in, then every list is empty | The access-token hook isn't enabled. See the top of this file. |
| "Signed in, but this account has no role assigned" | No row in `public.users` for that auth user. |
| Vercel build: "no Next.js version detected" | Root Directory isn't `app`. |
| Password reset link 404s or is rejected | `/reset-password/` isn't in the Redirect URLs. |
| Work orders have no number or SLA | Migration 0003 wasn't applied. |
| Attachments fail to upload | Migration 0005 wasn't applied, or the file exceeds 50MB / isn't an allowed mime type. |
| Dev server returns 500 for every chunk | `npm run build` ran while `npm run dev` was live. Stop it, `rm -rf .next`, restart. |
| APK build: "SDK location not found", though `ANDROID_HOME` is set | `sdk.dir` in `android/local.properties` names a path the Gradle daemon can't see. `BUILD_AND_DEPLOY.md` §6 explains why `%LOCALAPPDATA%\Android\Sdk` isn't real on this machine. |
