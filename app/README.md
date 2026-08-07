# SI — Service Inside · Work Order Management Module

Production implementation: **React + Next.js (App Router) + Firebase** (Auth, Firestore, Storage, Cloud Functions).

This repository contains **only** the Work Order Management module — no other SI module is implemented here, by design. It is the direct implementation of the three design documents that preceded it:

- The Work Order Management SRS/workflow (Requester → Supervisor → Technician → Requester)
- The Firestore database design (collections, fields, indexes, relationships, security rules, status flow)
- The UI/UX screen specification (9 screens, desktop + mobile, validation, status colors, empty/error states)

If anything in this codebase seems to make an unexplained decision, it's very likely explained in one of those three documents — this implementation does not deviate from them.

---

## 1. Architecture at a Glance

```
src/
  app/                     Next.js App Router pages
    login/page.jsx
    work-orders/page.jsx           Screen 1 — Work Order List
    work-orders/new/page.jsx       Screen 2 — Raise New Work Order
    work-orders/[id]/page.jsx      Screen 3 — Work Order Details (tabs = Screens 4–9)
  components/
    AppShell.jsx, NotificationBell.jsx, RequireAuth.jsx
    ui/                    Design-system primitives (Button, Field, Badges, Card, Toast…)
    workorders/            One component per tab/screen:
      WorkOrderList.jsx, RaiseWorkOrderForm.jsx, WorkOrderDetail.jsx,
      AssignPanel.jsx (Screen 4), ProgressLogPanel.jsx (Screen 6),
      AttachmentsPanel.jsx, StatusTimeline.jsx (Screen 9), WorkflowPanel.jsx (Screens 5, 7, 8)
  context/AuthContext.js    Firebase Auth + custom-claims role resolution
  lib/
    firebase.js             Client SDK init (+ emulator support)
    constants.js             SLA matrix, status flow, impact options — single source of truth
    workOrders.js            Firestore data-access layer — one function per workflow transition

functions/index.js          Cloud Functions: numbering, SLA computation, notifications, SLA sweep
firestore.rules             The transition-matrix security rules (client enforcement backstop)
firestore.indexes.json      Every composite index the app's real queries need
scripts/bootstrapUsers.js   One-time admin script to provision the first Requester/Technician/Supervisor/HOD
```

### Why the data layer is separated the way it is
`src/lib/workOrders.js` contains **no authorization logic** — every function just shapes a write. The actual authorization is `firestore.rules`, which is a direct transcription of the workflow's transition table. This means a malicious or buggy client can call `acceptWorkOrder()` on a work order it has no business touching, and Firestore will simply reject the write — the UI never has to be trusted as the security boundary.

### Why custom claims, not a Firestore read, drive `role`
`AuthContext` reads `role`/`plantIds` from the Firebase Auth ID token's custom claims first, falling back to the `/users/{uid}` document only for display fields (name, phone, skills). Security rules can only see custom claims, not arbitrary Firestore reads (a rule can't cheaply "look up" a role for every single request) — so the client mirrors that same source of truth to avoid a class of bugs where the UI and the rules disagree about who a user is.

---

## 2. Local Setup

```bash
npm install
cp .env.local.example .env.local
# fill in your Firebase project's web config in .env.local
```

### Run against the Firebase Emulator Suite (recommended for development)

```bash
npm install -g firebase-tools   # if you don't have it
firebase login
# set NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true in .env.local
npm run emulators   # starts Auth + Firestore + Functions emulators
npm run dev          # in a second terminal
```

Then provision the seed users against the emulator:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
GOOGLE_CLOUD_PROJECT=<your-project-id> \
node scripts/bootstrapUsers.js
```

Sign in at `http://localhost:3000/login` with any of the seeded accounts (see `scripts/bootstrapUsers.js` for emails/passwords).

