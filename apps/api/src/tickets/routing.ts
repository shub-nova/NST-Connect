import type { Prisma } from '../generated/prisma/client';
import { FINISHED_STATUSES } from './ticket-status';

/**
 * The POC who should receive a ticket at a given level of a category: the least-loaded
 * active POC who is not on leave. Null when nobody is on duty at that level.
 * Used when a ticket is created (level 1) and when it is escalated (the next level).
 *
 * Someone who was added but has not created their account yet (no password) cannot see their queue, and having no
 * tickets they would always look "least loaded". So registered people come first, and an unregistered person is only
 * chosen when nobody registered is available at that level (a ticket must never be left without an owner).
 */
export async function pickLeastLoadedOwner(tx: Prisma.TransactionClient, categoryId: string, level: number) {
  const pool = await tx.pOCAssignment.findMany({
    where: { categoryId, level, active: true, onLeave: false, user: { deactivatedAt: null } },
    include: { user: { select: { passwordHash: true } } },
  });
  if (!pool.length) return null;

  const loads = await tx.ticket.groupBy({
    by: ['assignedPocId'],
    where: {
      assignedPocId: { in: pool.map((p) => p.userId) },
      status: { notIn: FINISHED_STATUSES },
    },
    _count: { _all: true },
  });
  const load = new Map(loads.map((l) => [l.assignedPocId, l._count._all]));
  const registered = (p: (typeof pool)[number]) => (p.user.passwordHash === null ? 1 : 0);
  return pool.sort((a, b) => registered(a) - registered(b) || (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0))[0];
}
