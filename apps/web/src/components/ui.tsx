import Link from "next/link";
import { useEffect } from "react";
import type { TicketStatus } from "@/lib/types";

export const inputCls =
  "w-full rounded-lg border border-line bg-white px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted/70 outline-none transition focus:border-brand focus:ring-4 focus:ring-brand-soft disabled:opacity-60";

export const btnCls =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-[15px] font-semibold text-white transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60";

export const btnGhostCls =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-[15px] font-medium text-ink transition hover:bg-surface disabled:opacity-60";

export const cardCls = "rounded-xl border border-line bg-white";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
      {message}
    </p>
  );
}

const STATUS_STYLES: Record<TicketStatus, string> = {
  CREATED: "bg-gray-100 text-gray-700",
  ASSIGNED: "bg-brand-soft text-brand-dark",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  ESCALATED: "bg-orange-50 text-orange-700",
  RESOLVED: "bg-green-50 text-green-700",
  CLOSED: "bg-gray-100 text-gray-600",
  REOPENED: "bg-purple-50 text-purple-700",
};

export function StatusBadge({ status, label }: { status: TicketStatus; label: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}>
      {label}
    </span>
  );
}

const AVATAR_COLORS = ["bg-teal-500", "bg-indigo-500", "bg-rose-500", "bg-amber-700", "bg-sky-600", "bg-emerald-600"];

/** Coloured circle with initials, like the avatars across the Newton School product. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  const dims = size === "lg" ? "h-12 w-12 text-base" : size === "sm" ? "h-8 w-8 text-xs" : "h-10 w-10 text-sm";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${dims} ${AVATAR_COLORS[hash % AVATAR_COLORS.length]}`}>
      {initials || "?"}
    </span>
  );
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago", else the date. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** True when the given time has already passed. */
export function isPast(iso: string): boolean {
  return new Date(iso).getTime() < Date.now();
}

/** The words people see for each status ("Resolved" is shown as "Solved"). */
export const STATUS_TEXT: Record<TicketStatus, string> = {
  CREATED: "Created",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  ESCALATED: "Escalated",
  RESOLVED: "Solved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
};

/** A dropdown that matches the rest of the app: rounded pill, no browser arrows, our own chevron. */
export function PillSelect({ label, value, onChange, children, block }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode; block?: boolean }) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`cursor-pointer appearance-none rounded-full border border-line bg-white py-2 pl-4 pr-10 text-sm font-medium text-ink outline-none transition hover:border-brand focus:border-brand focus:ring-4 focus:ring-brand-soft ${block ? "w-full" : ""}`}
      >
        {children}
      </select>
      <svg viewBox="0 0 20 20" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 7.5l5 5 5-5" />
      </svg>
    </div>
  );
}

/** A centred dialog (a bottom sheet on phones). Closes on Esc and on a click outside. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/** A small segmented switch for choosing between a few options (better than a dropdown for two or three). */
export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-full bg-surface p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${value === o.value ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** "Back" link with a chevron icon instead of a text arrow. */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="-ml-1 inline-flex items-center text-sm font-medium text-brand hover:underline">
      <svg viewBox="0 0 20 20" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12.5 5l-5 5 5 5" />
      </svg>
      {children}
    </Link>
  );
}
