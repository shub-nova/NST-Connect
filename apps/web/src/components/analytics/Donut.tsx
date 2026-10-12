import { useContext, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import type { AnalyticsBreakdownRow, AnalyticsHeadline } from "@/lib/types";
import { RateLollipop } from "./Bars";
import { LimitContext } from "./format";
import { Empty, Row, Section } from "./Primitives";
import { COLORS, SHARE_PALETTE } from "./theme";

const SHARE_METRICS: { key: string; title: string; pick: (h: AnalyticsHeadline) => number }[] = [
  { key: "auto", title: "Auto-escalated", pick: (h) => h.autoEscalatedFrom },
  { key: "solved", title: "Solved", pick: (h) => h.solved },
  { key: "closed", title: "Closed", pick: (h) => h.closed },
  { key: "manual", title: "Escalated by a POC", pick: (h) => h.escalated },
];

export interface Slice {
  id: string;
  name: string;
  value: number;
  color: string;
}

/** A donut that shows the hovered slice in its centre, so nothing floats over the chart. */
export function Donut({ slices, total, idle, inline }: { slices: Slice[]; total: number; /** Centre text when nothing is hovered (defaults to the total). */ idle?: { value: string; label: string }; /** Fixed size, for sitting beside other content. */ inline?: boolean }) {
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
export function ShareDonuts({ rows, final }: { rows: AnalyticsBreakdownRow[]; final: boolean }) {
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
