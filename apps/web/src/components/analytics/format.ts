import { createContext } from "react";

// Formatting, the escalation limit in words, and the date helpers.

/** The escalation limit the admin has set, in words: "2 days" (and "2-day" before a noun). */
export type Limit = { long: string; adj: string };
export const DEFAULT_LIMIT: Limit = { long: "2 days", adj: "2-day" };
export const describeLimit = (hours: number): Limit =>
  hours % 24 === 0 ? { long: `${hours / 24} day${hours === 24 ? "" : "s"}`, adj: `${hours / 24}-day` } : { long: `${hours} hours`, adj: `${hours}-hour` };
export const LimitContext = createContext(DEFAULT_LIMIT);

export const fmtPct = (p: number | null) => (p === null ? "—" : `${p}%`);

export const DAY = 86_400_000;
export const isoDay = (offsetDays: number) => new Date(Date.now() - offsetDays * DAY).toISOString().slice(0, 10);

export const PRESETS = [
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "custom", label: "Custom" },
] as const;

export function tickLabel(day: string, bucket: "day" | "week") {
  const d = new Date(`${day}T00:00:00Z`);
  const text = d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return bucket === "week" ? `Wk ${text}` : text;
}
