/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // 360px is the floor we design to (Galaxy A-series, most budget Androids
      // on the plant floor). `xs` gives us one step below Tailwind's `sm` for
      // the handful of places two columns only fit on a slightly wider phone.
      screens: {
        xs: "400px",
      },
      // Safe-area insets as first-class spacing, so a bar can be padded past a
      // notch or the Android gesture pill with `pt-safe-t` / `pb-safe-b`.
      // These resolve to 0px in a normal browser window, so they cost nothing
      // on desktop — they only take effect once the viewport is edge-to-edge
      // (viewport-fit=cover, set in app/layout.jsx).
      spacing: {
        "safe-t": "env(safe-area-inset-top)",
        "safe-b": "env(safe-area-inset-bottom)",
        "safe-l": "env(safe-area-inset-left)",
        "safe-r": "env(safe-area-inset-right)",
      },
      colors: {
        // SI brand system — Navy / Orange / Green / Red on white
        navy: { DEFAULT: "#0F3D91", deep: "#0B2F70", mid: "#1E4FA0", line: "#2C5AA8" },
        canvas: "#F6F8FB",
        // `soft` was #64748B, which measures 4.47:1 on the #F6F8FB canvas —
        // under 4.5 by a hair, and it is the colour of nearly every secondary
        // line in the app (page subtitles, table headers, timestamps, hints).
        // #5A6880 is the same slate, one step down, and clears it.
        ink: { DEFAULT: "#101828", soft: "#5A6880" },
        /**
         * Each semantic colour carries TWO values, because the same hue cannot
         * do both jobs on a white page. The DEFAULT is the fill — it is what
         * `bg-accent` paints under dark text, and it must stay as bright as it
         * is or the Submit button stops looking like the primary action. `.text`
         * is the same hue darkened until it clears 4.5:1 as *text* on white.
         *
         * Measured before the split, as text on white: accent #F59E0B 2.15:1,
         * good #22C55E 2.28:1, danger #EF4444 3.76:1 — and those three carried
         * "Completed", "Closed" and "Breached", which is most of what anyone
         * reads a work order list to find out.
         *
         * Use `text-accent-text` / `text-good-text` / `text-danger-text` for
         * words, and the DEFAULT for fills, dots, borders and icons.
         */
        accent: { DEFAULT: "#F59E0B", soft: "#FDE7C4", text: "#9D6507" },
        good: { DEFAULT: "#22C55E", text: "#178640" },
        danger: { DEFAULT: "#EF4444", text: "#C1291F" },
        p3: "#FBBF24",
        border: "#E5E9F0",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "12px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,.04), 0 4px 12px rgba(15,23,42,.05)",
      },
    },
  },
  plugins: [],
};
