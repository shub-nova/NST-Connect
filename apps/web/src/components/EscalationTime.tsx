"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { EscalationSetting } from "@/lib/types";
import { btnCls, cardCls, ErrorNote, timeAgo } from "./ui";

/** Common choices; the current value is always offered too, in case it was set some other way. */
const CHOICES = [1, 2, 3, 4, 5, 6, 7, 10, 14];
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** Super Admin only: how long a POC has to act on a ticket before it moves up a level. */
export default function EscalationTime() {
  const [setting, setSetting] = useState<EscalationSetting | null>(null);
  const [choice, setChoice] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [openedAt] = useState(() => Date.now()); // "how long ago" is judged from when the page was opened

  useEffect(() => {
    let cancelled = false;
    api<EscalationSetting>("/settings/escalation")
      .then((s) => {
        if (cancelled) return;
        setSetting(s);
        setChoice(s.days);
      })
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load the escalation time."));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = await api<EscalationSetting>("/settings/escalation", { method: "PUT", body: { days: choice } });
      setSetting(next);
      setChoice(next.days);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the escalation time.");
    } finally {
      setBusy(false);
    }
  }

  // The check should run at least hourly. If it has not for a few hours, the schedule needs attention.
  const lastRun = setting?.lastRunAt ?? null;
  const stale = !!setting && (!lastRun || openedAt - new Date(lastRun).getTime() > 3 * 3_600_000);
  const options = setting && !CHOICES.includes(setting.days) ? [...CHOICES, setting.days].sort((a, b) => a - b) : CHOICES;
  const changed = !!setting && choice !== setting.days;

  return (
    <section className={`${cardCls} p-4 sm:p-5`} aria-labelledby="escalation-title">
      <h2 id="escalation-title" className="text-[15px] font-semibold text-ink">
        Escalation time
      </h2>
      <p className="mt-1 text-sm text-muted">
        A POC has this long to solve a ticket. If it is not solved in time, it moves up to the next level, and replies do not restart the clock. It applies from now on: tickets already open keep their current deadline.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <label className="sr-only" htmlFor="escalation-days">
          Days before a ticket escalates
        </label>
        <select
          id="escalation-days"
          value={choice}
          disabled={!setting || busy}
          onChange={(e) => {
            setChoice(Number(e.target.value));
            setSaved(false);
          }}
          className="rounded-lg border border-line bg-white px-3.5 py-2 text-[15px] text-ink outline-none focus:border-brand focus:ring-4 focus:ring-brand-soft disabled:opacity-60"
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {days(n)}
            </option>
          ))}
        </select>
        <button onClick={save} disabled={!changed || busy} className={`${btnCls} !py-2 !text-sm`}>
          {busy ? "Saving…" : "Save"}
        </button>
        {saved && (
          <span role="status" className="text-sm font-medium text-emerald-600">
            Saved. New tickets now escalate after {days(setting?.days ?? choice)}.
          </span>
        )}
      </div>
      {setting && (
        <p className={`mt-3 text-sm ${stale ? "font-medium text-red-600" : "text-muted"}`} role={stale ? "alert" : undefined}>
          {lastRun
            ? `Last escalation check ran ${timeAgo(lastRun)}.${stale ? " That is late: tickets are not being escalated on time. Check the schedule." : ""}`
            : "The escalation check has not run yet. Set up the schedule so tickets can escalate."}
        </p>
      )}
      <div className="mt-3">
        <ErrorNote message={error} />
      </div>
    </section>
  );
}
