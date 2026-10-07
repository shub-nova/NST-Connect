"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AnalyticsAccess } from "@/lib/types";
import { NOTES_CHANGED } from "./AdminNotes";
import { LeaveDialog } from "./StaffDialogs";
import { Avatar } from "./ui";

/** The Newton School logo mark. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return <Image src="/logo.png" alt="" width={64} height={64} className={`${className} shrink-0`} priority />;
}

function Chevron() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4 text-ink" aria-hidden="true">
      <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Wraps every logged-in page: redirects visitors to /login and renders the top bar. */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, status, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const role = user?.role;
  const isStudentArea = pathname === "/new" || pathname.startsWith("/tickets");
  const isPocArea = pathname.startsWith("/poc");
  const isAdminArea = pathname.startsWith("/admin");
  const [access, setAccess] = useState<AnalyticsAccess | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  useEffect(() => {
    if (status === "anon") router.replace("/login");
    // Each role only sees its own pages; anything else goes to that role's home.
    if (status === "authed" && role) {
      if (role !== "STUDENT" && isStudentArea) router.replace(role === "POC" ? "/poc" : "/");
      if (role === "STUDENT" && (isPocArea || isAdminArea)) router.replace("/new");
      if (role === "POC" && isAdminArea) router.replace("/poc");
      if (role === "SUPER_ADMIN" && isPocArea) router.replace("/admin");
    }
  }, [status, role, isStudentArea, isPocArea, isAdminArea, router]);

  // Which analytics pages this person may open (Team and Overall are for L2 and L3 only).
  useEffect(() => {
    if (status !== "authed" || (role !== "POC" && role !== "SUPER_ADMIN")) return;
    let cancelled = false;
    const load = () =>
      api<AnalyticsAccess>("/analytics/access")
        .then((a) => !cancelled && setAccess(a))
        .catch(() => {});
    load();
    // Reading a note changes the unread count in the menu.
    window.addEventListener(NOTES_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(NOTES_CHANGED, load);
    };
  }, [status, role]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (status !== "authed" || !user) {
    return <p className="p-10 text-sm text-muted">Loading…</p>;
  }

  const home = user.role === "POC" ? "/poc" : user.role === "SUPER_ADMIN" ? "/admin" : "/new";
  const links =
    user.role === "STUDENT"
      ? [
          { href: "/new", label: "New ticket", active: pathname === "/new" },
          { href: "/tickets", label: "My tickets", active: pathname.startsWith("/tickets") },
        ]
      : user.role === "POC"
        ? [
            { href: "/poc", label: "My queue", short: "Queue", active: pathname === "/poc" || pathname.startsWith("/poc/tickets") },
            { href: "/poc/analytics", label: "My analytics", short: "Mine", badge: access?.unreadNotes ?? 0, active: pathname === "/poc/analytics" },
            ...(access?.team ? [{ href: "/poc/analytics/team", label: "Team analytics", short: "Team", active: pathname === "/poc/analytics/team" }] : []),
            ...(access?.overall ? [{ href: "/poc/analytics/overall", label: "Overall analytics", short: "Overall", active: pathname === "/poc/analytics/overall" }] : []),
          ]
        : [{ href: "/admin", label: "All teams", short: "Teams", active: pathname === "/admin" }];

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="flex h-16 items-center justify-between gap-6 px-4 sm:h-[68px] sm:px-6">
          <div className="flex items-center gap-4 sm:gap-8">
            <Link
              href={home}
              className="flex items-center gap-2.5 text-[15px] font-semibold text-ink"
            >
              <LogoMark />
              <span className="hidden sm:inline">NST Connect</span>
            </Link>
            <nav className="flex items-center gap-4 overflow-x-auto whitespace-nowrap sm:gap-7" aria-label="Main">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={l.active ? "page" : undefined}
                  className={`text-sm font-medium transition hover:text-ink sm:text-[15px] ${l.active ? "text-ink" : "text-muted"}`}
                >
                  {"short" in l ? (<><span className="sm:hidden">{l.short}</span><span className="hidden sm:inline">{l.label}</span></>) : l.label}
                  {"badge" in l && (l.badge ?? 0) > 0 && (
                    <span className="ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold leading-5 text-white" aria-label={`${l.badge} unread notes`}>
                      {l.badge}
                    </span>
                  )}
                </Link>
              ))}
            </nav>
          </div>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-full py-1 pl-1 pr-2 hover:bg-surface"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
            >
              <Avatar name={user.name} />
              <Chevron />
            </button>
            {menuOpen && (
              <div role="menu" className="absolute right-0 mt-2 w-64 rounded-xl border border-line bg-white p-2 shadow-lg">
                <div className="px-3 py-2">
                  <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
                  <p className="truncate text-xs text-muted">{user.email}</p>
                  {access?.onLeave && (
                    <p className="mt-1.5 inline-block rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600">
                      On leave{access.onLeaveUntil ? ` · back ${new Date(access.onLeaveUntil).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                    </p>
                  )}
                </div>
                {access?.manage && (
                  <Link
                    href="/settings"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface"
                  >
                    Settings
                  </Link>
                )}
                {role === "POC" && (
                  <button
                    role="menuitem"
                    className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface"
                    onClick={async () => {
                      setMenuOpen(false);
                      if (!access?.onLeave) return setLeaveOpen(true);
                      await api("/staff/me/leave", { method: "PUT", body: { onLeave: false } }).catch(() => {});
                      window.dispatchEvent(new Event(NOTES_CHANGED)); // refreshes the menu state
                    }}
                  >
                    {access?.onLeave ? "I’m back from leave" : "Go on leave"}
                  </button>
                )}
                <button
                  role="menuitem"
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface"
                  onClick={async () => {
                    setMenuOpen(false);
                    await logout();
                    router.replace("/login");
                  }}
                >
                  Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">{children}</main>

      {leaveOpen && (
        <LeaveDialog
          onClose={() => setLeaveOpen(false)}
          onConfirm={async (until) => {
            await api("/staff/me/leave", { method: "PUT", body: { onLeave: true, until } });
            setLeaveOpen(false);
            window.dispatchEvent(new Event(NOTES_CHANGED)); // refreshes the menu state
          }}
        />
      )}
    </div>
  );
}
