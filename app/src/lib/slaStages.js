/**
 * SI — Service Inside · What each SLA stage promised, and what it actually took
 *
 * The detail page prints three SLA targets. Until now it printed only the
 * targets, which tells you what was promised and nothing about whether it
 * happened — and on a closed work order the promise is the least interesting
 * half. This pairs each target with the elapsed time actually recorded for that
 * stage, so the two can be read side by side.
 *
 * **Each actual is measured the same way its target is, and that is the whole
 * reason this is a module rather than three expressions in the component.**
 * P1-P4's targets are offsets from the raise time; P7's are stage durations
 * that start when the previous stage was met (migration 0050). Measuring a
 * sequential stage from `created_at` would compare a seven-day promise against
 * a fifteen-day elapsed and report a breach that never happened, and measuring
 * a from-creation stage from the previous stamp would do the reverse and hide a
 * real one. `sla.targets_are_sequential` decides which, exactly as it does in
 * si_sla_targets() and si_before_work_order_insert().
 *
 * Pure — no React, no Supabase — for the reason attachmentPhases.js and
 * historyEvents.js are: it can then be exercised in Node, which is the only
 * place this repo can run a test at all.
 *
 * The three stage boundaries are the FSD's (§6, and §6.1 for the sequential
 * shape), and they are the same instants the database stamps:
 *
 *   acknowledge  created_at      -> acknowledged_at   (reached `assigned`)
 *   response     prev or created -> responded_at      (reached `repairing`)
 *   resolution   prev or created -> closed_at         (reached `closed`)
 */

const MIN = 60000;

/**
 * Humanise an elapsed duration. Days, hours and minutes — the units the SLA
 * targets themselves are written in, so "5 days" and "4d 6h" read against each
 * other without arithmetic.
 *
 * Distinct from fmtDue() in constants.js, which formats a *countdown* and
 * appends "overdue" to a negative. An elapsed time is never negative and never
 * wants that word.
 *
 * Rounds nothing away silently: under a minute reads "<1m" rather than "0m",
 * because a stage that genuinely completed instantly (a supervisor assigning a
 * job the moment it lands) is worth distinguishing from one that was not
 * measured.
 */
export function fmtElapsed(ms) {
  if (ms == null || Number.isNaN(ms)) return null;
  if (ms < MIN) return "<1m";
  const mins = Math.floor(ms / MIN);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const at = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/**
 * The three stages, each with its target and — once the stage has finished —
 * what it actually took.
 *
 * `actualMs` is null while a stage is unfinished, and also when its start was
 * never recorded: a work order closed without ever reaching `repairing` has no
 * response stamp, so the response stage cannot be measured rather than having
 * taken zero. `met` is null in exactly those cases too — the honest answer to
 * "did it meet the target" for something not yet finished is "not yet", not
 * "no".
 *
 * Returns [] when there is no SLA row to compare against, which is what the
 * caller already renders as nothing.
 */
export function slaStages(wo, sla) {
  if (!wo || !sla) return [];

  const sequential = !!sla.targets_are_sequential;
  const created = at(wo.created_at);
  const acked = at(wo.acknowledged_at);
  const responded = at(wo.responded_at);
  const closed = at(wo.closed_at);

  const defs = [
    {
      key: "acknowledge",
      label: "Acknowledge",
      targetLabel: sla.ack_target_label,
      targetMinutes: sla.ack_target_minutes,
      // Always from the raise time, on every priority: acknowledging IS the
      // first stage, so there is no previous one for it to follow.
      from: created,
      to: acked,
      endedNote: "assigned to a technician",
    },
    {
      key: "response",
      label: "Response",
      targetLabel: sla.response_target_label,
      targetMinutes: sla.response_target_minutes,
      from: sequential ? acked : created,
      to: responded,
      endedNote: "work started",
    },
    {
      key: "resolution",
      label: "Resolution",
      targetLabel: sla.resolution_target_label,
      targetMinutes: sla.resolution_target_minutes,
      from: sequential ? responded : created,
      to: closed,
      endedNote: "closed",
    },
  ];

  return defs.map((d) => {
    const actualMs = d.from != null && d.to != null ? d.to - d.from : null;
    const targetMs = d.targetMinutes != null ? d.targetMinutes * MIN : null;
    return {
      key: d.key,
      label: d.label,
      targetLabel: d.targetLabel ?? null,
      actualMs,
      actualLabel: fmtElapsed(actualMs),
      finished: actualMs != null,
      met: actualMs != null && targetMs != null ? actualMs <= targetMs : null,
      endedNote: d.endedNote,
      sequential,
    };
  });
}
