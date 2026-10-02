/**
 * Node assertions for lib/slaExtension.js (migration 0078 semantics).
 * Run: node scripts/checks/slaExtension.check.mjs
 */
import assert from "node:assert/strict";
import { extensionOptions, suggestExtension, priorityTotalMinutes, stageGrantedMs } from "../../src/lib/slaExtension.js";

const T0 = Date.parse("2026-09-19T00:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const DAY = 1440 * MIN;

const PRIORITIES = [
  { id: "P8", label: "Scheduled", rank: 8, is_active: true },
  { id: "P1", label: "Critical", rank: 1, is_active: true },
  { id: "P2", label: "High", rank: 2, is_active: true },
  { id: "P3", label: "Medium", rank: 3, is_active: true },
  { id: "P4", label: "Low", rank: 4, is_active: false },
  { id: "P7", label: "Long-term", rank: 7, is_active: true },
];
const TARGETS = {
  P1: [5, 10, 225], P2: [15, 45, 420], P3: [30, 210, 1200],
  P4: [120, 1320, 5760], P7: [7200, 4320, 10080], P8: [7200, 7200, 28800],
};
const slaFor = (id) =>
  TARGETS[id]
    ? { ack_target_minutes: TARGETS[id][0], response_target_minutes: TARGETS[id][1], resolution_target_minutes: TARGETS[id][2] }
    : null;

assert.equal(priorityTotalMinutes(slaFor("P7")), 21600, "P7 total is 15 days");
assert.equal(priorityTotalMinutes(slaFor("P8")), 43200, "P8 total is 30 days");
assert.equal(priorityTotalMinutes(null), null);
assert.equal(priorityTotalMinutes({ ack_target_minutes: 0 }), null);

// A P7 in testing (resolution stage), due 9 days ago; now = T0.
const overdue = {
  priority: "P7", status: "testing",
  created_at: iso(T0 - 20 * DAY), acknowledged_at: iso(T0 - 18 * DAY), responded_at: iso(T0 - 16 * DAY),
  sla_ack_due_at: iso(T0 - 15 * DAY), sla_response_due_at: iso(T0 - 13 * DAY), sla_resolution_due_at: iso(T0 - 9 * DAY),
  sla_resolution_extra_mins: 0,
};

const opts = extensionOptions(overdue, PRIORITIES, slaFor, T0);
assert.deepEqual(opts.map((o) => o.id), ["P1", "P2", "P3", "P7", "P8"], "active priorities in rank order; retired P4 excluded");
const p7 = opts.find((o) => o.id === "P7");
assert.equal(p7.own, true);
assert.equal(p7.grantMs, 15 * DAY);
assert.equal(p7.absorbedMs, 9 * DAY, "overdue time is absorbed");
assert.equal(p7.dueAt, T0 + 15 * DAY, "overdue: due = now + amount");
assert.equal(p7.gainMs, 24 * DAY);
assert.equal(opts.find((o) => o.id === "P8").dueAt, T0 + 30 * DAY);

const s = suggestExtension(overdue, PRIORITIES, slaFor, T0);
assert.equal(s.stage, "resolution");
assert.equal(s.suggested.id, "P7", "the work order's own priority is pre-selected");
assert.equal(s.absorbedMs, 9 * DAY);

// Absorbed time is rounded UP to the minute, matching the server.
const fractional = extensionOptions(overdue, PRIORITIES, slaFor, T0 + 30_000)[0];
assert.equal(fractional.absorbedMs, 9 * DAY + MIN);

// Not overdue (1 day left): amount added on top, nothing absorbed.
const atRisk = { ...overdue, sla_resolution_due_at: iso(T0 + DAY) };
const r = extensionOptions(atRisk, PRIORITIES, slaFor, T0).find((o) => o.id === "P8");
assert.equal(r.absorbedMs, 0);
assert.equal(r.dueAt, T0 + DAY + 30 * DAY);

// No deadline yet, or no open stage → nothing to offer.
assert.deepEqual(extensionOptions({ ...overdue, sla_resolution_due_at: null }, PRIORITIES, slaFor, T0), []);
assert.deepEqual(extensionOptions({ ...overdue, status: "closed" }, PRIORITIES, slaFor, T0), []);
assert.equal(suggestExtension({ ...overdue, status: "closed" }, PRIORITIES, slaFor, T0).suggested, null);

// Own priority missing from the list → first option suggested.
assert.equal(suggestExtension({ ...overdue, priority: "P4" }, PRIORITIES, slaFor, T0).suggested.id, "P1");

assert.equal(stageGrantedMs({ sla_resolution_extra_mins: 60 }, "resolution"), 60 * MIN);
assert.equal(stageGrantedMs({}, "resolution"), 0);

console.log("slaExtension: all assertions passed");
