import type { Prisma } from '../generated/prisma/client';
import { pickLeastLoadedOwner } from '../tickets/routing';
import { deadlineAfter, getTatHours } from '../settings/tat';

export interface HandoffResult {
  /** Moved to another POC at the same level. */
  reassigned: number;
  /** Nobody else at the level, so moved up a level. */
  escalated: number;
  /** Nobody on duty anywhere above either: left where it is, and the admins were told. */
  stranded: number;
}

/**
 * Moves a POC's open tickets to someone else because they went on leave or were removed.
 *  1. Another on-duty POC at the same level (least loaded first, balanced one ticket at a time).
 *  2. Otherwise the next level up that has someone on duty.
 *  3. Otherwise the ticket stays and the admins are notified.
 * Call this AFTER the assignment has been marked on leave or inactive, so the person being
 * replaced is no longer in the pool. Runs inside the caller's transaction.
 */
export async function handOffOpenTickets(
  tx: Prisma.TransactionClient,
  from: { userId: string; categoryId: string; level: number },
  actorId: string,
  reason: string,
  now = new Date(),
): Promise<HandoffResult> {
  const result: HandoffResult = { reassigned: 0, escalated: 0, stranded: 0 };
  const category = await tx.category.findUniqueOrThrow({ where: { id: from.categoryId }, select: { maxLevel: true } });

  // Lock the tickets so a POC action cannot slip in between.
  const open = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM ticket
     WHERE assigned_poc_id = ${from.userId}::uuid AND category_id = ${from.categoryId}::uuid
       AND current_level = ${from.level} AND status NOT IN ('RESOLVED', 'CLOSED')
     ORDER BY created_at ASC
     FOR UPDATE`;
  if (!open.length) return result;

  const deadline = deadlineAfter(now, await getTatHours(tx));
  let admins: { id: string }[] | null = null;

  for (const { id } of open) {
    const t = await tx.ticket.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, studentId: true, currentLevel: true } });
    const fresh = { tatDeadline: deadline, tatWarnedAt: null, critical: false };

    const same = await pickLeastLoadedOwner(tx, from.categoryId, from.level);
    if (same && same.userId !== from.userId) {
      await tx.ticket.update({ where: { id }, data: { ...fresh, assignedPocId: same.userId } });
      // Internal: students never see that a ticket changed hands.
      await tx.ticketEvent.create({
        data: { ticketId: id, type: 'REASSIGNED', actorId, visibility: 'INTERNAL', fromLevel: from.level, toLevel: from.level, assigneeId: same.userId, note: reason },
      });
      await tx.notification.create({ data: { userId: same.userId, type: 'NEW_TICKET', ticketId: id } });
      result.reassigned++;
      continue;
    }

    let moved = false;
    for (let level = from.level + 1; level <= category.maxLevel && !moved; level++) {
      const owner = await pickLeastLoadedOwner(tx, from.categoryId, level);
      if (!owner) continue;
      await tx.ticket.update({ where: { id }, data: { ...fresh, assignedPocId: owner.userId, status: 'ESCALATED', currentLevel: level } });
      await tx.ticketEvent.create({
        data: { ticketId: id, type: 'ESCALATED', actorId: null, fromStatus: t.status, toStatus: 'ESCALATED', fromLevel: from.level, toLevel: level, assigneeId: owner.userId, reason: 'ON_LEAVE', note: reason },
      });
      await tx.notification.createMany({
        data: [
          { userId: t.studentId, type: 'ESCALATION', ticketId: id },
          { userId: owner.userId, type: 'ESCALATION', ticketId: id },
        ],
      });
      result.escalated++;
      moved = true;
    }
    if (moved) continue;

    result.stranded++;
    admins ??= await tx.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
    await tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, type: 'CRITICAL' as const, ticketId: id })) });
  }
  return result;
}
