# Sequential SLA stages, per-stage overdue, P8 and SLA extension — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every priority's SLA stages start when the previous stage finished, make "overdue" mean the stage it is sitting in is late, add a month-long P8, and let an Administrator extend a work order that is running out of time.

**Architecture:** Five migrations, applied in order, each independently pushable and reviewable: the sequential conversion and the new per-stage columns; the sweeps and dashboard readers that consume them; the backfill of every existing work order; the two enum labels; and P8's rows plus the extension RPC. On the client, two pure modules (`slaStages.js`, `slaExtension.js`) own all the arithmetic and are the only things with unit checks, exactly as `exportWorkOrders.js` and `chartPeriods.js` are. The extension is 0051's override machinery behind a second door.

**Tech Stack:** Postgres 15 / Supabase (RLS, plpgsql triggers, pg_cron), Next.js 14 static export, React 18, Tailwind, `node:assert` scripts run directly with `node` (there is no test runner in this repo).

**Spec:** `docs/superpowers/specs/2026-09-19-sequential-sla-and-extension-design.md`

## Global Constraints

- **The database is the authorization boundary.** A client predicate hides UI the policy would reject anyway; it never grants. Every rule added to the RPC is restated in the RPC's own body because RLS does not apply inside SECURITY DEFINER.
- **Components never import `supabase` directly.** They call a function in `src/lib/*`.
- **Every new function pins `search_path`** in the `create` header and issues `revoke all ... from public, anon` immediately after, granting `authenticated` only where a caller in the browser needs it. Trigger bodies are revoked from `authenticated` too.
- **A migration file can never be numbered between two existing ones.** The CLI orders by filename and every digit sorts below `_`.
- **`db push` silently skips a version already applied on the shared test project.** Check `npm run env:which` and the applied list before writing files, and renumber if 0067–0071 are taken.
- **Never run `npm run build` while `npm run dev` is live** — they share `.next` and the production build corrupts the dev cache.
- **`npm run lint` is broken** (Next 16 removed `next lint`). `npm run build` is the compile check.
- **A successful `db push` is not evidence that a plpgsql function works** — bodies are not parsed until called. Exercise every branch.
- **Never run `supabase config push` while linked to production.**
- Stage durations, in minutes, are exactly: P1 `5 / 10 / 225`, P2 `15 / 45 / 420`, P3 `30 / 210 / 1200`, P4 `120 / 1320 / 5760`, P7 `7200 / 4320 / 10080` (unchanged), P8 `7200 / 7200 / 28800`.
- P8's colour is `#0891B2`, rank `8`, label `Scheduled`. Its impact level is `scheduled`, sort order `6`.
- All work is on the current branch in this worktree. Commit after every task.

---

## File Structure

| File | Responsibility |
|---|---|
| `app/supabase/migrations/0067_sla_stages_start_when_the_last_one_finished.sql` | Sequential targets, four new columns, `si_open_sla_stage` + two companions, `si_stamp_work_order` |
| `app/supabase/migrations/0068_overdue_means_the_open_stage.sql` | Both pg_cron sweeps, `si_compute_dashboard_stats`, `si_dashboard_card_rows` |
| `app/supabase/migrations/0069_recompute_every_sla_under_the_new_model.sql` | The backfill, and nothing else |
| `app/supabase/migrations/0070_p8_and_scheduled_enum_values.sql` | Two enum labels, nothing else |
| `app/supabase/migrations/0071_p8_and_extending_an_sla.sql` | P8's three reference rows, dashboard P8 branches, `sla_extension_count`, guard amendment, `si_extend_work_order_sla` |
| `app/src/lib/slaStages.js` | Which stage is open, when it started, when it is due, and whether each finished stage met its target. Pure. |
| `app/src/lib/slaExtension.js` | Given a work order and the reference data, which priorities would buy it time and how much. Pure. |
| `app/src/lib/constants.js` | `canExtendSla`, and the overdue/at-risk predicates the dashboard shares |
| `app/src/lib/workOrders.js` | `extendWorkOrderSla` |
| `app/src/lib/historyEvents.js` | The `sla_extension` label |
| `app/src/lib/exportWorkOrders.js` | Three stage-breach columns and the extension count |
| `app/src/components/workorders/ExtendSlaDialog.jsx` | The confirm dialog |
| `app/src/components/workorders/WorkOrderDetail.jsx` | The Extend SLA button, and per-stage marks on the SLA card |
| `app/src/components/dashboard/RoleDashboard.jsx` | Overdue and at-risk buckets |
| `app/scripts/checks/slaStages.check.mjs` | Node assertions for `slaStages.js` |
| `app/scripts/checks/slaExtension.check.mjs` | Node assertions for `slaExtension.js` |
| `app/scripts/checks/backfillReport.mjs` | Prints the before/after table for the §3.3 review gate |

**Deviation from the spec, deliberate:** the spec named three migrations. This plan uses five, splitting the sweeps and the backfill into files of their own. Each is separately reviewable and separately pushable, and the backfill — the one irreversible step — is then a file that can be read on its own.

---

## Task 1: The pure stage module

**Files:**
- Modify: `app/src/lib/slaStages.js` (append; `slaStages()` and `fmtElapsed()` are untouched)
- Create: `app/scripts/checks/slaStages.check.mjs`
- Modify: `app/package.json` (add the `check:units` script)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `openSlaStage(wo) -> "acknowledge" | "response" | "resolution" | null`
  - `openStageStartedAt(wo) -> string | null` (ISO)
  - `openStageDueAt(wo) -> string | null` (ISO)
  - `openStageRemainMs(wo, now?) -> number | null`
  - `isStageOverdue(wo, now?) -> boolean`
  - `isStageAtRisk(wo, now?) -> boolean`
  - `STAGE_LABELS: { acknowledge: "Acknowledge", response: "Response", resolution: "Resolution" }`

- [ ] **Step 1: Write the failing check**

Create `app/scripts/checks/slaStages.check.mjs`:

```js
/**
 * Node assertions for lib/slaStages.js. There is no test runner in this repo;
 * this file is run directly with `node` and throws on the first failure.
 *
 * Run: node scripts/checks/slaStages.check.mjs
 */
import assert from "node:assert/strict";
import {
  openSlaStage,
  openStageStartedAt,
  openStageDueAt,
  openStageRemainMs,
  isStageOverdue,
  isStageAtRisk,
} from "../../src/lib/slaStages.js";

const T0 = Date.parse("2026-09-19T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;

// A work order raised at T0, nothing else stamped: the acknowledge stage is
// open and it is due 5 minutes in.
const raised = {
  status: "open",
  created_at: iso(T0),
  acknowledged_at: null,
  responded_at: null,
  sla_ack_due_at: iso(T0 + 5 * MIN),
  sla_response_due_at: null,
  sla_resolution_due_at: null,
};

assert.equal(openSlaStage(raised), "acknowledge");
assert.equal(openStageStartedAt(raised), raised.created_at);
assert.equal(openStageDueAt(raised), raised.sla_ack_due_at);
assert.equal(openStageRemainMs(raised, T0 + 1 * MIN), 4 * MIN);
assert.equal(isStageOverdue(raised, T0 + 1 * MIN), false);
assert.equal(isStageOverdue(raised, T0 + 6 * MIN), true);

// At risk is the last quarter of the stage's own window, mirroring
// si_sla_warning_sweep. A 5-minute stage is at risk with 75 seconds left.
assert.equal(isStageAtRisk(raised, T0 + 3 * MIN), false);
assert.equal(isStageAtRisk(raised, T0 + 4 * MIN), true);
// Already overdue is NOT "at risk" — the two buckets must not double-count.
assert.equal(isStageAtRisk(raised, T0 + 6 * MIN), false);

// Assigned at T0+3: the response stage is open, measured from the assignment.
const assigned = {
  ...raised,
  status: "assigned",
  acknowledged_at: iso(T0 + 3 * MIN),
  sla_response_due_at: iso(T0 + 13 * MIN),
};
assert.equal(openSlaStage(assigned), "response");
assert.equal(openStageStartedAt(assigned), assigned.acknowledged_at);
assert.equal(openStageDueAt(assigned), assigned.sla_response_due_at);
assert.equal(openStageRemainMs(assigned, T0 + 10 * MIN), 3 * MIN);

// Work started: the resolution stage is open.
const repairing = {
  ...assigned,
  status: "repairing",
  responded_at: iso(T0 + 10 * MIN),
  sla_resolution_due_at: iso(T0 + 235 * MIN),
};
assert.equal(openSlaStage(repairing), "resolution");
assert.equal(openStageStartedAt(repairing), repairing.responded_at);

// Finished work has no open stage and is never overdue or at risk, whatever
// its deadlines say — a countdown on a finished job is a deadline for nothing.
for (const status of ["completed", "closed"]) {
  const done = { ...repairing, status, sla_resolution_due_at: iso(T0 - MIN) };
  assert.equal(openSlaStage(done), null);
  assert.equal(openStageDueAt(done), null);
  assert.equal(openStageRemainMs(done), null);
  assert.equal(isStageOverdue(done), false);
  assert.equal(isStageAtRisk(done), false);
}

// A stage with no stored deadline cannot be missed. Reachable on rows the
// stamp trigger never touched — see migration 0062's three.
const noDeadline = { ...raised, sla_ack_due_at: null };
assert.equal(openStageDueAt(noDeadline), null);
assert.equal(openStageRemainMs(noDeadline), null);
assert.equal(isStageOverdue(noDeadline, T0 + 999 * MIN), false);
assert.equal(isStageAtRisk(noDeadline, T0 + 999 * MIN), false);

// Null-safe throughout: these are called on rows arriving from a live query.
assert.equal(openSlaStage(null), null);
assert.equal(openStageDueAt(undefined), null);
assert.equal(isStageOverdue(null), false);

console.log("slaStages: all assertions passed");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && node scripts/checks/slaStages.check.mjs
```

Expected: `SyntaxError: The requested module '../../src/lib/slaStages.js' does not provide an export named 'openSlaStage'`.

- [ ] **Step 3: Implement**

Append to `app/src/lib/slaStages.js`:

```js
/* ------------------------------------------------------------------
   Which stage is open, and how it is doing — migration 0067.

   Every priority is sequential now, so "the SLA" is no longer one
   countdown: a work order is inside exactly one stage at a time and it is
   that stage's deadline that can be missed. These five functions are the
   client mirror of si_open_sla_stage / si_open_stage_started_at /
   si_open_stage_due_at, and the pairing is the point — the dashboard's
   Overdue card and the sweep that writes sla_stage_overdue have to put the
   line in the same place, the way slaWindowMs() already mirrors
   si_sla_warning_sweep()'s 25%.

   `openSlaStage` tests the finished statuses FIRST, before the two
   timestamps. A work order can reach `closed` with `acknowledged_at` never
   stamped — 0062 found three of them on the test project — and asking
   about its acknowledge stage would report a job finished in June as
   currently late.
   ------------------------------------------------------------------ */

export const STAGE_LABELS = {
  acknowledge: "Acknowledge",
  response: "Response",
  resolution: "Resolution",
};

const FINISHED = ["completed", "closed"];

export function openSlaStage(wo) {
  if (!wo) return null;
  if (FINISHED.includes(wo.status)) return null;
  if (!wo.acknowledged_at) return "acknowledge";
  if (!wo.responded_at) return "response";
  return "resolution";
}

export function openStageStartedAt(wo) {
  switch (openSlaStage(wo)) {
    case "acknowledge":
      return wo.created_at ?? null;
    case "response":
      return wo.acknowledged_at ?? null;
    case "resolution":
      return wo.responded_at ?? null;
    default:
      return null;
  }
}

export function openStageDueAt(wo) {
  switch (openSlaStage(wo)) {
    case "acknowledge":
      return wo.sla_ack_due_at ?? null;
    case "response":
      return wo.sla_response_due_at ?? null;
    case "resolution":
      return wo.sla_resolution_due_at ?? null;
    default:
      return null;
  }
}

/** Milliseconds left in the open stage. Null when there is no stage or no
 *  deadline stored for it — which every caller renders as "—" and counts in
 *  neither bucket. A deadline that has not started cannot be missed. */
export function openStageRemainMs(wo, now = Date.now()) {
  const due = at(openStageDueAt(wo));
  return due == null ? null : due - now;
}

export function isStageOverdue(wo, now = Date.now()) {
  const remain = openStageRemainMs(wo, now);
  return remain != null && remain < 0;
}

/** The last quarter of the OPEN STAGE's own window, which is what
 *  si_sla_warning_sweep measures after 0068. Overdue is excluded rather than
 *  implied: the two dashboard buckets are shown side by side and a work order
 *  counted in both would make them add up to more than the pile. */
export function isStageAtRisk(wo, now = Date.now()) {
  const remain = openStageRemainMs(wo, now);
  if (remain == null || remain < 0) return false;
  const started = at(openStageStartedAt(wo));
  const due = at(openStageDueAt(wo));
  if (started == null || due == null) return false;
  const windowMs = due - started;
  return windowMs > 0 && remain < windowMs * 0.25;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd app && node scripts/checks/slaStages.check.mjs
```

Expected: `slaStages: all assertions passed`.

- [ ] **Step 5: Add the npm script**

In `app/package.json`, inside `"scripts"`, after `"check:env"`:

