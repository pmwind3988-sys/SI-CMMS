"use client";

/**
 * SI — Service Inside · carrying unsaved work across a forced sign-in.
 *
 * When a session cannot be recovered the user has to sign in again, and signing
 * in means leaving the page. A half-filled work order is the most expensive
 * thing in this app to lose: it is typed on a phone, on a plant floor, by
 * somebody standing in front of the fault.
 *
 * So the moment recovery is abandoned, whatever is on screen is snapshotted
 * here, and the form puts it back afterwards.
 *
 * Related to lib/toastHandoff.js and deliberately not merged with it. That
 * module carries ONE string across ONE navigation and is read-once by
 * construction. This one carries structured state across a sign-in — a
 * different lifetime, a different key shape, and an ownership test that a toast
 * has no need of.
 *
 * ─── Why sessionStorage ────────────────────────────────────────────────────
 *
 * Per-tab and cleared when the tab closes, which is the correct lifetime: a
 * draft is a rescue from an interruption, not a saved document. localStorage
 * would resurrect a two-week-old complaint on a shared plant terminal, and
 * `output: "export"` means there is no server-side session to hold it instead.
 *
 * ─── Why the uid is in the key ─────────────────────────────────────────────
 *
 * This is the load-bearing part. A draft holds free text somebody typed about a
 * fault, their name and their phone number. The whole reason it exists is that
 * a sign-in screen is about to appear — and the person who signs in at that
 * screen is NOT NECESSARILY the person who typed it. A shared terminal in a
 * workshop is the normal case, not the paranoid one.
 *
 * Keying every draft on the uid that produced it means a different account
 * cannot read one even by accident: it looks under its own uid and finds
 * nothing. clearDraftsFor() then removes the previous holder's drafts outright,
 * so they do not sit in the tab for the rest of its life.
 */

const PREFIX = "si:draft:";
const RESUME_KEY = "si:resume";

/**
 * Every Web Storage access in this app is guarded — see the same reasoning in
 * lib/supabase.js. A WebView with DOM storage off, Safari's private mode quota
 * and a file:// origin all throw rather than returning null, and losing a draft
 * is never worth an unhandled rejection on top of a session that has already
 * failed.
 */
function storage() {
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function keyFor(uid, name) {
  return `${PREFIX}${uid}:${name}`;
}

/* ------------------------------------------------------------------------- *
 * The snapshot registry.
 *
 * Drafts are captured ON DEMAND, at the instant recovery is abandoned — not
 * written continuously as the user types.
 *
 * Continuous persistence was the obvious alternative and is worse here. It
 * writes on every keystroke to rescue a case that almost never happens; it
 * leaves a stale draft behind after a NORMAL submit, which then reappears the
 * next time the form is opened; and it would need its own invalidation rules to
 * decide when a saved draft has been superseded. Capturing at the moment of
 * loss has none of those problems, and it is only possible because RequireAuth
 * holds the page mounted during recovery instead of redirecting immediately —
 * the component is still there to be asked.
 * ------------------------------------------------------------------------- */

const sources = new Map();

/**
 * Offer a snapshot function under `name`. Returns an unregister function.
 *
 * `snapshot` must return a JSON-serialisable object, or null to decline (an
 * untouched form has nothing worth rescuing, and restoring an empty draft over
 * a freshly-opened form is a confusing no-op).
 */
export function registerDraftSource(name, snapshot) {
  sources.set(name, snapshot);
  return () => {
    // Guarded so a late unmount cannot delete a re-registration made by the
    // next component to claim the same name.
    if (sources.get(name) === snapshot) sources.delete(name);
  };
}

/**
 * Ask every registered source for its state and persist whatever is offered.
 *
 * Returns the number of drafts written, which is what lets the caller decide
 * whether the sign-in screen should promise to restore anything. Promising a
 * restore and then producing nothing is worse than saying nothing at all.
 */
export function snapshotDrafts(uid) {
  const store = storage();
  if (!store || !uid) return 0;

  let written = 0;
  for (const [name, snapshot] of sources) {
    let data;
    try {
      data = snapshot();
    } catch {
      // A source that throws mid-teardown must not stop the others being saved.
      continue;
    }
    if (!data) continue;
    try {
      store.setItem(keyFor(uid, name), JSON.stringify(data));
      written += 1;
    } catch {
      // Quota, or storage disabled. Nothing to do but carry on with the rest.
    }
  }
  return written;
}

/**
 * Read a draft back and remove it in the same breath.
 *
 * Read-once for the reason toastHandoff is: a form that restored the same draft
 * every time it mounted would overwrite the user's second attempt with their
 * first, and a browser Back into the page would resurrect text they had already
 * decided against.
 */
export function takeDraft(uid, name) {
  const store = storage();
  if (!store || !uid) return null;
  const key = keyFor(uid, name);
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    store.removeItem(key);
    return JSON.parse(raw);
  } catch {
    // Unreadable or not JSON — a corrupt draft is worth less than a clean form.
    try {
      store.removeItem(key);
    } catch {
      /* Storage is gone entirely; there is nothing left to clean up. */
    }
    return null;
  }
}

/**
 * Drop every draft belonging to one account.
 *
 * Called when somebody OTHER than the draft's owner signs in. They could never
 * have read them — the uid is in the key — but leaving another person's typed
 * complaint sitting in the tab for the rest of its life is not the same thing as
 * it being unreachable, and the difference is exactly the distinction migration
 * 0029 turned on: "cannot be seen" and "is not there" are different claims, and
 * only one of them is worth making.
 */
export function clearDraftsFor(uid) {
  const store = storage();
  if (!store || !uid) return;
  const prefix = `${PREFIX}${uid}:`;
  try {
    // Collected before removing: removeItem reindexes the store, so deleting
    // inside a forward key(i) loop skips every other match.
    const doomed = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((key) => store.removeItem(key));
  } catch {
    /* Storage unavailable — there is nothing stored to clear. */
  }
}

/* ------------------------------------------------------------------------- *
 * The resume ticket.
 *
 * One record, written beside the drafts, answering the two questions the login
 * page has to ask before it can send anybody back to what they were doing:
 * WHO was interrupted, and WHERE.
 * ------------------------------------------------------------------------- */

/**
 * @param uid    the account that was interrupted
 * @param next   the path (with query string) it was interrupted on
 * @param drafts how many drafts were actually saved — 0 is meaningful and is
 *               why this is stored rather than inferred; it is the difference
 *               between "you'll be taken back" and "your work is waiting".
 */
export function setResumeTicket(uid, next, drafts) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(RESUME_KEY, JSON.stringify({ uid, next, drafts }));
  } catch {
    /* Without the ticket the user lands on their dashboard instead of back
       where they were. Degraded, not broken. */
  }
}

/** Read the ticket without consuming it — the login page checks it before it can act on it. */
export function peekResumeTicket() {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(RESUME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearResumeTicket() {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(RESUME_KEY);
  } catch {
    /* Nothing to clear. */
  }
}
