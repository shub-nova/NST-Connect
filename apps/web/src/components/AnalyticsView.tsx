"use client";

import { ArrowDownLeft, ArrowUpRight, Check, Clock, Inbox, RotateCcw, Smile, Target, Ticket, X, Zap } from "lucide-react";
import { Children, createContext, useContext, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError, api } from "@/lib/api";
import type { AnalyticsBreakdownRow, AnalyticsData, AnalyticsHeadline } from "@/lib/types";
import { SendNote } from "./AdminNotes";
import { ErrorNote, PillSelect, inputCls } from "./ui";

// ---- formatting ----------------------------------------------------------------------------

/** The escalation limit the admin has set, in words: "2 days" (and "2-day" before a noun). */
const DEFAULT_LIMIT = { long: "2 days", adj: "2-day" };
const describeLimit = (hours: number) =>
  hours % 24 === 0 ? { long: `${hours / 24} day${hours === 24 ? "" : "s"}`, adj: `${hours / 24}-day` } : { long: `${hours} hours`, adj: `${hours}-hour` };
const LimitContext = createContext(DEFAULT_LIMIT);

const fmtPct = (p: number | null) => (p === null ? "—" : `${p}%`);

const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() - offsetDays * DAY).toISOString().slice(0, 10);

const PRESETS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "custom", label: "Custom" },
] as const;

const COLORS = { brand: "#2f6df6", amber: "#f59e0b", red: "#ef4444", green: "#10b981", slate: "#94a3b8", grid: "#eef0f5", muted: "#6b7280" };

// ---- look and feel -------------------------------------------------------------------------

const cardShell = "min-w-0 rounded-2xl border border-line/70 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_16px_-8px_rgba(16,24,40,0.06)]";

type Accent = "blue" | "amber" | "red" | "green" | "slate" | "violet";
const ACCENT: Record<Accent, string> = {
  blue: "bg-brand-soft text-brand",
  amber: "bg-amber-50 text-amber-600",
  red: "bg-red-50 text-red-600",
  green: "bg-emerald-50 text-emerald-600",
  slate: "bg-slate-100 text-slate-600",
  violet: "bg-violet-50 text-violet-600",
};

const ICONS = {
  inbox: Inbox,
  clock: Clock,
  check: Check,
  x: X,
  up: ArrowUpRight,
  down: ArrowDownLeft,
  bolt: Zap,
  rotate: RotateCcw,
  target: Target,
  tickets: Ticket,
  smile: Smile,
} as const;

function Icon({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof ICONS; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} strokeWidth={2} aria-hidden="true" />;
}

/** Stat cards grow to fill each row, so there are never gaps however many there are. */
function Kpi({ label, value, icon, accent, bad }: { label: string; value: string; icon: keyof typeof ICONS; accent: Accent; bad?: boolean }) {
  return (
    <div className={`${cardShell} flex min-w-0 flex-col justify-center p-4 sm:p-5`}>
      <div className="flex items-center gap-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${ACCENT[bad ? "red" : accent]}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-4 text-muted">{label}</p>
          <p className={`mt-1 text-[28px] font-semibold leading-8 tracking-tight ${bad ? "text-red-600" : "text-slate-700"}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The stat cards, four to a row. When the count is not a multiple of four, the last row stretches to fill the
 * width, so a row is never left with one small card or an empty gap.
 */
function KpiGrid({ children }: { children: React.ReactNode }) {
  const n = Children.toArray(children).length;
  const layout =
    n % 4 === 0
      ? "grid grid-cols-2 lg:grid-cols-4"
      : "flex flex-wrap [&>*]:grow [&>*]:basis-[calc(50%-0.5rem)] sm:[&>*]:basis-[210px] lg:[&>*]:basis-[calc(25%-1rem)]";
  // On a phone (two columns) an odd last card spans the row instead of sitting half empty.
  return <div className={`${layout} gap-4 sm:gap-5 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2`}>{children}</div>;
}

/** A card that grows to share its row with its neighbours. */
function Section({ title, hint, children, basis = 420 }: { title: string; hint?: string; children: React.ReactNode; basis?: number }) {
  return (
    <section className={`${cardShell} flex flex-col p-4 sm:p-5`} style={{ flex: `1 1 ${basis}px` }}>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

const Row = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap gap-4 sm:gap-5">{children}</div>;
const Empty = ({ text = "Nothing in this period." }: { text?: string }) => <p className="py-8 text-center text-sm text-muted">{text}</p>;

function TrendPill({ delta }: { delta: number }) {
  if (delta === 0) return null;
  const up = delta > 0;
  return (
    <span className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${up ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"}`}>
      {up ? "▲" : "▼"} {Math.abs(delta)}
    </span>
  );
}

