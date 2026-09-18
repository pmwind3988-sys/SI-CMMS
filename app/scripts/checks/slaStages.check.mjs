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
