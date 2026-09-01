"use client";

const VARIANTS = {
  primary: "bg-ink text-white hover:bg-ink/90",
  amber: "bg-accent text-ink hover:bg-accent/90",
  ghost: "bg-transparent text-ink border border-[#D8DEE4] hover:bg-canvas",
  /* The tinted pair. They are for the SECONDARY half of a decision — the
     tint is deliberately quiet, so reaching for one of these to carry the
     action somebody came to the screen to perform makes it disappear. When a
     choice has an obvious answer, that answer wants `successSolid` (or
     `amber`) and the alternative wants one of these. */
  danger: "bg-[#FCE9E9] text-danger-text hover:bg-[#F9D7D7]",
  success: "bg-[#E7F5EE] text-good-text hover:bg-[#D4EFE0]",
  /* Filled, for the affirmative half of a consequential choice. #0B6B48 is
     the `good` hue dark enough to carry white text at 5.6:1 — the tinted
     `success` above measured 2.03:1 as the technician's Accept button, which
     made the most-pressed control in the product the least legible thing on
     the screen. */
  successSolid: "bg-[#0B6B48] text-white hover:bg-[#095539]",
  subtle: "bg-canvas text-ink hover:bg-[#EDF1F6]",
};

const SIZES = {
  sm: "text-[12.5px] px-3 py-1.5 min-h-[40px]",
  /* min-h keeps this at the 44px guideline; py alone rendered about 40. */
  md: "text-[13.5px] px-4 py-2.5 min-h-[44px]",
  /* A 48px row. For a primary action on a phone that is used with gloves —
     `md` renders about 40px, under the 44px guideline. */
  lg: "text-[15px] px-5 py-3 min-h-[48px]",
};

export default function Button({
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  disabled,
  className = "",
  ...props
}) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon size={14} />}
      {children}
    </button>
  );
}