```json
"check:units": "node scripts/checks/slaStages.check.mjs && node scripts/checks/slaExtension.check.mjs",
```

`check:units` will fail until Task 2 creates the second file; that is expected and is fixed by Task 2.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/slaStages.js app/scripts/checks/slaStages.check.mjs app/package.json
git commit -m "slaStages: which stage is open, and whether it is late"
```

---

## Task 2: The suggestion module

**Files:**
- Create: `app/src/lib/slaExtension.js`
- Create: `app/scripts/checks/slaExtension.check.mjs`

**Interfaces:**
- Consumes: `openSlaStage`, `openStageStartedAt`, `openStageDueAt` from Task 1.
- Produces:
  - `extensionOptions(wo, priorities, slaFor, now?) -> Option[]` where
    `Option = { id, label, rank, dueAt: number|null, gainMs: number|null, clears: boolean }`
  - `suggestExtension(wo, priorities, slaFor, now?) -> { stage, options, suggested, anyClears }`
  - `priorities` is the full rows array from `useReferenceData().priorities`
    (`{ id, label, rank, is_active }`).
  - `slaFor` is a function `(priorityId) => slaRow | null`, satisfied by
    `useReferenceData().slaForPriority`.

- [ ] **Step 1: Write the failing check**

Create `app/scripts/checks/slaExtension.check.mjs`:

```js
/**
 * Node assertions for lib/slaExtension.js.
 * Run: node scripts/checks/slaExtension.check.mjs
 */
import assert from "node:assert/strict";
import { extensionOptions, suggestExtension } from "../../src/lib/slaExtension.js";

