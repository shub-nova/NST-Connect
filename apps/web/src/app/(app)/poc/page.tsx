"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, ErrorNote, STATUS_TEXT, StatusBadge, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import type { PocQueueTicket } from "@/lib/types";

type View = "open" | "done";

const VIEWS: { id: View; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
];

function dueLabel(iso: string | null): { text: string; late: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const hours = Math.round(Math.abs(ms) / 36e5);
  const span = hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;
  return ms < 0 ? { text: `${span} overdue`, late: true } : { text: `due in ${span}`, late: false };
}

export default function PocQueuePage() {
  const [view, setView] = useState<View>("open");
  const [loaded, setLoaded] = useState<{ view: View; tickets: PocQueueTicket[]; error: string | null } | null>(null);

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
  }, [view]);

  const loading = !loaded || loaded.view !== view;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">My queue</h1>

      <div className="flex gap-6 border-b border-line" role="tablist">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={`-mb-px border-b-2 pb-3 text-[15px] font-medium transition ${
              view === v.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <ErrorNote message={loaded?.error ?? null} />
      {loading && <p className="text-sm text-muted">Loading…</p>}
      {!loading && loaded.tickets.length === 0 && !loaded.error && (
        <div className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
          {view === "open" ? "Nothing waiting. You're all caught up." : "Nothing finished yet."}
        </div>
      )}

      {!loading && (
        <ul className="space-y-3">
          {loaded.tickets.map((t) => {
            const due = view === "open" ? dueLabel(t.tatDeadline) : null;
            return (
              <li key={t.id}>
                <Link
                  href={`/poc/tickets/${t.id}`}
                  className="flex items-start gap-3 rounded-xl border border-line bg-white p-3.5 transition hover:border-brand hover:shadow-sm sm:items-center sm:gap-4 sm:p-4"
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
                    <div className="pt-1.5 sm:hidden">
                      <StatusBadge status={t.status} label={STATUS_TEXT[t.status]} />
                    </div>
                  </div>
                  <div className="hidden sm:block">
                    <StatusBadge status={t.status} label={STATUS_TEXT[t.status]} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
