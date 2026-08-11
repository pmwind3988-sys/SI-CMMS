# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SI — Service Inside: a CMMS work order module. Next.js 14 (static export, every page
`"use client"`) + Supabase (Postgres) + Vercel for web, Capacitor for Android.

The runnable app lives in `app/`. `docs/` holds the specs, `prototypes/` standalone HTML
click-throughs, `archive/` superseded iterations (never use as reference).

## Commands

All from `app/`:

```bash
npm run dev              # dev server (port 3000)
npm run build            # static export into out/
npm run lint             # next lint
```

Database (Supabase CLI; `db:push` needs Docker):

```bash
npm run db:push          # apply pending migrations
npm run db:diff          # diff live schema against migrations
npm run db:types         # regenerate src/lib/database.types.ts from live schema
npm run bootstrap:users  # create the 6 role users
npm run seed:demo        # one demo work order walked through the real workflow
```

Android:

```bash
npm run apk              # build + cap sync + assembleDebug
npm run apk:record       # record the built APK into apk_builds
```

There is **no test suite** and no test runner configured. Verification is manual, via the
dev server or `npm run lint`.

**Never run `npm run build` while `npm run dev` is live** — they share `.next`, and the
production build corrupts the dev cache (every chunk 500s, page fails to hydrate silently).

Environment: `app/.env.local` (copy `.env.local.example`). `SUPABASE_SERVICE_ROLE_KEY` is
read only by the Node scripts in `app/scripts/`; it bypasses RLS and must never be set in
Vercel or prefixed `NEXT_PUBLIC_`.

## Architecture

**The database is the authorization boundary — not the client.** Predicates in
`app/src/lib/constants.js` (`canAssign`, `canEditWhileOpen`, …) decide what to *show*; the
matching RLS policy decides what is *allowed*. When they disagree the policy wins and the
user sees an error, not a silent success. Adding a client predicate without the policy is a
bug; so is loosening a policy to match a predicate.

`app/supabase/migrations/*.sql` is the source of truth for schema, RLS, triggers, cron and
seed data. `app/schema/schema.js` is dead Firestore-era reference documentation.

### Data layer contract

Components **never import `supabase` directly**. They call `listenX(args, cb, onError)` from
`src/lib/*` and get an unsubscribe function back. Keep new code on that contract.

| File | Responsibility |
|---|---|
| `lib/supabase.js` | client, Remember-Me storage adapter, `liveQuery`/`liveRow` |
| `lib/workOrders.js` | every work order read and write |
| `lib/notifications.js` | in-app notifications |
| `lib/dashboard.js` | the two precomputed stat rows |
| `lib/referenceData.js` | `ReferenceDataProvider` / `useReferenceData()` |
| `lib/admin.js` | user and reference-data administration |
| `lib/errors.js` | `describeError()` |
| `context/AuthContext.js` | session, claims, the single `user` shape |

`liveQuery` re-runs its query on any relevant `postgres_changes` event rather than patching a
local cache — one extra round trip per change, always exactly what RLS returns now.

### The role claim

`role` is reserved by Supabase for the Postgres role PostgREST switches into. The application
role travels as **`user_role`**, injected by `public.custom_access_token_hook`. That hook must
be enabled (Authentication → Hooks → Customize Access Token) or every policy silently denies
and users sign in to an empty app. Consequence: **a role change takes effect only when the
token is next issued** (~hourly, or sign out/in).

Roles are lowercase snake_case, matching the `si_role` enum: `requester`, `technician`,
`supervisor`, `manager`, `admin`. Supervisor is scoped to their `department_id`; Manager and
Admin are system-wide. Admin screens are Admin-only, including for Managers.

### The role hierarchy (migration 0015)

```
requester(1) → technician(2) → supervisor(3) → manager(4) → admin(5) → superuser(6)
```

**You may write a `users` row if it is your own, or if its rank is strictly below yours.**
`si_account_rank()` / `si_caller_rank()` are the SQL side, `accountRank()` in `lib/roles.js`
the client mirror. The comparison needs no subquery because the row being checked carries
both the role and the flag being compared.

**Superuser is not a sixth enum value.** It is `role='admin'` plus `users.is_protected`,
injected into the JWT as the `is_protected` claim by `custom_access_token_hook` (migration
0017 — 0002's hook emitted only `user_role`, `department_id` and `plant_ids`, and 0015 was
written believing the flag was already there). That keeps `si_is_admin()` true for them, so
every existing policy, `RequireRole` and transition row applies unchanged and only the rank
comparison sees the extra tier. Adding to the `si_role` enum would have flipped
`si_is_admin()` to false for the account needing the most access.

The failure mode if that claim is missing is silence, not an error: `si_is_superuser()`
returns false, the account is an ordinary rank-5 admin, and the sixth tier simply does not
exist. Anything depending on a claim needs the hook checked, not assumed.

Consequences that are deliberate, not gaps:

- **Only a Superuser can create or promote an Administrator.** 5 is below 6, and not below 5.
- **Admins cannot edit each other.** Same rank, so neither is below the other.
- **Nobody changes their own role or status**, Superuser included — RLS always lets you write
  your own row, so `si_guard_user_self_update` is the only place that hole closes. It also
  removes the last way to lock yourself out.
- The rank rule is uniform at every level, but it does not hand out screens: `users_update`
  still gates its non-self branch on `si_is_admin()`, so Managers and Supervisors write no
  row but their own and `/admin/users` stays Admin-only. Where the uniform rule reaches them
  is `si_set_user_role`, which they have always been able to call.

