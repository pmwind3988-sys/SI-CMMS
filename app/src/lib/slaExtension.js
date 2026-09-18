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
