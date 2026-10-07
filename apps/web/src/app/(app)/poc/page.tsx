"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BulkDialog, { type BulkAction } from "@/components/BulkDialog";
import { Avatar, ErrorNote, STATUS_TEXT, StatusBadge, btnCls, btnGhostCls, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { PocQueueTicket } from "@/lib/types";

type View = "open" | "done";
type Sort = "time-left" | "newest" | "oldest";

const SORTS: { id: Sort; label: string }[] = [
  { id: "time-left", label: "Least time left" },
  { id: "oldest", label: "Oldest first" },
  { id: "newest", label: "Newest first" },
];

function msLeft(iso: string | null): number {
  return iso ? new Date(iso).getTime() - Date.now() : Number.POSITIVE_INFINITY;
}
function sortTickets(tickets: PocQueueTicket[], sort: Sort): PocQueueTicket[] {
  const list = [...tickets];
  if (sort === "newest") return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === "oldest") return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // Least time left first; critical tickets (no clock) on top, then the rest in the order they came.
  return list.sort((a, b) => Number(b.critical) - Number(a.critical) || msLeft(a.tatDeadline) - msLeft(b.tatDeadline));
}

const VIEWS: { id: View; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
];

function CriticalBadge() {
  return <span className="inline-flex shrink-0 items-center rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">Critical</span>;
}

function dueLabel(iso: string | null): { text: string; late: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const hours = Math.round(Math.abs(ms) / 36e5);
  const span = hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;
  return ms < 0 ? { text: `${span} overdue`, late: true } : { text: `due in ${span}`, late: false };
}

/** The most tickets one bulk action may touch (the server enforces the same limit). */
const MAX_BULK = 50;

