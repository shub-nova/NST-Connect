import type { Limit } from "./format";
import { cardShell } from "./theme";

/** The "how these numbers are calculated" note under the dashboard. */
export function Methodology({ limit }: { limit: Limit }) {
  return (
            <details className={`${cardShell} p-4 text-sm text-muted`}>
              <summary className="cursor-pointer font-medium text-ink">How these numbers are calculated</summary>
              <ul className="mt-3 list-disc space-y-1.5 pl-5">
                <li><b>How long tickets took</b>: days from when the student raised the ticket until a POC marked it Solved or Closed, rounded up. Only finished tickets count.</li>
                <li><b>Action needed / total</b>: open tickets waiting on the POC, out of all tickets they were involved with in the period.</li>
                <li><b>Auto-escalated</b>: the POC did not solve it within {limit.long}, so the system moved the ticket up. &quot;From me&quot; means I held it; &quot;to me&quot; means I inherited it.</li>
                <li><b>Solved / Closed / Escalated</b>: outcomes the POC chose themselves in the period.</li>
              </ul>
            </details>
  );
}
