import { ConflictException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { pickLeastLoadedOwner } from '../tickets/routing';
import { EventType, Prisma, TicketStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deadlineAfter, getTatHours } from '../settings/tat';
import { StorageService } from '../storage/storage.service';
import { STATUS_LABELS } from '../tickets/student-view';
import {
  DEFAULT_PAGE_SIZE,
  decodeCursor,
  defaultSort,
  encodeCursor,
  scopeSql,
  sortSpec,
  statusSql,
  type QueueSort,
  type QueueView,
} from './queue-query';


/** A ticket in one of these is finished: no more replies or status changes. */
const FINISHED: TicketStatus[] = ['RESOLVED', 'CLOSED'];

/** Statuses from which a POC acknowledging or replying moves the ticket to IN_PROGRESS. */
const NEEDS_ACK: TicketStatus[] = ['ASSIGNED', 'ESCALATED', 'REOPENED'];

const POC_EVENT_LABELS: Partial<Record<EventType, string>> = {
  CREATED: 'Ticket created',
  ASSIGNED: 'Assigned to the team',
  ESCALATED: 'Escalated',
  TAT_BREACHED: 'Missed the time limit',
  NUDGED: 'Reminder sent',
  RESOLVED: 'Solved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
  REASSIGNED: 'Handed to another POC',
  CLOSED_BY_STUDENT: 'Closed by the student',
  RENAMED: 'Category or topic renamed',
};

export type CloseOutcome = 'SOLVED' | 'CLOSED' | 'ESCALATED';
export type BulkAction = CloseOutcome | 'REPLY';
/** The most tickets one bulk action may touch. */
export const MAX_BULK = 50;

export type ThreadItem =
  | { kind: 'comment'; id: string; body: string; visibility: string; author: { name: string; role: string }; at: Date }
  | { kind: 'event'; id: string; label: string; note: string | null; at: Date };

@Injectable()
export class PocService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** The category+level pairs this POC is on duty for. A POC only ever sees tickets in these. */
  private async pairs(pocId: string): Promise<{ categoryId: string; level: number }[]> {
    const assignments = await this.prisma.pOCAssignment.findMany({ where: { userId: pocId, active: true } });
    return assignments.map((a) => ({ categoryId: a.categoryId, level: a.level }));
  }

  private async scope(pocId: string): Promise<Prisma.TicketWhereInput[]> {
    return (await this.pairs(pocId)).map((p) => ({ categoryId: p.categoryId, currentLevel: p.level }));
  }

  /**
   * One page of the queue, sorted by the database and paged with a cursor. Also returns how many tickets
   * are open and done in total, so the POC always knows how much is waiting beyond what is on screen.
   */
  async queue(pocId: string, q: { view: QueueView; sort?: QueueSort; limit?: number; cursor?: string }) {
    const pairs = await this.pairs(pocId);
    const counts = await this.counts(pairs);
    // `assigned` is false for someone who signed up but has not been added to a category yet.
    if (!pairs.length) return { tickets: [], total: 0, counts, nextCursor: null as string | null, assigned: false };

    const view = q.view;
    const limit = q.limit ?? DEFAULT_PAGE_SIZE;
    const spec = sortSpec(view, q.sort ?? defaultSort(view));
    const after = q.cursor ? decodeCursor(q.cursor) : null;
    const afterSql = after
      ? Prisma.sql`AND (${spec.k1}, ${spec.k2}, t.id) ${spec.op} (${after.k1}::float8, ${after.k2}::float8, ${after.id}::uuid)`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<{ id: string; k1: number; k2: number }[]>`
      SELECT t.id, ${spec.k1} AS k1, ${spec.k2} AS k2
        FROM ticket t
       WHERE ${scopeSql(pairs)} AND ${statusSql(view)} ${afterSql}
       ORDER BY k1 ${spec.dir}, k2 ${spec.dir}, t.id ${spec.dir}
       LIMIT ${limit + 1}`;
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ k1: Number(last.k1), k2: Number(last.k2), id: last.id }) : null;

    const found = await this.prisma.ticket.findMany({
      where: { id: { in: page.map((r) => r.id) } },
      select: {
        id: true,
        title: true,
        status: true,
        closedByStudent: true,
        currentLevel: true,
        critical: true,
        tatDeadline: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { name: true, shortName: true } },
        subCategory: { select: { name: true } },
        student: { select: { name: true } },
      },
    });
    const byId = new Map(found.map((t) => [t.id, t]));
    const tickets = page.map((r) => byId.get(r.id)).filter((t): t is NonNullable<typeof t> => !!t);
    return { tickets, total: counts[view], counts, nextCursor, assigned: true };
  }

  /** How many tickets are open and done for this POC (shown on the tabs). */
  private async counts(pairs: { categoryId: string; level: number }[]) {
    if (!pairs.length) return { open: 0, done: 0 };
    const or = pairs.map((p) => ({ categoryId: p.categoryId, currentLevel: p.level }));
    const [open, done] = await Promise.all([
      this.prisma.ticket.count({ where: { status: { notIn: FINISHED }, OR: or } }),
      this.prisma.ticket.count({ where: { status: { in: FINISHED }, OR: or } }),
    ]);
    return { open, done };
  }

  /** Full ticket for a POC. Anything outside the POC's category and level is a plain 404. */
  async detail(pocId: string, ticketId: string) {
    const scope = await this.scope(pocId);
    const t = scope.length
      ? await this.prisma.ticket.findFirst({
          where: { id: ticketId, OR: scope },
          select: {
            id: true,
            title: true,
            description: true,
            status: true,
            currentLevel: true,
            critical: true,
            tatDeadline: true,
            createdAt: true,
            resolvedAt: true,
            category: { select: { id: true, name: true, shortName: true } },
            subCategory: { select: { id: true, name: true } },
            student: { select: { name: true, email: true, enrollmentId: true } },
            attachments: {
              where: { scanStatus: 'CLEAN' },
              orderBy: { createdAt: 'asc' },
              select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
            },
            events: {
              where: { type: { not: 'COMMENTED' } },
              orderBy: { createdAt: 'asc' },
              select: { id: true, type: true, note: true, toStatus: true, toLevel: true, reason: true, createdAt: true },
            },
            comments: {
              orderBy: { createdAt: 'asc' },
              select: { id: true, body: true, visibility: true, createdAt: true, author: { select: { name: true, role: true } } },
            },
          },
        })
      : null;
    if (!t) throw new NotFoundException('Ticket not found.');

    const thread: ThreadItem[] = [
      ...t.events.map((e): ThreadItem => ({
        kind: 'event',
        id: e.id,
        label:
          e.type === 'STATUS_CHANGED' && e.toStatus
            ? `Marked ${STATUS_LABELS[e.toStatus].toLowerCase()}`
            : e.type === 'ESCALATED' && e.toLevel
              ? `Escalated to level ${e.toLevel}${e.reason === 'TAT_BREACH' ? ': no action within the time limit' : e.reason === 'ON_LEAVE' ? ': owner on leave' : ''}`
              : (POC_EVENT_LABELS[e.type] ?? 'Updated'),
        note: e.type === 'RESOLVED' || e.type === 'CLOSED' || e.type === 'ESCALATED' || e.type === 'REASSIGNED' || e.type === 'RENAMED' ? e.note : null,
        at: e.createdAt,
      })),
      ...t.comments.map((c): ThreadItem => ({
        kind: 'comment',
        id: c.id,
        body: c.body,
        visibility: c.visibility,
        author: { name: c.author.name, role: c.author.role },
        at: c.createdAt,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      statusLabel: STATUS_LABELS[t.status],
      category: t.category,
      subCategory: t.subCategory,
      student: t.student,
      currentLevel: t.currentLevel,
      critical: t.critical,
      tatDeadline: t.tatDeadline,
      createdAt: t.createdAt,
      resolvedAt: t.resolvedAt,
      attachments: t.attachments.map((a) => ({ ...a, sizeBytes: Number(a.sizeBytes) })),
      thread,
    };
  }

  async attachmentUrl(pocId: string, attachmentId: string) {
    const scope = await this.scope(pocId);
    const a = scope.length
      ? await this.prisma.attachment.findFirst({
          where: { id: attachmentId, scanStatus: 'CLEAN', ticket: { OR: scope } },
        })
      : null;
    if (!a) throw new NotFoundException('Attachment not found.');
    return { url: await this.storage.presignDownload(a.storageKey, a.fileName), expiresInSeconds: 60 };
  }

  /** Reply to the student. The first reply on a fresh ticket also marks it in progress. */
  async comment(pocId: string, ticketId: string, body: string) {
    await this.reply(pocId, ticketId, body);
    return this.detail(pocId, ticketId);
  }

  /** The reply itself, without loading the ticket afterwards (the bulk action reuses this). */
  private async reply(pocId: string, ticketId: string, body: string) {
    await this.act(pocId, ticketId, async (tx, t) => {
      const comment = await tx.comment.create({
        data: { ticketId, authorId: pocId, body, visibility: 'PUBLIC' },
      });
      await tx.ticketEvent.create({ data: { ticketId, type: 'COMMENTED', actorId: pocId } });
      await tx.notification.create({
        data: { userId: t.studentId, type: 'COMMENT', ticketId, commentId: comment.id },
      });
      return NEEDS_ACK.includes(t.status) ? this.markInProgress(tx, t, pocId, false) : null;
    });
  }

  async setInProgress(pocId: string, ticketId: string) {
    await this.act(pocId, ticketId, async (tx, t) => {
      if (t.status === 'IN_PROGRESS') throw new ConflictException('Already in progress.');
      return this.markInProgress(tx, t, pocId, true);
    });
    return this.detail(pocId, ticketId);
  }

  /**
   * Finish working on a ticket. The POC must pick one outcome and give a note:
   *  - SOLVED: fixed. The student sees "Solved" and the note.
   *  - CLOSED: finished without a fix (invalid, duplicate, not possible). Student sees the note.
   *  - ESCALATED: pass it to the next level. The ticket stays open; this POC loses sight of it.
   *    The reason is for staff only: the student just sees that it was escalated.
   */
  async close(pocId: string, ticketId: string, outcome: CloseOutcome, note: string) {
    await this.applyOutcome(pocId, ticketId, outcome, note);
    // The POC no longer has access once the ticket moves up, so there is no detail to return.
    if (outcome === 'ESCALATED') return { escalated: true as const };
    return this.detail(pocId, ticketId);
  }

  /** One ticket, one outcome: the single place this logic lives, used by the ticket page and the bulk action. */
  private async applyOutcome(pocId: string, ticketId: string, outcome: CloseOutcome, note: string) {
    if (outcome === 'ESCALATED') {
      await this.act(pocId, ticketId, (tx, t) => this.escalate(tx, t, pocId, note));
      return;
    }

    await this.act(pocId, ticketId, async (tx, t) => {
      const solved = outcome === 'SOLVED';
      const status: TicketStatus = solved ? 'RESOLVED' : 'CLOSED';
      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: solved ? 'RESOLVED' : 'CLOSED',
          actorId: pocId,
          fromStatus: t.status,
          toStatus: status,
          fromLevel: t.currentLevel,
          toLevel: t.currentLevel,
          note,
        },
      });
      await tx.notification.create({ data: { userId: t.studentId, type: 'RESOLVED', ticketId } });
      return { status, resolvedAt: new Date(), resolvedLevel: t.currentLevel, tatDeadline: null };
    });
  }

  /**
   * Apply one action to many tickets (up to MAX_BULK). Each ticket goes through exactly the same rules
   * as when handled alone (scope, locking, history, notification to its own student, a fresh TAT where
   * it applies), in its own transaction. A ticket that cannot be changed (already finished, moved by
   * someone else, nobody on duty above) is reported back and does not stop the rest.
   */
  async bulk(pocId: string, input: { ticketIds: string[]; action: BulkAction; note: string }) {
    const ids = [...new Set(input.ticketIds)];
    const failed: { id: string; reason: string }[] = [];
    let done = 0;
    for (const id of ids) {
      try {
        if (input.action === 'REPLY') await this.reply(pocId, id, input.note);
        else await this.applyOutcome(pocId, id, input.action, input.note);
        done++;
      } catch (err) {
        failed.push({ id, reason: err instanceof HttpException ? err.message : 'Could not update this ticket.' });
      }
    }
    return { done, failed };
  }

  private async escalate(
    tx: Prisma.TransactionClient,
    t: { id: string; status: TicketStatus; studentId: string; currentLevel: number; categoryId: string },
    actorId: string,
    note: string,
  ): Promise<Prisma.TicketUncheckedUpdateInput> {
    const category = await tx.category.findUniqueOrThrow({ where: { id: t.categoryId } });
    const nextLevel = t.currentLevel + 1;
    if (nextLevel > category.maxLevel) throw new ConflictException('This ticket is already at the highest level.');

    const owner = await pickLeastLoadedOwner(tx, t.categoryId, nextLevel);
    if (!owner) throw new ConflictException('No one is on duty at the next level.');

    await tx.ticketEvent.create({
      data: {
        ticketId: t.id,
        type: 'ESCALATED',
        actorId,
        fromStatus: t.status,
        toStatus: 'ESCALATED',
        fromLevel: t.currentLevel,
        toLevel: nextLevel,
        assigneeId: owner.userId,
        reason: 'MANUAL',
        note,
      },
    });
    await tx.notification.createMany({
      data: [
        { userId: t.studentId, type: 'ESCALATION', ticketId: t.id },
        { userId: owner.userId, type: 'ESCALATION', ticketId: t.id },
      ],
    });
    return { status: 'ESCALATED', currentLevel: nextLevel, assignedPocId: owner.userId };
  }

  private async markInProgress(
    tx: Prisma.TransactionClient,
    t: { id: string; status: TicketStatus; studentId: string; currentLevel: number },
    pocId: string,
    notifyStudent: boolean,
  ): Promise<Prisma.TicketUncheckedUpdateInput> {
    await tx.ticketEvent.create({
      data: {
        ticketId: t.id,
        type: 'STATUS_CHANGED',
        actorId: pocId,
        fromStatus: t.status,
        toStatus: 'IN_PROGRESS',
        fromLevel: t.currentLevel,
        toLevel: t.currentLevel,
      },
    });
    if (notifyStudent) {
      await tx.notification.create({ data: { userId: t.studentId, type: 'STATUS_CHANGE', ticketId: t.id } });
    }
    return { status: 'IN_PROGRESS' };
  }

  /**
   * The one place a POC changes a ticket. In ONE transaction it: locks the ticket, checks
   * the POC may work on it, refuses resolved tickets, runs the action (which writes its
   * own events and notifications), then claims the ticket for this POC and restarts the
   * 48-hour clock. A concurrent second action waits for the lock instead of racing.
   */
  private async act(
    pocId: string,
    ticketId: string,
    action: (
      tx: Prisma.TransactionClient,
      ticket: { id: string; status: TicketStatus; studentId: string; currentLevel: number; categoryId: string },
    ) => Promise<Prisma.TicketUncheckedUpdateInput | null>,
  ) {
    const scope = await this.scope(pocId);
    if (!scope.length) throw new NotFoundException('Ticket not found.');

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ticket WHERE id = ${ticketId}::uuid FOR UPDATE`;
      const t = await tx.ticket.findFirst({
        where: { id: ticketId, OR: scope },
        select: { id: true, status: true, studentId: true, currentLevel: true, categoryId: true },
      });
      if (!t) throw new NotFoundException('Ticket not found.');
      if (FINISHED.includes(t.status)) throw new ConflictException('This ticket is already finished.');

      const changes = await action(tx, t);
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          assignedPocId: pocId,
          // Every POC action restarts the clock for the current level, using the limit the admin has set.
          tatDeadline: deadlineAfter(new Date(), await getTatHours(tx)),
          // A POC acting restarts the clock: the warning can be sent again, and a ticket that
          // was flagged critical because nobody acted is no longer ignored.
          tatWarnedAt: null,
          critical: false,
          ...changes,
        },
      });
    });
  }
}
