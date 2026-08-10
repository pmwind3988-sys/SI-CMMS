# SI — Service Inside
## Enterprise Maintenance & Facilities Management System (CMMS)

This folder is the full export of the project. Start here.

```
SI-CMMS/
├── app/            The runnable application — Next.js 14 + React + Supabase
├── docs/           Current specifications (FSD, DB architecture, UI/UX, design system)
├── prototypes/     Clickable previews you can open without any setup
└── archive/        Superseded earlier iterations, kept for history only
```

The backend was migrated from Firebase to **Supabase** on 2026-08-07, and hosting
from Firebase Hosting to **Vercel**. Firebase is entirely gone from the codebase.
The design documents in `docs/` still describe the data model in Firestore terms —
see "Documentation guide" below for what that means in practice.

---

## Quick start

### Just want to look at it?
Open **`prototypes/SI_WorkOrder_Clickable_Prototype.html`** in any browser. No
install, no server, no backend — it's a self-contained click-through of all 9 work
order screens in both desktop and mobile layouts.

### Want to run the real application?

```bash
cd app
npm install
cp .env.local.example .env.local     # then fill in your Supabase URL + keys
npm run dev
```

Full instructions — the four environment values, applying migrations, enabling the
access-token hook, and seeding the six role users — are in **`app/GO_LIVE.md`**.
Read that before deploying anything.

### Want the Android app, or a live site?

```bash
cd app
npm run apk    # → android/app/build/outputs/apk/debug/app-debug.apk
```

The web app deploys itself: push to `main` and Vercel builds it.
**`app/BUILD_AND_DEPLOY.md`** covers both targets, including why the app is a
static export, signing a release APK, and the three machine-specific Gradle
problems on this PC. **`SETUP_SUPABASE_VERCEL.md`** covers creating the GitHub
repo and connecting Supabase and Vercel.

---

## What's actually built

| Module | State |
|---|---|
| **Authentication** | Complete — email/password, Remember Me, forgot password, password reset, session management, protected routes, 5-role RBAC with per-role dashboard redirect |
| **Work Order** | Complete — create, edit, assign, photos, videos, comments, timeline, SLA timer, 11-state status tracking, approval workflow, auto WO numbering |
| **Dashboard** | Complete for all five roles — Manager/Admin get 10 metric cards + 4 charts from precomputed stats; Requester/Technician/Supervisor get a live, RLS-scoped "what needs me" view |
| **Notification** | Complete — in-app, all 5 trigger categories, all 4 recipient roles, notification bell + full notification centre |
| **Row Level Security** | Complete — 46 policies plus 4 column guards, covering all 16 tables |
| **Server-side automation** | Complete — Postgres triggers for numbering, SLA computation, notification fan-out and the transition matrix; 3 pg_cron jobs for SLA sweeps and dashboard rollups |
| **Administration** | Complete — user creation, role changes, activate/deactivate, password setting, and editable reference data (statuses, priorities, SLA, impacts, types, severities, departments, equipment) |

### Known open items (stated plainly)

1. **Editing a work order writes no audit entry.** Status *transitions* are fully
   audited and atomic (`si_transition_work_order`, migration 0010, one
   transaction). Editing core fields while a work order is still Open goes through
   a plain UPDATE and leaves no history row.
2. **`verified` is a history state, not a resting state.** The flow documents
   eleven statuses, but no transition parks a work order at `verified`:
   `completed → closed` happens in one move, with `verified_by`/`verified_at`
   stamped and a `verified` entry written to the timeline. This was a genuine
   ambiguity in the original design and it is resolved in favour of the second
   reading — `verified` describes an event, not a state a job sits in.
3. **Single plant.** `plant_id` is threaded through every table and the SLA lookup
   already prefers a plant-specific row over the global default, but everything
   seeds to `PLT001` and no UI exposes plant selection.
4. **`@capacitor/cli` pulls a `tar` version with a critical advisory.** Fixing it
   needs a Capacitor 6 → 8 major upgrade.
5. **The six seeded accounts share one password** (`ChangeMe123!`) until you change
   them. Sign in as `admin@example.com` and use **Users → Password**.

---

## The database

Migrations in `app/supabase/migrations/` are the source of truth — ten files,
applied in filename order, covering schema, RLS, triggers, cron, storage, seed
data and two rounds of grant hardening. `app/GO_LIVE.md` Part B lists what each
one creates.

`app/schema/schema.js` survives as **reference documentation only**. It described
and validated the Firestore collections; Postgres now enforces what it used to
describe, so the drift checker that went with it was removed rather than left to
rot.

