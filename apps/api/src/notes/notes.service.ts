import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

export interface SendNoteInput {
  body: string;
  categoryId?: string;
  level?: number;
  pocId?: string;
  context?: string;
}

/**
 * Notes from the Super Admin to POCs. The audience is fixed when the note is sent (one receipt per
 * recipient), so the admin can see exactly who has read it. Students never reach this code: every
 * endpoint is limited to POC or Super Admin by RolesGuard.
 */
@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async send(authorId: string, input: SendNoteInput) {
    const category = input.categoryId
      ? await this.prisma.category.findFirst({ where: { id: input.categoryId, active: true }, select: { shortName: true } })
      : null;
    if (input.categoryId && !category) throw new NotFoundException('Category not found.');

    const people = await this.prisma.pOCAssignment.findMany({
      where: {
        active: true,
        category: { active: true },
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
        ...(input.level ? { level: input.level } : {}),
        ...(input.pocId ? { userId: input.pocId } : {}),
      },
      select: { userId: true, user: { select: { name: true, email: true } } },
    });
    const recipients = [...new Map(people.map((p) => [p.userId, p.user])).entries()];
    if (!recipients.length) throw new BadRequestException('No POCs match this selection.');

    const audience = input.pocId
      ? recipients[0][1].name
      : [category?.shortName ?? 'All categories', input.level ? `L${input.level}` : 'all levels'].join(' · ');

    const note = await this.prisma.adminNote.create({
      data: {
        authorId,
        body: input.body,
        audience,
        context: input.context ?? '',
        receipts: { create: recipients.map(([userId]) => ({ userId })) },
      },
      select: { id: true },
    });

    // Email each recipient. A mail failure is logged by MailService and never fails the request.
    const link = `${this.config.getOrThrow<string>('WEB_URL')}/poc/analytics`;
    await Promise.all(
      recipients.map(([, user]) =>
        this.mail.send(
          user.email,
          `Note from the admin · ${audience}`,
          `The admin left you a note${input.context ? ` about: ${input.context}` : ''}.\n\n${input.body}\n\nSee it on your dashboard: ${link}`,
        ),
      ),
    );
    return { id: note.id, recipients: recipients.length, audience };
  }

  /** What the admin sent, with how many recipients have seen each note. */
  async sent() {
    const notes = await this.prisma.adminNote.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, body: true, audience: true, context: true, createdAt: true, receipts: { select: { seenAt: true } } },
    });
    return {
      notes: notes.map(({ receipts, ...n }) => ({ ...n, recipients: receipts.length, seen: receipts.filter((r) => r.seenAt).length })),
    };
  }

  /** A POC's own notes, newest first. Only their receipts are ever read. */
  async mine(userId: string) {
    const rows = await this.prisma.adminNoteReceipt.findMany({
      where: { userId },
      orderBy: { note: { createdAt: 'desc' } },
      take: 20,
      select: { seenAt: true, note: { select: { id: true, body: true, context: true, createdAt: true } } },
    });
    return { notes: rows.map((r) => ({ ...r.note, seen: r.seenAt !== null })) };
  }

  async markSeen(userId: string, noteId: string) {
    const result = await this.prisma.adminNoteReceipt.updateMany({ where: { noteId, userId, seenAt: null }, data: { seenAt: new Date() } });
    if (result.count === 0) {
      const exists = await this.prisma.adminNoteReceipt.findUnique({ where: { noteId_userId: { noteId, userId } }, select: { noteId: true } });
      if (!exists) throw new NotFoundException('Note not found.');
    }
    return { ok: true };
  }

  unreadCount(userId: string) {
    return this.prisma.adminNoteReceipt.count({ where: { userId, seenAt: null } });
  }
}