const T0 = Date.parse("2026-09-19T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;

const PRIORITIES = [
  { id: "P1", label: "Critical", rank: 1, is_active: true },
  { id: "P2", label: "High", rank: 2, is_active: true },
  { id: "P3", label: "Medium", rank: 3, is_active: true },
  { id: "P4", label: "Low", rank: 4, is_active: true },
  { id: "P7", label: "Long-term", rank: 7, is_active: true },
  { id: "P8", label: "Scheduled", rank: 8, is_active: true },
];

const TARGETS = {
  P1: [5, 10, 225],
  P2: [15, 45, 420],
  P3: [30, 210, 1200],
  P4: [120, 1320, 5760],
  P7: [7200, 4320, 10080],
  P8: [7200, 7200, 28800],
};

const slaFor = (id) =>
  TARGETS[id]
    ? {
        ack_target_minutes: TARGETS[id][0],
        response_target_minutes: TARGETS[id][1],
        resolution_target_minutes: TARGETS[id][2],
        targets_are_sequential: true,
      }
    : null;

// ---------------------------------------------------------------------------
// A P1 stuck at the acknowledge stage: raised at T0, due T0+5, now T0+20.
// P2's ack stage is 15 min from the raise (still past), P3's is 30 (clears).
// ---------------------------------------------------------------------------
const stuckAtAck = {
  priority: "P1",
  status: "open",
  created_at: iso(T0),
  acknowledged_at: null,
  responded_at: null,
  sla_ack_due_at: iso(T0 + 5 * MIN),
  sla_response_due_at: null,
  sla_resolution_due_at: null,
};

const opts = extensionOptions(stuckAtAck, PRIORITIES, slaFor, T0 + 20 * MIN);
assert.deepEqual(
  opts.map((o) => o.id),
  ["P2", "P3", "P4", "P7", "P8"],
  "only less urgent priorities are offered, in rank order"
);
assert.equal(opts[0].dueAt, T0 + 15 * MIN);
assert.equal(opts[0].gainMs, 10 * MIN, "P2 buys 10 more minutes than P1");
assert.equal(opts[0].clears, false, "P2's deadline is still in the past");
assert.equal(opts[1].id, "P3");
assert.equal(opts[1].clears, true, "P3's 30-minute ack stage reaches past now");

const s = suggestExtension(stuckAtAck, PRIORITIES, slaFor, T0 + 20 * MIN);
assert.equal(s.stage, "acknowledge");
assert.equal(s.anyClears, true);
assert.equal(s.suggested.id, "P3", "the smallest step that actually clears it");

// ---------------------------------------------------------------------------
// Nothing clears it: the same work order five days later. The last rung is
// suggested and anyClears says so, because offering nothing is worse than
// offering the most time available and saying it is not enough.
// ---------------------------------------------------------------------------
const late = suggestExtension(stuckAtAck, PRIORITIES, slaFor, T0 + 20000 * MIN);
assert.equal(late.anyClears, false);
assert.equal(late.suggested.id, "P8");
assert.equal(late.suggested.clears, false);

// ---------------------------------------------------------------------------
// The resolution stage is measured from responded_at, not from the raise.
// ---------------------------------------------------------------------------
const repairing = {
  priority: "P1",
  status: "repairing",
  created_at: iso(T0),
  acknowledged_at: iso(T0 + 3 * MIN),
  responded_at: iso(T0 + 10 * MIN),
  sla_ack_due_at: iso(T0 + 5 * MIN),
  sla_response_due_at: iso(T0 + 13 * MIN),
  sla_resolution_due_at: iso(T0 + 235 * MIN),
};
const r = suggestExtension(repairing, PRIORITIES, slaFor, T0 + 240 * MIN);
assert.equal(r.stage, "resolution");
// P2's resolution stage is 420 min from responded_at = T0+430.
assert.equal(r.options[0].dueAt, T0 + 430 * MIN);
assert.equal(r.options[0].gainMs, (430 - 235) * MIN);
assert.equal(r.suggested.id, "P2", "P2 alone is enough here");

// ---------------------------------------------------------------------------
// A retired priority is never offered. Same rule as every other picker: the
// row stays so old work orders still render, and stops being choosable.
// ---------------------------------------------------------------------------
const retired = PRIORITIES.map((p) => (p.id === "P2" ? { ...p, is_active: false } : p));
assert.deepEqual(
  extensionOptions(stuckAtAck, retired, slaFor, T0 + 20 * MIN).map((o) => o.id),
  ["P3", "P4", "P7", "P8"]
);

// ---------------------------------------------------------------------------
// A finished work order has no open stage, so there is nothing to extend.
// ---------------------------------------------------------------------------
const closed = suggestExtension({ ...repairing, status: "closed" }, PRIORITIES, slaFor, T0);
assert.equal(closed.stage, null);
assert.deepEqual(closed.options, []);
assert.equal(closed.suggested, null);

// ---------------------------------------------------------------------------
// A stage whose clock has not started has no deadline to move. It is still
// offered, with dueAt null, and the dialog says so rather than inventing a
// date — reachable on a P7 whose work has not begun.
// ---------------------------------------------------------------------------
const unstarted = {
  priority: "P7",
  status: "assigned",
  created_at: iso(T0),
  acknowledged_at: null,
  responded_at: null,
  sla_ack_due_at: iso(T0 + 7200 * MIN),
  sla_response_due_at: null,
  sla_resolution_due_at: null,
};
const u = extensionOptions(unstarted, PRIORITIES, slaFor, T0);
assert.deepEqual(u.map((o) => o.id), ["P8"]);
assert.equal(u[0].dueAt, T0 + 7200 * MIN, "P8's ack stage is also 5 days");
assert.equal(u[0].gainMs, 0);

// Null-safe.
assert.deepEqual(extensionOptions(null, PRIORITIES, slaFor, T0), []);
assert.equal(suggestExtension(null, PRIORITIES, slaFor, T0).suggested, null);

console.log("slaExtension: all assertions passed");
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd app && node scripts/checks/slaExtension.check.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `src/lib/slaExtension.js`.

- [ ] **Step 3: Implement**

Create `app/src/lib/slaExtension.js`:

```js
/**
 * SI — Service Inside · What extending a work order's SLA would buy it
 *
 * Extending is re-grading to a less urgent priority, which under migration
 * 0067 gives the stage the work order is actually sitting in a longer window.
 * This module answers the dialog's two questions — which priorities are on
 * offer, and which is the smallest one that stops the work order being late —
 * and answers nothing else.
 *
 * **Advisory only.** si_extend_work_order_sla validates that the target is
 * strictly less urgent and re-checks the Administrator, the status and the
 * at-risk gate in its own body. Nothing here is a permission: the worst a
 * wrong answer can do is pre-select the wrong radio button.
 *
 * Pure — no React, no Supabase — for the reason exportWorkOrders.js,
 * chartPeriods.js and slaStages.js are: it is what lets every boundary be
 * exercised in Node, which is the only place this repo can run a test.
 */
import { openSlaStage, openStageStartedAt, openStageDueAt } from "./slaStages";

const MIN = 60000;

const at = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

const STAGE_TARGET_KEY = {
  acknowledge: "ack_target_minutes",
  response: "response_target_minutes",
  resolution: "resolution_target_minutes",
};

/**
 * Every priority less urgent than this work order's, in rank order, with what
 * the open stage's deadline would become under each.
 *
 * Rank ascending is severity descending — 1 is most severe — so "less urgent"
 * is a GREATER rank. The server enforces the same comparison; extending can
 * only ever grant time, which is the whole meaning of the word.
 *
 * `dueAt` is null when the open stage's clock has not started, which is
 * reachable on any sequential priority: the caller says so rather than showing
 * a date nothing promised.
 */
export function extensionOptions(wo, priorities, slaFor, now = Date.now()) {
  const stage = openSlaStage(wo);
  if (!stage || !Array.isArray(priorities) || typeof slaFor !== "function") return [];

  const current = (priorities || []).find((p) => p.id === wo.priority);
  const currentRank = current?.rank;
  if (currentRank == null) return [];

  const startedAt = at(openStageStartedAt(wo));
  const currentDue = at(openStageDueAt(wo));
  const key = STAGE_TARGET_KEY[stage];

  return priorities
    .filter((p) => p.is_active !== false && p.rank != null && p.rank > currentRank)
    .sort((a, b) => a.rank - b.rank)
    .map((p) => {
      const sla = slaFor(p.id);
      const minutes = sla?.[key];
      const dueAt = startedAt != null && minutes != null ? startedAt + minutes * MIN : null;
      return {
        id: p.id,
        label: p.label ?? p.id,
        rank: p.rank,
        dueAt,
        /* Null rather than 0 when either deadline is unknown: "we cannot say
           how much this buys" and "this buys nothing" are different claims. */
        gainMs: dueAt != null && currentDue != null ? dueAt - currentDue : null,
        clears: dueAt != null && dueAt > now,
      };
    });
}

/**
 * The options plus the one to pre-select: the smallest step whose deadline
 * lands in the future.
 *
 * When none of them clears it — a work order a month past a five-minute
 * acknowledge stage — the LAST rung is suggested and `anyClears` is false, so
 * the dialog can say the extension still leaves it overdue. Offering nothing
 * would be the wrong answer to a real situation: the most time available is
 * still the most time available.
 */
export function suggestExtension(wo, priorities, slaFor, now = Date.now()) {
  const stage = openSlaStage(wo);
  const options = extensionOptions(wo, priorities, slaFor, now);
  const clearing = options.find((o) => o.clears) || null;
  return {
    stage,
    options,
    anyClears: !!clearing,
    suggested: clearing || options[options.length - 1] || null,
  };
}
```

- [ ] **Step 4: Run both checks to verify they pass**

```bash
cd app && npm run check:units
```

Expected: `slaStages: all assertions passed` then `slaExtension: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/slaExtension.js app/scripts/checks/slaExtension.check.mjs
git commit -m "slaExtension: which priority buys the open stage enough time"
```

---

## Task 3: Migration 0067 — the sequential conversion

**Files:**
- Create: `app/supabase/migrations/0067_sla_stages_start_when_the_last_one_finished.sql`

**Interfaces:**
- Consumes: `si_sla_targets(si_priority)` (0050), `si_stamp_work_order` (0050's version).
- Produces, for later tasks:
  - columns `work_orders.sla_ack_breached`, `.sla_response_breached`, `.sla_resolution_breached`, `.sla_stage_overdue` (all `boolean not null default false`)
  - `si_open_sla_stage(work_orders) -> text`
  - `si_open_stage_started_at(work_orders) -> timestamptz`
  - `si_open_stage_due_at(work_orders) -> timestamptz`

- [ ] **Step 1: Confirm the migration number is free**

```bash
cd app && npm run env:which
```

Expected: it reports the **test** project. If it reports production, run `npm run env:test` first. Then list what is applied:

```bash
cd app && npx supabase migration list
```

If `0067` already appears, renumber this task's file and every later one, keeping the order.

- [ ] **Step 2: Write the migration**

Create `app/supabase/migrations/0067_sla_stages_start_when_the_last_one_finished.sql`:

```sql
-- ============================================================================
-- SI — Service Inside · 0067 Every SLA stage starts when the last one finished
-- ============================================================================
-- P1-P4 promised their three targets as offsets from the raise time, so three
-- hours spent finding a technician came out of the technician's four hours. P7
-- has not worked that way since 0050, and the split was never a design — it was
-- P7 arriving with a better model and the older four being left alone because
-- converting them looked like a change to the promise.
--
-- It is not, and that is the whole of section 1. The old numbers are CUMULATIVE
-- offsets; sequential numbers are stage DURATIONS; converting one to the other
-- is `stage(n) = cumulative(n) - cumulative(n-1)`. Every priority's headline
-- figure is the number it has had since 0006, and a work order whose stages all
-- complete exactly on time gets its resolution deadline at the same instant it
-- would have today.
--
--   P1  5 / 10  / 225   = 4 hrs        P3  30  / 210  / 1200  = 24 hrs
--   P2  15 / 45 / 420   = 8 hrs        P4  120 / 1320 / 5760  = 5 days
--
-- Accepted consequence, stated because it is the model rather than a rounding
-- error: a team that BEATS a stage target finishes earlier too. Respond to a P1
-- in two minutes and the repair is due at 3h47m from the fault, not 4h. It
-- never works the other way — an overrunning stage does not shorten the next
-- one, because the next one starts when the previous one actually completed.
--
-- ---------------------------------------------------------------------------
-- 2. Per-stage breach, and an overdue that clears
-- ---------------------------------------------------------------------------
-- `sla_breached` is a permanent record: the export reports it, the FSD forbids
-- clearing it by the passage of time, and 0051 treats clearing it as an
-- exception needing a named Administrator. The behaviour wanted on the
-- dashboard is the opposite — a work order nine minutes late to be assigned
-- should stop being "overdue" the moment it IS assigned, because the card
-- answers "what is late right now".
--
-- Those are two different facts, so they get two different sets of columns:
--
--   sla_ack_breached / sla_response_breached / sla_resolution_breached
--       STICKY. Set when that stage's deadline passed with the stage
--       unfinished, never cleared. This is what the work order's own SLA card
--       shows stage by stage and what the export reads.
--   sla_stage_overdue
--       TRANSIENT. True only while the stage the work order is CURRENTLY in is
--       past its deadline. This is what the dashboard's Overdue card counts.
--
-- `sla_breached` is kept and redefined as "any stage was ever missed", so every
-- existing reader keeps working and the export's heading does not churn.
--
-- ---------------------------------------------------------------------------
-- 3. Which stage is open — one definition, three readers
-- ---------------------------------------------------------------------------
-- si_open_sla_stage() states the chain once. The sweeps, the dashboard and the
-- extension RPC all call it rather than restating it, because two definitions
-- of one rule is what suggestPriority() vs si_derive_priority() already costs
-- this schema.
--
-- It tests the FINISHED statuses FIRST, before either timestamp. A work order
-- can reach `closed` with `acknowledged_at` never stamped — 0062 found three
-- such rows on the test project, closed by a route that never fired the stamp
-- trigger — and asking about its acknowledge stage would report a job finished
-- in June as currently late, forever.
--
-- ---------------------------------------------------------------------------
-- 4. si_stamp_work_order recomputes sla_stage_overdue rather than clearing it
-- ---------------------------------------------------------------------------
-- The obvious version is `if the stage advanced then sla_stage_overdue :=
-- false`. Recomputing from the new stage's own deadline is strictly better and
-- no longer: it is correct when the stage advances INTO one that is already
-- late (reachable whenever a stage target is shorter than the sweep's five
-- minutes — P1's response stage is ten), and it needs no comparison of old to
-- new. The sweep then only has to handle the passage of time.
--
-- The sticky flags are set on the stage being LEFT, judged against that stage's
-- own stored deadline and the moment it actually completed — never against
-- now(), which would make a late assignment look punctual if the trigger
-- happened to run later.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The targets. Cumulative -> incremental; the totals are unchanged.
-- ---------------------------------------------------------------------------
update sla set ack_target_minutes = 5,   ack_target_label        = '5 min',
               response_target_minutes = 10,  response_target_label   = '10 min after assignment',
               resolution_target_minutes = 225, resolution_target_label = '3 hrs 45 min after work starts',
               targets_are_sequential = true
 where priority_id = 'P1';

update sla set ack_target_minutes = 15,  ack_target_label        = '15 min',
               response_target_minutes = 45,  response_target_label   = '45 min after assignment',
               resolution_target_minutes = 420, resolution_target_label = '7 hrs after work starts',
               targets_are_sequential = true
 where priority_id = 'P2';

update sla set ack_target_minutes = 30,  ack_target_label        = '30 min',
               response_target_minutes = 210, response_target_label   = '3 hrs 30 min after assignment',
               resolution_target_minutes = 1200, resolution_target_label = '20 hrs after work starts',
               targets_are_sequential = true
 where priority_id = 'P3';

update sla set ack_target_minutes = 120, ack_target_label        = '2 hrs',
               response_target_minutes = 1320, response_target_label   = '22 hrs after assignment',
               resolution_target_minutes = 5760, resolution_target_label = '4 days after work starts',
               targets_are_sequential = true
 where priority_id = 'P4';

-- P7's numbers were authored sequentially in 0050 and are untouched. Stated
-- rather than skipped so the flag is true on every row without exception.
update sla set targets_are_sequential = true where priority_id = 'P7';

-- ---------------------------------------------------------------------------
-- si_sla_targets: the fallbacks follow the seeds, and `sequential` is now
-- unconditional. The fallbacks matter — a priority with no `sla` row at all
-- would otherwise silently get 0050's from-creation numbers under a sequential
-- reading, which is the one combination nothing in this schema means.
-- ---------------------------------------------------------------------------
create or replace function si_sla_targets(p si_priority)
returns table (
  ack         int,
  response    int,
  resolution  int,
  sequential  boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  select s.ack_target_minutes,
         s.response_target_minutes,
         s.resolution_target_minutes,
         coalesce(s.targets_are_sequential, true)
    into ack, response, resolution, sequential
    from sla s
   where s.priority_id = p and s.plant_id is null
   limit 1;

  if ack is null then
    ack := case p when 'P1' then 5 when 'P2' then 15 when 'P3' then 30
                  when 'P7' then 7200 else 120 end;
  end if;

  if response is null then
    response := case p when 'P1' then 10 when 'P2' then 45 when 'P3' then 210
                       when 'P7' then 4320 else 1320 end;
  end if;

  if resolution is null then
    resolution := case p when 'P1' then 225 when 'P2' then 420 when 'P3' then 1200
                         when 'P7' then 10080 else 5760 end;
  end if;

  -- Every priority is sequential now. Left as an assignment rather than
  -- deleted so the column stays the thing that decides, which is what keeps
  -- the model data instead of an `if` in two trigger bodies.
  if sequential is null then sequential := true; end if;

  return next;
end;
$$;

revoke all on function si_sla_targets(si_priority) from public, anon;
grant execute on function si_sla_targets(si_priority) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The four columns
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists sla_ack_breached        boolean not null default false;
alter table work_orders add column if not exists sla_response_breached   boolean not null default false;
alter table work_orders add column if not exists sla_resolution_breached boolean not null default false;
alter table work_orders add column if not exists sla_stage_overdue       boolean not null default false;

comment on column work_orders.sla_stage_overdue is
  'TRANSIENT: the stage this work order is currently in is past its deadline. Cleared when it advances. The dashboard Overdue card counts this; sla_*_breached are the permanent record.';

comment on column work_orders.sla_breached is
  'Any stage was ever missed — the OR of the three sla_*_breached columns. Never cleared by the passage of time.';

-- ---------------------------------------------------------------------------
-- 3. Which stage is open, when it started, when it is due
-- ---------------------------------------------------------------------------
create or replace function si_open_sla_stage(w work_orders)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when w.status in ('completed', 'closed') then null
           when w.acknowledged_at is null then 'acknowledge'
           when w.responded_at is null then 'response'
           else 'resolution'
         end;
$$;

revoke all on function si_open_sla_stage(work_orders) from public, anon;
grant execute on function si_open_sla_stage(work_orders) to authenticated, service_role;

create or replace function si_open_stage_started_at(w work_orders)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case si_open_sla_stage(w)
           when 'acknowledge' then w.created_at
           when 'response'    then w.acknowledged_at
           when 'resolution'  then w.responded_at
         end;
$$;

revoke all on function si_open_stage_started_at(work_orders) from public, anon;
grant execute on function si_open_stage_started_at(work_orders) to authenticated, service_role;

create or replace function si_open_stage_due_at(w work_orders)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select case si_open_sla_stage(w)
           when 'acknowledge' then w.sla_ack_due_at
           when 'response'    then w.sla_response_due_at
           when 'resolution'  then w.sla_resolution_due_at
         end;
$$;

revoke all on function si_open_stage_due_at(work_orders) from public, anon;
grant execute on function si_open_stage_due_at(work_orders) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The stamp trigger — 0050's body, with the stage verdicts added
--
-- Still SECURITY INVOKER, as 0003 left it, which is what decides
-- si_sla_targets' grant (see 0050 note 4) and now si_open_sla_stage's too.
-- ---------------------------------------------------------------------------
create or replace function si_stamp_work_order()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_ack  int;
  v_resp int;
  v_res  int;
  v_seq  boolean;
begin
  if new.status = old.status then return new; end if;

  -- Decline: assigned -> open with the assignee cleared.
  if old.status = 'assigned' and new.status = 'open' then
    new.decline_count := old.decline_count + 1;
    new.assigned_to_id := null;
    new.assigned_to_name := null;
  end if;

  -- First arrival only, never moved again — 0050 note 2.
  if new.status = 'assigned' then
    new.acknowledged_at := coalesce(new.acknowledged_at, now());
  end if;

  if new.status = 'repairing' then
    new.responded_at := coalesce(new.responded_at, now());
  end if;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(new.priority);

  if v_seq then
    if new.acknowledged_at is not null and new.sla_response_due_at is null then
      new.sla_response_due_at := new.acknowledged_at + make_interval(mins => v_resp);
    end if;
    if new.responded_at is not null and new.sla_resolution_due_at is null then
      new.sla_resolution_due_at := new.responded_at + make_interval(mins => v_res);
    end if;
  end if;

  /* The verdict on each stage as it is LEFT, judged against that stage's own
     stored deadline and the moment it actually completed. Never against now():
     the trigger runs in the same statement, but reading the clock instead of
     the stamp is the habit that makes a backfill wrong, and this body and
     0069's backfill have to agree exactly. `or` so a flag set once stays set —
     a stage cannot be un-missed, and a work order CAN re-enter a status. */
  if new.acknowledged_at is not null and old.acknowledged_at is null then
    new.sla_ack_breached := new.sla_ack_breached
      or (new.sla_ack_due_at is not null and new.acknowledged_at > new.sla_ack_due_at);
  end if;

  if new.responded_at is not null and old.responded_at is null then
    new.sla_response_breached := new.sla_response_breached
      or (new.sla_response_due_at is not null and new.responded_at > new.sla_response_due_at);
  end if;

  if new.status = 'completed' then
    new.resolved_at := now();
    /* The resolution stage ends at `completed`, not at `closed`: since 0061
       closure is automatic and happens in the same breath, so judging it at
       `closed` would measure the trigger's own second UPDATE. */
    new.sla_resolution_breached := new.sla_resolution_breached
      or (new.sla_resolution_due_at is not null and now() > new.sla_resolution_due_at);
  end if;

  if new.status = 'closed' then
    new.closed_at := now();
    /* Repeated for a work order that reaches `closed` without passing through
       `completed`. Idempotent, because of the `or`. `verified_at` is NOT
       stamped here — 0061 removed that line and closure no longer means
       verified. */
    new.sla_resolution_breached := new.sla_resolution_breached
      or (new.sla_resolution_due_at is not null and now() > new.sla_resolution_due_at);
  end if;

  -- The permanent record is the OR of the three. One place computes it.
  new.sla_breached := new.sla_ack_breached
                   or new.sla_response_breached
                   or new.sla_resolution_breached;

  /* Recomputed, not cleared — see note 4. Correct when the work order advances
     into a stage that is ALREADY late, which P1's ten-minute response stage
     reaches inside one sweep interval. */
  new.sla_stage_overdue := (si_open_stage_due_at(new) is not null
                            and si_open_stage_due_at(new) < now());

  return new;
end;
$$;
```

- [ ] **Step 3: Apply it to test and verify the seeds**

```bash
cd app && npm run env:which && npm run db:push
```

Then confirm the four sets of numbers and that every row is sequential:

```bash
cd app && node -e "require('dotenv').config({path:'.env.local'});const{Client}=require('pg');const c=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query('select priority_id,ack_target_minutes a,response_target_minutes r,resolution_target_minutes x,targets_are_sequential s,a+r+x total from sla order by priority_id')).then(r=>{console.table(r.rows);return c.end()})"
```

Expected: P1 `5/10/225` total 240, P2 `15/45/420` total 480, P3 `30/210/1200` total 1440, P4 `120/1320/5760` total 7200, P7 `7200/4320/10080`, and `s` true on every row. If `SUPABASE_DB_URL` is not in `.env.local`, use the pooler connection string from the Supabase dashboard (Settings → Database → Connection pooling) — this is the route recorded in memory as the one that works.

- [ ] **Step 4: Exercise `si_open_sla_stage`'s four branches**

A plpgsql body is not parsed until it is called and these are the functions everything else leans on:

```sql
-- Run in a transaction that is rolled back.
begin;
select si_open_sla_stage(w), si_open_stage_started_at(w), si_open_stage_due_at(w), w.status
  from work_orders w
 order by w.created_at desc
 limit 20;
rollback;
```

Expected: no error; `acknowledge` on rows with no `acknowledged_at`, `response` where it is set but `responded_at` is not, `resolution` on live rows with both, and NULL on every `completed` / `closed` row including any whose stamps are missing.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0067_sla_stages_start_when_the_last_one_finished.sql
git commit -m "0067: every SLA stage starts when the last one finished"
```

---

## Task 4: Migration 0068 — overdue means the open stage

**Files:**
- Create: `app/supabase/migrations/0068_overdue_means_the_open_stage.sql`

**Interfaces:**
- Consumes: `si_open_sla_stage`, `si_open_stage_started_at`, `si_open_stage_due_at`, the four columns (Task 3).
- Produces: `si_sla_breach_sweep()` and `si_sla_warning_sweep()` working per stage; `stats.dashboard_cards -> overdue` counting `sla_stage_overdue`; `si_dashboard_card_rows('overdue', …)` following it.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0068_overdue_means_the_open_stage.sql`:

```sql
-- ============================================================================
-- SI — Service Inside · 0068 "Overdue" means the stage it is sitting in
-- ============================================================================
-- 0067 added the columns; this is what writes and reads them.
--
-- ---------------------------------------------------------------------------
-- 1. The breach sweep works per stage, and notifies once per stage
-- ---------------------------------------------------------------------------
-- The old sweep's guard was `sla_breached = false`, which made it fire exactly
-- once per work order ever. Per stage that is wrong in both directions: a work
-- order late to be assigned AND later late to be fixed is two facts and two
-- notifications, and without a guard of its own the same late stage would
-- announce itself every five minutes forever.
--
-- So the guard is "this stage's own sticky flag is not set yet". It follows
-- that the sweep is idempotent, that the notification count per work order is
-- at most three, and that `sla_stage_overdue` is re-set on every pass of a
-- stage that is still late — which is what it must do, because
-- si_stamp_work_order clears it whenever the work order advances.
--
-- ---------------------------------------------------------------------------
-- 2. The warning window is the stage's, not the work order's
-- ---------------------------------------------------------------------------
-- `(due - created_at) * 0.25` described a window that no longer exists: on a
-- sequential priority the resolution deadline is measured from `responded_at`,
-- so subtracting `created_at` includes every stage before it and puts the
-- warning threshold somewhere nothing means. It becomes
-- `(due - stage_start) * 0.25`, which is what isStageAtRisk() computes on the
-- client, so the button, the banner and the notification agree.
--
-- `sla_warning_sent` stays one flag per work order rather than becoming three.
-- That is a deliberate non-change: it is a courtesy ping, `notifications` still
-- has no retention, and one warning per work order is the volume this table
-- was sized for. The consequence — a work order warned about its acknowledge
-- stage is not warned again about its resolution stage — is accepted.
--
-- ---------------------------------------------------------------------------
-- 3. The dashboard's Overdue card changes meaning, visibly and on purpose
-- ---------------------------------------------------------------------------
-- It counted `sla_breached`: ever late. It counts `sla_stage_overdue`: late
-- right now. On the day this lands the figure moves in both directions — work
-- stuck at an early stage appears that never did, and long-overdue work whose
-- stage has since advanced leaves. That is the card answering a better
-- question, and the per-stage flags are where "was ever late" still lives.
--
-- The drill-down's ORDER BY moves from `sla_resolution_due_at` to
-- si_open_stage_due_at(), and it had to: on a sequential priority the
-- resolution deadline is NULL until work starts, so the old ordering sent
-- every unstarted work order — exactly the ones an Overdue list is about — to
-- the bottom under `nulls last`.
-- ============================================================================

create or replace function si_sla_breach_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_sup   uuid;
  v_mgr   uuid;
  v_count int := 0;
begin
  for r in
    with open_stage as (
      select w.id,
             si_open_sla_stage(w)    as stage,
             si_open_stage_due_at(w) as due
        from work_orders w
       where w.status <> 'closed'
    ),
    late as (
      select id, stage
        from open_stage
       where stage is not null
         and due is not null
         and due < now()
    ),
    bumped as (
      update work_orders w
         set sla_stage_overdue       = true,
             sla_ack_breached        = w.sla_ack_breached        or l.stage = 'acknowledge',
             sla_response_breached   = w.sla_response_breached   or l.stage = 'response',
             sla_resolution_breached = w.sla_resolution_breached or l.stage = 'resolution',
             sla_breached            = true
        from late l
       where w.id = l.id
         /* Only rows whose verdict actually changes, so the loop below — and
            the notification in it — runs once per stage rather than every five
            minutes for the life of the work order. */
         and ((l.stage = 'acknowledge' and not w.sla_ack_breached)
           or (l.stage = 'response'    and not w.sla_response_breached)
           or (l.stage = 'resolution'  and not w.sla_resolution_breached))
      returning w.id, w.wo_number, w.asset_name, w.department_id, w.priority, l.stage
    )
    select * from bumped
  loop
    v_count := v_count + 1;

    for v_sup in select si_department_supervisors(r.department_id) loop
      perform si_notify(v_sup, 'supervisor', r.id, r.wo_number, 'sla_breach',
        'SLA breached',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' has passed its ' || r.stage || ' SLA');
    end loop;

    if r.priority = 'P1' then
      for v_mgr in select si_managers() loop
        perform si_notify(v_mgr, 'manager', r.id, r.wo_number, 'sla_breach',
          'P1 SLA breached',
          coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
          ' is critical and has passed its ' || r.stage || ' SLA');
      end loop;
    end if;
  end loop;

  /* Rows whose stage has advanced past a deadline they had already been
     flagged for. si_stamp_work_order clears the flag on every transition, so
     this only catches a row changed by a route that did not fire it. */
  update work_orders w
     set sla_stage_overdue = false
   where w.sla_stage_overdue
     and (si_open_stage_due_at(w) is null or si_open_stage_due_at(w) >= now());

  return v_count;
end;
$$;

revoke all on function si_sla_breach_sweep() from public, anon, authenticated;

create or replace function si_sla_warning_sweep()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r       record;
  v_sup   uuid;
  v_mgr   uuid;
  v_count int := 0;
begin
  for r in
    with open_stage as (
      select w.id,
             si_open_sla_stage(w)        as stage,
             si_open_stage_started_at(w) as started,
             si_open_stage_due_at(w)     as due
        from work_orders w
       where w.status <> 'closed'
         and w.sla_warning_sent = false
    ),
    at_risk as (
      select id, stage
        from open_stage
       where stage is not null
         and due is not null
         and started is not null
         and due > now()
         and (due - now()) <= (due - started) * 0.25
    ),
    warned as (
      update work_orders w
         set sla_warning_sent = true
        from at_risk a
       where w.id = a.id
      returning w.id, w.wo_number, w.asset_name, w.department_id, w.priority,
                w.assigned_to_id, a.stage
    )
    select * from warned
  loop
    v_count := v_count + 1;

    if r.assigned_to_id is not null then
      perform si_notify(r.assigned_to_id, 'technician', r.id, r.wo_number, 'sla_warning',
        'SLA deadline approaching',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' is close to breaching its ' || r.stage || ' SLA');
    end if;

    for v_sup in select si_department_supervisors(r.department_id) loop
      perform si_notify(v_sup, 'supervisor', r.id, r.wo_number, 'sla_warning',
        'SLA deadline approaching',
        coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
        ' is close to breaching its ' || r.stage || ' SLA');
    end loop;

    if r.priority = 'P1' then
      for v_mgr in select si_managers() loop
        perform si_notify(v_mgr, 'manager', r.id, r.wo_number, 'sla_warning',
          'P1 SLA deadline approaching',
          coalesce(r.wo_number, 'A work order') || ' — ' || coalesce(r.asset_name, 'equipment') ||
          ' is critical and close to breaching its ' || r.stage || ' SLA');
      end loop;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function si_sla_warning_sweep() from public, anon, authenticated;
```

Then, in the same file, the two dashboard readers. Copy 0059's bodies verbatim and change only the marked lines:

```sql
-- ---------------------------------------------------------------------------
-- 3. The cards. 0059's body with one filter changed — see note 3.
-- ---------------------------------------------------------------------------
create or replace function si_compute_dashboard_stats()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_open     si_wo_status[] := si_open_statuses();
  v_cards    jsonb;
  v_response numeric;
begin
  select avg(extract(epoch from (h.created_at - w.created_at)) / 60)
    into v_response
    from work_order_history h
    join work_orders w on w.id = h.work_order_id
   where h.to_status = 'accepted'
     and h.created_at >= w.created_at;

  select jsonb_build_object(
    'total_open',           count(*) filter (where status = any (v_open)),
    'p1_critical',          count(*) filter (where status = any (v_open) and priority = 'P1'),
    'p2_high',              count(*) filter (where status = any (v_open) and priority = 'P2'),
    'p3_medium',            count(*) filter (where status = any (v_open) and priority = 'P3'),
    'p4_low',               count(*) filter (where status = any (v_open) and priority = 'P4'),
    'p7_long_term',         count(*) filter (where status = any (v_open) and priority = 'P7'),
    'completed_today',      count(*) filter (where verified_at >= date_trunc('day', now())),
    -- CHANGED: late right now, not ever late.
    'overdue',              count(*) filter (where status = any (v_open) and sla_stage_overdue),
    'avg_response_minutes', coalesce(round(v_response), 0),
    'avg_repair_minutes',   coalesce(round(avg(
                              extract(epoch from (resolved_at - created_at)) / 60
                            ) filter (where verified_at is not null
                                        and resolved_at is not null)), 0),
    'active_technicians',   count(distinct assigned_to_id) filter (
                              where status = any (v_open)
                                and assigned_to_id is not null)
  )
  into v_cards
  from work_orders;

  insert into stats (id, data, updated_at)
  values ('dashboard_cards', v_cards, now())
  on conflict (id) do update set data = excluded.data, updated_at = now();
end;
$fn$;

revoke execute on function si_compute_dashboard_stats() from authenticated, anon, public;
```

For `si_dashboard_card_rows`, reproduce 0059's whole body unchanged except the first branch, whose two marked lines become:

```sql
         and (p_card <> 'overdue' or w.sla_stage_overdue)
       order by si_open_stage_due_at(w) asc nulls last
```

and whose `metric_value` becomes the open stage's countdown rather than the resolution one:

```sql
             round(extract(epoch from (si_open_stage_due_at(w) - now())) / 60)::numeric,
```

Keep the function's `security invoker`, its `stable`, its `set search_path = public`, and every other branch byte-identical.

- [ ] **Step 2: Apply and exercise both sweeps**

```bash
cd app && npm run db:push
```

Then, against test:

```sql
begin;
select si_sla_breach_sweep()  as breaches;
select si_sla_warning_sweep() as warnings;
select count(*) filter (where sla_stage_overdue)       as overdue_now,
       count(*) filter (where sla_ack_breached)        as ack_missed,
       count(*) filter (where sla_response_breached)   as resp_missed,
       count(*) filter (where sla_resolution_breached) as res_missed,
       count(*) filter (where sla_breached)            as ever_missed
  from work_orders;
-- Idempotence: the second call must return 0, or the sweep notifies forever.
select si_sla_breach_sweep() as second_pass;
rollback;
```

Expected: `second_pass` is `0`, `ever_missed` is greater than or equal to each of the three, and no error from either function.

- [ ] **Step 3: Exercise the two dashboard functions**

```sql
select si_compute_dashboard_stats();
select data->'overdue' as overdue, data->'total_open' as total_open from stats where id = 'dashboard_cards';
select * from si_dashboard_card_rows('overdue', 10);
```

Expected: no error, `overdue` present, and the card rows ordered soonest-deadline-first with no all-null `metric_value` column.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0068_overdue_means_the_open_stage.sql
git commit -m "0068: overdue means the stage it is sitting in"
```

---

## Task 5: Migration 0069 — the backfill

**Files:**
- Create: `app/supabase/migrations/0069_recompute_every_sla_under_the_new_model.sql`
- Create: `app/scripts/checks/backfillReport.mjs`

**Interfaces:**
- Consumes: everything from Tasks 3 and 4.
- Produces: `sla_backfill_0069` — a permanent audit table holding every work order's SLA columns as they were immediately before the recomputation.

**This is the one irreversible step in the plan. It ends at a review gate, not at a push to production.**

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0069_recompute_every_sla_under_the_new_model.sql`:

```sql
-- ============================================================================
-- SI — Service Inside · 0069 Recompute every SLA under the sequential model
-- ============================================================================
-- 0067 changed what the numbers mean. Every work order already in the table was
-- judged under the old one, so until this runs the deadlines on screen and the
-- targets behind them describe different promises.
--
-- **Everything is recomputed, closed and signed-off work included**, and every
-- verdict is decided by comparing two recorded instants — never by reading the
-- clock. A work order closed in June has its acknowledge stage judged by when
-- it was actually assigned against when it was actually due, so the answer is a
-- fact about June and will not drift again. now() appears only where a stage is
-- genuinely still open, which is the only case where "has it been missed" is a
-- question about the present.
--
-- Sign-off is untouched: `verified_at` and `verified_by` are not named in any
-- UPDATE here, nor are `status`, the assignee, `resolved_at`, `closed_at` or
-- `decline_count`. The omission is the mechanism, as in 0051 and 0064.
--
-- ---------------------------------------------------------------------------
-- 1. The stage moments come from history, filtered to transitions
-- ---------------------------------------------------------------------------
-- 0050 backfilled `acknowledged_at` and `responded_at` once. This re-derives
-- them for any row still missing one, by 0050's own rule: first occurrence of
-- `assigned` / `repairing` in work_order_history, `event_type = 'transition'`.
--
-- The filter is load-bearing and it is the trap lib/historyEvents.js exists
-- for: 0043's photo-replaced rows and 0051's priority-override rows carry the
-- work order's CURRENT status in `to_status`, so a photo swapped while a job
-- was assigned would otherwise read as the moment it was assigned. `coalesce`
-- on event_type, because every row written before 0043 has it null.
--
-- ---------------------------------------------------------------------------
-- 2. A stage whose predecessor never happened has no verdict
-- ---------------------------------------------------------------------------
-- No deadline, flag false, deadline column NULL. That is not "met" — it is
-- "never started", and si_open_sla_stage is what keeps such a work order
-- visible as overdue at the stage it is actually stuck in. Falling back to
-- created_at to fill the gap would be the from-creation reading of a
-- sequential stage, which is the exact arithmetic 0067 exists to remove.
--
-- ---------------------------------------------------------------------------
-- 3. Re-running it is a no-op
-- ---------------------------------------------------------------------------
-- Every value is derived from created_at, from history and from the sla table
-- — never from this migration's own previous output. The snapshot table is
-- written with `on conflict do nothing`, so the FIRST run's before-image is the
-- one kept.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The before-image. A permanent table, not a temp one: it is the evidence for
-- the review gate and the only way back to what the old model said.
-- ---------------------------------------------------------------------------
create table if not exists sla_backfill_0069 (
  work_order_id         uuid primary key references work_orders(id) on delete cascade,
  captured_at           timestamptz not null default now(),
  priority              si_priority,
  status                si_wo_status,
  created_at            timestamptz,
  acknowledged_at       timestamptz,
  responded_at          timestamptz,
  resolved_at           timestamptz,
  closed_at             timestamptz,
  sla_ack_due_at        timestamptz,
  sla_response_due_at   timestamptz,
  sla_resolution_due_at timestamptz,
  sla_breached          boolean,
  sla_warning_sent      boolean
);

alter table sla_backfill_0069 enable row level security;

-- Superuser only. It is an audit artefact of a one-off correction, and it holds
-- nothing a reader needs that work_orders does not already publish.
drop policy if exists sla_backfill_0069_select on sla_backfill_0069;
create policy sla_backfill_0069_select on sla_backfill_0069
  for select using (si_is_superuser());

insert into sla_backfill_0069 (
  work_order_id, priority, status, created_at, acknowledged_at, responded_at,
  resolved_at, closed_at, sla_ack_due_at, sla_response_due_at,
  sla_resolution_due_at, sla_breached, sla_warning_sent)
select id, priority, status, created_at, acknowledged_at, responded_at,
       resolved_at, closed_at, sla_ack_due_at, sla_response_due_at,
       sla_resolution_due_at, sla_breached, sla_warning_sent
  from work_orders
on conflict (work_order_id) do nothing;

-- ---------------------------------------------------------------------------
-- The recomputation
-- ---------------------------------------------------------------------------
with hist as (
  select work_order_id,
         min(created_at) filter (where to_status = 'assigned')  as first_assigned,
         min(created_at) filter (where to_status = 'repairing') as first_repairing
    from work_order_history
   where coalesce(event_type, 'transition') = 'transition'
   group by work_order_id
),
base as (
  select w.id,
         w.created_at,
         coalesce(w.acknowledged_at, h.first_assigned)  as acked,
         coalesce(w.responded_at,    h.first_repairing) as responded,
         /* The resolution stage ends when the repair was declared finished.
            resolved_at first, closed_at as the fallback for rows closed by a
            route that never stamped it — 0062 found three. */
         coalesce(w.resolved_at, w.closed_at)           as resolved,
         t.ack, t.response, t.resolution
    from work_orders w
    left join hist h on h.work_order_id = w.id
    cross join lateral si_sla_targets(w.priority) t
),
calc as (
  select b.*,
         b.created_at + make_interval(mins => b.ack) as ack_due,
         case when b.acked is not null
              then b.acked + make_interval(mins => b.response) end as resp_due,
         case when b.responded is not null
              then b.responded + make_interval(mins => b.resolution) end as res_due
    from base b
)
update work_orders w
   set acknowledged_at       = c.acked,
       responded_at          = c.responded,
       sla_ack_due_at        = c.ack_due,
       sla_response_due_at   = c.resp_due,
       sla_resolution_due_at = c.res_due,
       /* Completed stage -> compare the two stamps. Open stage -> compare the
          deadline with now(), which is the only honest reading of a question
          about the present. No deadline -> no verdict. */
       sla_ack_breached = case
         when c.ack_due is null then false
         when c.acked is not null then c.acked > c.ack_due
         else now() > c.ack_due end,
       sla_response_breached = case
         when c.resp_due is null then false
         when c.responded is not null then c.responded > c.resp_due
         else now() > c.resp_due end,
       sla_resolution_breached = case
         when c.res_due is null then false
         when c.resolved is not null then c.resolved > c.res_due
         else now() > c.res_due end
  from calc c
 where w.id = c.id;

-- The two derived columns, in a second statement so they read the values the
-- first one committed rather than the row's old ones.
update work_orders w
   set sla_breached      = w.sla_ack_breached
                        or w.sla_response_breached
                        or w.sla_resolution_breached,
       sla_stage_overdue = (si_open_stage_due_at(w) is not null
                            and si_open_stage_due_at(w) < now());

select si_compute_dashboard_stats();
```

- [ ] **Step 2: Snapshot, apply, and prove the invariant**

```bash
cd app && npm run env:which
```

Confirm it says **test**. Then:

```bash
cd app && npm run db:push
```

- [ ] **Step 3: Write the review report**

Create `app/scripts/checks/backfillReport.mjs`:

```js
/**
 * The 0069 review gate: what the backfill did to every work order.
 *
 * Prints one row per work order — before and after — and then runs the four
 * assertions the spec requires. Read the table; the assertions only prove the
 * things that can be proved mechanically.
 *
 * Run: node scripts/checks/backfillReport.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const url = env.SUPABASE_DB_URL;
if (!url) throw new Error("SUPABASE_DB_URL is not in app/.env.local — take the pooler string from Supabase → Settings → Database → Connection pooling.");

const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const { rows } = await c.query(`
  select w.wo_number, w.priority, w.status,
         b.sla_breached            as was_breached,
         w.sla_ack_breached        as ack_missed,
         w.sla_response_breached   as resp_missed,
         w.sla_resolution_breached as res_missed,
         w.sla_stage_overdue       as overdue_now,
         si_open_sla_stage(w)      as open_stage,
         b.sla_resolution_due_at   as res_due_before,
         w.sla_resolution_due_at   as res_due_after
    from work_orders w
    join sla_backfill_0069 b on b.work_order_id = w.id
   order by w.created_at
`);
console.table(rows);

// 1. Nothing outside the SLA columns moved.
const { rows: [moved] } = await c.query(`
  select count(*) as n
    from work_orders w
    join sla_backfill_0069 b on b.work_order_id = w.id
   where w.status      is distinct from b.status
      or w.resolved_at is distinct from b.resolved_at
      or w.closed_at   is distinct from b.closed_at
      or w.priority    is distinct from b.priority
`);
console.log("rows whose status/resolved_at/closed_at/priority changed:", moved.n, "(must be 0)");

// 2. Every finished work order's verdict is a comparison of two stamps, so it
//    cannot move again. Proved by re-running the arithmetic and diffing.
const { rows: [drift] } = await c.query(`
  with hist as (
    select work_order_id,
           min(created_at) filter (where to_status = 'assigned') as first_assigned
      from work_order_history
     where coalesce(event_type,'transition') = 'transition'
     group by work_order_id
  )
  select count(*) as n
    from work_orders w
    left join hist h on h.work_order_id = w.id
    cross join lateral si_sla_targets(w.priority) t
   where coalesce(w.acknowledged_at, h.first_assigned) is not null
     and w.sla_ack_breached
         is distinct from (coalesce(w.acknowledged_at, h.first_assigned)
                           > w.created_at + make_interval(mins => t.ack))
`);
console.log("acknowledge verdicts that disagree with recomputation:", drift.n, "(must be 0)");

// 3. sla_breached is exactly the OR of the three.
const { rows: [orRule] } = await c.query(`
  select count(*) as n from work_orders
   where sla_breached is distinct from (sla_ack_breached or sla_response_breached or sla_resolution_breached)
`);
console.log("rows where sla_breached is not the OR of the three:", orRule.n, "(must be 0)");

// 4. Nothing finished is flagged as currently overdue.
const { rows: [ghost] } = await c.query(`
  select count(*) as n from work_orders
   where sla_stage_overdue and status in ('completed','closed')
`);
console.log("finished work orders still marked overdue:", ghost.n, "(must be 0)");

await c.end();
```

- [ ] **Step 4: Run it and stop**

```bash
cd app && node scripts/checks/backfillReport.mjs
```

Expected: all four counters print `0`. **Then stop and hand the table to the user.** Do not push 0069 to production and do not start Task 6 until they have looked at it.

- [ ] **Step 5: Commit**

```bash
git add app/supabase/migrations/0069_recompute_every_sla_under_the_new_model.sql app/scripts/checks/backfillReport.mjs
git commit -m "0069: recompute every SLA under the sequential model"
```

---

## Task 6: Migration 0070 — the two enum labels

**Files:**
- Create: `app/supabase/migrations/0070_p8_and_scheduled_enum_values.sql`

**Interfaces:**
- Produces: `si_priority.'P8'` and `si_impact.'scheduled'`, usable by any later migration.

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0070_p8_and_scheduled_enum_values.sql`:

```sql
-- ============================================================================
-- SI — Service Inside · 0070 The P8 and 'scheduled' enum labels
-- ============================================================================
-- Two statements, and this file does nothing else on purpose.
--
-- Postgres refuses to let a transaction USE an enum value the same transaction
-- added — `insert into priorities … 'P8'` fails with "unsafe use of new value"
-- — and the Supabase CLI wraps every migration file in one transaction. So the
-- labels and the rows that name them cannot share a file. Same split 0035/0036
-- needed for si_wo_type, and 0048/0050 for P7.
--
-- P8 rather than P5, for the reason 0050 chose 7 over 5: rank is what
-- si_derive_priority compares with least() and what every escalation ceiling
-- resolves through, and leaving numbers unused keeps room for a priority
-- between P4 and P7 without renumbering anything.
-- ============================================================================

alter type si_priority add value if not exists 'P8';
alter type si_impact   add value if not exists 'scheduled';
```

- [ ] **Step 2: Apply and confirm**

```bash
cd app && npm run db:push
```

```sql
select unnest(enum_range(null::si_priority)) as priority;
select unnest(enum_range(null::si_impact))   as impact;
```

Expected: `P8` and `scheduled` present.

- [ ] **Step 3: Commit**

```bash
git add app/supabase/migrations/0070_p8_and_scheduled_enum_values.sql
git commit -m "0070: P8 and scheduled enum labels"
```

---

## Task 7: Migration 0071 — P8's rows and the extension RPC

**Files:**
- Create: `app/supabase/migrations/0071_p8_and_extending_an_sla.sql`

**Interfaces:**
- Consumes: `si_open_sla_stage` / `si_open_stage_started_at` / `si_open_stage_due_at` (0067), `si_priority_override()` and `si_guard_priority_override()` (0051), `si_notify` (0056's eight-argument version), `si_sla_targets` (0067).
- Produces:
  - `work_orders.sla_extension_count int not null default 0`
  - `si_extend_work_order_sla(p_work_order_id uuid, p_priority si_priority) returns void`, granted to `authenticated`
  - `work_order_history.event_type = 'sla_extension'` rows

- [ ] **Step 1: Write the migration**

Create `app/supabase/migrations/0071_p8_and_extending_an_sla.sql`:

```sql
-- ============================================================================
-- SI — Service Inside · 0071 P8, and an Administrator may extend an SLA
-- ============================================================================
-- ---------------------------------------------------------------------------
-- 1. P8 is a month, and it is a full priority
-- ---------------------------------------------------------------------------
-- Five days to assign, five more to start, twenty to finish: thirty days,
-- sequential like every priority since 0067. It arrives with an impact level of
-- its own ('scheduled' -> P8) because since 0036 nobody picks a priority, so a
-- priority with no impact deriving it would be a value the raise form could
-- never reach — and because 0051's override sets an impact to match a priority
-- and needs the map to stay 1:1.
--
-- Consequence, accepted rather than overlooked: requesters see "Scheduled work
-- (month-scale)" in the impact list. The alternative — extension-only, reachable
-- from nowhere else — was considered and declined.
--
-- Teal #0891B2. Every other candidate collides: violet is P7's, slate #64748B
-- is what priorityColor() returns when a lookup FAILS so a P8 badge would be
-- indistinguishable from a broken one, and green reads as completed.
--
-- The dashboard learns about P8 explicitly, because its priority row is
-- hardcoded keys rather than a loop over the table. Without the branch a P8
-- would be counted in total_open and in no band, the cards would visibly stop
-- adding up, and month-long work — exactly the kind that sits unattended —
-- would be the work with no figure watching it. Same trap 0050 documents.
--
-- ---------------------------------------------------------------------------
-- 2. Extending is 0051's machinery behind a second door
-- ---------------------------------------------------------------------------
-- Re-grading to a less urgent priority gives the OPEN STAGE a longer window,
-- which is what "extend" means once 0067 has made every stage sequential. So
-- this reuses 0051's override columns, 0051's guard and 0051's session-local
-- door, and differs in exactly three ways — which is what earns it a function
-- rather than a flag on si_override_work_order_priority:
--
--   * It refuses any target that is not STRICTLY LESS URGENT. Rank must
--     increase. Extending can only ever grant time; enforcing that in the body
--     means no client can turn "extend" into a covert escalation, and it is the
--     one rule 0051 must not have — a re-grade legitimately goes both ways.
--   * It generates its own remark instead of demanding a typed reason. The
--     action is a yes/no on a phone, and a ten-character floor on a confirm
--     dialog produces "asdfasdfasdf", which is worse evidence than a generated
--     sentence naming both priorities, the stage and the time granted.
--   * It writes event_type = 'sla_extension', so the timeline tells an
--     extension and a re-grade apart.
--
-- `sla_extension_count` joins the four priority_override columns in the guard's
-- protected set, so a direct PATCH of it is refused from anybody at any rank —
-- otherwise the count, which is the only thing on the row saying how many times
-- this has happened, would be the one part of the record anyone could edit.
--
-- The override columns are SHARED with 0051 rather than duplicated. "This work
-- order's priority is P3 regardless of its impact" is one standing decision
-- however it was reached; two parallel override columns would need
-- si_force_derived_priority to arbitrate between them, and the audit rows are
-- where the two routes are already told apart.
--
-- ---------------------------------------------------------------------------
-- 3. The at-risk gate, restated here because RLS does not apply inside
-- ---------------------------------------------------------------------------
-- The button appears when the open stage is overdue or in its last quarter.
-- canExtendSla() decides what to SHOW; this body decides what is allowed, and
-- the two disagreeing must produce an error rather than a silent success. The
-- 25% is si_sla_warning_sweep's, measured over the stage's own window.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. P8's three rows
-- ---------------------------------------------------------------------------
insert into priorities (id, code, label, color_hex, rank, description) values
  ('P8', 'P8', 'Scheduled', '#0891B2', 8,
   'Scheduled work on a month-long horizon. Nothing is stopped and nothing is degraded.')
on conflict (id) do update
  set code = excluded.code, label = excluded.label, color_hex = excluded.color_hex,
      rank = excluded.rank, description = excluded.description;

insert into impact_levels (code, label, suggests_priority, sort_order, description) values
  ('scheduled', 'Scheduled work (month-scale)', 'P8', 6,
   'Planned work with a month-long horizon — an overhaul, a staged upgrade, a deferred repair.')
on conflict (code) do update
  set label = excluded.label, suggests_priority = excluded.suggests_priority,
      sort_order = excluded.sort_order, description = excluded.description;

insert into sla (id, priority_id, plant_id,
                 ack_target_minutes,        ack_target_label,
                 response_target_minutes,   response_target_label,
                 resolution_target_minutes, resolution_target_label,
                 targets_are_sequential) values
  ('P8', 'P8', null,
   7200,  '5 days',
   7200,  '5 days after assignment',
   28800, '20 days after work starts',
   true)
on conflict (id) do update
  set priority_id = excluded.priority_id, plant_id = excluded.plant_id,
      ack_target_minutes = excluded.ack_target_minutes,
      ack_target_label = excluded.ack_target_label,
      response_target_minutes = excluded.response_target_minutes,
      response_target_label = excluded.response_target_label,
      resolution_target_minutes = excluded.resolution_target_minutes,
      resolution_target_label = excluded.resolution_target_label,
      targets_are_sequential = excluded.targets_are_sequential;

-- ---------------------------------------------------------------------------
-- 2. The dashboard's P8 branch — see note 1
-- ---------------------------------------------------------------------------
-- si_compute_dashboard_stats: 0068's body with one key added.
```

Reproduce 0068's `si_compute_dashboard_stats` body here in full, adding one line after `p7_long_term`:

```sql
    'p8_scheduled',         count(*) filter (where status = any (v_open) and priority = 'P8'),
```

and re-issue `revoke execute on function si_compute_dashboard_stats() from authenticated, anon, public;` immediately after — a later `create or replace` resets what an earlier statement set.

Then reproduce 0068's `si_dashboard_card_rows` in full, adding `'p8_scheduled'` to the `p_card in (…)` list and `when 'p8_scheduled' then 'P8'` to the `case`. Continue the file:

```sql
-- ---------------------------------------------------------------------------
-- 3. The count, and the guard that protects it
-- ---------------------------------------------------------------------------
alter table work_orders add column if not exists sla_extension_count int not null default 0;

comment on column work_orders.sla_extension_count is
  'How many times an Administrator has extended this work order''s SLA. Written only by si_extend_work_order_sla; si_guard_priority_override refuses every other route.';

create or replace function si_guard_priority_override()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
begin
  if auth.uid() is null then return new; end if;
  if si_priority_override() then return new; end if;

  if tg_op = 'INSERT' then
    v_changed := new.priority_override        is not null
              or new.priority_override_reason is not null
              or new.priority_overridden_by   is not null
              or new.priority_overridden_at   is not null
              or coalesce(new.sla_extension_count, 0) <> 0;
  else
    v_changed := new.priority_override        is distinct from old.priority_override
              or new.priority_override_reason is distinct from old.priority_override_reason
              or new.priority_overridden_by   is distinct from old.priority_overridden_by
              or new.priority_overridden_at   is distinct from old.priority_overridden_at
              or new.sla_extension_count      is distinct from old.sla_extension_count;
  end if;

  if v_changed then
    raise exception 'Priority can only be changed by an Administrator, with a reason. Use Change priority or Extend SLA on the work order.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

revoke all on function si_guard_priority_override() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The RPC
-- ---------------------------------------------------------------------------
create or replace function si_extend_work_order_sla(
  p_work_order_id uuid,
  p_priority      si_priority
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w             work_orders;
  v_actor       uuid := auth.uid();
  v_actor_name  text;
  v_stage       text;
  v_started     timestamptz;
  v_due         timestamptz;
  v_old_rank    int;
  v_new_rank    int;
  v_old_label   text;
  v_new_label   text;
  v_ack         int;
  v_resp        int;
  v_res         int;
  v_seq         boolean;
  v_ack_due     timestamptz;
  v_resp_due    timestamptz;
  v_res_due     timestamptz;
  v_new_due     timestamptz;
  v_breached    boolean;
  v_remark      text;
begin
  if v_actor is null then
    raise exception 'Sign in required.' using errcode = 'insufficient_privilege';
  end if;

  if not si_is_admin() then
    raise exception 'Only an Administrator can extend a work order''s SLA.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into w from work_orders where id = p_work_order_id;
  if not found then
    raise exception 'That work order no longer exists.' using errcode = 'no_data_found';
  end if;

  if w.status in ('verified', 'closed') then
    raise exception 'This work order is finished, so its SLA is part of the record now and cannot be extended.'
      using errcode = 'check_violation';
  end if;

  if p_priority is null then
    raise exception 'Choose the priority to extend this work order to.' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from priorities where id = p_priority and is_active) then
    raise exception 'That priority is not in use. Pick another one.' using errcode = 'check_violation';
  end if;

  select rank, label into v_old_rank, v_old_label from priorities where id = w.priority;
  select rank, label into v_new_rank, v_new_label from priorities where id = p_priority;

  /* Rank ascending is severity descending, so less urgent is a GREATER rank.
     This is the one rule si_override_work_order_priority must NOT have: a
     re-grade legitimately moves in both directions, an extension never does. */
  if v_new_rank is null or v_old_rank is null or v_new_rank <= v_old_rank then
    raise exception 'Extending an SLA can only move a work order to a lower priority than % (%).',
      coalesce(v_old_label, w.priority::text), w.priority
      using errcode = 'check_violation';
  end if;

  v_stage   := si_open_sla_stage(w);
  v_started := si_open_stage_started_at(w);
  v_due     := si_open_stage_due_at(w);

  if v_stage is null then
    raise exception 'This work order has no SLA stage running, so there is nothing to extend.'
      using errcode = 'check_violation';
  end if;

  /* The gate canExtendSla() mirrors. Overdue, or inside the last quarter of the
     open stage's own window — si_sla_warning_sweep's threshold. */
  if v_due is null then
    raise exception 'This work order''s % stage has no deadline yet, so there is nothing to extend.', v_stage
      using errcode = 'check_violation';
  end if;

  if v_due > now() and (v_started is null or (v_due - now()) > (v_due - v_started) * 0.25) then
    raise exception 'This work order still has most of its % time left. An SLA is extended when it is running out, not before.', v_stage
      using errcode = 'check_violation';
  end if;

  select ack, response, resolution, sequential
    into v_ack, v_resp, v_res, v_seq
    from si_sla_targets(p_priority);

  /* Recomputed from the raise time and the recorded stage moments, exactly as
     0051 does it — never from now(). The fault is as old as it is, and
     restarting the clock would reward extending a job that is already late. */
  v_ack_due := w.created_at + make_interval(mins => v_ack);

  if v_seq then
    v_resp_due := case when w.acknowledged_at is not null
                       then w.acknowledged_at + make_interval(mins => v_resp) end;
    v_res_due  := case when w.responded_at is not null
                       then w.responded_at + make_interval(mins => v_res) end;
  else
    v_resp_due := w.created_at + make_interval(mins => v_resp);
    v_res_due  := w.created_at + make_interval(mins => v_res);
  end if;

  v_new_due := case v_stage when 'acknowledge' then v_ack_due
                            when 'response'    then v_resp_due
                            when 'resolution'  then v_res_due end;

  v_breached := v_res_due is not null and v_res_due < now();

  select name into v_actor_name from users where id = v_actor;

  v_remark := 'SLA extended: ' || coalesce(v_old_label, w.priority::text) || ' (' || w.priority ||
              ') -> ' || coalesce(v_new_label, p_priority::text) || ' (' || p_priority ||
              '). ' || initcap(v_stage) || ' stage now due ' ||
              coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                       'when the stage starts') || '.';

  perform set_config('si.allow_priority_override', 'on', true);

  /* `status` and the assignee are deliberately NOT named — 0051 note 5. An
     extension changes what is expected of a work order, not who is doing it or
     how far along it is, and si_stamp_work_order's decline branch is three
     lines below a test this UPDATE must never reach.
     The three sticky breach flags are NOT reset either: a stage that was missed
     was missed, and granting more time afterwards does not un-miss it. Only
     sla_stage_overdue moves, because the stage may no longer be late. */
  update work_orders
     set priority_override        = p_priority,
         priority_override_reason = v_remark,
         priority_overridden_by   = v_actor,
         priority_overridden_at   = now(),
         sla_extension_count      = coalesce(sla_extension_count, 0) + 1,
         sla_ack_due_at           = v_ack_due,
         sla_response_due_at      = v_resp_due,
         sla_resolution_due_at    = v_res_due,
         sla_breached             = sla_ack_breached or sla_response_breached or sla_resolution_breached,
         sla_stage_overdue        = (v_new_due is not null and v_new_due < now()),
         sla_warning_sent         = case when v_new_due is not null and v_new_due > now()
                                         then false else sla_warning_sent end
   where id = p_work_order_id;

  perform set_config('si.allow_priority_override', 'off', true);

  insert into work_order_history
    (work_order_id, from_status, to_status, actor_id, actor_name, actor_role, remarks, event_type)
  values
    (p_work_order_id, w.status, w.status, v_actor, v_actor_name, 'admin', v_remark, 'sla_extension');

  /* The two people it changes something for, and neither of them if they are
     the one who did it. `distinct` because on a small site the requester and
     the assignee can be the same person. Deliberately not the ops chain: an
     extension is not a routing problem anybody else has to act on, and
     notifications still has no retention. */
  perform si_notify(r.id, r.role, p_work_order_id, coalesce(w.wo_number, 'Work order'),
                    'priority_changed',
                    'SLA extended to ' || p_priority,
                    coalesce(w.wo_number, 'A work order') || ' has been extended to ' ||
                    coalesce(v_new_label, p_priority::text) || ' (' || p_priority || '), was ' ||
                    coalesce(v_old_label, w.priority::text) || ' (' || w.priority || '). ' ||
                    initcap(v_stage) || ' stage now due ' ||
                    coalesce(to_char(v_new_due at time zone 'Asia/Kuala_Lumpur', 'DD/MM/YYYY HH24:MI'),
                             'when the stage starts') || '.',
                    w.status)
    from (select w.assigned_to_id as id, 'technician'::si_role as role
           where w.assigned_to_id is not null
             and w.assigned_to_id is distinct from v_actor
             and w.assigned_to_id is distinct from w.requester_id
          union all
          select w.requester_id, 'requester'::si_role
           where w.requester_id is distinct from v_actor) r;
end;
$$;

revoke all on function si_extend_work_order_sla(uuid, si_priority) from public, anon;
grant execute on function si_extend_work_order_sla(uuid, si_priority) to authenticated;

select si_compute_dashboard_stats();
```

Note the eighth argument on `si_notify` — 0056 dropped the seven-argument version and added `wo_status`. Passing seven here would fail to resolve.

- [ ] **Step 2: Apply and exercise every refusal**

```bash
cd app && npm run db:push
```

Then, against test, inside a transaction that is rolled back, impersonating each role with `set local request.jwt.claims`:

```sql
begin;
-- Pick a live work order that is currently overdue at some stage.
select id, wo_number, priority, status, si_open_sla_stage(w) from work_orders w
 where sla_stage_overdue limit 5;

-- 1. A technician is refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"<technician uuid>","user_roles":["technician"]}';
select si_extend_work_order_sla('<wo uuid>', 'P3');   -- expect: Only an Administrator…

