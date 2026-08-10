# SI — Service Inside · Work Order Management Module

A CMMS work order module: raise a breakdown, route it to a technician, track it
through a fifteen-step lifecycle against SLA targets, and close it with the
requester's sign-off.

React + Next.js in the browser, Supabase (Postgres) for everything else, Vercel
for hosting, Capacitor for the Android build.

- **Shipping it** → `BUILD_AND_DEPLOY.md`
- **Standing it up from scratch** → `GO_LIVE.md`
- **GitHub / Supabase / Vercel accounts** → `../SETUP_SUPABASE_VERCEL.md`

---

## 1. Architecture at a glance

```
Browser (Next.js static export, all "use client")
  │
  ├── @supabase/supabase-js
  │     ├── Auth            → sessions, password recovery
  │     ├── PostgREST       → every read and write, filtered by RLS
  │     ├── Realtime        → postgres_changes, drives every live list
  │     ├── Storage         → private attachments bucket, signed URLs on read
  │     └── Functions       → admin-users (password changes only)
  ▼
Postgres
  ├── Row Level Security    ← the authorization boundary
  ├── Triggers              ← WO numbering, SLA stamps, notifications, guards
  ├── pg_cron               ← SLA sweeps, dashboard rollups
  └── RPCs                  ← atomic transitions, role changes, stats refresh
```

**The database is the authorization boundary.** Not the client. Every predicate in
`lib/constants.js` (`canAssign`, `canEditWhileOpen`, …) decides what to *show*;
the equivalent RLS policy decides what is *allowed*. When they disagree, the
policy wins and the user sees an error rather than a silent success.

### The data layer

| File | Responsibility |
|---|---|
| `lib/supabase.js` | the client, the Remember-Me storage adapter, and `liveQuery`/`liveRow` |
| `lib/workOrders.js` | every work order read and write |
| `lib/notifications.js` | in-app notifications |
| `lib/dashboard.js` | the two precomputed stat rows |
| `lib/referenceData.js` | departments, assets, priorities, SLA, statuses, impacts, types, severities |
| `lib/admin.js` | user and reference-data administration |
| `lib/errors.js` | turning a thrown error into a sentence worth showing |
| `context/AuthContext.js` | session, claims, and the single `user` shape |

Components never import `supabase` directly. They call a `listenX(args, cb, onError)`
and get an unsubscribe function back. That contract is why the Firestore → Supabase
migration touched five files instead of twenty-five.

### `liveQuery`: how Realtime replaces `onSnapshot`

Firestore's `onSnapshot` handed back the whole result set on every change.
Supabase Realtime hands back individual row deltas. Rather than maintain a local
cache, `liveQuery` re-runs its query whenever a relevant row changes.

That is one extra round trip per change instead of a locally patched cache. It's
the right trade here: the queries are indexed and small, the result is always
exactly what RLS would return right now, and it kept every component call site
unchanged.

### Why the role comes from a JWT claim

`role` is **reserved** by Supabase for the Postgres role PostgREST switches into
(`authenticated`). Putting `"technician"` there breaks every request with an
undefined-role error.

So the application role travels as **`user_role`**, injected by
`public.custom_access_token_hook`, which reads `public.users` when a token is
minted. `si_role()` reads that claim and every policy goes through it. The
practical consequence: **a role change only takes effect when the token is next
issued.** Supabase refreshes roughly hourly; to make it immediate, sign out and
back in.

---

## 2. Local setup

```bash
cd app
npm install
# fill in .env.local — see GO_LIVE.md Part A
npm run dev
```

Sign in with one of the six seeded accounts (`GO_LIVE.md` Part C).

**Don't run `npm run build` while `npm run dev` is live** — they share `.next`,
and the production build corrupts the dev server's cache. Every chunk starts
returning 500 and the page silently fails to hydrate.

---

## 3. How the workflow actually runs

Eleven statuses, in `wo_statuses`:

```
open → assigned → accepted → on_the_way → on_site → repairing
     → testing → completed → verified → closed
                  ↕
        waiting_spare_part
```

The permitted moves are **data, not code** — 22 rows in `wo_status_transitions`,
each recording which roles may perform it, which fields it requires, and whether
it demands a different assignee. `si_guard_work_order_transition()`, a BEFORE
UPDATE trigger, consults that table and raises a readable message on a violation:

```
closed is not a permitted transition from accepted.
"resolution_notes" is required for "Mark completed" (testing -> completed).
A requester may not perform "Assign technician" (open -> assigned).
```

Those messages reach the user — `lib/errors.js` surfaces the server's text rather
than replacing it with "try again".

This is a trigger and not an RLS policy for one reason: **a policy cannot compare
OLD to NEW.** Authorization is therefore split — policies decide row visibility
and role gating, the trigger owns the transition matrix.

### What the database does for you

