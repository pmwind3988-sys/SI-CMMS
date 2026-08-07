# SI — Service Inside
## Enterprise Maintenance & Facilities Management System (CMMS)

This folder is the full export of the project. Start here.

```
SI-CMMS/
├── app/            The runnable application — Next.js 14 + React + Firebase
├── docs/           Current specifications (FSD, DB architecture, UI/UX, design system)
├── prototypes/     Clickable previews you can open without any setup
└── archive/        Superseded earlier iterations, kept for history only
```

---

## Quick start

### Just want to look at it?
Open **`prototypes/SI_WorkOrder_Clickable_Prototype.html`** in any browser. No install, no server, no Firebase — it's a self-contained click-through of all 9 work order screens in both desktop and mobile layouts.

### Want to run the real application?

```bash
cd app
npm install
cp .env.local.example .env.local     # then fill in your Firebase web config
npm run dev
```

Full setup instructions — including the Firebase Emulator Suite path, deploying rules/indexes/functions, and seeding demo users and data — are in **`app/README.md`**. Read that before deploying anything.

### Want the Android app, or a live site?

```bash
cd app
npm run apk              # → android/app/build/outputs/apk/debug/app-debug.apk
npm run deploy:hosting   # → https://<your-project>.web.app
```

Both need a Firebase project wired up first. **`app/BUILD_AND_DEPLOY.md`** covers
that end to end: creating the project, the six config values, rules/indexes,
bootstrapping the role users, signing a release APK, and which features need the
Blaze plan. The app is now a Next.js **static export**, so the same `out/` folder
is what Hosting serves and what the APK embeds.

---

## What's actually built

| Module | State |
|---|---|
| **Authentication** | Complete — email/password, Remember Me, forgot password, session management, protected routes, 5-role RBAC with per-role dashboard redirect |
| **Work Order** | Complete — create, edit, assign, photos, videos, comments, timeline, SLA timer, 11-state status tracking, approval workflow, auto WO numbering |
| **Dashboard** | Complete for Manager/Admin — 10 metric cards + 4 charts, responsive, backed by precomputed stats (not live collection scans) |
| **Notification** | Complete — in-app, all 5 trigger categories, all 4 recipient roles, notification bell + full notification centre |
| **Firestore security rules** | Complete — full 5-role transition matrix across all 15 collections |
| **Cloud Functions** | Complete — auto-numbering, SLA computation, notification fan-out, SLA warning + breach sweeps, dashboard stat rollups, role claim provisioning |
| **Database tooling** | Complete — machine-readable schema, idempotent seeder, drift check, APK build registry, Claude Code skill + MCP server (see below) |

### Known open items (stated plainly)

1. **Supervisor has no dashboard.** Manager and Admin have a working one. The stats documents are global, and giving Supervisor a system-wide dashboard would contradict their department-scoped access everywhere else. The fix is department-scoped stat documents (`stats/dashboard_cards_{department_id}`) — designed for, not yet built.
2. **Nothing has been deployed or run against real Firebase.** Every file is syntax-verified (`node --check` for JS, Babel for JSX, brace/paren balance for `.rules`, JSON validation for configs), but this project has never executed against a live Firebase project. Expect the ordinary first-run friction of a real deployment: index build waits, claim-refresh timing, emulator config.
3. **Asset, Department, and Technician records are still read from local lookups by the UI.** The collections themselves now exist and are seeded (`npm run seed:db` writes `/assets`, `/departments`, `/technicians`, `/priorities`, `/plants`, `/sla` from `app/schema/schema.js`). What remains is the UI half: components still import the hardcoded arrays from `app/src/lib/constants.js` rather than subscribing with `onSnapshot`. That migration is now a contained per-component change, but it is not done.
4. **`priorities` and `sla` are seeded as collections, but the app still reads the SLA matrix from constants.** Both collections are populated with the exact values from `constants.js` and `functions/index.js`, so the data is no longer the blocker — switching the readers over is. Note those numbers currently live in **three** places (constants.js, functions/index.js, and now `/sla`); the collection is meant to become the only one.
5. **No status transition ever sets `verified`.** `verified` is the tenth of the eleven documented statuses and `seedDemoWorkOrder.js` writes a history entry for it, but `firestore.rules` goes `completed → closed` directly (with `verified_by` set) and has no clause producing `verified`. So no role can put a work order into that state. Either the rules need a `completed → verified → closed` pair, or `verified` should be dropped from the flow and treated as what it actually is — the `verified_by`/`verified_at` fields on a closed order.