-- 2. An Administrator moving the WRONG way is refused.
set local request.jwt.claims = '{"sub":"<admin uuid>","user_roles":["admin"]}';
select si_extend_work_order_sla('<P3 wo uuid>', 'P1'); -- expect: can only move to a lower priority…

-- 3. The same priority is refused.
select si_extend_work_order_sla('<P3 wo uuid>', 'P3'); -- expect: same message

-- 4. A work order with plenty of time left is refused.
select si_extend_work_order_sla('<fresh wo uuid>', 'P4'); -- expect: still has most of its … time left

-- 5. A direct PATCH of the count is refused.
update work_orders set sla_extension_count = 9 where id = '<wo uuid>';
-- expect: Priority can only be changed by an Administrator…

-- 6. The happy path.
select si_extend_work_order_sla('<overdue P1 uuid>', 'P3');
select priority, priority_override, sla_extension_count, sla_stage_overdue,
       sla_ack_breached, sla_response_breached, sla_resolution_breached,
       status, assigned_to_id, acknowledged_at, responded_at
  from work_orders where id = '<overdue P1 uuid>';
select event_type, remarks, actor_name from work_order_history
 where work_order_id = '<overdue P1 uuid>' order by created_at desc limit 1;
rollback;
```

Expected on the happy path: `priority` is `P3`, `sla_extension_count` is 1, the three sticky flags are **unchanged**, `status` / `assigned_to_id` / `acknowledged_at` / `responded_at` are unchanged, and the newest history row is `sla_extension` with the generated remark.

- [ ] **Step 3: Regenerate types**

```bash
cd app && npm run db:types
```

**Then hand-restore `si_rank` and `si_set_protected`** in `src/lib/database.types.ts` — regenerating against test deletes them, because they exist only on production. This is a known standing step.

- [ ] **Step 4: Commit**

```bash
git add app/supabase/migrations/0071_p8_and_extending_an_sla.sql app/src/lib/database.types.ts
git commit -m "0071: P8, and an Administrator may extend an SLA"
```

---

## Task 8: The client predicate and the write function

**Files:**
- Modify: `app/src/lib/constants.js` (after `canOverridePriority`, around line 215)
- Modify: `app/src/lib/workOrders.js` (after `overrideWorkOrderPriority`, around line 742)
- Modify: `app/src/lib/historyEvents.js` (the `EVENT_LABELS` map)

**Interfaces:**
- Consumes: `isStageOverdue`, `isStageAtRisk`, `openSlaStage` (Task 1); `ROLES`, `hasRole` (already imported by `constants.js`).
- Produces:
  - `canExtendSla(wo, currentUser) -> boolean`
  - `extendWorkOrderSla(woId, priority) -> Promise<void>`

- [ ] **Step 1: Add the predicate**

In `app/src/lib/constants.js`, add the import at the top beside the existing ones:

```js
import { isStageOverdue, isStageAtRisk } from "./slaStages";
```

and after `canOverridePriority`:

```js
/**
 * May this person extend this work order's SLA? (migration 0071)
 *
 * Administrator, live work order, and the stage it is sitting in is either past
 * its deadline or inside the last quarter of its own window — the same 25%
 * si_sla_warning_sweep uses, so the button and the warning agree about "running
 * out of time".
 *
 * DISPLAY ONLY, like every predicate in this file.
 * si_extend_work_order_sla restates all three checks in its own body, so the
 * two disagreeing produces an error rather than a silent success.
 *
 * Deliberately narrower than canOverridePriority: a re-grade is a judgement
 * about what a work order IS and can be made at any time, an extension is a
 * response to a clock and only means something while the clock is nearly out.
 */
