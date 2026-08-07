"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, Bell, Search, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { RoleBadge } from "./ui/Badges";
import { ROLE_LABELS, dashboardPathForRole } from "../lib/roles";
import NotificationBell from "./NotificationBell";

function Logo({ size = 30, variant = "light" }) {
  const bg = variant === "light" ? "#fff" : "#0F3D91";
  const fg = variant === "light" ? "#0F3D91" : "#fff";
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-label="SI logo">
      <rect width="34" height="34" rx="9" fill={bg} />
      <path
        d="M9.2 13.4c0-2.1 1.9-3.6 4.6-3.6 2.4 0 4.1 1 4.8 2.7l-2.3 1.1c-.5-1-1.3-1.5-2.5-1.5-1.1 0-1.8.5-1.8 1.2 0 .8.8 1.1 2.3 1.5 2.5.6 4.3 1.4 4.3 3.8 0 2.2-2 3.7-4.9 3.7-2.6 0-4.5-1.1-5.2-2.9l2.3-1.1c.5 1.1 1.5 1.7 2.9 1.7 1.2 0 2-.5 2-1.3 0-.8-.8-1.1-2.5-1.5-2.4-.6-4-1.5-4-3.8z"
        fill={fg}
      />
      <rect x="22.4" y="10.1" width="2.5" height="12.9" rx="1.1" fill={fg} />
      <circle cx="23.65" cy="7.4" r="1.9" fill="#F59E0B" />
    </svg>
  );
}

export default function AppShell({ children }) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  if (!user) return null;

  const navItems = [
    { href: dashboardPathForRole(user.role), label: "Dashboard", icon: LayoutDashboard },
    { href: "/work-orders", label: "Work Orders", icon: ClipboardList },
    { href: "/notifications", label: "Notifications", icon: Bell },
  ];

  return (
    <div className="min-h-screen flex bg-canvas font-sans">
      {/* Sidebar */}
      <div className="w-56 bg-navy flex flex-col p-4 flex-shrink-0">
        <div className="flex items-center gap-2.5 px-2 mb-6">
          <Logo size={30} variant="light" />
          <div>
            <div className="text-white font-extrabold text-[15.5px] leading-none">SI</div>
            <div className="text-[9px] text-[#9FB6E0] tracking-wide leading-none mt-0.5">SERVICE INSIDE</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded flex items-center gap-2.5 px-2.5 py-2 text-[13.5px] font-semibold ${isActive ? "bg-navy-mid text-white" : "text-[#9FB6E0] hover:bg-navy-mid/40"}`}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto pt-3 border-t border-navy-line">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-navy font-bold text-[12.5px]">
              {user.name?.split(" ").map((n) => n[0]).join("").slice(0, 2)}
            </div>
            <div>
              <div className="text-white text-[12.5px] font-semibold">{user.name}</div>
              <div className="text-[#9FB6E0] text-[10.5px]">{ROLE_LABELS[user.role] || user.role}</div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-[#9FB6E0] text-[12px] hover:text-white"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-border">
          <div className="flex items-center gap-2 bg-canvas rounded px-3 py-1.5 w-80">
            <Search size={15} className="text-ink-soft" />
            <input
              placeholder="Search work orders…"
              className="bg-transparent outline-none text-[13.5px] w-full"
            />
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <RoleBadge role={user.role} />
          </div>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
