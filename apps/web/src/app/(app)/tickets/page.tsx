"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar, ErrorNote, StatusBadge, btnCls, btnGhostCls, timeAgo } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { isFinished } from "@/lib/types";
import type { TicketList } from "@/lib/types";

type Tab = "all" | "open" | "done";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "done", label: "Done" },
];

export default function MyTicketsPage() {
  const [data, setData] = useState<TicketList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("all");
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    api<TicketList>("/tickets?limit=30")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your tickets."));
  }, []);

  async function loadMore() {
    if (!data?.nextCursor) return;
    setLoadingMore(true);
    try {
      const more = await api<TicketList>(`/tickets?limit=30&cursor=${data.nextCursor}`);
      setData({ items: [...data.items, ...more.items], nextCursor: more.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  }

  const items = data?.items ?? [];
  const visible = items.filter((t) =>
    tab === "all" ? true : tab === "done" ? isFinished(t.status) : !isFinished(t.status),
  );
  const counts: Record<Tab, number> = {
    all: items.length,
    open: items.filter((t) => !isFinished(t.status)).length,
    done: items.filter((t) => isFinished(t.status)).length,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">My tickets</h1>
        <Link href="/new" className={btnCls}>
          Raise a ticket
        </Link>
      </div>

      <div className="flex gap-5 border-b border-line sm:gap-6" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-3 text-[15px] font-medium transition ${
              tab === t.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label} <span className="text-xs">({counts[t.id]})</span>
          </button>
        ))}
      </div>

      <ErrorNote message={error} />

      {data === null && !error ? (
        <p className="text-sm text-muted">Loading your tickets…</p>
      ) : visible.length === 0 && !error ? (
        <div className="space-y-4 rounded-2xl border border-dashed border-line bg-surface p-8 text-center sm:p-10">
          <p className="text-sm text-muted">
            {items.length === 0 ? "You have not raised any tickets yet." : tab === "done" ? "Nothing finished yet." : "No open tickets."}
          </p>
          {items.length === 0 && (
            <Link href="/new" className={btnCls}>
              Raise your first ticket
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tickets/${t.id}`}
                className="flex items-start gap-3 rounded-xl border border-line bg-white p-3.5 transition hover:border-brand hover:shadow-sm sm:items-center sm:gap-4 sm:p-4"
              >
                <Avatar name={t.category.shortName || t.category.name} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="line-clamp-2 font-semibold text-ink sm:truncate">{t.title}</p>
                  {t.subCategory && <p className="truncate text-sm text-ink/70">{t.subCategory.name}</p>}
                  <p className="truncate text-xs text-muted">
                    {t.assignedTo ?? t.category.shortName} · {timeAgo(t.updatedAt)}
                  </p>
                  {/* On phones the status sits under the text so titles get the full width. */}
                  <div className="pt-1.5 sm:hidden">
                    <StatusBadge status={t.status} label={t.statusLabel} />
                  </div>
                </div>
                <div className="hidden sm:block">
                  <StatusBadge status={t.status} label={t.statusLabel} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data?.nextCursor && (
        <button className={btnGhostCls} onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