/** Ranked horizontal bars: readable on a phone, no chart library needed. */
function BarList({ rows, empty }: { rows: { key: string; label: string; sub?: string; value: number; display?: string; trend?: number; color?: string }[]; empty?: string }) {
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
function StackedBar({ segments, empty }: { segments: { label: string; value: number; color: string }[]; empty: string }) {
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

const tooltipStyle = { borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 8px 24px -8px rgba(16,24,40,0.18)", fontSize: 12, padding: "8px 12px" };
const axisTick = { fontSize: 11, fill: COLORS.muted };

function tickLabel(day: string, bucket: "day" | "week") {
  const d = new Date(`${day}T00:00:00Z`);
  const text = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return bucket === "week" ? `Wk ${text}` : text;
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
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

function Gradients() {
  return (
    <defs>
      <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6b9bff" />
        <stop offset="100%" stopColor="#2f6df6" />
      </linearGradient>
      <linearGradient id="gAmber" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#f59e0b" />
      </linearGradient>
      <linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f87171" />
        <stop offset="100%" stopColor="#ef4444" />
      </linearGradient>
    </defs>
  );
}

// One colour per category, the same in every donut, so a category is easy to follow across charts.
const SHARE_PALETTE = ["#2f6df6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6"];

const SHARE_METRICS: { key: string; title: string; pick: (h: AnalyticsHeadline) => number }[] = [
  { key: "auto", title: "Auto-escalated", pick: (h) => h.autoEscalatedFrom },
  { key: "solved", title: "Solved", pick: (h) => h.solved },
  { key: "closed", title: "Closed", pick: (h) => h.closed },
  { key: "manual", title: "Escalated by a POC", pick: (h) => h.escalated },
];

// ---- lollipop chart: a line ending in a dot at each category's auto-escalation rate -------------

function RateLollipop({ items }: { items: { id: string; name: string; total: number; auto: number; rate: number }[] }) {
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

/** Vertical columns, one colour per category, with the count on top. Grows to fill its card. */
function ColumnChart({ items }: { items: { id: string; name: string; value: number; previous: number; color: string }[] }) {
  if (!items.length) return <Empty />;
  return (
    <div className="relative min-h-[260px] flex-1">
      <div className="absolute inset-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={items} margin={{ left: -24, right: 4, top: 22, bottom: 4 }} barCategoryGap="24%">
            <CartesianGrid stroke={COLORS.grid} vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} interval={0} angle={-28} textAnchor="end" height={64} tickFormatter={(n: string) => (n.length > 13 ? `${n.slice(0, 12)}…` : n)} />
            <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip
              cursor={{ fill: "#f5f6f8" }}
              contentStyle={tooltipStyle}
              formatter={(v, _n, item) => [`${v} tickets · ${(item.payload as { previous: number }).previous} before`, ""]}
              labelFormatter={(l) => String(l)}
            />
            <Bar dataKey="value" name="Tickets" radius={[8, 8, 0, 0]}>
              {items.map((x) => (
                <Cell key={x.id} fill={x.color} />
              ))}
              <LabelList dataKey="value" position="top" style={{ fontSize: 12, fontWeight: 700, fill: "#1f2937" }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Words sized by how often they repeat. Hovering (or tabbing to) one shows its count and rank. */
function PhraseCloud({ items }: { items: { term: string; count: number }[] }) {
  if (!items.length) return <Empty text="Not enough tickets yet." />;
  const max = Math.max(...items.map((i) => i.count));
  const min = Math.min(...items.map((i) => i.count));
  const tints = ["text-brand bg-brand-soft", "text-violet-600 bg-violet-50", "text-amber-600 bg-amber-50", "text-emerald-600 bg-emerald-50", "text-pink-600 bg-pink-50", "text-cyan-600 bg-cyan-50"];
  return (
    <div className="flex flex-wrap items-center gap-2.5 py-1">
      {items.map((i, idx) => {
        const t = max === min ? 0.5 : (i.count - min) / (max - min);
        return (
          <span
            key={i.term}
            tabIndex={0}
            className={`group relative cursor-default rounded-full px-3.5 py-1.5 font-semibold outline-none transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand ${tints[idx % tints.length]}`}
            style={{ fontSize: `${13 + t * 9}px` }}
          >
            {i.term}
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2.5 -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-xl bg-ink px-3.5 py-2 text-left opacity-0 shadow-lg transition duration-150 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
            >
              <span className="block text-sm font-semibold leading-5 text-white">
                {i.count} ticket{i.count === 1 ? "" : "s"}
              </span>
              <span className="block text-xs font-normal leading-4 text-white/70">
                #{idx + 1} most repeated
              </span>
              <span className="absolute left-1/2 top-full -mt-1 h-2 w-2 -translate-x-1/2 rotate-45 bg-ink" />
            </span>
          </span>
        );
      })}
    </div>
  );
}

interface Slice {
  id: string;
  name: string;
  value: number;
  color: string;
}

/** A donut that shows the hovered slice in its centre, so nothing floats over the chart. */
function Donut({ slices, total, idle, inline }: { slices: Slice[]; total: number; /** Centre text when nothing is hovered (defaults to the total). */ idle?: { value: string; label: string }; /** Fixed size, for sitting beside other content. */ inline?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const on = active === null ? null : slices[active];
  return (
    <div
      className={inline ? "relative h-40 w-40 shrink-0" : "relative mx-auto h-44 w-44"}
      // The chart's own "mouse leave" is unreliable (gaps between slices, fast exits), so the selection
      // is cleared whenever the pointer is over anything that is not a slice, or leaves the donut.
      onMouseOver={(e) => {
        if (!(e.target as Element).closest(".recharts-sector")) setActive(null);
      }}
      onMouseLeave={() => setActive(null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="70%"
            outerRadius="100%"
            paddingAngle={2}
            cornerRadius={5}
            stroke="none"
            onMouseEnter={(_, i) => setActive(i)}
          >
            {slices.map((x, i) => (
              <Cell key={x.id} fill={x.color} fillOpacity={active === null || active === i ? 1 : 0.3} style={{ transition: "fill-opacity 150ms", outline: "none" }} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-9 text-center">
        {on ? (
          <>
            <span className="max-w-full truncate text-[11px] font-medium leading-4 text-muted">{on.name}</span>
            <span className="text-2xl font-bold leading-7 text-ink">{on.value}</span>
            <span className="text-[11px] font-semibold leading-4" style={{ color: on.color }}>{Math.round((on.value / total) * 1000) / 10}%</span>
          </>
        ) : (
          <>
            <span className="text-2xl font-bold leading-7 text-ink">{idle?.value ?? total}</span>
            <span className="text-[11px] text-muted">{idle?.label ?? "total"}</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Where each outcome comes from: a donut per outcome showing each category's share of the total. */
function ShareDonuts({ rows, final }: { rows: AnalyticsBreakdownRow[]; final: boolean }) {
  const limit = useContext(LimitContext);
  const colorOf = new Map(rows.map((r, i) => [r.id, SHARE_PALETTE[i % SHARE_PALETTE.length]]));
  const rated = rows
    .filter((r) => r.headline.total > 0)
    .map((r) => ({ r, rate: Math.round((r.headline.autoEscalatedFrom / r.headline.total) * 1000) / 10 }))
    .sort((a, b) => b.rate - a.rate);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Row>
        {SHARE_METRICS.filter((m) => !(final && m.key === "manual")).map((m) => {
          const all = rows.map((r) => ({ id: r.id, name: r.name, value: m.pick(r.headline) })).filter((x) => x.value > 0).sort((a, b) => b.value - a.value);
          const total = all.reduce((n, x) => n + x.value, 0);
          const slices = all.map((x) => ({ ...x, color: colorOf.get(x.id) ?? COLORS.slate }));
          return (
            <Section key={m.key} title={final && m.key === "auto" ? `Missed the ${limit.adj} limit` : m.title} basis={250}>
              {total === 0 ? (
                <Empty />
              ) : (
                <>
                  <Donut slices={slices} total={total} />
                  <p className="mt-4 text-center text-sm text-muted">
                    Most from <b className="font-semibold text-ink">{all[0].name}</b>
                    <span className="text-ink"> · {Math.round((all[0].value / total) * 100)}%</span>
                  </p>
                </>
              )}
            </Section>
          );
        })}
      </Row>

      {/* One colour key for all four donuts */}
      <ul
        className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-2.5 rounded-2xl bg-surface px-4 py-3.5 text-[13px] text-ink sm:px-5"
        aria-label="Colour key"
      >
        {rows.map((r) => (
          <li key={r.id} className="flex min-w-0 items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf.get(r.id) }} />
            <span className="truncate">{r.name}</span>
          </li>
        ))}
      </ul>

      <Section title={final ? "Missed-deadline rate" : "Auto-escalation rate"} hint="The categories with the highest share of their tickets auto-escalated">
        <RateLollipop items={rated.map(({ r, rate }) => ({ id: r.id, name: r.name, total: r.headline.total, auto: r.headline.autoEscalatedFrom, rate }))} />
      </Section>
    </div>
  );
}

const OUTCOME_COLORS = { solved: COLORS.green, closed: COLORS.slate, escalated: "#8b5cf6" };

/**
 * One comparison card, one row per category or POC. Bar length is the number of tickets handled
 * (so rows compare at a glance) and its colours show how they ended. Alphabetical, never ranked.
 */
function Breakdown({ title, rows }: { title: string; rows: AnalyticsBreakdownRow[]; nameHeader?: string }) {
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

// ---- the dashboard ---------------------------------------------------------------------------

interface Props {
  /** API path, e.g. "/analytics/me". */
  endpoint: string;
  /** Admin gets category and level filters. */
  filters?: { categories: { id: string; shortName: string }[] };
}

export default function AnalyticsView({ endpoint, filters }: Props) {
  const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("30");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [categoryId, setCategoryId] = useState("");
  const [level, setLevel] = useState("");
  const [state, setState] = useState<{ key: string; data: AnalyticsData | null; error: string | null } | null>(null);

  // The query string is derived, so changing any control refetches without extra effects.
  const range = preset === "custom" ? custom : { from: isoDay(Number(preset) - 1), to: isoDay(0) };
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  if (categoryId) params.set("categoryId", categoryId);
  if (level) params.set("level", level);
  const key = `${endpoint}?${params}`;
  const customIncomplete = preset === "custom" && (!custom.from || !custom.to);

  useEffect(() => {
    if (customIncomplete) return;
    let cancelled = false;
    api<AnalyticsData>(key)
      .then((data) => !cancelled && setState({ key, data, error: null }))
      .catch((err) => !cancelled && setState({ key, data: null, error: err instanceof ApiError ? err.message : "Could not load analytics." }));
    return () => {
      cancelled = true;
    };
  }, [key, customIncomplete]);

  const ready = state && state.key === key ? state : null;
  const data = ready?.data ?? null;
  const h = data?.headline ?? null;

  // What makes sense depends on the view and level: L1 is first (nothing arrives from below),
  // L3 is final (nothing to escalate to, nothing to reopen), and Overall is about what is being raised.
  const isMe = data?.view === "me";
  const onlyTopics = data?.view === "overall";
  const isEveryone = onlyTopics || data?.view === "admin";
  const top = data?.levels ? Math.max(...data.levels) : 0;
  const isAdmin = data?.view === "admin";
  const adminLevel = isAdmin && level ? Number(level) : 0;
  // L1 is the first level (tickets leave their queue), L3 is final (nothing to escalate to or reopen).
  // The same rules apply on a person's own page and when the admin filters by a level.
  const firstLevel = (isMe && top === 1) || adminLevel === 1;
  const finalLevel = (isMe && top === 3) || adminLevel === 3;
  const showWithinLimit = isMe ? top === 1 : !adminLevel || adminLevel === 1;
  // The admin donuts break the cards' totals down by category, so the per-category list is not repeated.
  const showShares = isAdmin && (data?.breakdown?.length ?? 0) > 1;
  // What is being raised describes a whole category, so it is hidden once the admin narrows to a level.
  const showTopics = isEveryone && !adminLevel;
  const manyCategories = (data?.categories.length ?? 0) > 1;

  // A category keeps one colour across the donuts, the columns and the sub-category bars.
  const categoryColor = (name: string) => {
    // Same order the donuts use (the comparison rows), so colours match across charts.
    const order = data?.breakdown?.length ? data.breakdown.map((r) => r.name) : (data?.categories.map((c) => c.name) ?? []);
    const i = order.indexOf(name);
    return SHARE_PALETTE[(i < 0 ? 0 : i) % SHARE_PALETTE.length];
  };

  // What a note would be about and who it would go to, taken from the current filters.
  const categoryName = filters?.categories.find((c) => c.id === categoryId)?.shortName ?? "All categories";
  const audience = `${categoryName} · ${level ? `L${level}` : "all levels"}`;
  const periodLabel = preset === "custom" ? `${custom.from} to ${custom.to}` : `last ${preset} days`;
  const notePocs = categoryId && data?.breakdown ? data.breakdown.map((r) => ({ id: r.id, name: r.name, level: r.level })) : [];

  const phrases = data ? (data.phrases.length >= 3 ? data.phrases : data.words) : [];
  const phrasesTitle = data && data.phrases.length >= 3 ? "Most repeated phrases" : "Most repeated words";
  const limit = data ? describeLimit(data.tatHours) : DEFAULT_LIMIT;

  return (
    <LimitContext.Provider value={limit}>
    <div className="space-y-5 sm:space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="inline-flex rounded-full bg-surface p-1" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              aria-pressed={preset === p.id}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${preset === p.id ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From" className={`${inputCls} !w-auto`} value={custom.from} max={custom.to || undefined} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="text-muted">–</span>
            <input type="date" aria-label="To" className={`${inputCls} !w-auto`} value={custom.to} min={custom.from || undefined} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        {filters && (
          <>
            <PillSelect label="Category" value={categoryId} onChange={setCategoryId}>
              <option value="">All categories</option>
              {filters.categories.map((c) => (
                <option key={c.id} value={c.id}>{c.shortName}</option>
              ))}
            </PillSelect>
            <PillSelect label="Level" value={level} onChange={setLevel}>
              <option value="">All levels</option>
              <option value="1">L1</option>
              <option value="2">L2</option>
              <option value="3">L3</option>
            </PillSelect>
            <SendNote audience={audience} categoryId={categoryId} level={level} pocs={notePocs} context={`${audience}, ${periodLabel}`} />
          </>
        )}
      </div>

      {customIncomplete && <p className="text-sm text-muted">Pick a start and end date.</p>}
      <ErrorNote message={ready?.error ?? null} />
      {!ready && !customIncomplete && <p className="text-sm text-muted">Loading…</p>}

      {data && h && (
        <div className="space-y-5 sm:space-y-6">
          {/* Stat cards: personal and operational numbers (not on Overall) */}
          {!onlyTopics && (
            <>
              <div className="space-y-4">
              <h2 className="text-lg font-semibold text-ink">Summary</h2>
              <KpiGrid>
                <Kpi
                  icon="inbox"
                  accent="blue"
                  label="Action needed / total"
                  value={`${h.actionNeeded} / ${h.total}`}
                  bad={!!(h.overdue || h.critical)}
                />
                <Kpi icon="check" accent="green" label="Solved" value={String(h.solved)} />
                <Kpi icon="x" accent="slate" label="Closed" value={String(h.closed)} />
                {!finalLevel && <Kpi icon="up" accent="violet" label="Escalated" value={String(h.escalated)} />}
                <Kpi
                  icon="bolt"
                  accent="red"
                  label={finalLevel ? `Missed the ${limit.adj} limit` : isMe ? "Auto-escalated from me" : "Auto-escalated"}
                  value={String(h.autoEscalatedFrom)}
                  bad={h.autoEscalatedFrom > 0}
                />
                {isMe && !firstLevel && <Kpi icon="down" accent="blue" label="Auto-escalated to me" value={String(h.autoEscalatedTo)} />}
                {showWithinLimit && (
                  <Kpi icon="target" accent="green" label={`Finished within ${limit.long}`} value={fmtPct(h.withinTatPct)} />
                )}
                {!finalLevel && <Kpi icon="rotate" accent="violet" label="Reopened" value={fmtPct(h.reopenRatePct)} />}
                <Kpi icon="smile" accent="green" label="Satisfaction" value={fmtPct(h.feedback.satisfactionPct)} />
              </KpiGrid>
              </div>

              <div className="space-y-4">
              <h2 className="text-lg font-semibold text-ink">Analytics</h2>
              <Row>
                {!finalLevel && (
                  <Section title="Escalations" hint={`Automatic: not solved within ${limit.long}. Manual: a POC chose to escalate.`}>
                    {data.trend.some((p) => p.autoEscalated || p.manualEscalated) ? (
                      <>
                        <Legend items={[{ label: "Manual", color: COLORS.amber }, { label: "Automatic (TAT)", color: COLORS.red }]} />
                        <div className="relative min-h-[224px] flex-1">
                          <div className="absolute inset-0">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data.trend} margin={{ left: -24, right: 4, top: 4 }} barCategoryGap="22%">
                              <Gradients />
                              <CartesianGrid stroke={COLORS.grid} vertical={false} strokeDasharray="3 3" />
                              <XAxis dataKey="day" tickFormatter={(d) => tickLabel(d, data.range.bucket)} tick={axisTick} minTickGap={28} axisLine={false} tickLine={false} />
                              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                              <Tooltip cursor={{ fill: "#f5f6f8" }} contentStyle={tooltipStyle} labelFormatter={(d) => tickLabel(String(d), data.range.bucket)} />
                              <Bar dataKey="manualEscalated" name="Manual" stackId="e" fill="url(#gAmber)" />
                              <Bar dataKey="autoEscalated" name="Automatic" stackId="e" fill="url(#gRed)" radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ResponsiveContainer>
                          </div>
                        </div>
                      </>
                    ) : (
                      <Empty />
                    )}
                  </Section>
                )}

                {!firstLevel && (
                  <Section title="How long tickets took to finish" hint="From raised to Solved or Closed, across all levels">
                    {data.finishTimes.some((b) => b.count) ? (
                      <div className="relative min-h-[224px] flex-1">
                        <div className="absolute inset-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={data.finishTimes.map((b, i, all) => ({ ...b, label: i === all.length - 1 ? `${b.days}+` : String(b.days) }))}
                            margin={{ left: -24, right: 4, top: 4, bottom: 14 }}
                            barCategoryGap="22%"
                          >
                            <Gradients />
                            <CartesianGrid stroke={COLORS.grid} vertical={false} strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} label={{ value: "days to finish", position: "insideBottom", offset: -4, fontSize: 11, fill: COLORS.muted }} height={44} />
                            <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} />
                            <Tooltip cursor={{ fill: "#f5f6f8" }} contentStyle={tooltipStyle} separator="" formatter={(v) => [`${v} ticket${v === 1 ? "" : "s"}`, ""]} labelFormatter={(l) => `${l} day${l === "1" ? "" : "s"}`} />
                            <Bar dataKey="count" name="Tickets" fill="url(#gBlue)" radius={[6, 6, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                        </div>
                      </div>
                    ) : (
                      <Empty />
                    )}
                  </Section>
                )}


              </Row>
              </div>

              {data.view !== "admin" && (
                <Section title="Time left on open tickets" hint={`How much of the ${limit.long} is left. Critical tickets have no clock.`}>
                  <StackedBar
                    segments={[
                      { label: "Under 6 hours", value: data.timeLeft.within6h, color: "#f97316" },
                      { label: "6 to 12 hours", value: data.timeLeft.within12h, color: COLORS.amber },
                      { label: "12 to 24 hours", value: data.timeLeft.within24h, color: "#60a5fa" },
                      { label: "More than 24 hours", value: data.timeLeft.later, color: COLORS.slate },
                    ]}
                    empty="No open tickets."
                  />
                </Section>
              )}

              {showShares && data.breakdown && (
                <ShareDonuts rows={data.breakdown} final={finalLevel} />
              )}

              <Section title="Student feedback" hint="Anonymous answers on tickets solved or closed">
                {h.feedback.responses === 0 ? (
                  <Empty text="No feedback yet." />
                ) : (
                  <div className="flex flex-wrap items-stretch gap-x-10 gap-y-6">
                    {/* Left: the donut and its key, centred against the phrases beside it. */}
                    <div className="flex flex-col">
                      <div className="flex flex-1 flex-wrap items-center gap-x-8 gap-y-4">
                    <Donut
                      inline
                      total={h.feedback.responses}
                      idle={h.feedback.satisfactionPct === null ? { value: String(h.feedback.responses), label: "answers" } : { value: `${h.feedback.satisfactionPct}%`, label: "satisfied" }}
                      slices={[
                        { id: "satisfied", name: "Satisfied", value: h.feedback.satisfied, color: COLORS.green },
                        { id: "okay", name: "Okay", value: h.feedback.okay, color: COLORS.amber },
                        { id: "not", name: "Not satisfied", value: h.feedback.notSatisfied, color: COLORS.red },
                      ].filter((x) => x.value > 0)}
                    />

                    <ul className="w-56 space-y-3">
                      {[
                        { label: "Satisfied", n: h.feedback.satisfied, color: COLORS.green },
                        { label: "Okay", n: h.feedback.okay, color: COLORS.amber },
                        { label: "Not satisfied", n: h.feedback.notSatisfied, color: COLORS.red },
                      ].map((x) => (
                        <li key={x.label} className="flex items-center gap-3 text-sm">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: x.color }} />
                          <span className="flex-1 text-ink">{x.label}</span>
                          <span className="font-semibold tabular-nums text-ink">{x.n}</span>
                          <span className="w-10 text-right tabular-nums text-muted">{Math.round((x.n / h.feedback.responses) * 100)}%</span>
                        </li>
                      ))}
                      {h.feedback.satisfactionPct === null && <li className="pt-1 text-xs text-muted">A percentage appears once at least 5 students have answered.</li>}
                    </ul>
                      </div>
                    </div>

                    {data.feedbackTerms.length > 0 && (
                      <div className="-mt-2 min-w-[16rem] flex-1 border-line/70 lg:border-l lg:pl-10">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted">Most repeated phrases</p>
                        <div className="mt-4">
                          <BarList
                            rows={data.feedbackTerms.slice(0, 4).map((p) => ({ key: p.term, label: p.term, value: p.count }))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Section>

              {data.breakdown && data.breakdown.length > 1 && !showShares && (
                <Breakdown title={data.view === "admin" && !categoryId ? "By category" : "By POC"} rows={data.breakdown} />
              )}
              {data.members && <Breakdown title="Your team" rows={data.members.map((m) => ({ id: m.userId, name: m.name, level: m.level, headline: m.headline }))} />}
            </>
          )}

          {/* What is being raised: Overall and the admin view */}
          {showTopics && (
            <>
              {!manyCategories && data.categories[0] && (
                <div className={`${cardShell} flex flex-wrap items-center gap-4 p-4 sm:p-5`}>
                  <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${ACCENT.blue}`}>
                    <Icon name="tickets" className="h-6 w-6" />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-muted">Tickets raised in {data.categories[0].name}</p>
                    <p className="text-3xl font-bold leading-9 tracking-tight text-ink">{data.categories[0].count}</p>
                  </div>
                </div>
              )}

              <Row>
                {manyCategories && (
                  <Section title="Most repeated categories" hint="vs the previous period of the same length" basis={380}>
                    <ColumnChart items={data.categories.slice(0, 8).map((c) => ({ id: c.id, name: c.name, value: c.count, previous: c.previous, color: categoryColor(c.name) }))} />
                  </Section>
                )}
                <Section title="Most repeated sub-categories" hint="vs the previous period of the same length" basis={380}>
                  <BarList
                    rows={data.subCategories.slice(0, 8).map((s) => ({
                      key: s.id,
                      label: s.name,
                      value: s.count,
                      trend: s.count - s.previous,
                      sub: manyCategories ? s.category : undefined,
                    }))}
                  />
                </Section>
                <Section title={phrasesTitle} hint="from titles and descriptions" basis={380}>
                  <PhraseCloud items={phrases.slice(0, 14)} />
                </Section>
              </Row>
            </>
          )}

          {!onlyTopics && (
            <details className={`${cardShell} p-4 text-sm text-muted`}>
              <summary className="cursor-pointer font-medium text-ink">How these numbers are calculated</summary>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li><b>How long tickets took</b>: days from when the student raised the ticket until a POC marked it Solved or Closed, rounded up. Only finished tickets count.</li>
                <li><b>Action needed / total</b>: open tickets waiting on the POC, out of all tickets they were involved with in the period.</li>
                <li><b>Auto-escalated</b>: the POC did not solve it within {limit.long}, so the system moved the ticket up. &quot;From me&quot; means I held it; &quot;to me&quot; means I inherited it.</li>
                <li><b>Solved / Closed / Escalated</b>: outcomes the POC chose themselves in the period.</li>
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
    </LimitContext.Provider>
  );
}
