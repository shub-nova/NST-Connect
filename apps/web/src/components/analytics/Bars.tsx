import { Empty } from "./Primitives";

// Bars and lists that need no chart library.

export function TrendPill({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  return (
    <span className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}

/** Ranked horizontal bars: readable on a phone, no chart library needed. */
export function BarList({ rows, empty }: { rows: { key: string; label: string; sub?: string; value: number; display?: string; trend?: number; color?: string }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <Empty text={empty} />;
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-ink">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-ink">
              {r.display ?? r.value}
              {r.trend !== undefined && <TrendPill delta={r.trend} />}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${Math.max((r.value / max) * 100, r.value ? 3 : 0)}%`, background: r.color ?? "linear-gradient(90deg,#7aa2ff,#2f6df6)" }}
            />
          </div>
          {r.sub && <p className="mt-1 text-xs text-muted">{r.sub}</p>}
        </li>
      ))}
    </ul>
  );
}

/** One bar split into coloured parts, with a legend that always shows every count. */
export function StackedBar({ segments, empty }: { segments: { label: string; value: number; color: string }[]; empty: string }) {
  const total = segments.reduce((n, x) => n + x.value, 0);
  if (!total) return <Empty text={empty} />;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface">
        {segments.filter((x) => x.value).map((x) => (
          <div key={x.label} title={`${x.label}: ${x.value}`} style={{ width: `${(x.value / total) * 100}%`, background: x.color }} />
        ))}
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
        {segments.map((x) => (
          <li key={x.label} className="flex items-start gap-2">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
            <span>
              <span className="block text-lg font-bold leading-6 text-ink">{x.value}</span>
              <span className="block text-xs text-muted">{x.label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/** A line ending in a dot at each category's auto-escalation rate. */
export function RateLollipop({ items }: { items: { id: string; name: string; total: number; auto: number; rate: number }[] }) {
  if (!items.length) return <Empty text="No tickets in this period." />;
  const shown = items.slice(0, 6);
  // Scale to the highest rate so the differences between categories are easy to see.
  const scale = Math.max(1, ...shown.map((i) => i.rate)) * 1.08;
  return (
    <div>
      <ul className="space-y-4">
        {shown.map((i) => (
          <li key={i.id} className="grid grid-cols-[minmax(90px,150px)_minmax(0,1fr)_44px] items-center gap-3" title={`${i.auto} of ${i.total} tickets auto-escalated`}>
            <span className="truncate text-sm text-ink">{i.name}</span>
            <div className="relative h-4">
              <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line/80" />
              <span className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full" style={{ width: `${(i.rate / scale) * 100}%`, background: "linear-gradient(90deg,#fecaca,#ef4444)" }} />
              <span
                className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-red-500 shadow ring-2 ring-red-200"
                style={{ left: `${(i.rate / scale) * 100}%` }}
              />
            </div>
            <span className="text-right text-sm font-semibold tabular-nums text-ink">{i.rate}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
