"use client";

const VARIANTS = {
  primary: "bg-ink text-white hover:bg-ink/90",
  amber: "bg-accent text-ink hover:bg-accent/90",
  ghost: "bg-transparent text-ink border border-[#D8DEE4] hover:bg-canvas",
  danger: "bg-[#FCE9E9] text-danger hover:bg-[#F9D7D7]",
  success: "bg-[#E7F5EE] text-good hover:bg-[#D4EFE0]",
  subtle: "bg-canvas text-ink hover:bg-[#EDF1F6]",
};

const SIZES = {
  sm: "text-[12.5px] px-3 py-1.5",
  md: "text-[13.5px] px-4 py-2.5",
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
