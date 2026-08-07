"use client";

import { useAuth } from "../context/AuthContext";
import { ROLE_LABELS } from "../lib/roles";

export default function DashboardPlaceholder({ title, description }) {
  const { user } = useAuth();
  return (
    <div>
      <h1 className="text-xl font-bold text-ink mb-1">{title}</h1>
      <p className="text-[13px] text-ink-soft mb-6">{description}</p>
      <div className="bg-white border border-border rounded-xl p-6 shadow-card max-w-lg">
        <div className="text-[13px] text-ink-soft mb-1">Signed in as</div>
        <div className="text-[15px] font-semibold text-ink">{user?.name}</div>
        <div className="text-[12.5px] text-ink-soft mt-0.5">
          {ROLE_LABELS[user?.role] || user?.role}
          {user?.departmentId ? ` · Department ${user.departmentId}` : ""}
        </div>
        <div className="mt-4 pt-4 border-t border-[#F1F3F5] text-[12.5px] text-ink-soft">
          This is a placeholder landing page confirming the Authentication module's role-based
          redirect worked correctly. The real {ROLE_LABELS[user?.role]} dashboard content is a
          separate module.
        </div>
      </div>
    </div>
  );
}