| Concern | Where |
|---|---|
| `wo_number` allocation | `si_before_work_order_insert()`, via the `counters` table |
| SLA deadlines | same trigger, reading the `sla` table |
| `resolved_at` / `closed_at` / `verified_at` / `sla_breached` | `si_stamp_work_order()` |
| Notification fan-out | `si_after_work_order_insert()`, `si_notify_work_order_update()` |
| `decline_count`, clearing the assignee on decline | the transition trigger |
| SLA warnings and breaches | two `pg_cron` jobs, every 5 minutes |
| Dashboard aggregates | `si_compute_dashboard_stats()`, every 15 minutes |

None of these are client responsibilities. `lib/workOrders.js` deliberately does
not send those columns.

### Transitions are atomic

`si_transition_work_order()` (migration 0010) updates the work order and appends
its history row in one transaction. Before that they were two statements, and a
failure between them left the work order advanced with no record of who advanced
it.

It also stops the audit trail being self-reported: `actor_id`, `actor_name` and
`actor_role` are read from `auth.uid()` server-side, not taken from arguments.

---

## 4. Reference data is editable, not hardcoded

Everything that used to be a literal array in `lib/constants.js` is now a table
an Administrator edits at **Settings**:

| Category | Table | Editable |
|---|---|---|
| Statuses | `wo_statuses` | label, colour, order |
| Priorities | `priorities` | label, colour, description |
| SLA targets | `sla` | ack / response / resolution minutes and labels |
| Impact levels | `impact_levels` | label, the priority it suggests |
| Work order types | `wo_types` | label, description |
| Safety severities | `safety_severities` | label, the priority ceiling it forces |
| Departments | `departments` | add and edit |
| Equipment | `assets` | add and edit |

The first six are keyed on a Postgres enum, so they can be **relabelled but not
added to**. That's deliberate: the enum is what `work_orders` columns are typed
as, existing rows reference these codes, and a new status would need transition
rows and trigger handling — not just a label. Migration 0009 grants UPDATE only,
so the database enforces it rather than relying on the UI.

Departments and equipment are real business records and can be added freely.
Adding a machine makes it selectable on the raise form immediately — no code
change, no redeploy.

`lib/constants.js` now holds only code: `fmtDue()` and the display predicates.

---

## 5. Attachments

The `attachments` bucket is **private**. Firebase's tokenised download URLs were
durable — once stored in a row, they kept working regardless of any later access
change. Supabase signed URLs expire, which is the safer default.

So `attachments.file_url` stores the **object key**, and `listenAttachments()`
mints a one-hour signed URL on read. `<img src={p.file_url}>` in
`AttachmentsPanel` needed no change.

The bucket caps uploads at 50MB with a mime allowlist. Both rejections surface
their real reason ("mime type text/plain is not supported") rather than a generic
retry prompt.

---

## 6. Administration

**Users** (`/admin/users`) — create accounts, change roles and departments, edit
profiles, activate/deactivate, and set passwords.

Three different mechanisms, chosen by what each needs:

- **Plain UPDATE** for profile fields and status. The `users_update` policy lets
  an admin write any row; a column guard stops everyone else straying beyond
  their own name, phone and photo.
- **RPC** for role changes (`si_set_user_role`), because it also enforces that a
  Supervisor may only provision inside their own department.
- **Edge Function** for passwords and account creation, because those need
  Supabase's Admin API and therefore the service-role key — which bypasses RLS
  and can never be shipped to a browser. `supabase/functions/admin-users` is the
  only place it runs, and it checks the caller is an active admin *from the
  database*, not from the JWT claim, so a token issued before a demotion can't be
  used.

**Settings** (`/admin/settings`) — the reference data above.

Both screens are Admin-only, including for Managers, matching the policies.

---

## 7. Dashboards

| Role | Screen | Source |
|---|---|---|
| Requester / Technician / Supervisor | `RoleDashboard` | their own RLS-scoped work order list, live |
| Manager / Admin | `DashboardModule` | two precomputed `stats` rows, refreshed by cron |

The split is deliberate. The role dashboards answer "what needs me right now", so
they need exact live numbers over a small scoped set — one indexed query. The
Manager and Admin dashboards answer "how is the plant doing", which is a
plant-wide aggregate that would be expensive per page load and is fine at fifteen
minutes old.

Each role dashboard leads with the one status where work is waiting on that
person specifically: `completed` for a requester to verify, `assigned` for a
technician to accept, `open` for a supervisor to assign.

---

## 8. Deliberately out of scope

- Preventive maintenance scheduling, spare parts inventory, purchase orders, cost
  tracking. The schema leaves room (`assets`, `plants`, `apk_builds` exist) but no
  module reads them.
- Email, push and SMS. Notifications are in-app only.
- Multi-plant operation. `plant_id` is threaded through every table and the SLA
  lookup already prefers a plant-specific row over the global default, but
  everything currently seeds to `PLT001`.
- Offline write queueing. Reads are live; a write made offline fails and is
  reported.

---

## 9. Known gaps

- Editing a work order's core fields while it is Open writes no history row. The
  transition path is fully audited; the edit path isn't.
- `@capacitor/cli` pulls a `tar` version with a critical advisory. The fix is a
  Capacitor 6 → 8 major upgrade.
- The six seeded accounts share one password until you change them.
