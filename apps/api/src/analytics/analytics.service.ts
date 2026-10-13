import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotesService } from '../notes/notes.service';
import { AnalyticsEngine, type Scope } from './analytics.engine';
import type { DateRange } from './range';

interface Assignment {
  id: string;
  userId: string;
  categoryId: string;
  level: number;
  managerAssignmentId: string | null;
  user: { name: string };
  category: { shortName: string };
}

/**
 * Decides WHICH numbers each person may see, then hands the scope to the engine.
 *  - My analytics: what I handled (any POC).
 *  - Team analytics: the POCs below me, and my category only (L2 and L3).
 *  - Overall analytics: everything in my category, all levels, read-only (L2 and L3).
 *  - Admin: anything, optionally filtered by category, level or POC.
 * A POC's scope comes only from their own assignments, never from request parameters.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: AnalyticsEngine,
    private readonly notes: NotesService,
  ) {}

  private async myAssignments(userId: string): Promise<Assignment[]> {
    const rows = await this.prisma.pOCAssignment.findMany({
      where: { userId, active: true, category: { active: true } },
      include: { user: { select: { name: true } }, category: { select: { shortName: true } } },
    });
    if (rows.length === 0) throw new ForbiddenException('You are not assigned to any category.');
    return rows;
  }

  /** Everyone below the given assignments in the escalation chain (not including them). */
  private async below(assignments: Assignment[]): Promise<Assignment[]> {
    const found: Assignment[] = [];
    let frontier = assignments.map((a) => a.id);
    while (frontier.length) {
      const next = await this.prisma.pOCAssignment.findMany({
        where: { managerAssignmentId: { in: frontier }, active: true, category: { active: true } },
        include: { user: { select: { name: true } }, category: { select: { shortName: true } } },
      });
      found.push(...next);
      frontier = next.map((n) => n.id);
    }
    return found;
  }

  private who(a: Assignment) {
    return { userId: a.userId, name: a.user.name, level: a.level, category: a.category.shortName };
  }

  async me(userId: string, range: DateRange) {
    const mine = await this.myAssignments(userId);
    const scope: Scope = { userIds: [userId], categoryIds: mine.map((m) => m.categoryId) };
    return {
      view: 'me',
      title: 'My analytics',
      levels: [...new Set(mine.map((m) => m.level))].sort((a, b) => a - b),
      ...(await this.engine.dashboard(scope, range)),
    };
  }

  async team(userId: string, range: DateRange) {
    const mine = await this.myAssignments(userId);
    if (!mine.some((m) => m.level >= 2)) throw new ForbiddenException('Team analytics is for L2 and L3.');
    const leading = mine.filter((m) => m.level >= 2); // the categories where this person actually leads a team
    const people = await this.below(leading);
    // Only those categories: a person who is also an L1 somewhere else must not see their team members' work there.
    const scope: Scope = { userIds: [...new Set(people.map((p) => p.userId))], categoryIds: [...new Set(leading.map((m) => m.categoryId))] };
    const members = await Promise.all(
      // Alphabetical, on purpose: this is for comparing workloads, not for ranking people.
      people
        .sort((a, b) => a.user.name.localeCompare(b.user.name))
        .map(async (p) => ({
          ...this.who(p),
          headline: await this.engine.headline({ userIds: [p.userId], categoryIds: [p.categoryId] }, range),
        })),
    );
    return {
      view: 'team',
      title: 'Team analytics',
      members,
      ...(people.length ? await this.engine.dashboard(scope, range) : await this.emptyDashboard(range)),
    };
  }

  async overall(userId: string, range: DateRange) {
    const mine = await this.myAssignments(userId); // every POC level may see their whole category, read only
    const scope: Scope = { categoryIds: mine.map((m) => m.categoryId) };
    return { view: 'overall', title: 'Overall analytics', ...(await this.engine.dashboard(scope, range)) };
  }

  /** Super Admin: filter by category, level and/or one POC. With no filter, compares categories. */
  async admin(range: DateRange, filter: { categoryId?: string; level?: number; pocId?: string }) {
    const scope: Scope = {};
    if (filter.categoryId) {
      const exists = await this.prisma.category.findUnique({ where: { id: filter.categoryId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Category not found.');
      scope.categoryIds = [filter.categoryId];
    }
    if (filter.pocId || filter.level) {
      const people = await this.prisma.pOCAssignment.findMany({
        where: {
          active: true,
          category: { active: true },
          ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
          ...(filter.level ? { level: filter.level } : {}),
          ...(filter.pocId ? { userId: filter.pocId } : {}),
        },
        select: { userId: true },
      });
      scope.userIds = people.map((p) => p.userId);
      if (!scope.userIds.length) return { view: 'admin', title: 'All teams', ...(await this.emptyDashboard(range)), breakdown: [] };
    }

    let breakdown;
    if (!filter.categoryId) {
      const cats = await this.prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' } });
      breakdown = await Promise.all(
        cats.map(async (c) => ({
          id: c.id,
          name: c.shortName,
          headline: await this.engine.headline({ ...scope, categoryIds: [c.id] }, range),
        })),
      );
    } else {
      const people = await this.prisma.pOCAssignment.findMany({
        where: { categoryId: filter.categoryId, active: true, category: { active: true }, ...(filter.level ? { level: filter.level } : {}) },
        include: { user: { select: { name: true } }, category: { select: { shortName: true } } },
        orderBy: [{ level: 'asc' }, { user: { name: 'asc' } }],
      });
      breakdown = await Promise.all(
        people.map(async (p) => ({
          id: p.userId,
          name: p.user.name,
          level: p.level,
          headline: await this.engine.headline({ userIds: [p.userId], categoryIds: [p.categoryId] }, range),
        })),
      );
    }
    return { view: 'admin', title: 'All teams', breakdown, ...(await this.engine.dashboard(scope, range)) };
  }

  /** Which analytics pages this person may open, so the menu only shows what works. */
  async access(userId: string, role: string) {
    if (role === 'SUPER_ADMIN') return { me: false, team: false, overall: false, admin: true, manage: true, unreadNotes: 0, onLeave: false, onLeaveUntil: null };
    const mine = await this.prisma.pOCAssignment.findMany({
      where: { userId, active: true, category: { active: true } },
      select: { level: true, onLeave: true, onLeaveUntil: true },
    });
    const senior = mine.some((a) => a.level >= 2);
    const leave = mine.find((a) => a.onLeave);
    return {
      me: mine.length > 0,
      team: senior,
      overall: mine.length > 0,
      admin: false,
      manage: senior, // Settings is for L2, L3 and the admin
      unreadNotes: await this.notes.unreadCount(userId),
      onLeave: !!leave,
      onLeaveUntil: leave?.onLeaveUntil ?? null,
    };
  }

  /** Category list for the Super Admin filter. */
  categories() {
    return this.prisma.category.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, shortName: true },
    });
  }

  private emptyDashboard(range: DateRange) {
    // A scope with no people matches nothing; the engine handles an empty id list.
    return this.engine.dashboard({ userIds: [] }, range);
  }
}