---

## The database, and the tooling around it

`app/schema/schema.js` is the machine-readable description of all 15
collections — fields, types, enums, references, and who may write what. It was
derived from `firestore.rules`, `firestore.indexes.json`, `src/lib/constants.js`
and `functions/index.js`, not hand-authored, and `npm run schema:check` fails if
those files drift apart from it.

Everything defaults to the **Firebase Emulator**. Reaching a live project takes
a deliberate `SI_TARGET=live` plus a service-account key, and the connector
refuses to start if you set that while an emulator host is still exported.

```bash
cd app
npm run emulators        # Firestore + Auth + Functions  (needs JDK 21+)
npm run bootstrap:users  # 6 seed Auth users + custom claims
npm run seed:db          # seed all reference collections — idempotent
npm run schema:check     # fail on schema drift; no database needed
npm run apk:record       # record the built APK into /apk_builds
```

Run `bootstrap:users` before `seed:db` so technician documents get real Auth
UIDs rather than the placeholder slugs from `constants.js`.

### APK build registry

`apk_builds` holds one document per built APK, so the installed app can ask "is
there a newer build, and am I below the forced-update floor?" in a single read.
`scripts/recordApkBuild.js` reads `build.gradle`, the built `.apk` (size and
SHA-256), `.next/BUILD_ID` and git — it does not accept hand-typed versions.
`version_code` is the ordering key; `released: false` means recorded but not
offered to clients.

### Claude Code integration

`.claude/skills/si-firestore/` and `.mcp.json` wire the schema into Claude Code
automatically — no install step. The skill triggers on any Firestore work in
this repo; the MCP server exposes ten tools (`si_schema_overview`,
`si_describe_collection`, `si_check_transition`, `si_validate_document`,
`si_query`, `si_count`, `si_database_status`, `si_latest_apk_build`,
`si_divergences`, `si_get_document`). It is **read-only** — writes go through
the seeding scripts, which validate and print first.

`si_check_transition` is the useful one: it answers whether a given status
change is legal for a given role and which companion fields the rules demand on
that same update, which is otherwise only discoverable by triggering an opaque
`permission-denied`.

---

## Documentation guide

Read in this order if you're new to the project:

1. **`docs/SI_WorkOrder_FSD.md`** (v1.1) — the authoritative functional spec. 15 sections covering purpose, roles, workflow, business rules, approval flow, SLA, priority, notifications, status flow, validation, DB fields, permissions, error handling, audit trail, UI behaviour. **Where this and the code disagree, this document is correct.**
2. **`docs/SI_Enterprise_Firestore_Architecture.md`** — the system-wide database design: 11 main collections, fields, data types, relationships, composite indexes, security-rule matrix, naming conventions, ID strategy, scalability practices.
3. **`docs/SI_WorkOrder_Firestore_Design_v3.md`** — the Work Order module's own narrower DB view, reflecting the current 11-state flow.
4. **`docs/SI_Design_System.md`** — colours, typography, components, status colours.
5. **`docs/SI_WorkOrder_Screens_UIUX.md`** — all 9 screens, field by field, desktop + mobile, with empty/error state copy.
6. **`docs/CMMS_SRS.md`** and **`docs/CMMS_UIUX_Wireframe_Spec.md`** — the original broad requirements covering the whole product, including modules not yet built (Assets, PM, Inventory, Procurement, Reports).
7. **`docs/SI_Role_Based_UI_Prototype.md`** — role access matrix and per-role UI walkthrough.

`archive/` contains three superseded Firestore design iterations and two early monolithic JSX builds. Nothing in there should be used as a reference — it's kept only so the design history is visible.

---

## The status flow (referenced constantly across all docs)

```
open → assigned → accepted → on_the_way → on_site → repairing
     → waiting_spare_part ⇄ repairing → testing → completed → verified → closed
```

Plus three permitted loops: `assigned → open` (technician declines), `testing → repairing` (test fails), `completed → repairing` (requester says not fixed). No status may be skipped by any role, including Admin.

---

## Roles

`requester` · `technician` · `supervisor` · `manager` (Maintenance Manager) · `admin` (Administrator)

Lowercase snake_case throughout — these are the literal values in Firebase Auth custom claims and in every security rule. Supervisor is scoped to their own `department_id`; Manager and Admin are system-wide.
