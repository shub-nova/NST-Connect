import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pickLeastLoadedOwner } from './routing';
import {
  StudentTicketDetail,
  StudentTicketSummary,
  StudentTimelineEntry,
  displayName,
  teamLabel,
  timelineLabel,
  toStudentSummary,
} from './student-view';

export const TAT_HOURS = 48;

/**
 * A finished ticket can be reopened unless the highest level finished it: that level has the
 * last word, so its decision is final. (Today the top level is L2; the rule follows the
 * category's configured top level, so it keeps working if a level is added.)
 */
export function canReopen(status: TicketStatus, resolvedLevel: number | null, topLevel: number): boolean {
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

  listCategories() {
    return this.prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        shortName: true,
        subCategories: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          select: { id: true, name: true },
        },
      },
    });
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

    const ticketId = await this.prisma.$transaction(async (tx) => {
      // Normally level 1. If nobody is on duty there (everyone on leave), the ticket starts at the next
      // level that has someone, so it never sits without an owner.
      let owner = null;
      let startLevel = 1;
      for (; startLevel <= category.maxLevel && !owner; startLevel++) owner = await pickLeastLoadedOwner(tx, category.id, startLevel);
      startLevel -= 1;
      if (!owner) startLevel = 1;
      const now = new Date();

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
          tatDeadline: owner ? new Date(now.getTime() + TAT_HOURS * 60 * 60 * 1000) : null,
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
   * duty there), the student's comment becomes part of the conversation, and the 48-hour clock
   * restarts. All of it happens in one transaction, and the ticket row is locked so two
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
      for (let level = t.resolvedLevel ?? 1; level <= t.category.maxLevel && !owner; level++) {
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
          tatDeadline: new Date(Date.now() + TAT_HOURS * 60 * 60 * 1000),
          tatWarnedAt: null,
          critical: false,
          resolvedAt: null,
          resolvedLevel: null,
        },
      });
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

    const team = displayName(t.category);
    const timeline: StudentTimelineEntry[] = [
      // A COMMENTED event only marks that a reply happened; the reply itself comes from comments.
      ...t.events
        .filter((e) => e.type !== 'COMMENTED')
        .map((e) => ({
          type: e.type,
          label: timelineLabel(e.type, team, e.toStatus),
          // Solved and Closed carry a note for the student. An escalation's reason stays internal.
          message: e.type === 'RESOLVED' || e.type === 'CLOSED' ? e.note : null,
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
      timeline,
      attachments: t.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        mimeType: a.mimeType,
        sizeBytes: Number(a.sizeBytes),
      })),
    };
  }
}
