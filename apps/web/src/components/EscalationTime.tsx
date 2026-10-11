"use client";

import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api";
import type { EscalationSetting } from "@/lib/types";
import { btnCls, cardCls, ErrorNote } from "./ui";

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

  const options = setting && !CHOICES.includes(setting.days) ? [...CHOICES, setting.days].sort((a, b) => a - b) : CHOICES;
  const changed = !!setting && choice !== setting.days;

  return (
    <section className={`${cardCls} p-4 sm:p-5`} aria-labelledby="escalation-title">
      <h2 id="escalation-title" className="text-[15px] font-semibold text-ink">
        Escalation time
      </h2>
      <p className="mt-1 text-sm text-muted">
        If a POC does nothing for this long, the ticket moves up to the next level. It applies from now on: tickets already open keep their current deadline until their next action.
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
      <div className="mt-3">
        <ErrorNote message={error} />
      </div>
    </section>
  );
}
