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
  opts.filter((o) => o.kind === "regrade").map((o) => o.id),
  ["P2", "P3", "P4", "P7", "P8"],
  "only less urgent priorities are offered as re-grades, in rank order"
);
const regrades = opts.filter((o) => o.kind === "regrade");
assert.equal(regrades[0].dueAt, T0 + 15 * MIN);
assert.equal(regrades[0].gainMs, 10 * MIN, "P2 buys 10 more minutes than P1");
assert.equal(regrades[0].clears, false, "P2's deadline is still in the past");
assert.equal(regrades[1].id, "P3");
assert.equal(regrades[1].clears, true, "P3's 30-minute ack stage reaches past now");

const s = suggestExtension(stuckAtAck, PRIORITIES, slaFor, T0 + 20 * MIN);
assert.equal(s.stage, "acknowledge");
assert.equal(s.anyClears, true);
/* The top-up buys 5 more minutes on a stage already 15 minutes past, so it
   does not clear and the smallest step that DOES is still P3. */
assert.equal(s.suggested.key, "P3", "the smallest step that actually clears it");

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
const rRegrades = r.options.filter((o) => o.kind === "regrade");
// P2's resolution stage is 420 min from responded_at = T0+430.
assert.equal(rRegrades[0].dueAt, T0 + 430 * MIN);
assert.equal(rRegrades[0].gainMs, (430 - 235) * MIN);
/* Since 0075 the smallest step is no longer P2: another 225 minutes of P1's
   own resolution window reaches T0+460, which clears T0+240 without re-grading
   a work order whose priority nobody is disputing. */
assert.equal(r.suggested.key, "top-up", "the top-up is the smallest step that clears it");
assert.equal(r.suggested.dueAt, T0 + 460 * MIN);
assert.equal(r.suggested.grantMs, 225 * MIN);

// ---------------------------------------------------------------------------
// A retired priority is never offered. Same rule as every other picker: the
// row stays so old work orders still render, and stops being choosable.
// ---------------------------------------------------------------------------
const retired = PRIORITIES.map((p) => (p.id === "P2" ? { ...p, is_active: false } : p));
assert.deepEqual(
  extensionOptions(stuckAtAck, retired, slaFor, T0 + 20 * MIN)
    .filter((o) => o.kind === "regrade")
    .map((o) => o.id),
  ["P3", "P4", "P7", "P8"]
);
/* The top-up survives its own priority being retired, deliberately: it moves
   the work order nowhere, so there is no choosable value for the retirement to
   veto, and si_guard_retired_reference only ever checks values being SET. */
assert.equal(
  extensionOptions(stuckAtAck, PRIORITIES.map((p) => (p.id === "P1" ? { ...p, is_active: false } : p)), slaFor, T0 + 20 * MIN)[0].kind,
  "top-up"
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
// date. Since migration 0070 the open stage is decided by STATUS, not by
// which timestamp is null — so this work order is already `assigned` and
// therefore sitting in the RESPONSE stage, whose clock (acknowledged_at) has
// not started. That is the reachable gap: a row can carry a status ahead of
// a stamp that was never backfilled for it.
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
assert.equal(u[0].dueAt, null, "the response stage's clock has not started, so there is no deadline to offer");
assert.equal(u[0].gainMs, null, "with no deadline on either side, the gain is unknown rather than zero");

// ---------------------------------------------------------------------------
// 0075 — topping up in place. The first option keeps the priority and gives the
// OPEN stage one more of its own window, so a P1 stuck at a 5-minute
// acknowledge stage is offered another 5 minutes before any re-grade.
// ---------------------------------------------------------------------------
const withTopUp = extensionOptions(stuckAtAck, PRIORITIES, slaFor, T0 + 20 * MIN);
assert.equal(withTopUp[0].kind, "top-up", "the top-up leads the list");
assert.equal(withTopUp[0].key, "top-up");
assert.equal(withTopUp[0].id, "P1", "it stays on the work order's own priority");
assert.equal(withTopUp[0].dueAt, T0 + 10 * MIN, "5-minute stage, plus another 5");
assert.equal(withTopUp[0].grantMs, 5 * MIN);
assert.equal(withTopUp[0].gainMs, 5 * MIN);
assert.equal(withTopUp[0].clears, false, "still short of T0+20");
assert.deepEqual(
  withTopUp.slice(1).map((o) => o.key),
  ["P2", "P3", "P4", "P7", "P8"],
  "the re-grades follow, unchanged and still in rank order"
);
assert.equal(withTopUp[1].kind, "regrade");

// ---------------------------------------------------------------------------
// Time already granted is part of every deadline, not just the top-up's. A
// work order carrying 10 extra ack minutes has them added to the re-grade
// options too — the server does exactly this (0075 note 1), and an option
// naming a date the server will not produce is worse than no option at all.
// ---------------------------------------------------------------------------
const toppedOnce = {
  ...stuckAtAck,
  sla_ack_extra_mins: 10,
  sla_ack_due_at: iso(T0 + 15 * MIN),
  sla_top_up_count: 1,
};
const again = extensionOptions(toppedOnce, PRIORITIES, slaFor, T0 + 20 * MIN);
assert.equal(again[0].dueAt, T0 + 20 * MIN, "5 target + 10 already granted + 5 more");
assert.equal(again[0].gainMs, 5 * MIN, "measured against the deadline it actually has");
assert.equal(again[1].id, "P2");
assert.equal(again[1].dueAt, T0 + 25 * MIN, "P2's 15-minute stage keeps the 10 granted minutes");

// ---------------------------------------------------------------------------
// The dead end 0075 exists to remove: a P8 has no lower priority to move to,
// so before this it could not be extended at all. It can always be topped up.
// ---------------------------------------------------------------------------
const p8Stuck = {
  priority: "P8",
  status: "open",
  created_at: iso(T0),
  acknowledged_at: null,
  responded_at: null,
  sla_ack_due_at: iso(T0 + 7200 * MIN),
  sla_response_due_at: null,
  sla_resolution_due_at: null,
};
const p8 = suggestExtension(p8Stuck, PRIORITIES, slaFor, T0 + 7300 * MIN);
assert.equal(p8.options.length, 1, "no re-grade is available below P8");
assert.equal(p8.options[0].kind, "top-up");
assert.equal(p8.options[0].dueAt, T0 + 14400 * MIN, "another five days");
assert.equal(p8.suggested.key, "top-up");
assert.equal(p8.anyClears, true);

// ---------------------------------------------------------------------------
// A stage whose clock has not started is offered no top-up: there is no
// deadline to add to, and si_extend_work_order_sla refuses it for that reason.
// `unstarted` is the P7 above, sitting in an unstarted response stage — so the
// list is still the re-grades alone.
// ---------------------------------------------------------------------------
assert.deepEqual(u.map((o) => o.key), ["P8"], "no top-up without a deadline to extend");

// A finished work order is still offered nothing, top-up included.
assert.deepEqual(
  extensionOptions({ ...repairing, status: "closed" }, PRIORITIES, slaFor, T0),
  []
);

// Null-safe.
assert.deepEqual(extensionOptions(null, PRIORITIES, slaFor, T0), []);
assert.equal(suggestExtension(null, PRIORITIES, slaFor, T0).suggested, null);

console.log("slaExtension: all assertions passed");
