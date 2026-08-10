"use client";

import { useEffect, useState } from "react";

/**
 * Every layout switch in this app is a Tailwind breakpoint — CSS, no JS, so the
 * static export paints the right layout immediately. This hook exists for the
 * one case that can't be: Recharts sizes its axes and radii in pixel numbers
 * passed as props, so a chart that needs a narrower Y-axis label gutter on a
 * phone has to be told the actual number.
 *
 * Reach for it only when a *number* is required. If a class would do, use a
 * breakpoint prefix instead.
 *
 * The initial value is `false` rather than a measured width on purpose: the
 * pages are prerendered at build time (output: "export"), where no viewport
 * exists, so anything else would hydrate against markup built for a desktop
 * and mismatch. The subscription corrects it on mount.
 */
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const onChange = (e) => setMatches(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/** Below Tailwind's `sm` — one narrow column, roughly a phone in portrait. */
export function useIsNarrow() {
  return useMediaQuery("(max-width: 639px)");
}