export function canExtendSla(wo, currentUser) {
  if (!wo || !currentUser) return false;
  if (wo.status === "verified" || wo.status === "closed") return false;
  if (!hasRole(currentUser, ROLES.ADMIN)) return false;
  return isStageOverdue(wo) || isStageAtRisk(wo);
}
```

- [ ] **Step 2: Add the write function**

In `app/src/lib/workOrders.js`, after `overrideWorkOrderPriority`:

```js
/**
 * Extend a work order's SLA by re-grading it to a less urgent priority
 * (migration 0071).
 *
 * Not `updateWorkOrderFields` and not a transition: the priority is derived
 * from the production impact and a trigger overwrites whatever the client sends
 * (0036), and si_guard_priority_override refuses a direct PATCH of the override
 * columns or of `sla_extension_count` from anybody at any rank. The RPC is the
 * only door.
 *
 * Three things worth knowing at the call site:
 *
 *  - `priority` must be STRICTLY less urgent than the work order's current one.
 *    The server refuses anything else, including the same priority — extending
 *    can only grant time.
 *  - No reason is passed. The server generates the remark, names both
 *    priorities and the stage, and writes it to the timeline as `sla_extension`.
 *  - The deadlines are recomputed from the raise time and the recorded stage
 *    moments, not from now, so the countdown on screen can move the moment this
 *    returns and an overdue badge clearing is the correct outcome.
 */
