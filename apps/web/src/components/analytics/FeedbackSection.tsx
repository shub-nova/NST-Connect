import type { AnalyticsData, AnalyticsHeadline } from "@/lib/types";
import { BarList } from "./Bars";
import { Donut } from "./Donut";
import { Empty, Section } from "./Primitives";
import { COLORS } from "./theme";

/** Student satisfaction, and the phrases repeated most in their comments. */
export function FeedbackSection({ h, data }: { h: AnalyticsHeadline; data: AnalyticsData }) {
  return (
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
  );
}
