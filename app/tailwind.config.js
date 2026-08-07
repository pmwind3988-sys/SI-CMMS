/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
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
