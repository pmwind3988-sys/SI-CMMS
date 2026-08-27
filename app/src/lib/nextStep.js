/**
 * SI — Service Inside · What happens to this work order next, and whose move it is
 *
 * Derived from `wo_status_transitions`, never from a list written here. That
 * table already holds exactly what this question needs — which moves are legal
 * from the current status, which roles may perform each, and a label for each
 * one — and it is the same table the trigger enforces. A hardcoded next-step
 * map would be a second copy of the workflow, and the moment the two disagreed
 * the copy would be the one on screen, telling somebody confidently to do a
 * thing the database refuses. Migration 0039 is the live example: it deleted
 * three rows and inserted one, and this module needed no edit.
 *
 * Pure — no React, no Supabase. `transitions` and the account are arguments.
 */
import { ROLES, hasAnyRole } from "./roles";

/**
 * Who a move belongs to, out of the roles allowed to make it.
 *
 * Every row in the matrix lists `manager` and `admin` alongside whoever the
 * move is actually FOR — they are overrides, present so a stuck record can be
 * corrected, not the person the work is waiting on. Stripping them leaves
 * exactly one role per row, and every row leaving a given status agrees on it,
 * which is what makes "whose move is it" answerable at all.
 */
const OWNER_PRIORITY = [ROLES.TECHNICIAN, ROLES.REQUESTER, ROLES.SUPERVISOR];

function ownerRole(transition) {
  return OWNER_PRIORITY.find((r) => transition.roles?.includes(r)) ?? null;
}

/**
 * The moves available from where this work order is now.
 *
 * `to_status === from_status` rows are dropped: the four "reassign mid-flight"
 * rows and the "edit core fields" row are corrections to a work order that is
 * already somewhere, not the step that moves it on. Offering "Reassign" as the
 * next step on every single status would drown the one answer that matters.
 */
export function nextTransitions(transitions, status, statusOrder) {
  const moves = (transitions || []).filter(
    (t) => t.from_status === status && t.to_status !== status
  );

  /* Ordered so the move that carries the job FURTHEST forward is named first.
     Row order out of the database is arbitrary, and it happened to read
     backwards on the two statuses that offer a choice: "Test failed or Mark
     completed" puts the setback ahead of the outcome, and the same for
     "Waiting for spare part" ahead of "Start testing". Sorting by the
     destination's own sort_order, descending, fixes both without a special
     case and stays derived — an admin who reorders the ladder in Settings
     reorders this too. Falls back to row order when the orders are unknown. */
  if (!statusOrder) return moves;
  return [...moves].sort(
    (a, b) => (statusOrder.get(b.to_status) ?? 0) - (statusOrder.get(a.to_status) ?? 0)
  );
}

/**
 * @param wo           the work order row
 * @param user         the signed-in account (`user.uid`, `user.roles`)
 * @param transitions  every row of wo_status_transitions
 * @param statusOrder  optional Map of status code -> sort_order, used only to
 *   name the most-advancing move first
 *
 * @returns `{ text, isYours }`, or null when there is nothing sensible to say.
 *   `isYours` is what earns the line its colour — the single most useful bit
 *   here is "am I being waited on, or am I a spectator right now".
 */
export function nextStep(wo, user, transitions, statusOrder) {
  if (!wo?.status) return null;

  const moves = nextTransitions(transitions, wo.status, statusOrder);

  /* A terminal status says so rather than rendering nothing. A guidance line
     that is present on ten screens and absent on the eleventh reads as a bug on
     the eleventh, and "is there anything left to do here?" is a real question
     about a closed job. */
  if (moves.length === 0) {
    return { text: "Nothing further — this work order is finished.", isYours: false };
  }

  const owner = ownerRole(moves[0]);
  const actions = moves.map((m) => m.label).filter(Boolean);

  /* Whether it is yours is a narrower test than whether you *may* act. A
     Manager may perform every technician move in the matrix; the job is still
     the assignee's, and telling a Manager "your move" on every work order in
     the plant would make the line worthless. So the technician branch asks who
     the job is assigned to, not what roles the reader holds — which is also the
     distinction the transition guard makes when it refuses a technician who is
     not the assignee. */
  let isYours = false;
  let waitingOn = null;

  if (owner === ROLES.TECHNICIAN) {
    isYours = !!wo.assigned_to_id && wo.assigned_to_id === user?.uid;
    waitingOn = wo.assigned_to_name || "the assigned technician";
  } else if (owner === ROLES.REQUESTER) {
    isYours = !!wo.requester_id && wo.requester_id === user?.uid;
    waitingOn = wo.requester_name || "the requester";
  } else if (owner === ROLES.SUPERVISOR) {
    // Nothing is assigned yet, so there is no named person to wait on — this is
    // the one case where the answer is genuinely a role rather than somebody.
    isYours = hasAnyRole(user, [ROLES.SUPERVISOR, ROLES.MANAGER, ROLES.ADMIN]);
    waitingOn = "a Supervisor";
  } else {
    return null;
  }

  const list = joinWithOr(actions);
  if (!list) return null;

  return {
    text: isYours ? `Your move: ${list}.` : `Waiting on ${waitingOn}: ${list}.`,
    isYours,
  };
}

/**
 * The labels are used verbatim rather than bent into a sentence. They are
 * imperative phrases written for buttons ("Accept", "Start work", "Waiting for
 * spare part"), and conjugating them — "a Supervisor assigns technician" — is
 * both wrong and impossible to do from data. Naming them as the actions they
 * are keeps the line true no matter what the matrix says.
 */
function joinWithOr(items) {
  if (!items.length) return null;
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}
