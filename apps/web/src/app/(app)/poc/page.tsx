"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import BulkDialog, { type BulkAction } from "@/components/BulkDialog";
import { ErrorNote, SubCategoryIcon, STATUS_TEXT, StatusBadge, btnCls, btnGhostCls, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useDismiss } from "@/lib/use-dismiss";
import type { PocQueuePage, PocQueueTicket } from "@/lib/types";

type View = "open" | "done";
type Sort = "time-left" | "newest" | "oldest";

/** Tickets per page. */
const PAGE_SIZE = 25;
/** The most tickets one selection can hold. */
const MAX_SELECTION = 500;

const SORTS: { id: Sort; label: string }[] = [
  { id: "time-left", label: "Least time left" },
  { id: "oldest", label: "Oldest first" },
  { id: "newest", label: "Newest first" },
];

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

interface Loaded {
  key: string;
  tickets: PocQueueTicket[];
  total: number;
  counts: { open: number; done: number };
  nextCursor: string | null;
  assigned: boolean;
  error: string | null;
}

export default function PocQueuePage() {
  const [view, setView] = useState<View>("open");
  const [sort, setSort] = useState<Sort>("time-left");
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // The right-click menu ("Select") and the long-press timer used on phones.
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justPressed = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const open = view === "open";
  // Finished tickets have no clock, so they only sort by date.
  const activeSort: Sort = open ? sort : sort === "oldest" ? "oldest" : "newest";
  const key = `${view}|${activeSort}|${version}`;

  // First page: reloads whenever the tab, the sort or the version (after an action) changes.
  useEffect(() => {
    let cancelled = false;
    api<PocQueuePage>(`/poc/queue?view=${view}&sort=${activeSort}&limit=${PAGE_SIZE}`)
      .then((res) => !cancelled && setLoaded({ key, ...res, error: null }))
      .catch((err) => {
        if (!cancelled) {
          setLoaded({ key, tickets: [], total: 0, counts: { open: 0, done: 0 }, nextCursor: null, assigned: true, error: err instanceof ApiError ? err.message : "Could not load your queue." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, activeSort, key]);

  // Closes on a press outside, on Escape, or when the list scrolls (the menu is positioned on screen).
  useDismiss(!!menu, menuRef, () => setMenu(null), { escape: true, scroll: true });

  const ready = loaded && loaded.key === key ? loaded : null;
  const tickets = ready?.tickets ?? [];
  const total = ready?.total ?? 0;

  // Checkboxes exist only while something is selected: they appear after "Select" and go when the last is cleared.
  const selecting = open && selected.size > 0;
  const loadedPicked = tickets.filter((t) => selected.has(t.id));
  const allLoadedPicked = tickets.length > 0 && loadedPicked.length === tickets.length;
  // L3 is the top level: there is nowhere to escalate to.
  const hasTopLevel = loadedPicked.some((t) => t.currentLevel >= 3);

  function clearSelection() {
    setSelected(new Set());
  }
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_SELECTION) next.add(id);
      return next;
    });
  }
  function toggleLoaded() {
    setSelected(allLoadedPicked ? new Set() : new Set(tickets.slice(0, MAX_SELECTION).map((t) => t.id)));
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
  function switchView(v: View) {
    clearSelection();
    setView(v);
  }
  function changeSort(s: Sort) {
    clearSelection();
    setSort(s);
  }
  function finished(message: string) {
    setBulk(null);
    clearSelection();
    setToast(message);
    setTimeout(() => setToast(null), 5000);
    setVersion((n) => n + 1);
  }

  async function loadMore() {
    if (!ready?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const res = await api<PocQueuePage>(`/poc/queue?view=${view}&sort=${activeSort}&limit=${PAGE_SIZE}&cursor=${encodeURIComponent(ready.nextCursor)}`);
      setLoaded((prev) => {
        if (!prev || prev.key !== key) return prev;
        const have = new Set(prev.tickets.map((t) => t.id));
        return { ...prev, ...res, key, tickets: [...prev.tickets, ...res.tickets.filter((t) => !have.has(t.id))], error: null };
      });
    } catch (err) {
      setMoreError(err instanceof ApiError ? err.message : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  }

  const titles = new Map(tickets.map((t) => [t.id, t.title]));

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
              className={`-mb-px flex items-center gap-2 border-b-2 pb-3 text-[15px] font-medium transition ${
                view === v.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {v.label}
              {ready && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${view === v.id ? "bg-brand-soft text-brand" : "bg-surface text-muted"}`}>{ready.counts[v.id]}</span>
              )}
            </button>
          ))}
        </div>
        {ready && total > 1 && (
          <div className="relative pb-2">
            <select
              aria-label="Sort by"
              className="cursor-pointer appearance-none bg-transparent py-1 pr-6 text-sm font-medium text-muted outline-none transition hover:text-ink focus:text-ink"
              value={activeSort}
              onChange={(e) => changeSort(e.target.value as Sort)}
            >
              {SORTS.filter((o) => open || o.id !== "time-left").map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-4 w-4 -translate-y-[60%] text-muted" strokeWidth={2} aria-hidden="true" />
          </div>
        )}
      </div>

      {toast && <p role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">{toast}</p>}
      <ErrorNote message={ready?.error ?? moreError} />
      {!ready && <p className="text-sm text-muted">Loading…</p>}
      {ready && !ready.assigned && !ready.error && (
        <div className="rounded-2xl border border-line bg-white p-8 text-center shadow-[0_1px_2px_rgba(16,24,40,0.04)] sm:p-10">
          <p className="text-[17px] font-semibold text-ink">You are not assigned to a category yet</p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">Your account is ready. Ask your team lead or the admin to add you from Settings, and your tickets will appear here.</p>
        </div>
      )}
      {ready && ready.assigned && total === 0 && !ready.error && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
          {view === "open" ? "Nothing waiting. You're all caught up." : "Nothing finished yet."}
        </div>
      )}

      {/* Select all: exactly the tickets on screen. Only shown while something is selected. */}
      {selecting && tickets.length > 1 && (
        <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm text-muted">
          <input type="checkbox" checked={allLoadedPicked} onChange={toggleLoaded} className="h-[18px] w-[18px] cursor-pointer rounded accent-brand" />
          {allLoadedPicked ? "Clear selection" : `Select all ${tickets.length}`}
        </label>
      )}

      {ready && (
        <ul className="space-y-3">
          {tickets.map((t) => {
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
                    <input type="checkbox" checked={on} onChange={() => toggle(t.id)} aria-label={`Select ${t.title}`} className="h-[18px] w-[18px] cursor-pointer rounded accent-brand" />
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
                  <SubCategoryIcon category={t.category.shortName || t.category.name} subCategory={t.subCategory?.name} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="line-clamp-2 font-semibold text-ink sm:truncate">{t.title}</p>
                    {t.subCategory && <p className="truncate text-sm text-ink/70">{t.subCategory.name}</p>}
                    <p className="truncate text-xs text-muted">
                      {t.student.name} · {timeAgo(view === "open" ? t.createdAt : t.updatedAt)}
                      {due && <span className={due.late ? "font-semibold text-red-600" : ""}>{` · ${due.text}`}</span>}
                    </p>
                    <div className="flex gap-2 pt-1.5 sm:hidden">
                      {t.critical && <CriticalBadge />}
                      <StatusBadge status={t.status} label={t.closedByStudent ? "Closed by student" : STATUS_TEXT[t.status]} />
                    </div>
                  </div>
                  <div className="hidden items-center gap-2 sm:flex">
                    {t.critical && <CriticalBadge />}
                    <StatusBadge status={t.status} label={t.closedByStudent ? "Closed by student" : STATUS_TEXT[t.status]} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* Paging */}
      {ready && total > 0 && (
        <div className="flex flex-col items-center gap-3 pt-1">
          <p className="text-sm text-muted">
            Showing {tickets.length} of {total}
          </p>
          {ready.nextCursor && (
            <button onClick={loadMore} disabled={loadingMore} className={`${btnGhostCls} !px-6`}>
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          )}
        </div>
      )}

      {/* Right-click menu */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          style={{ left: Math.min(menu.x, typeof window === "undefined" ? menu.x : window.innerWidth - 190), top: menu.y }}
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
            <span className="mr-auto text-[15px] font-semibold text-ink">{selected.size} selected</span>
            <button onClick={() => setBulk("SOLVED")} className={`${btnCls} !px-4 !py-2 !text-sm`}>
              Solve
            </button>
            <button onClick={() => setBulk("CLOSED")} className={`${btnGhostCls} !px-4 !py-2 !text-sm`}>
              Close
            </button>
            {!hasTopLevel && (
              <button onClick={() => setBulk("ESCALATED")} className={`${btnGhostCls} !px-4 !py-2 !text-sm`}>
                Escalate
              </button>
            )}
            <button onClick={() => setBulk("REPLY")} className={`${btnGhostCls} !px-4 !py-2 !text-sm`}>
              Reply
            </button>
            <button onClick={clearSelection} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:text-ink">
              Clear
            </button>
          </div>
        </div>
      )}

      {bulk && <BulkDialog action={bulk} ids={[...selected]} titleOf={(id) => titles.get(id)} onClose={() => setBulk(null)} onDone={finished} />}
    </div>
  );
}
