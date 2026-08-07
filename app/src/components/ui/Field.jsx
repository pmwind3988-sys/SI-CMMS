"use client";

export default function Field({ label, required, hint, children }) {
  return (
    <div className="mb-4">
      <label className="block text-[12.5px] font-semibold text-ink mb-1.5">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {hint && <div className="text-[11.5px] text-danger mt-1">{hint}</div>}
    </div>
  );
}

export const inputClass =
  "w-full px-3 py-2.5 rounded border border-[#D8DEE4] text-[13.5px] bg-white text-ink focus:outline-none focus:border-navy";