To also see a fully closed, real example in the UI immediately (Screen 9's Status Timeline and Screen 6's Progress Log both render actual data instead of an empty state):

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
GOOGLE_CLOUD_PROJECT=<your-project-id> \
npm run seed:demo
```

This creates one work order (`WO-2026-000001`) that has already run the full `Open → Assigned → Accepted → On The Way → On Site → Repairing → Testing → Completed → Verified → Closed` sequence, 08:15–09:16, with a real actor and timestamp on every step — see the comments in `scripts/seedDemoWorkOrder.js` for exactly which two steps (On The Way, Testing) were folded into an adjacent timestamp because the source timeline didn't call them out separately.

### Run against a real Firebase project

```bash
firebase deploy --only firestore:rules,firestore:indexes,functions
GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json node scripts/bootstrapUsers.js
npm run build && npm run start
```

---

## 3. How the Workflow Actually Runs

1. **Requester** submits Screen 2 → `createWorkOrder()` writes a `workOrders` doc with `status: "New"`.
2. The `onWorkOrderCreate` Cloud Function fires immediately: assigns the human-readable `woNumber` via a transactional counter, computes `slaAckDueAt`/`slaResolutionDueAt` from the SLA matrix, writes the first `statusHistory` entry, and notifies every Supervisor/HOD in the plant.
3. **Supervisor/HOD** sees the "needs assignment" banner on Screen 1, opens Screen 3 → Assignment tab (Screen 4), assigns a **Technician** → `assignTechnician()` → rules check `isSupervisorLike() && status New→Assigned` → the `onWorkOrderUpdated` function notifies the technician.
4. **Technician** opens the Workflow tab (Screen 5), taps **Accept** → `acceptWorkOrder()` → rules check the caller *is* `assignedToId`. Then **Attend/Start** → **Mark Resolved** (Screen 7, resolution notes required by both the UI and the rules) → the function notifies the requester.
5. **Requester** opens the Workflow tab (Screen 8), taps **Confirm fixed — Close** → `verifyAndClose()` writes `Verified` then `Closed` as two history entries in one call, exactly as specified.
6. Screen 9 (Status Timeline) is a live `onSnapshot` on the `statusHistory` subcollection the whole time — nothing in it is ever edited, only appended to.

Every one of these client calls will be **rejected by Firestore** if attempted out of order or by the wrong role — try it by editing a component to call the wrong transition function and watch the write fail. That's the point of keeping authorization server-side.

---

## 4. What's Intentionally Out of Scope

- **Asset/Equipment management** — `EQUIPMENT` in `constants.js` and `AssignPanel`'s `TECHNICIANS` roster are lightweight local lookups standing in for what would be separate modules (Asset Management, User Management) in the full SI product. Swapping them for real Firestore-backed lookups is a matter of replacing those two arrays with `onSnapshot` listeners against `/assets` and `/users` — the Work Order module's own logic doesn't change.
- **File Storage security rules** — this repo ships Firestore rules only; a matching `storage.rules` restricting who can write to `workOrders/{woId}/attachments/*` should be added before production use of the upload features in `AttachmentsPanel`/`RaiseWorkOrderForm`.
- **User Management UI** — `setUserRoleClaims` (in `functions/index.js`) is the callable function a future admin screen would invoke; `scripts/bootstrapUsers.js` is a stand-in for that screen during initial setup only.

---

## 5. Authentication Module

Roles are now the approved 5-role model: `requester`, `technician`, `supervisor`, `manager` (Maintenance Manager), `admin` (Administrator) — lowercase, matching the custom claims `firestore.rules` checks against.

- **`src/lib/roles.js`** — single source of truth for role constants, display labels, and the role → dashboard path map.
- **`src/context/AuthContext.js`** — sign-in (with Remember Me → Firebase Auth persistence mode), sign-out, password reset, and resolving `role`/`departmentId`/`plantIds` from the ID token's custom claims on every token refresh (`onIdTokenChanged`, not just `onAuthStateChanged` — so a role change made by an admin takes effect without a full re-login).
- **`src/components/RequireAuth.jsx`** — protected-route guard; unauthenticated visitors are sent to `/login?next=...`.
- **`src/components/RequireRole.jsx`** — per-page role gate; a role that isn't allowed on a page is redirected to *their own* dashboard, not shown a bare "denied" screen. Manager and Admin are elevated everywhere by default (`includeElevated`), except the Admin dashboard itself, which is Admin-only.
- **Post-login redirect always goes to the signed-in user's own role dashboard** (`/dashboard`, `/technician/dashboard`, `/supervisor/dashboard`, `/manager/dashboard`, `/admin/dashboard`) — never to a `?next=` deep link, per the specified requirement.
- **`scripts/bootstrapUsers.js`** seeds one user per role with the new claims shape (`role`, `department_id`, `plant_ids`).

### ⚠️ Known integration gap with the existing Work Order module
The Work Order module's business logic (`src/lib/workOrders.js`, `WorkflowPanel.jsx`, `AssignPanel.jsx`, `isAssigneeOf`/`isRequesterOf` in `constants.js`) still checks the **old** capitalized 4-role model (`"Requester"`, `"Technician"`, `"Supervisor"`, `"HOD"`) and the old camelCase field names. Since Authentication now issues lowercase 5-role claims (`requester`/`technician`/`supervisor`/`manager`/`admin`, no `HOD`), **a Technician or Supervisor signing in today will lose every action button in the Work Order module** — the role string simply won't match anything the Workflow/Assignment logic checks for. This module was scoped to Authentication only per the request that produced it; migrating the Work Order module's role checks (and ideally its field naming) to match is the necessary next step before the two modules work together end-to-end.

---

## 6. Dashboard Module

10 cards + 4 charts, responsive (2-column card grid on mobile, up to 5 on desktop; charts stack to 1 column on mobile, 2 on desktop). Wired into `/manager/dashboard` and `/admin/dashboard` — Manager and Admin are the two roles with system-wide visibility, which is what these metrics assume.

**Architecture — precomputed, not live-scanned:**
- `functions/index.js` → `computeDashboardStats()` reads the full `work_orders` collection (plus a bounded `work_order_history` query for real response-time data) and writes two small documents: `stats/dashboard_cards` and `stats/dashboard_charts`.
- `recomputeDashboardStats` (scheduled, every 15 min) keeps them fresh automatically.
- `refreshDashboardStats` (callable, Manager/Admin only) lets the UI's "Refresh now" button force an immediate recompute instead of waiting.
- The frontend (`src/lib/dashboard.js`, `DashboardModule.jsx`) only ever reads those two documents via `onSnapshot` — never queries `work_orders` directly for dashboard purposes. This is deliberate: scanning the whole collection on every dashboard page load doesn't scale, one precomputed read does.
- **Average Response Time** is computed from real `work_order_history` "accepted" transitions, not approximated — see the comment in `computeDashboardStats` for why a fabricated number was rejected in favor of one extra bounded query.
- Flagged in the function's own comments: at high volume (tens of thousands of work orders), the full-collection scan this runs on should be replaced with incremental counters or a BigQuery export — not solved preemptively here since current volume doesn't need it (per the architecture doc's "design for the query you actually have" principle).

**⚠️ This module depends on the same migration gap noted in Section 5.** `computeDashboardStats` reads `work_orders` using the new snake_case field/status convention (`department_id`, `status: "completed"`, etc.). Until the Work Order module's writes are migrated to match, every card and chart will read as zero/empty against real data — the Dashboard module itself is complete and correct against the schema it's built for, but that schema and the Work Order module's actual writes are not yet the same thing.

Supervisor intentionally has no dashboard wired up in this pass — `stats/dashboard_cards` is global, not department-scoped, and giving Supervisor a system-wide dashboard would contradict their department-only access elsewhere. A department-scoped variant (`stats/dashboard_cards_{department_id}`) is the natural next step if/when that's needed.

---

## 7. Complete Work Order Module — Migration Summary

This section supersedes the "known integration gap" warnings in Sections 5 and 6. **Both are now resolved.**

**What changed, end to end:**
- `functions/index.js` — every collection reference migrated from `workOrders`/`statusHistory` (subcollection)/`progressLog` (subcollection) to `work_orders`/`work_order_history` (top-level)/`comments` (top-level, entity_type + entity_id). `setUserRoleClaims` now issues the 5-role model (`requester`/`technician`/`supervisor`/`manager`/`admin` + `department_id`), not the old 4-role/`HOD`/`plantIds` shape. The unused `appendWorkOrderHistory` callable was removed — history is written directly by the client, matching the rules' existing `allow create: if signedIn()` pattern for that collection.
- `firestore.rules` — added the new **Edit Work Order** clause (Section 8 feature): core fields (department, equipment, complaint, priority, impact, downtime, risk flags) may be corrected only while `status == "open"`, by the requester, a department-scoped Supervisor, or Manager/Admin. Everything else was already correct from the prior task — this migration is what finally caught the app code up to it.
- `firestore.indexes.json` and `storage.rules` — both were still the *old* schema and have been rewritten to match (`work_orders`, `requester_id`, `assigned_to_id`, `department_id`-scoped queries instead of `plantId`, plus a new `users(role, department_id)` index for the Cloud Functions' department-supervisor lookup).
- `src/lib/constants.js`, `src/lib/workOrders.js` — full rewrite to snake_case fields/statuses, reusing `roles.js` from the Authentication module as the single source of truth for role values (no more duplicate/conflicting role constants).
- Every Work Order component (`WorkOrderList`, `RaiseWorkOrderForm`, `AssignPanel`, `WorkflowPanel`, `StatusTimeline`, `AttachmentsPanel`) migrated to match.
- `scripts/seedDemoWorkOrder.js` migrated to the new schema so it still actually seeds usable demo data.

**New features added in this pass (the module is now genuinely complete against the original feature list):**
- **Edit Work Order** — `RaiseWorkOrderForm` is now dual-mode (`existing` prop present = Edit); new route `/work-orders/[id]/edit`; edit is only reachable/permitted while a work order is still Open.
- **Comments** — replaces the old Technician-only "Progress Log" with the shared, reusable `comments` collection (per the architecture doc) — any role who can read a work order can comment, unifying field notes and general collaboration into one surface instead of two.
- **Auto Work Order Number**, **Assign Technician**, **Upload Photos/Videos**, **Timeline**, **SLA Timer**, **Status Tracking**, and **Approval Workflow** were already built in earlier passes and are carried forward unchanged in substance, just migrated to the current schema.

**Verification performed:** every touched `.js` file syntax-checked with `node --check`/`node --input-type=module --check`; every touched `.jsx` file verified with Babel (`@babel/preset-react`); `firestore.rules` and `storage.rules` brace/paren-balance checked; `firestore.indexes.json` JSON-validated; a full-project grep for every old-schema string (`workOrders`, `requesterId`, `assignedToId`, `plantId`, `HOD`, `statusHistory`, `progressLog`) confirmed zero remaining references outside of benign display labels, comments, and unrelated identifier names.

**What's still genuinely open:** the Dashboard module's Supervisor variant (department-scoped stats) was flagged as a future enhancement in Section 6 and remains so — Manager/Admin have a working Dashboard, Supervisor does not yet. Nothing else from the original scope is known to be incomplete.

---

## 8. Notification Module

**In-app only**, per the module's scope — no email/SMS/push transport. Every notification is written server-side by Cloud Functions and read/marked-read client-side; `firestore.rules`' existing notifications block (recipient-only read, status-only self-update, no client create/delete) needed no changes — it was already correctly scoped, this module just needed the client-side plumbing built to actually use it correctly.

**⚠️ Bug fixed in this pass:** `NotificationBell.jsx` was importing `listenNotifications`/`markNotificationRead` from `../lib/workOrders` — functions that were dropped when that file was fully rewritten in the schema migration. It also referenced stale fields (`n.woId`, `status === "Read"`) from before the entity_type/entity_id polymorphic migration. This was a live bug (broken import) sitting in the app before this task; it's now fixed by giving notifications their own proper data-access module (`src/lib/notifications.js`) instead of being an afterthought bolted onto the Work Order module.

**Trigger → recipient matrix:**

| Trigger | Requester | Technician | Supervisor (dept) | Manager |
|---|---|---|---|---|
| New Work Order | ✔ confirmation | — | ✔ needs assignment | — |
| Assignment | ✔ notified | ✔ notified | — | — |
| Status Change: Declined | — | — | ✔ needs reassignment | — |
| Status Change: Accepted | ✔ notified | — | — | — |
| Status Change: On Site | ✔ notified | — | — | — |
| Status Change: Reopened | — | ✔ notified | ✔ notified | — |
| SLA Warning (≤25% of window remaining, not yet breached) | — | ✔ (assignee) | ✔ | ✔ (P1 only) |
| SLA Breach | — | — | ✔ | ✔ (P1 only) |
| Completed Work Order | ✔ please verify | — | — | — |

Every one of the four listed roles (Requester, Technician, Supervisor, Manager) genuinely receives at least two distinct notification types — this was checked deliberately rather than assumed, since a "notify X" requirement that turns out to route zero real triggers to X is a common way these lists go unfulfilled quietly.

**SLA Warning vs. SLA Breach** are two separate scheduled functions (`slaWarningSweep`, `slaBreachSweep`), both every 5 minutes, each guarded by its own boolean (`sla_warning_sent`, `sla_breached`) so a work order is only ever notified once per threshold crossed, not on every subsequent sweep. Warning fires at ≤25% of the total resolution window remaining; breach fires once the deadline has actually passed. Manager escalation is P1-only for both — deliberately not every work order, so Manager's notifications stay meaningful (system-wide critical issues) rather than becoming noise.

**New/changed files:**
- `src/lib/notifications.js` (new) — `listenNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `pathForNotification`, and `NOTIFICATION_META` (icon/color/label per type, one source of truth both the bell and the full notifications page read from).
- `src/components/NotificationBell.jsx` (rewritten) — fixed the broken import, added per-type icons/colors, relative timestamps, and "mark all read".
- `src/app/notifications/page.jsx` (new) — full notification history (last 100, vs. the bell's last 30), filterable by type — the complete in-app notification center, not just the dropdown preview.
- `src/components/AppShell.jsx` — sidebar nav is now real links (previously "Work Orders" was unclickable static text with no way back to the Dashboard at all); added Dashboard and Notifications entries with active-state highlighting.
- `functions/index.js` — added the Requester "submitted" confirmation, two new Status Change notifications (Accepted, On Site → Requester), extended Reopened to also notify department Supervisors, added `getManagers()`, and the new `slaWarningSweep` function alongside the existing `slaBreachSweep`.
