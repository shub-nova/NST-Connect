import type { AnalyticsHeadline } from "@/lib/types";
import { type Limit, fmtPct } from "./format";
import { Kpi, KpiGrid } from "./Primitives";

/** The row of stat cards. What is shown depends on the person's level: L1 is first, L3 is final. */
export function SummaryCards({
  h,
  isMe,
  firstLevel,
  finalLevel,
  showWithinLimit,
  limit,
}: {
  h: AnalyticsHeadline;
  isMe: boolean;
  firstLevel: boolean;
  finalLevel: boolean;
  showWithinLimit: boolean;
  limit: Limit;
}) {
  return (
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
  );
}
