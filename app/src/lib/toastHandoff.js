"use client";

/**
 * SI — Service Inside · one confirmation message, carried across one navigation.
 *
 * Some actions confirm themselves by staying put: the panel re-renders and the
 * new state is the receipt. Decline cannot. It deliberately ends outside the
 * caller's own SELECT scope (migration 0037), so the component that performed
 * it has to route away and unmounts before any toast it rendered could be seen.
 *
 * sessionStorage rather than a query parameter, and rather than React state
 * lifted to a provider:
 *
 *   - A query parameter would put the message in the URL, where it survives a
 *     refresh, a bookmark and a shared link — a stale "Declined — WO-123 sent
 *     back" reappearing days later on a work order that has long since been
 *     repaired.
 *   - `output: "export"` means these are static pages; there is no server-side
 *     redirect that could carry a flash of its own.
 *   - sessionStorage is per-tab and cleared when the tab closes, which is
 *     exactly the lifetime a confirmation deserves.
 *
 * Read-once by construction: take() removes the key before returning it, so a
 * back-navigation to the same page does not replay the message.
 */

const KEY = "si:handoffToast";

export function handoffToast(message) {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    /* Safari in Private Browsing has thrown on setItem for storage this app
       does not depend on. Losing a confirmation message is not worth an
       unhandled rejection on top of an action that already succeeded. */
  }
}

export function takeHandoffToast() {
  try {
    const message = sessionStorage.getItem(KEY);
    if (message) sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return null;
  }
}