export default function PocQueuePage() {
  const [view, setView] = useState<View>("open");
  const [sort, setSort] = useState<Sort>("time-left");
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ view: View; tickets: PocQueueTicket[]; error: string | null } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // The right-click menu ("Select") and the long-press timer used on phones.
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justPressed = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // A press inside the menu must not close it first, or the click on "Select" never lands.
    const closeOutside = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  useEffect(() => {
    let cancelled = false;
    api<{ tickets: PocQueueTicket[] }>(`/poc/queue?view=${view}`)
      .then((res) => !cancelled && setLoaded({ view, tickets: res.tickets, error: null }))
      .catch((err) => {
        if (!cancelled)
          setLoaded({ view, tickets: [], error: err instanceof ApiError ? err.message : "Could not load your queue." });
      });
    return () => {
      cancelled = true;
    };
  }, [view, version]);

  const loading = !loaded || loaded.view !== view;
  const open = view === "open";
  // Finished tickets have no clock, so they only sort by date.
  const activeSort: Sort = open ? sort : sort === "oldest" ? "oldest" : "newest";
  const shown = loading ? [] : sortTickets(loaded.tickets, activeSort);

  // Only tickets still on screen count as selected (a refresh may have removed some).
  const picked = shown.filter((t) => selected.has(t.id));
  // Checkboxes exist only while something is selected: they appear after "Select" and go when the last one is cleared.
  const selecting = open && picked.length > 0;
  const allPicked = open && shown.length > 0 && picked.length === Math.min(shown.length, MAX_BULK);
  // L3 is the top level: there is nowhere to escalate to.
  const canEscalate = picked.every((t) => t.currentLevel < 3);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK) next.add(id);
      return next;
    });
  }
  function startPress(id: string) {
    if (!open) return;
    justPressed.current = false;
    pressTimer.current = setTimeout(() => {
      justPressed.current = true; // the finger lifts after this: do not also open the ticket
      setSelected((prev) => new Set(prev).add(id));
    }, 550);
  }
  function cancelPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  }
  function toggleAll() {
    setSelected(allPicked ? new Set() : new Set(shown.slice(0, MAX_BULK).map((t) => t.id)));
  }
  function switchView(v: View) {
    setSelected(new Set());
    setView(v);
  }
  function finished(message: string) {
    setBulk(null);
    setSelected(new Set());
    setToast(message);
    setTimeout(() => setToast(null), 5000);
    setVersion((n) => n + 1);
  }

  return (
    <div className={`mx-auto max-w-3xl space-y-6 ${selecting ? "pb-24" : ""}`}>
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">My queue</h1>

      <div className="flex items-end justify-between gap-4 border-b border-line">
        <div className="flex gap-6" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => switchView(v.id)}
              className={`-mb-px border-b-2 pb-3 text-[15px] font-medium transition ${
                view === v.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {!loading && loaded.tickets.length > 1 && (
          <div className="relative pb-2">
            <select
              aria-label="Sort by"
              className="cursor-pointer appearance-none bg-transparent py-1 pr-6 text-sm font-medium text-muted outline-none transition hover:text-ink focus:text-ink"
              value={activeSort}
              onChange={(e) => setSort(e.target.value as Sort)}
            >
              {SORTS.filter((o) => open || o.id !== "time-left").map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-[60%] text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 7.5l5 5 5-5" />
            </svg>
          </div>
        )}
      </div>

      {toast && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{toast}</p>}
      <ErrorNote message={loaded?.error ?? null} />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {!loading && loaded.tickets.length === 0 && !loaded.error && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
          {view === "open" ? "Nothing waiting. You're all caught up." : "Nothing finished yet."}
        </div>
      )}

      {selecting && shown.length > 1 && (
        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-muted">
          <input type="checkbox" checked={allPicked} onChange={toggleAll} className="h-[18px] w-[18px] cursor-pointer rounded accent-brand" />
          {allPicked ? "Clear selection" : shown.length > MAX_BULK ? `Select first ${MAX_BULK}` : `Select all ${shown.length}`}
        </label>
      )}

      {!loading && (
        <ul className="space-y-3">
          {shown.map((t) => {
            const due = view === "open" ? dueLabel(t.tatDeadline) : null;
            const on = selected.has(t.id);
            return (
              <li
                key={t.id}
                onMouseDown={(e) => {
                  // A right-click would otherwise highlight the text under the pointer.
                  if (open && e.button === 2) e.preventDefault();
                }}
                onContextMenu={(e) => {
                  if (!open) return;
                  e.preventDefault();
                  window.getSelection()?.removeAllRanges();
                  setMenu({ x: e.clientX, y: e.clientY, id: t.id });
                }}
                onTouchStart={() => startPress(t.id)}
                onTouchEnd={cancelPress}
                onTouchMove={cancelPress}
                className={`flex items-center rounded-xl border transition ${open ? "select-none" : ""} ${on ? "border-brand bg-brand-soft/40" : "border-line bg-white hover:border-brand hover:shadow-sm"}`}
              >
                {selecting && (
                  <label className="flex cursor-pointer items-center self-stretch pl-3.5 pr-1 sm:pl-4">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(t.id)}
                      aria-label={`Select ${t.title}`}
                      className="h-[18px] w-[18px] cursor-pointer rounded accent-brand"
                    />
                  </label>
                )}
                <Link
                  href={`/poc/tickets/${t.id}`}
                  onClick={(e) => {
                    // While selecting, a click on the row toggles it instead of opening the ticket.
                    if (selecting || justPressed.current) {
                      e.preventDefault();
                      justPressed.current = false;
                      if (selecting) toggle(t.id);
                    }
                  }}
                  className={`flex min-w-0 flex-1 items-start gap-3 p-3.5 sm:items-center sm:gap-4 sm:p-4 ${selecting ? "select-none" : ""}`}
                >
                  <Avatar name={t.category.shortName || t.category.name} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="line-clamp-2 font-semibold text-ink sm:truncate">{t.title}</p>
                    {t.subCategory && <p className="truncate text-sm text-ink/70">{t.subCategory.name}</p>}
                    <p className="truncate text-xs text-muted">
                      {t.student.name} · {timeAgo(view === "open" ? t.createdAt : t.updatedAt)}
                      {due && (
                        <span className={due.late ? "font-semibold text-red-600" : ""}>{` · ${due.text}`}</span>
                      )}
                    </p>
                    <div className="flex gap-2 pt-1.5 sm:hidden">
                      {t.critical && <CriticalBadge />}
                      <StatusBadge status={t.status} label={STATUS_TEXT[t.status]} />
                    </div>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    {t.critical && <CriticalBadge />}
                    <StatusBadge status={t.status} label={STATUS_TEXT[t.status]} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Right-click menu */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          style={{ left: Math.min(menu.x, (typeof window === "undefined" ? menu.x : window.innerWidth - 190)), top: menu.y }}
          className="fixed z-40 w-44 rounded-xl border border-line bg-white p-1.5 shadow-lg"
        >
          <button
            role="menuitem"
            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-surface"
            onClick={() => {
              setSelected((prev) => new Set(prev).add(menu.id));
              setMenu(null);
            }}
          >
            Select
          </button>
        </div>
      )}

      {/* The bar that appears once something is selected */}
      {selecting && (
        <div className="fixed inset-x-0 bottom-4 z-30 px-4">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-2xl border border-line bg-white px-4 py-3 shadow-[0_8px_30px_-8px_rgba(16,24,40,0.25)]">
            <span className="mr-auto text-[15px] font-semibold text-ink">
              {picked.length} selected{picked.length === MAX_BULK ? " (max)" : ""}
            </span>
            <button onClick={() => setBulk("SOLVED")} className={`${btnCls} !px-4 !py-2 !text-sm`}>
              Solve
            </button>
            <button onClick={() => setBulk("CLOSED")} className={`${btnGhostCls} !px-4 !py-2 !text-sm`}>
              Close
            </button>
            {canEscalate && (
              <button onClick={() => setBulk("ESCALATED")} className={`${btnGhostCls} !px-4 !py-2 !text-sm`}>
                Escalate
              </button>
            )}
            <button onClick={() => setBulk("REPLY")} className={`${btnGhostCls} !px-4 !py-2 !text-sm`}>
              Reply
            </button>
            <button onClick={() => setSelected(new Set())} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:text-ink">
              Clear
            </button>
          </div>
        </div>
      )}

      {bulk && <BulkDialog action={bulk} tickets={picked} onClose={() => setBulk(null)} onDone={finished} />}
    </div>
  );
}