export async function extendWorkOrderSla(woId, priority) {
  const { error } = await supabase.rpc("si_extend_work_order_sla", {
    p_work_order_id: woId,
    p_priority: priority,
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Add the history label**

In `app/src/lib/historyEvents.js`, inside `EVENT_LABELS`, after the `priority_override` entry:

```js
  // Migration 0071 — an Administrator moved a work order to a less urgent
  // priority to give the stage it is in more time. Distinct from
  // priority_override on purpose: they are different events and one heading
  // covering both would make it mean two things.
  sla_extension: "SLA extended",
```

- [ ] **Step 4: Verify it compiles**

```bash
cd app && npm run build
```

Expected: a successful export into `out/`. Do not run this while `npm run dev` is live.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/constants.js app/src/lib/workOrders.js app/src/lib/historyEvents.js
git commit -m "Extending an SLA: predicate, write function, timeline label"
```

---

## Task 9: The Extend SLA dialog

**Files:**
- Create: `app/src/components/workorders/ExtendSlaDialog.jsx`
- Modify: `app/src/components/workorders/WorkOrderDetail.jsx`

**Interfaces:**
- Consumes: `suggestExtension` (Task 2), `extendWorkOrderSla` and `canExtendSla` (Task 8), `STAGE_LABELS` / `openStageDueAt` (Task 1), `useReferenceData().priorities` and `.slaForPriority`, `fmtDue` and `fmtDateTimeMY`.
- Produces: `<ExtendSlaDialog wo={wo} onClose={fn} />`, default-exported alongside a named export.

- [ ] **Step 1: Write the dialog**

Create `app/src/components/workorders/ExtendSlaDialog.jsx`:

```jsx
"use client";

/**
 * SI — Service Inside · Extending a work order's SLA (migration 0071)
 *
 * A confirm dialog, not a form. The decision it collects is "yes, give this
 * work order more time", and the arithmetic behind it — which priority, how
 * much longer, and whether that is even enough — is worked out before the
 * dialog opens and shown rather than asked.
 *
 * Three things here are deliberate:
 *
 *  - **No reason field.** Every other deliberate act on this schema carries a
 *    typed reason, and this one does not, because it is a two-tap action on a
 *    phone beside a machine. A ten-character floor on a confirm dialog produces
 *    "asdfasdfasdf", which is worse evidence than the sentence the server
 *    generates naming both priorities, the stage and the new deadline.
 *  - **The disclaimer is above the button, not after it.** What is recorded and
 *    who is told has to be readable before the decision, the same reason
 *    AttachmentViewer warns before the file picker opens rather than after.
 *  - **Every option names its own deadline, not only a delta.** Stage windows
 *    differ in kind — P4's response stage is 22 hours, P8's is five days — so
 *    "+4d" without a date is an arithmetic problem rather than an answer.
 */
import { useMemo, useState } from "react";
import { X, Clock } from "lucide-react";
import { Card, Button, ErrorBanner, ModalOverlay } from "../ui/Primitives";
import { useReferenceData } from "../../lib/referenceData";
import { extendWorkOrderSla } from "../../lib/workOrders";
import { describeError } from "../../lib/errors";
import { suggestExtension } from "../../lib/slaExtension";
import { STAGE_LABELS, openStageDueAt, openStageRemainMs } from "../../lib/slaStages";
import { fmtDue } from "../../lib/constants";
import { fmtDateTimeMY } from "../../lib/datetime";
import { fmtElapsed } from "../../lib/slaStages";

export function ExtendSlaDialog({ wo, onClose }) {
  const { priorities, priorityLabel, slaForPriority } = useReferenceData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /* Computed once on open rather than on every render: `now` moving between
     renders would let the pre-selected option change under the reader's finger
     while they are looking at it. */
  const plan = useMemo(
    () => suggestExtension(wo, priorities, slaForPriority, Date.now()),
    [wo, priorities, slaForPriority]
  );

  const [choice, setChoice] = useState(plan.suggested?.id ?? "");
  const selected = plan.options.find((o) => o.id === choice) ?? null;

  const stageLabel = plan.stage ? STAGE_LABELS[plan.stage] : null;
  const currentDue = openStageDueAt(wo);
  const remain = openStageRemainMs(wo);

  async function submit(e) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    setBusy(true);
    try {
      await extendWorkOrderSla(wo.id, selected.id);
      onClose();
    } catch (err) {
      setError(describeError(err, "Couldn't extend the SLA."));
      setBusy(false);
    }
  }

  return (
    <ModalOverlay onClose={onClose} label="Extend SLA" className="p-4">
      <Card className="rise max-h-[85dvh] w-full max-w-md overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[15.5px] font-bold text-ink">Extend SLA</h2>
          <button onClick={onClose} aria-label="Close" className="text-ink-soft hover:text-ink">
            <X size={18} />
          </button>
        </div>

        {error && <ErrorBanner message={error} />}

        <p className="mb-3.5 text-[12.5px] leading-relaxed text-ink-soft">
          <strong className="font-mono text-ink">{wo.wo_number || "This work order"}</strong> is{" "}
          <strong className="text-ink">
            {priorityLabel(wo.priority)} ({wo.priority})
          </strong>
          {stageLabel && (
            <>
              , and its <strong className="text-ink">{stageLabel.toLowerCase()}</strong> stage{" "}
              {remain != null && remain < 0 ? (
                <>
                  was due <strong className="text-danger">{fmtDateTimeMY(currentDue)}</strong> —{" "}
                  {fmtElapsed(Math.abs(remain))} ago.
                </>
              ) : (
                <>
                  is due <strong className="text-ink">{fmtDateTimeMY(currentDue)}</strong>, in{" "}
                  {fmtDue(remain)}.
                </>
              )}
            </>
          )}
        </p>

        {plan.options.length === 0 ? (
          <p className="mb-4 text-[12.5px] text-ink-soft">
            There is no lower priority to move this work order to, so its SLA cannot be
            extended any further.
          </p>
        ) : (
          <form onSubmit={submit}>
            {!plan.anyClears && (
              <p className="mb-3 rounded border border-warn/40 bg-warn/10 px-2.5 py-2 text-[12px] leading-relaxed text-ink">
                Every option below still leaves this work order past its deadline. Extending
                it will give it more time, but it will stay overdue.
              </p>
            )}

            <fieldset className="mb-4">
              <legend className="mb-1.5 text-[12.5px] font-semibold text-ink">Extend to</legend>
              <div className="flex flex-col gap-1">
                {plan.options.map((o) => (
                  <label
                    key={o.id}
                    className="flex items-start gap-2.5 rounded px-2 py-2 text-[13px] text-ink hover:bg-canvas"
                  >
                    <input
                      type="radio"
                      name="extend-to"
                      value={o.id}
                      checked={choice === o.id}
                      onChange={() => setChoice(o.id)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="font-semibold">
                        {o.label} ({o.id})
                      </span>
                      {o.id === plan.suggested?.id && (
                        <span className="ml-1.5 rounded bg-brand/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand">
                          Suggested
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                        {o.dueAt == null ? (
                          <>This stage has not started, so there is no deadline to move yet.</>
                        ) : (
                          <>
                            {stageLabel} due {fmtDateTimeMY(new Date(o.dueAt).toISOString())}
                            {o.gainMs != null && o.gainMs > 0 && <> · +{fmtElapsed(o.gainMs)}</>}
                            {!o.clears && <> · still overdue</>}
                          </>
                        )}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mb-4 rounded border border-line bg-canvas px-2.5 py-2 text-[11.5px] leading-relaxed text-ink-soft">
              <Clock size={12} className="mr-1 inline align-[-1px]" />
              This is recorded on the work order&apos;s timeline with your name and the time,
              and the assigned technician and the person who raised it are both notified. The
              stages this work order has already missed stay on its record — extending gives
              it more time from here, it does not erase what happened.
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                No, leave it
              </Button>
              <Button type="submit" loading={busy} disabled={!selected}>
                Yes, extend to {selected?.id ?? "…"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </ModalOverlay>
  );
}

export default ExtendSlaDialog;
```

If any of `Card`, `Button`, `ErrorBanner`, `ModalOverlay` is not exported from `../ui/Primitives`, copy the import line from `WorkOrderDetail.jsx`, which already imports all four.

- [ ] **Step 2: Wire it into the detail page**

In `app/src/components/workorders/WorkOrderDetail.jsx`:

Add to the `constants` import on line 8: `canExtendSla`.
Add a new import beside the other component imports:

```jsx
import { ExtendSlaDialog } from "./ExtendSlaDialog";
```

Beside `const showPriority = canOverridePriority(wo, user);` (line 143) add:

```jsx
  const showExtend = canExtendSla(wo, user);
```

Add the state beside the existing `changingPriority` state:

```jsx
  const [extendingSla, setExtendingSla] = useState(false);
```

Add the button immediately after the existing "Change priority" button, matching its markup and variant, with the label `Extend SLA`, `onClick={() => setExtendingSla(true)}`, rendered under `{showExtend && …}`.

Add the dialog beside line 342's `<PriorityDialog …>`:

```jsx
        {extendingSla && <ExtendSlaDialog wo={wo} onClose={() => setExtendingSla(false)} />}
```

- [ ] **Step 3: Verify it compiles and renders**

```bash
cd app && npm run build
```

Then start the preview and sign in as an Administrator:

```bash
cd app && npm run dev
```

Open a work order whose open stage is overdue. Expected: an **Extend SLA** button beside Change priority; the dialog names the open stage and how late it is; one option carries the **Suggested** chip; pressing "Yes, extend to …" closes the dialog, the priority badge in the header changes without a reload (the listener is already open on this work order), and the timeline gains an **SLA extended** entry.

On a work order with most of its time left, expected: no button at all.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/workorders/ExtendSlaDialog.jsx app/src/components/workorders/WorkOrderDetail.jsx
git commit -m "Extend SLA dialog: the suggestion, the disclaimer, and yes/no"
```

---

## Task 10: The dashboard buckets and the SLA card's per-stage marks

**Files:**
- Modify: `app/src/components/dashboard/RoleDashboard.jsx:196-209`
- Modify: `app/src/components/workorders/WorkOrderDetail.jsx` (the SLA targets card, around line 876)

**Interfaces:**
- Consumes: `isStageOverdue`, `isStageAtRisk`, `openSlaStage`, `STAGE_LABELS` (Task 1).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Repoint the dashboard buckets**

In `RoleDashboard.jsx`, replace the `remainMs` / `overdue` / `atRisk` block (lines 190-209) with:

```jsx
    /* The open stage's clock, not the resolution one — migrations 0067, 0068.
       Every priority is sequential now, so a work order has one stage running
       at a time and it is that stage's deadline that can be missed. Reading
       `sla_resolution_due_at` here would report every unstarted work order as
       having no deadline at all, which is exactly the work an Overdue card
       exists to surface.

       isStageOverdue / isStageAtRisk mirror si_sla_breach_sweep and
       si_sla_warning_sweep, so this card and the notification somebody received
       about the same work order cannot disagree. */
    const overdue = open.filter((w) => isStageOverdue(w));
    const atRisk = open.filter((w) => isStageAtRisk(w));
```

Update the imports at the top of the file: remove `slaRemainMs` and `slaWindowMs` from the `constants` import **only if nothing else in the file uses them** (check with a search first), and add:

```jsx
import { isStageOverdue, isStageAtRisk } from "../../lib/slaStages";
```

- [ ] **Step 2: Mark each stage on the detail page**

In `WorkOrderDetail.jsx`'s SLA targets card, each row rendered from `slaStages(wo, sla)` gains the sticky verdict beside the elapsed time. Add to the `constants`/`slaStages` import: `openSlaStage`. Inside the map over `stages`, read the matching flag:

```jsx
              const missed =
                s.key === "acknowledge" ? wo.sla_ack_breached
                : s.key === "response" ? wo.sla_response_breached
                : wo.sla_resolution_breached;
              const isOpen = openSlaStage(wo) === s.key;
```

and render, after the existing actual/target pair:

```jsx
              {missed && (
                <span className="ml-1.5 rounded bg-danger/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-danger">
                  Missed
                </span>
              )}
              {isOpen && !missed && (
                <span className="ml-1.5 rounded bg-brand/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-brand">
                  Running
                </span>
              )}
```

This is where a cleared Overdue is still visible: the card stops counting the work order the moment the stage advances, and the **Missed** chip stays for good.

- [ ] **Step 3: Verify**

```bash
cd app && npm run build
```

Then with `npm run dev`, as a Manager: the dashboard's **Overdue** card and its drill-down list the work orders whose current stage is past due; open one of them and the SLA card shows **Missed** against that stage and **Running** against none, or **Running** against the stage still in progress.

Cross-check the client and the server agree:

```sql
select count(*) from work_orders
 where status = any (si_open_statuses()) and sla_stage_overdue;
```

Expected: the same number the Overdue card shows.

- [ ] **Step 4: Commit**

```bash
git add app/src/components/dashboard/RoleDashboard.jsx app/src/components/workorders/WorkOrderDetail.jsx
git commit -m "Dashboard and SLA card read the open stage"
```

---

## Task 11: The export

**Files:**
- Modify: `app/src/lib/exportWorkOrders.js:273-288`

**Interfaces:**
- Consumes: nothing from earlier client tasks.
- Produces: four new columns on the **Work Orders** sheet.

- [ ] **Step 1: Add the columns**

In the `// ---- SLA ----` block, after the existing `SLA Status` and `SLA Warning Sent` columns:

```js
    /* Which stages were missed, migration 0067. `SLA Status` above keeps its
       meaning — "was this work order ever late" — and these three say where,
       which is the question a monthly review actually asks. The dashboard's
       transient sla_stage_overdue is deliberately NOT exported: a workbook is
       read weeks later and "late right now" would mean "late when the file was
       saved", which is a fact about the download rather than about the work. */
    { header: "Ack Stage Missed", width: 16, cell: (w) => textCell(yesNo(w.sla_ack_breached)) },
    { header: "Response Stage Missed", width: 20, cell: (w) => textCell(yesNo(w.sla_response_breached)) },
    { header: "Resolution Stage Missed", width: 22, cell: (w) => textCell(yesNo(w.sla_resolution_breached)) },
    /* Migration 0071. Distinct from "Priority Overridden", which records the
       requester overriding a suggestion and has read "No" for everything since
       0036 — folding them together would make one heading mean two things. */
    { header: "SLA Extensions", width: 14, cell: (w) => numberCell(w.sla_extension_count ?? 0) },
```

If the file has no `numberCell` helper, use the same helper the other numeric columns in this file use — check the `Times Reassigned` column and copy its shape.

- [ ] **Step 2: Verify**

```bash
cd app && npm run build
```

Then with `npm run dev`, as a Manager, export the work order list and open the workbook. Expected: the four new columns are present on the **Work Orders** sheet, the three stage columns read Yes/No, and `SLA Extensions` is a number that sorts.

- [ ] **Step 3: Commit**

```bash
git add app/src/lib/exportWorkOrders.js
git commit -m "Export: which SLA stages were missed, and how often it was extended"
```

---

## Task 12: End-to-end walk, and CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Walk the whole flow on test**

Raise a work order as a Requester, then take it through `assigned → accepted → repairing → testing → completed` as the right roles, checking at each step:

- `sla_stage_overdue` is set only while the current stage is past due, and clears on the next transition.
- Whichever sticky flags were set stay set.
- `si_sla_breach_sweep()` called twice in a row returns a non-zero count then `0`.
- The technician receives the notifications they should and none about anybody else's work.

Then, as an Administrator, extend one overdue work order and confirm:

```sql
select status, assigned_to_id, acknowledged_at, responded_at, decline_count
  from work_orders where id = '<uuid>';
```

is byte-identical to the same query run immediately before the extension.

- [ ] **Step 2: Raise a P8 from the form**

As a Requester, raise a work order choosing **Scheduled work (month-scale)** as the production impact. Expected: the form previews P8 and its three targets; after submitting, the badge is teal, `priority` is `P8`, `sla_ack_due_at` is five days out, and both later deadlines are NULL.

Then confirm the dashboard adds up:

```sql
select si_compute_dashboard_stats();
select data from stats where id = 'dashboard_cards';
```

Expected: `p8_scheduled` present, and `p1_critical + p2_high + p3_medium + p4_low + p7_long_term + p8_scheduled` equals `total_open`.

- [ ] **Step 3: Update CLAUDE.md**

Replace the section headed **"P7, and an SLA whose stages start when the last one finished (0048, 0050)"** with one covering 0067-0071. It must say, in the file's own voice:

- Every priority is sequential now, and the conversion was cumulative-to-incremental subtraction, so no headline promise moved. Include the six-row table of stage durations.
- The accepted consequence: beating a stage target finishes the job earlier.
- Why per-stage breach flags and `sla_stage_overdue` are separate columns, and that `sla_breached` is now the OR of the three.
- That `si_open_sla_stage` tests the finished statuses first, and why (0062's three rows).
- That `si_stamp_work_order` recomputes `sla_stage_overdue` rather than clearing it.
- That the breach sweep's guard is per stage, which is what stops it notifying every five minutes forever.
- That the warning window is the stage's, and that `sla_warning_sent` stays one flag per work order deliberately.
- That the Overdue card changed meaning and the figure moved in both directions on the day it landed.
- 0069: recomputed from recorded instants and not from `now()`, `sla_backfill_0069` holds the before-image, and sign-off was untouched.
- P8: a month, sequential, teal, a full impact level, visible to requesters, and the dashboard branch it needed.
- 0071: the three ways the extension RPC differs from 0051's override, that the rank must strictly increase, that the sticky flags are not reset by an extension, and that `sla_extension_count` is in the guard's protected set.

Also update **Known gaps**: remove nothing, and add that the advisor has not been re-run after 0067-0071 — `si_open_sla_stage`, `si_open_stage_started_at`, `si_open_stage_due_at` and `si_extend_work_order_sla` are new and granted to `authenticated`, and the last will be reported under *Signed-In Users Can Execute SECURITY DEFINER Function*, correctly and deliberately, because the browser calls it and it re-checks its caller in its own body.

- [ ] **Step 4: Final compile check and commit**

```bash
cd app && npm run check:units && npm run build
```

```bash
git add CLAUDE.md
git commit -m "CLAUDE.md: sequential SLA stages, per-stage overdue, P8, SLA extension"
```

- [ ] **Step 5: Hand back**

Report to the user: what was verified and how, the before/after backfill table from Task 5, and the fact that **nothing has been pushed to production** — `db:push` and the git push to `main` are theirs to run, and the SQL Editor is the route that works for them.

---

## Self-Review

**Spec coverage:** §1.1 numbers → Task 3 Step 2. §1.2 consequence → documented in 0067's header and Task 12. §1.3 `si_sla_targets` / insert / stamp → Task 3. §2.1 columns → Task 3. §2.2 open stage → Task 3 (`si_open_sla_stage`) and Task 1 (client mirror). §2.3 maintainers → Task 3 (stamp) and Task 4 (both sweeps). §2.4 readers → Task 4 (dashboard), Task 10 (RoleDashboard, SLA card), Task 11 (export). §3 backfill → Task 5, with the review gate at Step 4. §4 P8 → Tasks 6 and 7. §5.1-5.2 RPC → Task 7. §5.3 suggestion → Task 2. §5.4 gate → Task 8 and the RPC body. §5.5 dialog → Task 9. §5.6 logging → Task 7 (history, notify) and Task 8 (label). §6 files → the File Structure table. §7 verification → every task's verify step, plus Task 12. §8 numbering → Task 3 Step 1. §9 risks → Task 5's gate and Task 12's CLAUDE.md note.

**Deviations from the spec, both deliberate and both noted above:** five migrations rather than three; and `fmtElapsed` is reused for the "+4d 6h" gain in the dialog rather than a new formatter, because a gain is an elapsed duration and `fmtDue` would append "overdue" to a negative.

**Names checked across tasks:** `openSlaStage`, `openStageStartedAt`, `openStageDueAt`, `openStageRemainMs`, `isStageOverdue`, `isStageAtRisk`, `STAGE_LABELS` (Task 1, used in Tasks 2, 8, 9, 10); `extensionOptions`, `suggestExtension` (Task 2, used in Task 9); `si_open_sla_stage`, `si_open_stage_started_at`, `si_open_stage_due_at` (Task 3, used in Tasks 4, 5, 7); `sla_ack_breached`, `sla_response_breached`, `sla_resolution_breached`, `sla_stage_overdue` (Task 3, used in Tasks 4, 5, 7, 10, 11); `sla_extension_count` (Task 7, used in Tasks 7, 11); `canExtendSla`, `extendWorkOrderSla` (Task 8, used in Task 9).
