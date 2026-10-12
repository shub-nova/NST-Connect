// Colours and shared class names for the analytics dashboard.

export const COLORS = { brand: "#2f6df6", amber: "#f59e0b", red: "#ef4444", green: "#10b981", slate: "#94a3b8", grid: "#eef0f5", muted: "#6b7280" };

// ---- look and feel -------------------------------------------------------------------------

export const cardShell = "min-w-0 rounded-2xl border border-line/70 bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04),0_4px_16px_-8px_rgba(16,24,40,0.06)]";

export type Accent = "blue" | "amber" | "red" | "green" | "slate" | "violet";
export const ACCENT: Record<Accent, string> = {
  blue: "bg-brand-soft text-brand",
  amber: "bg-amber-50 text-amber-600",
  red: "bg-red-50 text-red-600",
  green: "bg-emerald-50 text-emerald-600",
  slate: "bg-slate-100 text-slate-600",
  violet: "bg-violet-50 text-violet-600",
};

// One colour per category, the same in every donut, so a category is easy to follow across charts.
export const SHARE_PALETTE = ["#2f6df6", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1", "#14b8a6"];

export const OUTCOME_COLORS = { solved: COLORS.green, closed: COLORS.slate, escalated: "#8b5cf6" };
