"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, Bell, Search, LogOut, Users, Settings, Menu, X } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { RoleBadge } from "./ui/Badges";
import { ROLES, dashboardPathForRole, hasRole, rolesLabel } from "../lib/roles";
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

/**
 * Two layouts from one tree, switched at `lg` (1024px):
 *
 *   < lg  — the navy nav is an off-canvas drawer behind a hamburger. It used to
 *           be a permanent 224px column, which on a 360px phone left 136px for
 *           the actual screen and made every page unusable.
 *   >= lg — the same nav is a sticky column, exactly as before.
 *
 * The switch is pure CSS (translate + `lg:` overrides) rather than a JS width
 * check, so there is no flash of the wrong layout on first paint and the static
 * export stays render-identical between Vercel and the APK's WebView.
 */
export default function AppShell({ children }) {
  const { user, signOut } = useAuth();
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);

  // Navigating from the drawer must close it, or the page the user just asked
  // for stays hidden behind it.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  // While the drawer is over the page, the page behind it must not scroll —
  // on a phone a scrolling backdrop reads as the drawer itself failing to
  // scroll. Escape closes it for anyone on a keyboard.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [navOpen]);

  if (!user) return null;

  const navItems = [
    { href: dashboardPathForRole(user.role), label: "Dashboard", icon: LayoutDashboard },
    { href: "/work-orders", label: "Work Orders", icon: ClipboardList },
    { href: "/notifications", label: "Notifications", icon: Bell },
    // Administration is Admin-only, matching RequireRole on those pages — a
    // Manager following the link would only be redirected back.
    ...(hasRole(user, ROLES.ADMIN)
      ? [
          { href: "/admin/users", label: "Users", icon: Users },
          { href: "/admin/settings", label: "Settings", icon: Settings },
        ]
      : []),
  ];

  const initials = user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2);

  return (
    <div className="min-h-dvh flex bg-canvas font-sans">
      {/* Drawer backdrop — mobile only. */}
      {navOpen && (
        <div
          onClick={() => setNavOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          aria-hidden="true"
        />
      )}

      <aside
        id="app-nav"
        aria-label="Main navigation"
        // si-navy replaces the flat bg-navy fill: the brand gradient plus the
        // drifting highlight, defined once in globals.css so the sidebar, the
        // login panel and the mobile brand band cannot drift apart.
        className={`si-navy fixed top-0 bottom-0 left-0 z-50 flex w-64 max-w-[82vw] flex-col overflow-y-auto p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] transition-transform duration-200 ease-out lg:sticky lg:bottom-auto lg:z-auto lg:h-dvh lg:w-56 lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
          navOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between gap-2 px-2">
          <Link href={dashboardPathForRole(user.role)} className="flex items-center gap-2.5">
            <Logo size={30} variant="light" />
            <div>
              <div className="text-[15.5px] font-extrabold leading-none text-white">SI</div>
              <div className="mt-0.5 text-[9px] leading-none tracking-wide text-[#9FB6E0]">SERVICE INSIDE</div>
            </div>
          </Link>
          <button
            onClick={() => setNavOpen(false)}
            className="-mr-1 p-1 text-[#9FB6E0] hover:text-white lg:hidden"
            aria-label="Close navigation"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname?.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded px-2.5 py-2.5 text-[13.5px] font-semibold lg:py-2 ${isActive ? "bg-navy-mid text-white" : "text-[#9FB6E0] hover:bg-navy-mid/40"}`}
              >
                <item.icon size={16} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto border-t border-navy-line pt-3">
          <div className="mb-2.5 flex items-center gap-2.5">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-[12.5px] font-bold text-navy">
              {initials}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold text-white">{user.name}</div>
              {/* Every role held, highest first — "Supervisor · Technician".
                  The identity block has room for it; the header chip does not. */}
              <div className="text-[10.5px] text-[#9FB6E0]">{rolesLabel(user.roles)}</div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-[12px] text-[#9FB6E0] hover:text-white"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky rather than static: on a phone the page itself scrolls (there
            is no inner scroll container any more), so the bar has to follow. */}
        <header className="sticky top-0 z-30 border-b border-border bg-white pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3 lg:px-6 lg:py-3.5">
            <button
              onClick={() => setNavOpen(true)}
              className="-ml-1.5 p-1.5 text-ink-soft lg:hidden"
              aria-label="Open navigation"
              aria-controls="app-nav"
              aria-expanded={navOpen}
            >
              <Menu size={22} />
            </button>

            {/* The sidebar's brand mark is behind the drawer on mobile, so the
                bar carries one of its own. The wordmark beside it repeats what
                the mark already says, so it is the first thing to go when the
                row is short of room — below `xs` the logo stands alone. */}
            <Link
              href={dashboardPathForRole(user.role)}
              className="flex min-w-0 flex-shrink-0 items-center gap-2 lg:hidden"
              aria-label="SI — Service Inside"
            >
              <Logo size={26} variant="dark" />
              <span className="hidden text-[15px] font-extrabold text-navy xs:inline">SI</span>
            </Link>

            <div className="hidden max-w-xs flex-1 items-center gap-2 rounded bg-canvas px-3 py-1.5 sm:flex">
              <Search size={15} className="flex-shrink-0 text-ink-soft" />
              <input
                placeholder="Search work orders…"
                className="w-full bg-transparent text-[13.5px] outline-none"
              />
            </div>

            <div className="ml-auto flex min-w-0 items-center gap-2.5 sm:gap-4">
              <NotificationBell />
              {/* The chip shows the highest role only — two will not fit at this
                  size — with the full set on hover. */}
              <span title={rolesLabel(user.roles)}>
                <RoleBadge role={user.role} compact />
              </span>
            </div>
          </div>
        </header>

        {/* Keyed on the path so the entrance replays on every navigation rather
            than only on first mount — which is the whole point of it: it marks
            that the content changed, on a phone where there is no other cue. */}
        <main
          key={pathname}
          className="rise flex-1 p-4 sm:p-5 lg:p-6 pb-[calc(2rem+env(safe-area-inset-bottom))]"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
