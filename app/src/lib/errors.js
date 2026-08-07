"use client";

/**
 * SI — Service Inside · Error presentation
 *
 * Since the migration, the database is the authorization boundary, and it raises
 * messages written to be read by the person who hit them: the transition matrix,
 * the column guards and the role checks in migrations 0002–0004 all say exactly
 * what went wrong and why. Collapsing those into a generic "try again" throws
 * away the only accurate explanation the user will ever get — and, worse, points
 * them at their connection when the real answer was "a requester may not assign
 * a technician".
 *
 * So the default here is to SHOW the server's message, and to hide only the
 * genuinely internal ones.
 *
 * Discriminating on SQLSTATE alone is not enough: a deliberate
 * `raise ... using errcode = 'insufficient_privilege'` and an RLS row denial are
 * both 42501, but only the first is meant for a human. Raw Postgres constraint
 * text has a recognisable shape, so that is what gets filtered.
 */

/** Raw Postgres constraint / RLS text — internal, never shown verbatim. */
function isInternalMessage(msg) {
  return (
    /violates (row-level security|check constraint|foreign key constraint|not-null constraint|unique constraint)/i.test(msg) ||
    /duplicate key value|invalid input syntax|column .* does not exist|relation .* does not exist/i.test(msg)
  );
}

/** Friendly stand-ins for the internal cases, keyed by SQLSTATE. */
const INTERNAL_FALLBACKS = {
  42501: "You don't have permission to do that.",
  23502: "A required field is missing.",
  23503: "That refers to something that no longer exists — reload and try again.",
  23505: "That already exists.",
  23514: "That change isn't allowed here.",
};

/**
 * Turn anything thrown by supabase-js into a sentence worth showing a user.
 * `fallback` is used only when there is genuinely nothing presentable.
 */
export function describeError(e, fallback = "Something went wrong — try again.") {
  if (!e) return fallback;

  const msg = String(e.message || "").trim();

  // Offline, or an unreachable project URL. Matched on the message rather than
  // on `e instanceof TypeError`, because a real bug in our own code is also a
  // TypeError and must not be reported to the user as a network problem.
  if (
    e.name === "AuthRetryableFetchError" ||
    /failed to fetch|networkerror|network request failed|load failed/i.test(msg)
  ) {
    return "Can't reach the server — check your connection and try again.";
  }

  if (msg && !isInternalMessage(msg)) return msg;

  return INTERNAL_FALLBACKS[Number(e.code)] || INTERNAL_FALLBACKS[e.code] || fallback;
}
