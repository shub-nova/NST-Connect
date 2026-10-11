import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TicketStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickLeastLoadedOwner } from '../tickets/routing';
import { deadlineAfter, getTatHours } from '../settings/tat';

export interface EscalationRunResult {
  /** Tickets moved up a level because the assigned POC did nothing within the time limit. */
  escalated: number;
  /** Tickets with nowhere higher to go: flagged critical instead. */
  flaggedCritical: number;
  /** "Time is almost up" warnings sent to assigned POCs. */
  warned: number;
}

const OPEN: TicketStatus[] = ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED'];
/** Safety cap so one run can never loop forever. The next run picks up the rest. */
const MAX_TICKETS_PER_RUN = 500;

/**
 * Automatic escalation. Every POC action (reply, mark in progress, solve, close, escalate)
 * restarts the ticket's clock, so a ticket whose deadline has passed is exactly one where
 * its assigned POC did nothing within the limit (48 hours unless the admin changed it). This job moves such tickets up one level (to the
 * next level that has someone on duty), logs the miss against the POC who ignored it, and
 * warns the POC beforehand.
 *
 * It is safe to run at any time and from several processes at once:
 *  - each ticket is claimed with FOR UPDATE SKIP LOCKED, so two runs never take the same one;
 *  - after a ticket is handled its deadline is in the future (or cleared), so a second run
 *    finds nothing to do.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name);
  private readonly warningHours: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.warningHours = config.getOrThrow<number>('TAT_WARNING_HOURS');
  }

  async runOnce(now: Date = new Date()): Promise<EscalationRunResult> {
    const result: EscalationRunResult = { escalated: 0, flaggedCritical: 0, warned: 0 };

    // Leave with a return date ends by itself.
    await this.prisma.pOCAssignment.updateMany({ where: { onLeave: true, onLeaveUntil: { lte: now } }, data: { onLeave: false, onLeaveUntil: null } });

    result.warned = await this.sendWarnings(now);

    for (let i = 0; i < MAX_TICKETS_PER_RUN; i++) {
      const outcome = await this.handleNextOverdue(now);
      if (outcome === 'none') break;
      if (outcome === 'escalated') result.escalated++;
      else result.flaggedCritical++;
    }

    await this.prisma.jobHeartbeat.upsert({
      where: { jobName: 'escalation' },
      update: { lastRunAt: new Date() },
      create: { jobName: 'escalation', lastRunAt: new Date() },
    });

    if (result.escalated || result.flaggedCritical || result.warned) {
      this.logger.log(
        `Escalation run: ${result.escalated} escalated, ${result.flaggedCritical} flagged critical, ${result.warned} warned`,
      );
    }
    return result;
  }

  /** Tell POCs their ticket is about to escalate. Once per deadline. */
  private async sendWarnings(now: Date): Promise<number> {
    const soon = new Date(now.getTime() + this.warningHours * 60 * 60 * 1000);
    // One atomic statement claims the tickets and returns them, so two runs cannot both warn.
    const claimed = await this.prisma.$queryRaw<{ id: string; assigned_poc_id: string }[]>`
      UPDATE ticket
         SET tat_warned_at = ${now}
       WHERE status IN ('ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED')
         AND assigned_poc_id IS NOT NULL
         AND tat_deadline IS NOT NULL
         AND tat_deadline > ${now}
         AND tat_deadline <= ${soon}
         AND tat_warned_at IS NULL
      RETURNING id, assigned_poc_id`;
    if (!claimed.length) return 0;

    await this.prisma.notification.createMany({
      data: claimed.map((t) => ({ userId: t.assigned_poc_id, type: 'TAT_WARNING' as const, ticketId: t.id })),
    });
    return claimed.length;
  }

  /** Claim one overdue ticket and either escalate it or, at the top, flag it critical. */
  private async handleNextOverdue(now: Date): Promise<'escalated' | 'critical' | 'none'> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM ticket
         WHERE status IN ('ASSIGNED', 'IN_PROGRESS', 'ESCALATED', 'REOPENED')
           AND tat_deadline IS NOT NULL
           AND tat_deadline <= ${now}
         ORDER BY tat_deadline
         LIMIT 1
           FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return 'none';

      const t = await tx.ticket.findUniqueOrThrow({ where: { id: rows[0].id }, include: { category: true } });
      if (!OPEN.includes(t.status)) return 'none'; // cannot happen under the lock; defensive

      // Next level up that actually has someone on duty. Empty levels are skipped.
      let owner = null;
      for (let level = t.currentLevel + 1; level <= t.category.maxLevel && !owner; level++) {
        owner = await pickLeastLoadedOwner(tx, t.categoryId, level);
      }

      // The POC held responsible for the missed deadline. Internal: students never see this.
      await tx.ticketEvent.create({
        data: {
          ticketId: t.id,
          type: 'TAT_BREACHED',
          actorId: t.assignedPocId,
          fromLevel: t.currentLevel,
          visibility: 'INTERNAL',
        },
      });
      if (t.assignedPocId) {
        await tx.notification.create({ data: { userId: t.assignedPocId, type: 'TAT_MISSED', ticketId: t.id } });
      }

      if (owner) {
        await this.escalate(tx, t, owner, now);
        return 'escalated';
      }
      await this.flagCritical(tx, t.id);
      return 'critical';
    });
  }

  private async escalate(
    tx: Prisma.TransactionClient,
    t: { id: string; status: TicketStatus; studentId: string; currentLevel: number },
    owner: { userId: string; level: number },
    now: Date,
  ) {
    await tx.ticketEvent.create({
      data: {
        ticketId: t.id,
        type: 'ESCALATED',
        actorId: null, // done by the system, not by a person
        fromStatus: t.status,
        toStatus: 'ESCALATED',
        fromLevel: t.currentLevel,
        toLevel: owner.level,
        assigneeId: owner.userId,
        reason: 'TAT_BREACH',
      },
    });
    await tx.notification.createMany({
      data: [
        { userId: t.studentId, type: 'ESCALATION', ticketId: t.id },
        { userId: owner.userId, type: 'ESCALATION', ticketId: t.id },
      ],
    });
    await tx.ticket.update({
      where: { id: t.id },
      data: {
        status: 'ESCALATED',
        currentLevel: owner.level,
        assignedPocId: owner.userId,
        tatDeadline: deadlineAfter(now, await getTatHours(tx)),
        tatWarnedAt: null,
      },
    });
  }

  /**
   * Nowhere higher to go. Flag it, tell the admins, and stop the clock so the next run does
   * not log the same miss again. When a POC acts, the clock restarts and the flag clears.
   */
  private async flagCritical(tx: Prisma.TransactionClient, ticketId: string) {
    const admins = await tx.user.findMany({ where: { role: 'SUPER_ADMIN' }, select: { id: true } });
    if (admins.length) {
      await tx.notification.createMany({ data: admins.map((a) => ({ userId: a.id, type: 'CRITICAL' as const, ticketId })) });
    }
    await tx.ticket.update({ where: { id: ticketId }, data: { critical: true, tatDeadline: null, tatWarnedAt: null } });
  }
}
