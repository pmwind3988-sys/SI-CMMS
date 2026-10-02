/**
 * SI — Service Inside · What extending a work order's SLA would buy it
 * (migration 0078; earlier modes from 0072/0075 are no longer offered)
 *
 * Extending gives the stage a work order is sitting in a chosen priority's
 * FULL total — "P8 is a month" — and never moves the priority. When the stage
 * is already overdue, the overdue time is absorbed and the amount counts from
 * now, so the Administrator never does overdue arithmetic:
 *
 *   dueAt = max(now, currentDue) + amount
 *
 * **Advisory only.** si_extend_sla_stage re-checks the Administrator, the
 * status and the at-risk gate in its own body and computes the real deadline;
 * the worst a wrong answer here can do is show a date a minute off.
 *
 * Pure — no React, no Supabase — so every boundary is exercised in Node.
 */
import { openSlaStage, openStageDueAt } from "./slaStages.js";

const MIN = 60000;

const at = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** Minutes already granted to each stage by earlier extensions (0075, 0078). */
const STAGE_EXTRA_KEY = {
  acknowledge: "sla_ack_extra_mins",
  response: "sla_response_extra_mins",
  resolution: "sla_resolution_extra_mins",
};

/** How much time earlier extensions have added to `stage`, in milliseconds. */
export function stageGrantedMs(wo, stage) {
  return (Number(wo?.[STAGE_EXTRA_KEY[stage]]) || 0) * MIN;
}

/** A priority's full total in minutes — acknowledge + response + resolution —
 *  which is the amount extending "by" it adds. Null when it has no targets. */
export function priorityTotalMinutes(sla) {
  if (!sla) return null;
  const total =
    (Number(sla.ack_target_minutes) || 0) +
    (Number(sla.response_target_minutes) || 0) +
    (Number(sla.resolution_target_minutes) || 0);
  return total > 0 ? total : null;
}

/**
 * One option per active priority, rank ascending, each naming the deadline the
 * open stage would end up with. Empty when no stage is running or the running
 * stage has no deadline yet — the server refuses both.
 */
export function extensionOptions(wo, priorities, slaFor, now = Date.now()) {
  const stage = openSlaStage(wo);
  if (!stage || !Array.isArray(priorities) || typeof slaFor !== "function") return [];
  const due = at(openStageDueAt(wo));
  if (due == null) return [];

  /* Rounded UP to the minute, as the server does, so the deadline shown is
     never earlier than the one that will be stored. */
  const absorbedMs = Math.max(0, Math.ceil((now - due) / MIN) * MIN);

  return priorities
    .filter((p) => p.is_active !== false && p.rank != null)
    .sort((a, b) => a.rank - b.rank)
    .map((p) => {
      const mins = priorityTotalMinutes(slaFor(p.id));
      if (mins == null) return null;
      const grantMs = mins * MIN;
      return {
        key: p.id,
        id: p.id,
        label: p.label ?? p.id,
        rank: p.rank,
        own: p.id === wo.priority,
        grantMs,
        absorbedMs,
        dueAt: due + absorbedMs + grantMs,
        gainMs: absorbedMs + grantMs,
      };
    })
    .filter(Boolean);
}

/** The options plus the one to pre-select: the work order's own priority. */
export function suggestExtension(wo, priorities, slaFor, now = Date.now()) {
  const stage = openSlaStage(wo);
  const options = extensionOptions(wo, priorities, slaFor, now);
  return {
    stage,
    options,
    suggested: options.find((o) => o.own) || options[0] || null,
    absorbedMs: options[0]?.absorbedMs ?? 0,
  };
}
