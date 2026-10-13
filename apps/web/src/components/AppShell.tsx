"use client";

import { ChevronDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useDismiss } from "@/lib/use-dismiss";
import type { AnalyticsAccess } from "@/lib/types";
import { NOTES_CHANGED, NotesBell, SentNotesBell } from "./AdminNotes";
import { Avatar } from "./ui";

/** The Newton School logo mark. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return <Image src="/logo.png" alt="" width={64} height={64} className={`${className} shrink-0`} priority />;
}

function Chevron() {
  return <ChevronDown className="h-4 w-4 text-ink" strokeWidth={2} aria-hidden="true" />;
}

/** The top bar and a few placeholder blocks, shown for the moment it takes to confirm the login. */
function ShellSkeleton() {
  return (
    <div className="min-h-screen bg-white" role="status" aria-label="Loading">
      <header className="border-b border-line">
        <div className="flex h-16 items-center justify-between px-4 sm:h-[68px] sm:px-6">
          <div className="flex items-center gap-2.5 text-[15px] font-semibold text-ink">
            <LogoMark />
            <span className="hidden sm:inline">NST Connect</span>
          </div>
          <div className="h-9 w-9 animate-pulse rounded-full bg-surface" />
        </div>
      </header>
      <div className="mx-auto max-w-5xl animate-pulse space-y-4 px-4 py-8 sm:px-6">
        <div className="h-8 w-56 rounded-lg bg-surface" />
        <div className="h-4 w-80 max-w-full rounded bg-surface" />
        <div className="h-40 rounded-xl bg-surface" />
        <div className="h-40 rounded-xl bg-surface" />
      </div>
    </div>
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

  useDismiss(menuOpen, menuRef, () => setMenuOpen(false));

  // While the session is being restored, draw the page frame at once instead of a blank screen.
  if (status !== "authed" || !user) return <ShellSkeleton />;

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
            ...(access?.me === false ? [] : [{ href: "/poc/analytics", label: "My analytics", short: "Mine", active: pathname === "/poc/analytics" }]),
            ...(access?.team ? [{ href: "/poc/analytics/team", label: "Team analytics", short: "Team", active: pathname === "/poc/analytics/team" }] : []),
            ...(access?.overall ? [{ href: "/poc/analytics/overall", label: "Overall analytics", short: "Overall", active: pathname === "/poc/analytics/overall" }] : []),
          ]
        : [{ href: "/admin", label: "All teams", short: "Teams", active: pathname === "/admin" }];

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-10 border-b border-line bg-white">
        <div className="flex h-16 items-center justify-between gap-3 px-4 sm:h-[68px] sm:gap-6 sm:px-6">
          <div className="flex min-w-0 items-center gap-4 sm:gap-8">
            <Link
              href={home}
              className="flex shrink-0 items-center gap-2.5 text-[15px] font-semibold text-ink"
            >
              <LogoMark />
              <span className="hidden sm:inline">NST Connect</span>
            </Link>
            <nav className="flex min-w-0 items-center gap-4 overflow-x-auto whitespace-nowrap sm:gap-7" aria-label="Main">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  aria-current={l.active ? "page" : undefined}
                  className={`text-sm font-medium transition hover:text-ink sm:text-[15px] ${l.active ? "text-ink" : "text-muted"}`}
                >
                  {"short" in l ? (<><span className="sm:hidden">{l.short}</span><span className="hidden sm:inline">{l.label}</span></>) : l.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
          {role === "POC" && <NotesBell unread={access?.unreadNotes ?? 0} />}
          {role === "SUPER_ADMIN" && <SentNotesBell />}
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
                {role === "SUPER_ADMIN" && (
                  <Link
                    href="/admin/categories"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface"
                  >
                    Categories
                  </Link>
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
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-5 sm:py-8">{children}</main>

    </div>
  );
}
