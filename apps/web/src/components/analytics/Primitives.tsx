import { ArrowDownLeft, ArrowUpRight, Check, Clock, Inbox, RotateCcw, Smile, Target, Ticket, X, Zap } from "lucide-react";
import { Children } from "react";
import { ACCENT, type Accent, cardShell } from "./theme";

// The small building blocks every section is made of: icons, stat cards, section cards and empty states.

export const ICONS = {
  inbox: Inbox,
  clock: Clock,
  check: Check,
  x: X,
  up: ArrowUpRight,
  down: ArrowDownLeft,
  bolt: Zap,
  rotate: RotateCcw,
  target: Target,
  tickets: Ticket,
  smile: Smile,
} as const;

export function Icon({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof ICONS; className?: string }) {
  const Glyph = ICONS[name];
  return <Glyph className={className} strokeWidth={2} aria-hidden="true" />;
}

/** Stat cards grow to fill each row, so there are never gaps however many there are. */
export function Kpi({ label, value, icon, accent, bad }: { label: string; value: string; icon: keyof typeof ICONS; accent: Accent; bad?: boolean }) {
  return (
    <div className={`${cardShell} flex min-w-0 flex-col justify-center p-4 sm:p-5`}>
      <div className="flex items-center gap-4">
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${ACCENT[bad ? "red" : accent]}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-medium leading-4 text-muted">{label}</p>
          <p className={`mt-1 text-[28px] font-semibold leading-8 tracking-tight ${bad ? "text-red-600" : "text-slate-700"}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * The stat cards, four to a row. When the count is not a multiple of four, the last row stretches to fill the
 * width, so a row is never left with one small card or an empty gap.
 */
export function KpiGrid({ children }: { children: React.ReactNode }) {
  const n = Children.toArray(children).length;
  const layout =
    n % 4 === 0
      ? "grid grid-cols-2 lg:grid-cols-4"
      : "flex flex-wrap [&>*]:grow [&>*]:basis-[calc(50%-0.5rem)] sm:[&>*]:basis-[210px] lg:[&>*]:basis-[calc(25%-1rem)]";
  // On a phone (two columns) an odd last card spans the row instead of sitting half empty.
  return <div className={`${layout} gap-4 sm:gap-5 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2`}>{children}</div>;
}

/** A card that grows to share its row with its neighbours. */
export function Section({ title, hint, children, basis = 420 }: { title: string; hint?: string; children: React.ReactNode; basis?: number }) {
  return (
    <section className={`${cardShell} flex flex-col p-4 sm:p-5`} style={{ flex: `1 1 ${basis}px` }}>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-4 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

export const Row = ({ children }: { children: React.ReactNode }) => <div className="flex flex-wrap gap-4 sm:gap-5">{children}</div>;
export const Empty = ({ text = "Nothing in this period." }: { text?: string }) => <p className="py-8 text-center text-sm text-muted">{text}</p>;