Three enforcement points, because two of them bypass RLS: the `users_*` policies; the
`si_set_user_role` RPC (SECURITY DEFINER); and `supabase/functions/admin-users` (service
role). A rule added to one and not the others is a hole — the loosest path wins.

### Protected accounts

`users.is_protected` marks an account that is administered **only from Supabase**.
`si_guard_protected_user` refuses every write to one, and `users_select` hides it from
everyone but its own holder — so it is absent from Admin → Users, from every count and every
picker, while still able to sign in and use the app normally. Setting the flag is itself
impossible from the app.

That guard was added directly to the hosted project and shipped `SECURITY INVOKER` while
calling a helper granted only to `postgres`, so it raised `permission denied for function
si_protected_override` on *every* write to `users` for *every* role. Migration 0013 fixes it.
Every other guard on this schema is `SECURITY DEFINER`; that is not optional styling.

### Status flow

```
open → assigned → accepted → on_the_way → on_site → repairing
     → waiting_spare_part ⇄ repairing → testing → completed → verified → closed
```

Plus `assigned → open` (decline), `testing → repairing`, `completed → repairing`. No status
may be skipped.

The permitted moves are **data, not code** — 22 rows in `wo_status_transitions` recording
which roles may perform each move, which fields it requires, and whether it demands a
different assignee. `si_guard_work_order_transition()` (BEFORE UPDATE trigger) enforces it,
because an RLS policy cannot compare OLD to NEW. `admin` is deliberately exempt so stuck
records can be corrected.

All transitions go through the private `transition()` helper in `lib/workOrders.js`, which
calls the `si_transition_work_order` RPC: one transaction, work order + history row together,
with `actor_id`/`actor_name`/`actor_role` read server-side from `auth.uid()` rather than
taken from arguments. Add new transitions there, not as raw updates.

### What the database owns (do not send these from the client)

`wo_number` allocation, SLA deadlines, `resolved_at`/`closed_at`/`verified_at`/`sla_breached`,
notification fan-out, `decline_count` and assignee clearing on decline, SLA warning/breach
sweeps (pg_cron, 5 min), dashboard aggregates (`si_compute_dashboard_stats`, 15 min).

### Error handling

`describeError()` deliberately **surfaces the server's message** rather than replacing it —
the trigger and policy messages are written to be read by the person who hit them. Only raw
constraint/RLS text is filtered into a friendly stand-in. Don't wrap database errors in
generic "try again" copy.

### Reference data

Statuses, priorities, SLA, impact levels, WO types, safety severities, departments and
equipment are **editable tables**, not literals. The first six are keyed on Postgres enums, so
migration 0009 grants UPDATE only — they can be relabelled but not added to. Departments and
assets can be added freely and appear on the raise form immediately.

### Attachments

The `attachments` bucket is private. `attachments.file_url` stores the **object key**;
`listenAttachments()` mints a one-hour signed URL on read. 50MB cap with a mime allowlist,
enforced by the bucket.

### Admin operations

Three mechanisms by need: plain UPDATE for profile fields and status (column guard limits
non-admins to their own name/phone/photo); RPC `si_set_user_role` for role changes (also
enforces supervisor department scoping); Edge Function `supabase/functions/admin-users` for
password changes and account creation, since those need the service-role key. That function
re-checks the caller is an active admin *from the database*, not from the JWT claim.

### Static export constraints

`output: "export"` + `trailingSlash: true` in `next.config.js`. No server routes, no API
routes, no `next/image` optimization, no middleware. The same `out/` is served by Vercel and
packaged into the APK, so web and Android ship identical UI — rebuild the APK after any web
change. Adding a server-side feature means giving up the Android build path.

## Adding a feature — sequence that works

1. Migration first (schema + RLS policy + any trigger), applied via `npm run db:push`.
2. `npm run db:types` to regenerate types.
3. A `listenX`/write function in the matching `lib/` file.
4. Component consuming it via the listener contract.
5. Client predicate in `constants.js` only to hide UI the policy would reject anyway.

Any new function in `public` is an anon-callable RPC by default (Postgres grants EXECUTE to
PUBLIC, PostgREST publishes it). Migrations 0007, 0008 and 0011 exist because of this. Revoke
explicitly and run the Supabase security advisor after any migration that adds a function.

## Docs worth reading

- `docs/SI_WorkOrder_FSD.md` — authoritative functional spec. **Where it and the code disagree
  on behaviour, the FSD is correct.**
- `docs/SI_Design_System.md`, `docs/SI_WorkOrder_Screens_UIUX.md` — colours, components, all 9
  screens field by field.
- `docs/SI_Enterprise_Firestore_Architecture.md`, `docs/SI_WorkOrder_Firestore_Design_v3.md` —
  still describe the model in Firestore terms. Entities/fields/relationships carried over
  unchanged; mechanisms did not (collections → tables, rules → RLS + triggers). Design intent
  only; migrations are the implementation.
- `app/BUILD_AND_DEPLOY.md` — includes three machine-specific Gradle problems on this PC.
- `app/GO_LIVE.md` — env values, migrations, the access-token hook, seeding users.

## Known gaps

- Editing a work order's core fields while Open writes no history row (transitions are fully
  audited; the edit path isn't).
- `verified` is a history state, not a resting state — `completed → closed` happens in one
  move with `verified_by`/`verified_at` stamped.
- Single plant: `plant_id` is threaded everywhere but everything seeds to `PLT001` and no UI
  exposes plant selection.
- `@capacitor/cli` pulls a `tar` version with a critical advisory; fixing it needs a Capacitor
  6 → 8 major upgrade.
