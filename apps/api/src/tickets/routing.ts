import type { Prisma } from '../generated/prisma/client';

/**
 * The POC who should receive a ticket at a given level of a category: the least-loaded
 * active POC who is not on leave. Null when nobody is on duty at that level.
 * Used when a ticket is created (level 1) and when it is escalated (the next level).
 */
export async function pickLeastLoadedOwner(tx: Prisma.TransactionClient, categoryId: string, level: number) {
  const pool = await tx.pOCAssignment.findMany({
    where: { categoryId, level, active: true, onLeave: false },
  });
  if (!pool.length) return null;

  const loads = await tx.ticket.groupBy({
    by: ['assignedPocId'],
    where: {
      assignedPocId: { in: pool.map((p) => p.userId) },
      status: { notIn: ['RESOLVED', 'CLOSED'] },
    },
    _count: { _all: true },
  });
  const load = new Map(loads.map((l) => [l.assignedPocId, l._count._all]));
  return pool.sort((a, b) => (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0))[0];
}
