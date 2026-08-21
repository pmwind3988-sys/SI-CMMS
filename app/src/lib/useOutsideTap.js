"use client";

import { useEffect, useRef } from "react";

/**
 * Dismiss a panel when the pointer taps outside it — and only then.
 *
 * The obvious implementation closes on any `pointerdown` landing outside, and on
 * a touch screen that is wrong: `pointerdown` fires the instant a finger lands,
 * so the first frame of a page scroll is indistinguishable from a tap meaning
 * "cancel". Both panels in this app that did it died the moment the page moved.
 * Neither case is exotic — opening the picker focuses its search field, which
 * raises the soft keyboard and leaves the list half offscreen, and the
 * notification panel has no tap shield from `sm` up, so there is live page
 * behind it to scroll.
 *
 * So: remember where a pointer went down *outside*, then decide on `pointerup`,
 * and only if it stayed put. `pointercancel` carries as much weight as the other
 * two — a gesture the browser takes over to scroll ends there and never reaches
 * pointerup, and a start point left behind would close the panel on somebody's
 * next, unrelated tap.
 *
 * The callback is held in a ref rather than named in the dependency list, and
 * that is load-bearing rather than tidiness: callers pass a fresh closure every
 * render, so depending on it would tear the listeners down and rebuild them
 * mid-gesture — losing the `down` position, which is the one piece of state the
 * whole discrimination rests on. `active` gates the listeners, so a closed panel
 * costs nothing.
 */

/** How far a pointer may travel and still count as a tap rather than a drag. */
const TAP_SLOP_PX = 10;

export function useOutsideTap(ref, active, onOutsideTap) {
  const handler = useRef(onOutsideTap);
  useEffect(() => {
    handler.current = onOutsideTap;
  });

  useEffect(() => {
    if (!active) return;
    let down = null;
    const isOutside = (target) => ref.current && !ref.current.contains(target);

    function onPointerDown(e) {
      down = isOutside(e.target) ? { x: e.clientX, y: e.clientY } : null;
    }
    function onPointerUp(e) {
      if (!down) return;
      const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y);
      down = null;
      if (moved <= TAP_SLOP_PX && isOutside(e.target)) handler.current();
    }
    function onPointerCancel() {
      down = null;
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerCancel);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [ref, active]);
}
