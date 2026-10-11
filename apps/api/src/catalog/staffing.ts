/**
 * A category only takes tickets once somebody is assigned at EVERY level (L1 up to its top level). Otherwise a
 * ticket could reach a level with nobody to act on it, and the promise of an answer within 48 hours at each
 * step would not hold.
 *
 * "Assigned" means an active assignment held by a person who can still log in. Being on leave does not count as
 * unassigned: tickets already move past someone on leave.
 */
export function missingLevels(maxLevel: number, staffedLevels: Iterable<number>): number[] {
  const staffed = new Set(staffedLevels);
  const missing: number[] = [];
  for (let level = 1; level <= maxLevel; level++) if (!staffed.has(level)) missing.push(level);
  return missing;
}

/** "L2 and L3", for messages. */
export function describeLevels(levels: number[]): string {
  const names = levels.map((l) => `L${l}`);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The assignments that count towards a category being staffed (use inside a Prisma `pocAssignments` select). */
export const STAFFING_WHERE = { active: true, user: { deactivatedAt: null } } as const;
