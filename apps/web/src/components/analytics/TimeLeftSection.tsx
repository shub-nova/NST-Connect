import type { AnalyticsData } from "@/lib/types";
import { StackedBar } from "./Bars";
import type { Limit } from "./format";
import { Section } from "./Primitives";
import { COLORS } from "./theme";

/** Open tickets by how much of their time limit is left. */
export function TimeLeftSection({ data, limit }: { data: AnalyticsData; limit: Limit }) {
  return (
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
  );
}
