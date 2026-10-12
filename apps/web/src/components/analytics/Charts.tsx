import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsData } from "@/lib/types";
import { Legend } from "./Bars";
import { type Limit, tickLabel } from "./format";
import { Empty, Section } from "./Primitives";
import { COLORS } from "./theme";

// Charts drawn with Recharts.

export const tooltipStyle = { borderRadius: 12, border: "1px solid #e5e7eb", boxShadow: "0 8px 24px -8px rgba(16,24,40,0.18)", fontSize: 12, padding: "8px 12px" };
export const axisTick = { fontSize: 11, fill: COLORS.muted };

export function Gradients() {
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

/** Vertical columns, one colour per category, with the count on top. Grows to fill its card. */
export function ColumnChart({ items }: { items: { id: string; name: string; value: number; previous: number; color: string }[] }) {
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

/** Manual and automatic escalations over time. */
export function EscalationsSection({ data, limit }: { data: AnalyticsData; limit: Limit }) {
  return (
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
  );
}

/** How many tickets took how many days to finish. */
export function FinishTimesSection({ data }: { data: AnalyticsData }) {
  return (
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
  );
}
