import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FINISHED_STATUSES } from '../tickets/ticket-status';
import { missingLevels, STAFFING_WHERE } from './staffing';

/** The same name with different capitals or spaces counts as the same name. */
const tidy = (value: string) => value.trim().replace(/\s+/g, ' ');

/**
 * The categories students pick from, and the topics (sub-categories) inside each. Only the Super Admin
 * manages them.
 *
 * Nothing is ever deleted: tickets, staff assignments and analytics all point at categories and topics.
 * "Remove" hides one from new tickets (`active = false`) and "Restore" brings it back, so history keeps
 * its names and a mistake is never permanent.
 */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything, including removed items, with the counts the admin needs to decide what is safe to remove. */
  async list() {
    const [categories, open, staff] = await Promise.all([
      this.prisma.category.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          shortName: true,
          active: true,
          maxLevel: true,
          _count: { select: { tickets: true } },
          pocAssignments: { where: STAFFING_WHERE, select: { level: true } },
          subCategories: {
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            select: { id: true, name: true, active: true, _count: { select: { tickets: true } } },
          },
        },
      }),
      this.prisma.ticket.groupBy({ by: ['categoryId'], where: { status: { notIn: FINISHED_STATUSES } }, _count: { _all: true } }),
      this.prisma.pOCAssignment.groupBy({ by: ['categoryId'], where: { active: true }, _count: { _all: true } }),
    ]);
    const openBy = new Map(open.map((r) => [r.categoryId, r._count._all]));
    const staffBy = new Map(staff.map((r) => [r.categoryId, r._count._all]));

    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        active: c.active,
        tickets: c._count.tickets,
        openTickets: openBy.get(c.id) ?? 0,
        staff: staffBy.get(c.id) ?? 0,
        /** Levels (1, 2, 3) nobody holds yet. While any is missing, students are not offered this category. */
        missingLevels: missingLevels(c.maxLevel, c.pocAssignments.map((a) => a.level)),
        topics: c.subCategories.map((s) => ({ id: s.id, name: s.name, active: s.active, tickets: s._count.tickets })),
      })),
    };
  }

  // ---- categories -------------------------------------------------------------------------

  async createCategory(actorId: string, input: { name: string; shortName?: string; topics: string[] }) {
    const name = tidy(input.name);
    const shortName = tidy(input.shortName || name);
    const topics = this.uniqueTopics(input.topics);
    await this.assertCategoryNameFree(name);

    const created = await this.prisma.$transaction(async (tx) => {
      const last = await tx.category.aggregate({ _max: { sortOrder: true } });
      const category = await tx.category.create({
        data: {
          name,
          shortName,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          subCategories: { create: topics.map((topic, i) => ({ name: topic, sortOrder: i })) },
        },
      });
      await this.audit(tx, actorId, 'CATEGORY_ADDED', category.id, `Added category “${name}” with ${topics.length} topic${topics.length === 1 ? '' : 's'}`);
      return category;
    });
    return { id: created.id };
  }

  async updateCategory(actorId: string, id: string, input: { name?: string; shortName?: string }) {
    const category = await this.category(id);
    const name = input.name === undefined ? category.name : tidy(input.name);
    const shortName = input.shortName === undefined ? category.shortName : tidy(input.shortName);
    if (name === category.name && shortName === category.shortName) return { id, updated: 0 };
    if (name !== category.name) await this.assertCategoryNameFree(name, id);

    const [from, to] = name !== category.name ? [category.name, name] : [category.shortName || category.name, shortName || name];
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { name, shortName } });
      const summary =
        name !== category.name ? `Renamed category “${category.name}” to “${name}”` : `Changed the short name of “${category.name}” to “${shortName}”`;
      await this.audit(tx, actorId, 'CATEGORY_UPDATED', id, summary);
      return this.noteOnOpenTickets(tx, { categoryId: id }, `The category “${from}” is now “${to}”.`);
    });
    return { id, updated };
  }

  /** Hides the category from new tickets. Refused while it still has open tickets, so nobody is left waiting. */
  async removeCategory(actorId: string, id: string) {
    const category = await this.category(id);
    if (!category.active) return { id };
    const open = await this.prisma.ticket.count({ where: { categoryId: id, status: { notIn: FINISHED_STATUSES } } });
    if (open > 0) {
      throw new ConflictException(
        `“${category.name}” still has ${open} open ticket${open === 1 ? '' : 's'}. Remove it once they are solved or closed.`,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { active: false } });
      await this.audit(tx, actorId, 'CATEGORY_REMOVED', id, `Removed category “${category.name}”`);
    });
    return { id };
  }

  async restoreCategory(actorId: string, id: string) {
    const category = await this.category(id);
    if (category.active) return { id };
    await this.prisma.$transaction(async (tx) => {
      await tx.category.update({ where: { id }, data: { active: true } });
      await this.audit(tx, actorId, 'CATEGORY_RESTORED', id, `Restored category “${category.name}”`);
    });
    return { id };
  }

  // ---- topics (sub-categories) --------------------------------------------------------------

  async addTopic(actorId: string, categoryId: string, rawName: string) {
    const category = await this.category(categoryId);
    if (!category.active) throw new BadRequestException('Restore this category before adding topics to it.');
    const name = tidy(rawName);
    await this.assertTopicNameFree(categoryId, name);

    const topic = await this.prisma.$transaction(async (tx) => {
      const last = await tx.subCategory.aggregate({ where: { categoryId }, _max: { sortOrder: true } });
      const created = await tx.subCategory.create({ data: { categoryId, name, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
      await this.audit(tx, actorId, 'TOPIC_ADDED', categoryId, `Added topic “${name}” to ${category.shortName || category.name}`);
      return created;
    });
    return { id: topic.id };
  }

  async renameTopic(actorId: string, id: string, rawName: string) {
    const topic = await this.topic(id);
    const name = tidy(rawName);
    if (name === topic.name) return { id, updated: 0 };
    await this.assertTopicNameFree(topic.categoryId, name, id);
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.subCategory.update({ where: { id }, data: { name } });
      await this.audit(tx, actorId, 'TOPIC_UPDATED', topic.categoryId, `Renamed topic “${topic.name}” to “${name}”`);
      return this.noteOnOpenTickets(tx, { subCategoryId: id }, `The topic “${topic.name}” is now “${name}”.`);
    });
    return { id, updated };
  }

  /** Hides the topic from new tickets. Refused while tickets with it are still open. A live category always keeps one topic. */
  async removeTopic(actorId: string, id: string) {
    const topic = await this.topic(id);
    if (!topic.active) return { id };
    const open = await this.prisma.ticket.count({ where: { subCategoryId: id, status: { notIn: FINISHED_STATUSES } } });
    if (open > 0) {
      throw new ConflictException(
        `“${topic.name}” still has ${open} open ticket${open === 1 ? '' : 's'}. Remove it once they are solved or closed.`,
      );
    }
    if (topic.category.active) {
      const others = await this.prisma.subCategory.count({ where: { categoryId: topic.categoryId, active: true, id: { not: id } } });
      if (others === 0) {
        throw new BadRequestException('A category needs at least one topic. Add another first, or remove the whole category.');
      }
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.subCategory.update({ where: { id }, data: { active: false } });
      await this.audit(tx, actorId, 'TOPIC_REMOVED', topic.categoryId, `Removed topic “${topic.name}”`);
    });
    return { id };
  }

  async restoreTopic(actorId: string, id: string) {
    const topic = await this.topic(id);
    if (topic.active) return { id };
    await this.prisma.$transaction(async (tx) => {
      await tx.subCategory.update({ where: { id }, data: { active: true } });
      await this.audit(tx, actorId, 'TOPIC_RESTORED', topic.categoryId, `Restored topic “${topic.name}”`);
    });
    return { id };
  }

  // ---- helpers ------------------------------------------------------------------------------

  private async category(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  private async topic(id: string) {
    const topic = await this.prisma.subCategory.findUnique({ where: { id }, include: { category: { select: { active: true } } } });
    if (!topic) throw new NotFoundException('Topic not found.');
    return topic;
  }

  private async assertCategoryNameFree(name: string, exceptId?: string) {
    const clash = await this.prisma.category.findFirst({
      where: { name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { active: true },
    });
    if (clash) {
      throw new ConflictException(
        clash.active ? 'A category with that name already exists.' : 'A removed category has that name. Restore it instead of adding it again.',
      );
    }
  }

  private async assertTopicNameFree(categoryId: string, name: string, exceptId?: string) {
    const clash = await this.prisma.subCategory.findFirst({
      where: { categoryId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { active: true },
    });
    if (clash) {
      throw new ConflictException(
        clash.active ? 'This category already has a topic with that name.' : 'A removed topic has that name. Restore it instead of adding it again.',
      );
    }
  }

  /**
   * Adds a public "renamed" entry to the timeline of every ticket that is still open and matches `where`, so the
   * student sees on the ticket itself that a name changed. Finished tickets just show the new name. Returns how
   * many tickets got the note.
   */
  private async noteOnOpenTickets(tx: Prisma.TransactionClient, where: Prisma.TicketWhereInput, note: string) {
    const open = await tx.ticket.findMany({ where: { ...where, status: { notIn: FINISHED_STATUSES } }, select: { id: true } });
    if (!open.length) return 0;
    await tx.ticketEvent.createMany({ data: open.map((t) => ({ ticketId: t.id, type: 'RENAMED' as const, note, visibility: 'PUBLIC' as const })) });
    return open.length;
  }

  /** The list without blanks or repeats (ignoring capitals), keeping the first spelling and the order. */
  private uniqueTopics(raw: string[]): string[] {
    const seen = new Set<string>();
    const topics: string[] = [];
    for (const item of raw.map(tidy).filter(Boolean)) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      topics.push(item);
    }
    if (!topics.length) throw new BadRequestException('Add at least one topic, so students have something to choose.');
    return topics;
  }

  /** Shown under "Recent changes" in Settings, so catalogue edits are traceable like staff edits. */
  private audit(tx: Prisma.TransactionClient, actorId: string, action: string, categoryId: string, summary: string) {
    return tx.staffAudit.create({ data: { actorId, action, categoryId, summary } });
  }
}
