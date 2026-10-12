import type { AnalyticsBreakdownRow } from "@/lib/types";
import { Legend } from "./Bars";
import { OUTCOME_COLORS, cardShell } from "./theme";

/**
 * One comparison card, one row per category or POC. Bar length is the number of tickets handled
 * (so rows compare at a glance) and its colours show how they ended. Alphabetical, never ranked.
 */
export function Breakdown({ title, rows }: { title: string; rows: AnalyticsBreakdownRow[]; nameHeader?: string }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.headline.total));
  return (
    <section className={`${cardShell} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-muted">Bar length is tickets handled. Alphabetical, not ranked.</p>
        </div>
        <Legend
          items={[
            { label: "Solved", color: OUTCOME_COLORS.solved },
            { label: "Closed", color: OUTCOME_COLORS.closed },
            { label: "Escalated", color: OUTCOME_COLORS.escalated },
          ]}
        />
      </div>

      <ul className="mt-5 divide-y divide-line/60">
        {rows.map((r) => {
          const h = r.headline;
          const parts = [
            { label: "Solved", value: h.solved, color: OUTCOME_COLORS.solved },
            { label: "Closed", value: h.closed, color: OUTCOME_COLORS.closed },
            ...(r.level === 3 ? [] : [{ label: "Escalated", value: h.escalated, color: OUTCOME_COLORS.escalated }]),
          ];
          const done = Math.max(1, parts.reduce((n, x) => n + x.value, 0));
          return (
            <li key={r.id} className="grid items-center gap-x-5 gap-y-2 py-3 sm:grid-cols-[minmax(150px,1fr)_minmax(0,2.4fr)_auto]">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{r.name}</span>
                {r.level ? <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">L{r.level}</span> : null}
              </div>

              <div className="h-2.5 rounded-full bg-surface">
                <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${Math.max((h.total / max) * 100, h.total ? 4 : 0)}%` }}>
                  {parts.filter((x) => x.value).map((x) => (
                    <div key={x.label} title={`${x.label}: ${x.value}`} style={{ width: `${(x.value / done) * 100}%`, background: x.color }} />
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="w-10 text-right text-sm font-bold tabular-nums text-ink sm:order-last sm:ml-1">{h.total}</span>
                <span className="flex items-center gap-1.5">
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-medium text-muted">{h.actionNeeded} open</span>
                  {h.autoEscalatedFrom > 0 && (
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">{h.autoEscalatedFrom} auto-esc.</span>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
