/**
 * SI — Service Inside · readable text colour
 * ============================================================================
 * Badge colours are DATA, not literals: `priorities.color_hex` and
 * `wo_statuses.color_hex` are editable in Admin → Settings, and the whole point
 * of that (Badges.jsx) is that recolouring a status recolours every badge in
 * the app. So the contrast problem cannot be fixed by picking better constants —
 * the next Administrator to open the colour picker would undo it.
 *
 * Instead the stored colour keeps its job as the *identity* of the status — the
 * dot, the tint behind the pill, the border — and the text on top is darkened
 * from it until it actually clears 4.5:1. The hue is preserved, so a P1 still
 * reads red and a Closed still reads green; only the lightness moves, and only
 * as far as it has to.
 *
 * Measured before this existed, against white: P3 `#FBBF24` at 1.67:1, Closed
 * `#22C55E` at 2.28:1, Completed `#F59E0B` at 2.15:1 — the two facts a
 * supervisor scans a list for were the two least legible things on it.
 *
 * Darkening rather than lightening is deliberate: every surface these sit on is
 * white or a near-white tint of the colour itself, so down is the only
 * direction that gains contrast.
 */

/** #RGB or #RRGGBB -> [r,g,b], or null if it is neither. */
function parseHex(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

const toHex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.1 contrast ratio between two rgb triples. */
export function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The same colour, darkened just far enough to clear `target` against `bg`.
 *
 * Returned unchanged when it already passes — an Administrator who picks a
 * genuinely dark colour gets exactly the colour they picked.
 *
 * The walk is 24 steps of 4% toward black, which reaches black from any input
 * and stops at the first passing step, so the result is the *lightest* shade
 * that is legible rather than an arbitrarily dark one. Falls back to the
 * inherited ink colour if the input is not a hex value we understand, because
 * returning a broken colour would be worse than not recolouring at all.
 */
export function readableText(hex, bg = "#FFFFFF", target = 4.5) {
  const fg = parseHex(hex);
  const ground = parseHex(bg) || [255, 255, 255];
  if (!fg) return "#101828";
  if (contrastRatio(fg, ground) >= target) return toHex(fg);

  let best = fg;
  for (let i = 1; i <= 24; i++) {
    const k = 1 - i * 0.04;
    best = [fg[0] * k, fg[1] * k, fg[2] * k];
    if (contrastRatio(best, ground) >= target) break;
  }
  return toHex(best);
}
