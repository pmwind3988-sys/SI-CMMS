/**
 * SI — Service Inside · What a work_order_history row is
 *
 * The table was a status trail and nothing else until migration 0043, which
 * started recording things that happen to a work order without moving it — a
 * photo replaced, so far. Those rows carry `event_type` naming what happened;
 * every row that came before them, and every row si_transition_work_order
 * writes, carries the column's default of `'transition'`.
 *
 * **The obvious test is wrong here.** "Not a transition" looks like
 * `from_status === to_status`, and on this schema that is a real transition:
 * `('assigned','assigned', …, 'Reassign (pre-acceptance)')` is row 3 of the
 * matrix in migration 0003, so every reassignment before acceptance matches it.
 * Anything reading the flow has to ask `event_type`, which is why that column
 * exists rather than the readers inferring it.
 *
 * Pure — no React, no Supabase — because the two callers are the timeline and
 * the Excel export, and neither should own the definition. Same reason
 * attachmentPhases.js is shaped this way.
 */

/**
 * Is this row a step through the status flow?
 *
 * Fail-safe on the missing value: a row with no `event_type` at all — one read
 * back before the migration is applied, or written by something that predates
 * it — is treated as a transition, which is what every such row is.
 */
export function isTransition(row) {
  return !row?.event_type || row.event_type === "transition";
}

/**
 * A word for a non-transition row, for the places that show one. Falls through
 * to the raw code rather than throwing, the fail-soft direction every lookup in
 * referenceData.js takes: an event added by a later migration should read
 * oddly, not vanish from an audit trail.
 */
const EVENT_LABELS = {
  photo_replaced: "Photo replaced",
};

export function historyEventLabel(row) {
  if (isTransition(row)) return null;
  return EVENT_LABELS[row.event_type] || row.event_type;
}
