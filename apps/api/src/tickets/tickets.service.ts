import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { missingLevels, STAFFING_WHERE } from '../catalog/staffing';
import { deadlineAfter, getTatHours } from '../settings/tat';
import { Prisma, TicketStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickLeastLoadedOwner } from './routing';
import {
  StudentFeedback,
  StudentTicketDetail,
  StudentTicketSummary,
  StudentTimelineEntry,
  displayName,
  teamLabel,
  timelineLabel,
  toStudentSummary,
} from './student-view';

/** How long a student can change their feedback after giving it. */
const FEEDBACK_CHANGE_DAYS = 7;
const FINISH_EVENTS = ['RESOLVED', 'CLOSED'] as const;

/**
 * A finished ticket can be reopened unless the highest level finished it: that level has the
 * last word, so its decision is final. (Today the top level is L2; the rule follows the
 * category's configured top level, so it keeps working if a level is added.)
 */
function canReopen(status: TicketStatus, resolvedLevel: number | null, topLevel: number): boolean {
  return (status === 'RESOLVED' || status === 'CLOSED') && (resolvedLevel ?? 1) < topLevel;
}

export interface CreateTicketInput {
  title: string;
  description: string;
  /** The category is derived from this. */
  subCategoryId: string;
}

export interface ListTicketsInput {
  status?: TicketStatus;
  categoryId?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit: number;
}

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * What a student may raise a ticket about: live categories with at least one topic AND somebody assigned at every
   * level, so a new ticket always has a full chain to go through.
   */
  async listCategories() {
    const categories = await this.prisma.category.findMany({
      where: { active: true, subCategories: { some: { active: true } } },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        shortName: true,
        maxLevel: true,
        subCategories: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true },
        },
        pocAssignments: { where: STAFFING_WHERE, select: { level: true } },
      },
    });
    return categories
      .filter((c) => missingLevels(c.maxLevel, c.pocAssignments.map((a) => a.level)).length === 0)
      .map((c) => ({ id: c.id, name: c.name, shortName: c.shortName, subCategories: c.subCategories }));
  }

  /**
   * Create a ticket and route it to the category's L1 pool in ONE transaction, so a
   * ticket can never exist without its audit events.
   */
  async create(studentId: string, input: CreateTicketInput): Promise<StudentTicketDetail> {
    const subCategory = await this.prisma.subCategory.findFirst({
      where: { id: input.subCategoryId, active: true, category: { active: true } },
      include: { category: true },
    });
    if (!subCategory) throw new BadRequestException('Unknown topic.');
    const category = subCategory.category;
    // The picker already hides categories without a full team; this stops a direct request or a stale page.
    const staffed = await this.prisma.pOCAssignment.findMany({ where: { categoryId: category.id, ...STAFFING_WHERE }, select: { level: true } });
    if (missingLevels(category.maxLevel, staffed.map((a) => a.level)).length > 0) {
      throw new BadRequestException('This category is not taking tickets yet. Please try again later.');
    }

    const ticketId = await this.prisma.$transaction(async (tx) => {
      // Normally level 1. If nobody is on duty there (everyone on leave), the ticket starts at the next
      // level that has someone, so it never sits without an owner.
      let owner = null;
      let startLevel = 1;
      for (; startLevel <= category.maxLevel && !owner; startLevel++) owner = await pickLeastLoadedOwner(tx, category.id, startLevel);
      startLevel -= 1;
      if (!owner) startLevel = 1;
      const now = new Date();
      const tatHours = await getTatHours(tx);

      const ticket = await tx.ticket.create({
        data: {
          title: input.title,
          description: input.description,
          categoryId: category.id,
          subCategoryId: subCategory.id,
          studentId,
          // With nobody on duty at L1 the ticket stays CREATED until one is configured.
          status: owner ? 'ASSIGNED' : 'CREATED',
          currentLevel: startLevel,
          assignedPocId: owner?.userId ?? null,
          tatDeadline: owner ? deadlineAfter(now, tatHours) : null,
        },
      });

      await tx.ticketEvent.create({
        data: { ticketId: ticket.id, type: 'CREATED', actorId: studentId, toStatus: 'CREATED', toLevel: 1 },
      });
      if (owner) {
        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: 'ASSIGNED',
            fromStatus: 'CREATED',
            toStatus: 'ASSIGNED',
            toLevel: startLevel,
            assigneeId: owner.userId,
            note: startLevel > 1 ? 'Nobody on duty at level 1' : null,
          },
        });
        await tx.notification.create({
          data: { userId: owner.userId, type: 'NEW_TICKET', ticketId: ticket.id },
        });
      }
      return ticket.id;
    });

    return this.getOwnDetail(studentId, ticketId);
  }

  async listOwn(studentId: string, input: ListTicketsInput) {
    const where: Prisma.TicketWhereInput = {
      studentId,
      ...(input.status && { status: input.status }),
      ...(input.categoryId && { categoryId: input.categoryId }),
      ...((input.from || input.to) && {
        createdAt: { ...(input.from && { gte: input.from }), ...(input.to && { lte: input.to }) },
      }),
    };

    const rows = await this.prisma.ticket.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
      ...(input.cursor && { cursor: { id: input.cursor }, skip: 1 }),
      select: {
        id: true,
        title: true,
        status: true,
        closedByStudent: true,
        createdAt: true,
        updatedAt: true,
        category: { select: { id: true, name: true, shortName: true } },
        subCategory: { select: { id: true, name: true } },
      },
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const items: StudentTicketSummary[] = page.map(toStudentSummary);
    return { items, nextCursor: hasMore ? page[page.length - 1].id : null };
  }

  /**
   * The student is not satisfied with a Solved or Closed ticket: reopen the same ticket with
   * a comment. It goes back to the level that finished it (or the next level up if nobody is on
   * duty there), the student's comment becomes part of the conversation, and a fresh clock
   * starts. All of it happens in one transaction, and the ticket row is locked so two
   * simultaneous reopens cannot both succeed.
   */
  async reopen(studentId: string, ticketId: string, comment: string): Promise<StudentTicketDetail> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM ticket WHERE id = ${ticketId}::uuid FOR UPDATE`;
      const t = await tx.ticket.findFirst({
        where: { id: ticketId, studentId },
        include: { category: true },
      });
      if (!t) throw new NotFoundException('Ticket not found.');
      if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') {
        throw new ConflictException('Only a finished ticket can be reopened.');
      }
      if (!canReopen(t.status, t.resolvedLevel, t.category.maxLevel)) {
        throw new ConflictException('This outcome is final, so the ticket cannot be reopened.');
      }

      let owner = null;
      for (let level = t.closedByStudent ? t.currentLevel : (t.resolvedLevel ?? 1); level <= t.category.maxLevel && !owner; level++) {
        owner = await pickLeastLoadedOwner(tx, t.categoryId, level);
      }
      if (!owner) throw new ConflictException('This ticket cannot be reopened right now. Please try again later.');

      await tx.ticketEvent.create({
        data: {
          ticketId,
          type: 'REOPENED',
          actorId: studentId,
          fromStatus: t.status,
          toStatus: 'REOPENED',
          fromLevel: t.currentLevel,
          toLevel: owner.level,
          assigneeId: owner.userId,
        },
      });
      const message = await tx.comment.create({
        data: { ticketId, authorId: studentId, body: comment, visibility: 'PUBLIC' },
      });
      await tx.notification.create({ data: { userId: owner.userId, type: 'COMMENT', ticketId, commentId: message.id } });
      await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: 'REOPENED',
          currentLevel: owner.level,
          assignedPocId: owner.userId,
          tatDeadline: deadlineAfter(new Date(), await getTatHours(tx)),
          tatWarnedAt: null,
          critical: false,
          resolvedAt: null,
          resolvedLevel: null,
          closedByStudent: false,
        },
      });
    });
    return this.getOwnDetail(studentId, ticketId);
  }

  /**
   * The student closes their own ticket (they sorted it out, or no longer need it). It leaves the POC's
   * open queue, stops its clock, and is NOT a POC outcome: analytics never count it as Solved or Closed
   * and it gets no satisfaction question. The student can still reopen it.
   */
  async closeOwn(studentId: string, ticketId: string): Promise<StudentTicketDetail> {
    await this.prisma.$transaction(async (tx) => {
      // Lock the row so a POC acting at the same moment cannot interleave.
      await tx.$queryRaw`SELECT id FROM ticket WHERE id = ${ticketId}::uuid FOR UPDATE`;
      const t = await tx.ticket.findFirst({ where: { id: ticketId, studentId } });
      if (!t) throw new NotFoundException('Ticket not found.');
      if (t.status === 'RESOLVED' || t.status === 'CLOSED') throw new ConflictException('This ticket is already finished.');

      await tx.ticketEvent.create({
        data: { ticketId, type: 'CLOSED_BY_STUDENT', actorId: studentId, fromStatus: t.status, toStatus: 'CLOSED', fromLevel: t.currentLevel, toLevel: t.currentLevel },
      });
      await tx.ticket.update({
        where: { id: ticketId },
        data: { status: 'CLOSED', closedByStudent: true, tatDeadline: null, tatWarnedAt: null, critical: false },
      });
      // Let the POC who held it know it is gone from their queue.
      if (t.assignedPocId) await tx.notification.create({ data: { userId: t.assignedPocId, type: 'STATUS_CHANGE', ticketId } });
    });
    return this.getOwnDetail(studentId, ticketId);
  }

  /** Students can only ever read their own tickets; anything else is a plain 404. */
  async getOwnDetail(studentId: string, ticketId: string): Promise<StudentTicketDetail> {
    const t = await this.prisma.ticket.findFirst({
      where: { id: ticketId, studentId },
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        closedByStudent: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        resolvedLevel: true,
        category: { select: { id: true, name: true, shortName: true, maxLevel: true } },
        subCategory: { select: { id: true, name: true } },
        // INTERNAL events (nudges, "POC on leave" notes) are never selected for students.
        events: {
          where: { visibility: 'PUBLIC' },
          orderBy: { createdAt: 'asc' },
          select: { type: true, note: true, toStatus: true, createdAt: true },
        },
        // Replies shown to the student. The author's identity is never selected: replies
        // are labelled with the team, and INTERNAL comments are excluded entirely.
        comments: {
          where: { visibility: 'PUBLIC' },
          orderBy: { createdAt: 'asc' },
          // Only the author's ROLE is read, never their name: staff replies are labelled with
          // the team, and the student's own messages are labelled "You".
          select: { body: true, createdAt: true, author: { select: { role: true } } },
        },
        attachments: {
          where: { scanStatus: 'CLEAN' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
        },
      },
    });
    if (!t) throw new NotFoundException('Ticket not found.');

    // Feedback belongs to the latest Solved or Closed event, so a reopened ticket can be rated again.
    const finished = t.status === 'RESOLVED' || t.status === 'CLOSED';
    const finish = finished
      ? await this.prisma.ticketEvent.findFirst({
          where: { ticketId, type: { in: [...FINISH_EVENTS] } },
          orderBy: { createdAt: 'desc' },
          select: { feedback: { select: { rating: true, comment: true, createdAt: true } } },
        })
      : null;
    const feedback: StudentFeedback | null = finish?.feedback
      ? {
          rating: finish.feedback.rating,
          comment: finish.feedback.comment,
          canChange: Date.now() - finish.feedback.createdAt.getTime() <= FEEDBACK_CHANGE_DAYS * 86_400_000,
        }
      : null;

    const team = displayName(t.category);
    const timeline: StudentTimelineEntry[] = [
      // A COMMENTED event only marks that a reply happened; the reply itself comes from comments.
      ...t.events
        .filter((e) => e.type !== 'COMMENTED')
        .map((e) => ({
          type: e.type,
          label: timelineLabel(e.type, team, e.toStatus),
          // Solved and Closed carry a note for the student, and so does a rename ("The topic ... is now ...").
          // An escalation's reason stays internal.
          message: e.type === 'RESOLVED' || e.type === 'CLOSED' || e.type === 'RENAMED' ? e.note : null,
          at: e.createdAt,
        })),
      ...t.comments.map((c) => ({
        type: 'COMMENTED' as const,
        label: c.author.role === 'STUDENT' ? 'You' : `${teamLabel(team)} replied`,
        message: c.body,
        at: c.createdAt,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      ...toStudentSummary(t),
      description: t.description,
      resolvedAt: t.resolvedAt,
      canReopen: canReopen(t.status, t.resolvedLevel, t.category.maxLevel),
      // Feedback is about a POC's outcome, so a ticket the student closed themselves has none.
      canGiveFeedback: finish !== null,
      feedback,
      timeline,
      attachments: t.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: Number(a.sizeBytes),
      })),
    };
  }

  /**
   * The student's feedback on how a finished ticket went. One answer per finish (Solved or Closed); it
   * can be changed for a week. The POC who finished the ticket is remembered so analytics can credit
   * them, but that never leaves the server: staff see the rating and comment, never the student.
   */
  async giveFeedback(studentId: string, ticketId: string, input: { rating: 'SATISFIED' | 'OKAY' | 'NOT_SATISFIED'; comment?: string }): Promise<StudentFeedback> {
    const t = await this.prisma.ticket.findFirst({
      where: { id: ticketId, studentId },
      select: { id: true, status: true, categoryId: true, subCategoryId: true, resolvedLevel: true },
    });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status !== 'RESOLVED' && t.status !== 'CLOSED') {
      throw new ConflictException('You can share feedback once your ticket is Solved or Closed.');
    }

    const finish = await this.prisma.ticketEvent.findFirst({
      where: { ticketId, type: { in: [...FINISH_EVENTS] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, actorId: true, toLevel: true, feedback: { select: { id: true, createdAt: true } } },
    });
    if (!finish) throw new ConflictException('This ticket has not been finished yet.');
    if (finish.feedback && Date.now() - finish.feedback.createdAt.getTime() > FEEDBACK_CHANGE_DAYS * 86_400_000) {
      throw new ConflictException('Feedback can no longer be changed.');
    }

    const comment = input.comment?.trim() ? input.comment.trim() : null;
    const saved = await this.prisma.ticketFeedback.upsert({
      where: { finishEventId: finish.id },
      create: {
        ticketId,
        studentId,
        finishEventId: finish.id,
        rating: input.rating,
        comment,
        finishedById: finish.actorId,
        finishedLevel: finish.toLevel ?? t.resolvedLevel,
        categoryId: t.categoryId,
        subCategoryId: t.subCategoryId,
      },
      update: { rating: input.rating, comment },
      select: { rating: true, comment: true },
    });
    return { rating: saved.rating, comment: saved.comment, canChange: true };
  }
}
