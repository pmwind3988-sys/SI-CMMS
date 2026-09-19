/**
 * SI — Service Inside · What extending a work order's SLA would buy it
 *
 * Extending buys the stage a work order is actually sitting in more time, and
 * since migration 0075 there are two ways to do it: TOP UP that stage with one
 * more of the work order's own window, or RE-GRADE to a less urgent priority
 * and take its longer window (0072, under the sequential stages of 0067). This
 * module answers the dialog's two questions — what is on offer, and which is
 * the smallest step that stops the work order being late — and nothing else.
 *
 * **Advisory only.** si_extend_work_order_sla re-checks the Administrator, the
 * status, the at-risk gate and, for a re-grade, that the target is strictly
 * less urgent, all in its own body. Nothing here is a permission: the worst a
 * wrong answer can do is pre-select the wrong radio button.
 *
 * Pure — no React, no Supabase — for the reason exportWorkOrders.js,
 * chartPeriods.js and slaStages.js are: it is what lets every boundary be
 * exercised in Node, which is the only place this repo can run a test.
 */
import { openSlaStage, openStageStartedAt, openStageDueAt } from "./slaStages.js";

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

/** Minutes already granted to each stage by a previous top-up (migration 0075).
 *  Part of every deadline this module computes, not only the top-up's — the
 *  server adds them to whichever priority's targets it is working from, so an
 *  option that left them out would name a date the server will not produce. */
const STAGE_EXTRA_KEY = {
  acknowledge: "sla_ack_extra_mins",
  response: "sla_response_extra_mins",
  resolution: "sla_resolution_extra_mins",
};

/**
 * How much time previous top-ups have already added to `stage`, in
 * milliseconds. Zero when nothing has been granted, so the dialog can say
 * "already given 14 days beyond its original target" without a second query —
 * the columns ride along on the work order row.
 */
export function stageGrantedMs(wo, stage) {
  return (Number(wo?.[STAGE_EXTRA_KEY[stage]]) || 0) * MIN;
}

/**
 * What the dialog can offer: one top-up, then every priority less urgent than
 * this work order's, in rank order, each with the deadline the open stage would
 * end up with.
 *
 * Two kinds, and the distinction is the whole of migration 0075:
 *
 *  - `kind: "top-up"` keeps the priority exactly where it is and gives the open
 *    stage one more of its OWN window. Always available while a stage is
 *    running, which is what stops a P7 — or, before 0075, anything at all —
 *    reaching a dead end where no lower priority is left to move to.
 *  - `kind: "regrade"` is 0072's original meaning: move to a less urgent
 *    priority and take that priority's longer window for the stage. Rank
 *    ascending is severity descending — 1 is most severe — so "less urgent" is
 *    a GREATER rank, and the server enforces the same comparison.
 *
 * `key` rather than `id` identifies an option, because a top-up's `id` is the
 * work order's current priority and would otherwise collide with nothing while
 * meaning something quite different. `id` is still what a re-grade sends.
 *
 * `dueAt` is null when the open stage's clock has not started, which is
 * reachable on any sequential priority: the caller says so rather than showing
 * a date nothing promised. A top-up is not offered at all in that case — there
 * is no deadline to add to, and si_extend_work_order_sla refuses it for that
 * same reason.
 *
 * **Advisory only**, like everything else in this file.
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
  const extraMins = Number(wo?.[STAGE_EXTRA_KEY[stage]]) || 0;

  /** The stage's deadline under `minutes` of target, keeping whatever has
   *  already been granted. Mirrors the server's `v_target + v_extra`. */
  const dueUnder = (minutes) =>
    startedAt != null && minutes != null ? startedAt + (minutes + extraMins) * MIN : null;

  const shape = (o) => ({
    ...o,
    gainMs: o.dueAt != null && currentDue != null ? o.dueAt - currentDue : null,
    clears: o.dueAt != null && o.dueAt > now,
  });

  const options = [];

  const ownMinutes = slaFor(wo.priority)?.[key];
  if (startedAt != null && currentDue != null && ownMinutes != null && ownMinutes > 0) {
    options.push(
      shape({
        key: "top-up",
        kind: "top-up",
        id: wo.priority,
        label: current.label ?? wo.priority,
        rank: currentRank,
        /* One more of the stage's own window, on top of anything already
           granted — so the second top-up buys exactly what the first did. */
        dueAt: dueUnder(ownMinutes * 2),
        grantMs: ownMinutes * MIN,
      })
    );
  }

  for (const p of priorities
    .filter((p) => p.is_active !== false && p.rank != null && p.rank > currentRank)
    .sort((a, b) => a.rank - b.rank)) {
    options.push(
      shape({
        key: p.id,
        kind: "regrade",
        id: p.id,
        label: p.label ?? p.id,
        rank: p.rank,
        dueAt: dueUnder(slaFor(p.id)?.[key]),
        /* Null rather than 0: "we cannot say how much this buys" and "this
           buys nothing" are different claims. */
        grantMs: null,
      })
    );
  }

  return options;
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
 *
 * The top-up leads the list, so whenever it is enough it is what gets
 * suggested — the smallest step that clears is now usually the one that
 * re-grades nothing. That ordering is the recommendation: a work order's
 * priority describes what the fault IS, and needing longer is not a reason to
 * restate it as something less severe.
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
