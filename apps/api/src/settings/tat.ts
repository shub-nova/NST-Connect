import type { Prisma } from '../generated/prisma/client';

/** How long a POC has to act before a ticket moves up a level, until the admin changes it. */
export const DEFAULT_TAT_HOURS = 48;
export const MIN_TAT_DAYS = 1;
export const MAX_TAT_DAYS = 14;
export const TAT_SETTING_KEY = 'escalation_hours';

/** Something that can read settings: the database client, or the client of a running transaction. */
type SettingReader = Pick<Prisma.TransactionClient, 'appSetting'>;

/**
 * The stored value turned into hours, or the default when nothing valid is stored. It is always a whole number
 * of days between the limits, so a bad row can never switch escalation off or make it absurd.
 */
export function parseTatHours(stored: string | null | undefined): number {
  const hours = Number(stored);
  if (!Number.isInteger(hours) || hours % 24 !== 0) return DEFAULT_TAT_HOURS;
  const days = hours / 24;
  return days >= MIN_TAT_DAYS && days <= MAX_TAT_DAYS ? hours : DEFAULT_TAT_HOURS;
}

/** The current limit in hours. Read inside the same transaction that sets a deadline, so they always agree. */
export async function getTatHours(db: SettingReader): Promise<number> {
  const row = await db.appSetting.findUnique({ where: { key: TAT_SETTING_KEY } });
  return parseTatHours(row?.value);
}

/** The deadline for a ticket whose clock starts at `from`. */
export const deadlineAfter = (from: Date, tatHours: number): Date => new Date(from.getTime() + tatHours * 60 * 60 * 1000);

/** "2 days" for whole days, otherwise "36 hours". */
export function describeTat(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24} day${hours === 24 ? '' : 's'}` : `${hours} hours`;
}
