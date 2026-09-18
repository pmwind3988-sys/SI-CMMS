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
