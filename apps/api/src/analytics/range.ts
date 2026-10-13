import { BadRequestException } from '@nestjs/common';

const DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

export interface DateRange {
  from: Date;
  /** Exclusive upper bound. */
  to: Date;
  /** Same length, immediately before `from`: used for "vs previous period". */
  prevFrom: Date;
  days: number;
  /** Charts use daily points for short ranges and weekly points for long ones. */
  bucket: 'day' | 'week';
}

/** A calendar day (YYYY-MM-DD) as a UTC date, or null when the day does not exist (30 February would otherwise roll into March). */
function parseDay(value: string): Date | null {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/**
 * `from` and `to` are calendar days (YYYY-MM-DD, inclusive). Defaults to the last 30 days.
 * Days are interpreted in UTC; the dashboards only need day-level precision.
 */
export function resolveRange(fromStr: string | undefined, toStr: string | undefined, now = new Date()): DateRange {
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const toDay = toStr ? parseDay(toStr) : startOfToday;
  const fromDay = fromStr ? parseDay(fromStr) : null;
  if (!toDay || (fromStr && !fromDay)) throw new BadRequestException('Dates must be real days, like 2026-10-31.');
  const toExclusive = new Date(toDay.getTime() + DAY);
  const from = fromDay ?? new Date(toExclusive.getTime() - 30 * DAY);
  const days = Math.round((toExclusive.getTime() - from.getTime()) / DAY);
  if (days < 1) throw new BadRequestException('"from" must be on or before "to".');
  if (days > MAX_RANGE_DAYS) throw new BadRequestException(`Choose a range of at most ${MAX_RANGE_DAYS} days.`);
  return {
    from,
    to: toExclusive,
    prevFrom: new Date(from.getTime() - days * DAY),
    days,
    bucket: days > 45 ? 'week' : 'day',
  };
}
