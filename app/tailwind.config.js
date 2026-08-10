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
        ink: { DEFAULT: "#101828", soft: "#64748B" },
        accent: { DEFAULT: "#F59E0B", soft: "#FDE7C4" },
        good: "#22C55E",
        danger: "#EF4444",
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
