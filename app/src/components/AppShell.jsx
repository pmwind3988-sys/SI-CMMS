"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "../lib/useMediaQuery";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, Bell, LogOut, Users, Settings, Menu, X, KeyRound } from "lucide-react";
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
  const closeBtnRef = useRef(null);
  const menuBtnRef = useRef(null);
  const mainColRef = useRef(null);
  /* `lg` is where the drawer stops being a drawer and becomes a sticky
     sidebar — the same 1024px the aside's own `lg:` classes switch on. */
  const isDesktop = useMediaQuery("(min-width: 1024px)");

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

    /**
     * Focus has to MOVE INTO the drawer, and be kept there.
     *
     * Without this the drawer was a modal in every respect except the one that
     * matters to a keyboard: it covered the page and locked its scroll, but
     * focus stayed wherever it was, and Tab then walked the tabs *underneath*
     * the open drawer — measured, six presses, never once entering the menu.
     * So on a phone the menu was the one thing you could not reach from it.
     *
     * The page behind is marked `inert` instead of hand-rolling a trap: it is
     * one attribute, it removes the background from the tab order and from
     * assistive tech together, and there is nothing left to wrap around from.
     */
    const returnTo = document.activeElement;
    const main = mainColRef.current;
    if (main) main.inert = true;
    closeBtnRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (main) main.inert = false;
      // Back to the hamburger, not to nowhere: closing a menu should leave you
      // where you opened it, which is also where you are looking.
      if (returnTo instanceof HTMLElement && document.contains(returnTo)) returnTo.focus();
    };
  }, [navOpen]);

  if (!user) return null;

  /**
   * Where "home" is. Normally the dashboard for the highest role held.
   *
   * A flagged account holds no roles, so dashboardPathForRole(null) returns
   * "/login" — and /login is not behind RequireAuth, so following it lands them
   * on the sign-in form while their session is still live, which reads as having
   * been signed out. They have exactly one page, so point at it.
   */
  const homeHref = user.mustChangePassword
    ? "/change-password"
    : dashboardPathForRole(user.role);

  /**
   * A flagged account gets one destination, because it HAS one destination:
   * RequireAuth returns it here from anywhere else. Offering the usual links
   * would be offering three that bounce straight back, which is the same
   * "nothing works and nothing says why" this whole path exists to remove.
   */
  const navItems = user.mustChangePassword
    ? [{ href: "/change-password", label: "Change password", icon: KeyRound }]
    : [
        { href: homeHref, label: "Dashboard", icon: LayoutDashboard },
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

  /**
   * Below `lg` the drawer is hidden by translating it off-screen while it stays
   * `visibility: visible` — measured at x=-240, fully focusable. So on every
   * page a keyboard user tabbed through six invisible navigation links before
   * reaching any content, watching focus vanish off the left edge. `inert`
   * when closed is what makes "off-screen" and "out of reach" the same thing.
   *
   * It is applied only below `lg`, where the drawer is actually a drawer; from
   * `lg` up it is a normal sticky sidebar and must stay reachable. `isDesktop`
   * is read from a media query rather than assumed, and starts false so the
   * server-rendered HTML and the first client render agree — this is a static
   * export, and a mismatch there costs the whole tree.
   */
  const navInert = !isDesktop && !navOpen;

  return (
    <div className="min-h-dvh flex bg-canvas font-sans">
      {/* Straight past the navigation to the content. Every page starts with
          about a dozen nav stops; this is the one control that helps everyone
          on a keyboard, and it stays invisible until it is focused. */}
      <a
        href="#main-content"
        /* Out of reach while the drawer is over the page: the drawer is modal,
           and the one thing it must not do is offer a way past itself. */
        inert={navOpen}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded focus:bg-navy focus:px-4 focus:py-2 focus:text-[13px] focus:font-semibold focus:text-white"
      >
        Skip to main content
      </a>

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
        // React wants a real boolean here; an empty string is treated as false.
        inert={navInert}
        // si-navy replaces the flat bg-navy fill: the brand gradient plus the
        // drifting highlight, defined once in globals.css so the sidebar, the
        // login panel and the mobile brand band cannot drift apart.
        className={`si-navy fixed top-0 bottom-0 left-0 z-50 flex w-64 max-w-[82vw] flex-col overflow-y-auto p-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-[calc(1rem+env(safe-area-inset-bottom))] transition-transform duration-200 ease-out lg:sticky lg:bottom-auto lg:z-auto lg:h-dvh lg:w-56 lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
          navOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        }`}
      >
        <div className="mb-6 flex items-center justify-between gap-2 px-2">
          <Link href={homeHref} className="flex items-center gap-2.5">
            <Logo size={30} variant="light" />
            <div>
              <div className="text-[15.5px] font-extrabold leading-none text-white">SI</div>
              <div className="mt-0.5 text-[9px] leading-none tracking-wide text-[#9FB6E0]">SERVICE INSIDE</div>
            </div>
          </Link>
          <button
            ref={closeBtnRef}
            onClick={() => setNavOpen(false)}
            /* p-3 with -m-1.5 keeps the X where it was drawn while giving it a
               44px hit area — it was 28x28, under even the 24px floor. */
            className="-mr-1.5 -my-1.5 p-3 text-[#9FB6E0] hover:text-white lg:hidden"
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
                className={`flex min-h-[44px] items-center gap-2.5 rounded px-2.5 py-2.5 text-[13.5px] font-semibold lg:min-h-0 lg:py-2 ${isActive ? "bg-navy-mid text-white" : "text-[#9FB6E0] hover:bg-navy-mid/40"}`}
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
            /* Was 68x18. Full width and py-2.5 makes it a 44px row, which is
               also the shape of every other item in this column. */
            className="-mx-2.5 flex min-h-[44px] w-[calc(100%+1.25rem)] items-center gap-2 rounded px-2.5 py-2.5 text-[12.5px] text-[#9FB6E0] hover:bg-navy-mid/40 hover:text-white"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div ref={mainColRef} className="flex min-w-0 flex-1 flex-col">
        {/* Sticky rather than static: on a phone the page itself scrolls (there
            is no inner scroll container any more), so the bar has to follow. */}
        <header className="sticky top-0 z-30 border-b border-border bg-white pt-[env(safe-area-inset-top)]">
          <div className="flex items-center gap-2 px-4 py-2.5 sm:gap-3 lg:px-6 lg:py-3.5">
            <button
              ref={menuBtnRef}
              onClick={() => setNavOpen(true)}
              className="-my-2 -ml-2.5 p-3 text-ink-soft lg:hidden"
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
              href={homeHref}
              className="-my-2 flex min-h-[44px] min-w-0 flex-shrink-0 items-center gap-2 lg:hidden"
              aria-label="SI — Service Inside"
            >
              <Logo size={26} variant="dark" />
              <span className="hidden text-[15px] font-extrabold text-navy xs:inline">SI</span>
            </Link>

            {/* The search box that used to sit here was never wired to
                anything — no value, no onChange, no handler — while being the
                widest control in the bar on every screen from 640px up. Typing
                a work order number and pressing Enter did nothing at all, and
                because the work order list has a real search directly below it,
                the visible effect was that search looked broken. Removed rather
                than faked: /work-orders owns searching, and its field works. */}

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
          id="main-content"
          tabIndex={-1}
          key={pathname}
          className="rise flex-1 p-4 sm:p-5 lg:p-6 pb-[calc(2rem+env(safe-area-inset-bottom))] focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