```bash
cd app
npm run db:push          # apply pending migrations (needs Docker)
npm run db:diff          # diff live schema against the migrations
npm run db:types         # regenerate TypeScript types from the live schema
npm run bootstrap:users  # create the 6 role users
npm run seed:demo        # one demo work order, walked through the real workflow
npm run apk:record       # record the built APK into apk_builds
```

The service-role key those last three need lives in `app/.env.local` only. It
bypasses Row Level Security completely — never commit it, and never set it in
Vercel.

### Two things that will cost you an afternoon if you don't know them

**`role` is a reserved JWT claim.** Supabase uses it for the Postgres role
PostgREST switches into. The application role therefore travels as **`user_role`**,
injected by `public.custom_access_token_hook`. That hook must be enabled at
Authentication → Hooks → Customize Access Token, or every policy silently denies
and users sign in to an empty app.

**A new function in `public` is an anon-callable RPC by default.** Postgres grants
EXECUTE to PUBLIC and PostgREST publishes anything executable. That briefly made
`si_notify()` — a SECURITY DEFINER insert into a table no client may write —
forgeable by anonymous callers. Migrations 0007 and 0008 revoke it. Run the
security advisor after any migration that adds a function.

### APK build registry

`apk_builds` holds one row per built APK, so the installed app can ask "is there a
newer build, and am I below the forced-update floor?" in a single read.
`scripts/recordApkBuild.js` reads `build.gradle`, the built `.apk` (size and
SHA-256), `.next/BUILD_ID` and git — it does not accept hand-typed versions.
`version_code` is the ordering key; `released: false` means recorded but not
offered to clients.

---

## Documentation guide

Read in this order if you're new to the project:

1. **`docs/SI_WorkOrder_FSD.md`** (v1.1) — the authoritative functional spec. 15 sections covering purpose, roles, workflow, business rules, approval flow, SLA, priority, notifications, status flow, validation, DB fields, permissions, error handling, audit trail, UI behaviour. **Where this and the code disagree on behaviour, this document is correct.**
2. **`docs/SI_Enterprise_Firestore_Architecture.md`** — the system-wide data design: collections, fields, types, relationships, indexes, the security-rule matrix, naming conventions, ID strategy.
3. **`docs/SI_WorkOrder_Firestore_Design_v3.md`** — the Work Order module's own narrower DB view, reflecting the 11-state flow.
4. **`docs/SI_Design_System.md`** — colours, typography, components, status colours.
5. **`docs/SI_WorkOrder_Screens_UIUX.md`** — all 9 screens, field by field, desktop + mobile, with empty/error state copy.
6. **`docs/CMMS_SRS.md`** and **`docs/CMMS_UIUX_Wireframe_Spec.md`** — the original broad requirements covering the whole product, including modules not yet built (Assets, PM, Inventory, Procurement, Reports).
7. **`docs/SI_Role_Based_UI_Prototype.md`** — role access matrix and per-role UI walkthrough.

> **On documents 2 and 3:** they describe the data model as Firestore collections
> and security rules. The *model* — entities, fields, relationships, who may write
> what — carried over to Postgres essentially unchanged, and they remain the best
> explanation of why the schema looks the way it does. The *mechanisms* did not:
> collections are tables, security rules are RLS policies plus triggers, and
> composite indexes are ordinary Postgres indexes. Treat them as design intent, and
> `app/supabase/migrations/` as the implementation.

`archive/` contains three superseded Firestore design iterations and two early
monolithic JSX builds. Nothing in there should be used as a reference — it's kept
only so the design history is visible.

---

## The status flow (referenced constantly across all docs)

```
open → assigned → accepted → on_the_way → on_site → repairing
     → waiting_spare_part ⇄ repairing → testing → completed → verified → closed
```

Plus three permitted loops: `assigned → open` (technician declines),
`testing → repairing` (test fails), `completed → repairing` (requester says not
fixed). No status may be skipped.

This is **data, not code**: 22 rows in `wo_status_transitions`, each recording
which roles may perform the move, which fields it requires, and whether it demands
a different assignee. A BEFORE UPDATE trigger consults that table, which is why
the matrix lives in the database rather than in a policy — an RLS policy cannot
compare OLD to NEW.

Admin is the one exception: `si_guard_work_order_transition()` returns early for
`admin`, deliberately and narrowly, so a stuck record can be corrected.

---

## Roles

`requester` · `technician` · `supervisor` · `manager` (Maintenance Manager) · `admin` (Administrator)

Lowercase snake_case throughout — these are the literal values of the `si_role`
enum, the `user_role` JWT claim, and every RLS policy. Supervisor is scoped to
their own `department_id`; Manager and Admin are system-wide. Administration
screens (users, settings) are Admin-only, including for Managers.
