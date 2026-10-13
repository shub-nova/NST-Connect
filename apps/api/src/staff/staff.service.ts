import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { describeDomains, parseDomains } from '../auth/email-domains';
import { signInvite } from '../auth/invite';
import { MailService } from '../mail/mail.service';
import { Prisma, type Role } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { handOffOpenTickets, type HandoffResult } from './handoff';
import { FINISHED_STATUSES } from '../tickets/ticket-status';

export interface Actor {
  id: string;
  role: Role;
}

const include = {
  user: { select: { id: true, name: true, email: true, passwordHash: true, deactivatedAt: true } },
  category: { select: { id: true, name: true, shortName: true, maxLevel: true } },
} satisfies Prisma.POCAssignmentInclude;
type Assignment = Prisma.POCAssignmentGetPayload<{ include: typeof include }>;

/**
 * Settings: who may add, change, move and remove POCs.
 *  - Super Admin: anyone, any category.
 *  - L3: the L2 and L1 below them. L2: the L1 below them. L1: nobody.
 * Everything is checked here on the server by walking the reporting chain (manager links). Anything
 * outside the caller's reach is a plain 404, the same as the ticket pages. Removal never deletes:
 * history and analytics keep working.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  // ---- who can manage whom ----------------------------------------------------------------

  private live(): Prisma.POCAssignmentWhereInput {
    return { active: true, category: { active: true } };
  }

  /** Everyone this person may manage, plus their own senior assignments. */
  private async reach(actor: Actor): Promise<{ mine: Assignment[]; below: Assignment[]; isAdmin: boolean }> {
    if (actor.role === 'SUPER_ADMIN') {
      return { mine: [], below: await this.prisma.pOCAssignment.findMany({ where: this.live(), include }), isAdmin: true };
    }
    const mine = await this.prisma.pOCAssignment.findMany({ where: { userId: actor.id, ...this.live(), level: { gte: 2 } }, include });
    if (!mine.length) throw new ForbiddenException('Settings is for L2, L3 and the admin.');
    const below: Assignment[] = [];
    let frontier = mine.map((m) => m.id);
    while (frontier.length) {
      const next = await this.prisma.pOCAssignment.findMany({ where: { managerAssignmentId: { in: frontier }, ...this.live() }, include });
      below.push(...next);
      frontier = next.map((n) => n.id);
    }
    return { mine, below, isAdmin: false };
  }

  private async inReach(actor: Actor, assignmentId: string): Promise<Assignment> {
    const { below } = await this.reach(actor);
    const target = below.find((a) => a.id === assignmentId);
    if (!target) throw new NotFoundException('POC not found.');
    return target;
  }

  /** The assignments someone could report to at `level + 1`, among those this person can reach. */
  private managerCandidates(pool: Assignment[], categoryId: string, level: number): Assignment[] {
    return pool.filter((a) => a.categoryId === categoryId && a.level === level + 1);
  }

  private shape(a: Assignment, openTickets = 0, managerName: string | null = null) {
    return {
      id: a.id,
      userId: a.userId,
      name: a.user.name,
      email: a.user.email,
      level: a.level,
      category: { id: a.category.id, name: a.category.shortName || a.category.name },
      managerId: a.managerAssignmentId,
      managerName,
      status: a.user.passwordHash === null ? 'invited' : a.onLeave ? 'on_leave' : 'active',
      onLeave: a.onLeave,
      onLeaveUntil: a.onLeaveUntil,
      openTickets,
    };
  }

  // ---- reading ----------------------------------------------------------------------------

  async team(actor: Actor, categoryId?: string) {
    const { below } = await this.reach(actor);
    const people = below.filter((a) => !categoryId || a.categoryId === categoryId);
    const names = new Map(below.map((a) => [a.id, a.user.name]));
    const loads = await this.prisma.ticket.groupBy({
      by: ['assignedPocId', 'categoryId'],
      where: { assignedPocId: { in: people.map((p) => p.userId) }, status: { notIn: FINISHED_STATUSES } },
      _count: { _all: true },
    });
    const open = (a: Assignment) => loads.find((l) => l.assignedPocId === a.userId && l.categoryId === a.categoryId)?._count._all ?? 0;
    return {
      people: people
        .map((a) => this.shape(a, open(a), a.managerAssignmentId ? (names.get(a.managerAssignmentId) ?? null) : null))
        .sort((x, y) => y.level - x.level || x.name.localeCompare(y.name)),
    };
  }

  /** What the Add and Edit forms may offer this person. */
  async options(actor: Actor) {
    const { mine, below, isAdmin } = await this.reach(actor);
    const pool = [...mine, ...below];
    const categories = isAdmin
      ? await this.prisma.category.findMany({ where: { active: true }, orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, shortName: true, maxLevel: true } })
      : [...new Map(mine.map((m) => [m.categoryId, m.category])).values()];

    return {
      categories: categories.map((c) => {
        const myTop = isAdmin ? c.maxLevel + 1 : Math.max(...mine.filter((m) => m.categoryId === c.id).map((m) => m.level));
        const levels = Array.from({ length: c.maxLevel }, (_, i) => i + 1)
          .filter((level) => level < myTop)
          .map((level) => ({
            level,
            managers: this.managerCandidates(pool, c.id, level).map((m) => ({ id: m.id, name: m.user.name, level: m.level })),
          }));
        return { id: c.id, name: c.shortName || c.name, levels };
      }),
    };
  }

  async audit(actor: Actor) {
    const { mine, isAdmin } = await this.reach(actor);
    const rows = await this.prisma.staffAudit.findMany({
      where: isAdmin ? {} : { categoryId: { in: mine.map((m) => m.categoryId) } },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, action: true, summary: true, createdAt: true, actor: { select: { name: true } } },
    });
    return { changes: rows.map((r) => ({ id: r.id, action: r.action, summary: r.summary, createdAt: r.createdAt, by: r.actor.name })) };
  }

  // ---- adding -----------------------------------------------------------------------------

  async add(actor: Actor, input: { name: string; email: string; categoryId: string; level: number; managerAssignmentId?: string }) {
    const email = input.email.trim().toLowerCase();
    const domains = parseDomains(this.config.getOrThrow<string>('POC_EMAIL_DOMAIN'));
    if (!domains.some((d) => email.endsWith(`@${d}`))) throw new BadRequestException(`Staff must use an ${describeDomains(domains)} email address.`);

    const { mine, below, isAdmin } = await this.reach(actor);
    const pool = [...mine, ...below];
    const category = await this.prisma.category.findFirst({ where: { id: input.categoryId, active: true } });
    if (!category) throw new NotFoundException('Category not found.');
    if (input.level > category.maxLevel) throw new BadRequestException('That level does not exist for this category.');

    const myTop = isAdmin ? category.maxLevel + 1 : Math.max(0, ...mine.filter((m) => m.categoryId === category.id).map((m) => m.level));
    if (input.level >= myTop) throw new ForbiddenException('You can only add POCs below your own level.');

    let managerId: string | null = null;
    if (input.level < category.maxLevel) {
      const candidates = this.managerCandidates(pool, category.id, input.level);
      if (input.managerAssignmentId) {
        if (!candidates.some((c) => c.id === input.managerAssignmentId)) throw new BadRequestException('Choose someone at the next level up to report to.');
        managerId = input.managerAssignmentId;
      } else if (candidates.length === 1) {
        managerId = candidates[0].id;
      } else if (candidates.length === 0) {
        throw new BadRequestException(`There is no L${input.level + 1} to report to yet.`);
      } else {
        throw new BadRequestException('Choose who this person reports to.');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { email } });
      if (user && user.role !== 'POC') throw new ConflictException('That email belongs to an account that cannot be added as a POC.');
      user ??= await tx.user.create({ data: { email, name: input.name, role: 'POC' } });

      const existing = await tx.pOCAssignment.findUnique({ where: { userId_categoryId: { userId: user.id, categoryId: category.id } } });
      if (existing?.active) throw new ConflictException('That person is already on this category.');
      const assignment = existing
        ? await tx.pOCAssignment.update({
            where: { id: existing.id },
            data: { active: true, level: input.level, managerAssignmentId: managerId, onLeave: false, onLeaveUntil: null },
            include,
          })
        : await tx.pOCAssignment.create({ data: { userId: user.id, categoryId: category.id, level: input.level, managerAssignmentId: managerId }, include });
      if (user.deactivatedAt) await tx.user.update({ where: { id: user.id }, data: { deactivatedAt: null } });

      await tx.staffAudit.create({
        data: { actorId: actor.id, action: 'ADDED', targetUserId: user.id, categoryId: category.id, summary: `Added ${user.name} as L${input.level} in ${category.shortName || category.name}` },
      });
      return assignment;
    });

    const web = this.config.getOrThrow<string>('WEB_URL');
    const where = `${category.shortName || category.name} (L${input.level})`;
    await this.mail.send(
      email,
      result.user.passwordHash ? `You were added to ${where}` : `You are invited to NST Connect · ${where}`,
      result.user.passwordHash
        ? `You have been added as L${input.level} for ${category.shortName || category.name}.\n\nOpen your queue: ${web}/poc`
        : `You have been invited to NST Connect as L${input.level} for ${category.shortName || category.name}.\n\nCreate your account with this link (it only works for this email address):\n${await this.inviteLink(email)}`,
    );
    return this.shape(result);
  }

  // ---- changing ---------------------------------------------------------------------------

  async update(actor: Actor, id: string, input: { name?: string; managerAssignmentId?: string }) {
    const { mine, below } = await this.reach(actor);
    const target = below.find((a) => a.id === id);
    if (!target) throw new NotFoundException('POC not found.');

    let managerId = target.managerAssignmentId;
    if (input.managerAssignmentId !== undefined && input.managerAssignmentId !== target.managerAssignmentId) {
      const candidates = this.managerCandidates([...mine, ...below], target.categoryId, target.level);
      if (!candidates.some((c) => c.id === input.managerAssignmentId)) throw new BadRequestException('Choose someone at the next level up to report to.');
      managerId = input.managerAssignmentId;
    }

    await this.prisma.$transaction(async (tx) => {
      if (input.name && input.name !== target.user.name) await tx.user.update({ where: { id: target.userId }, data: { name: input.name } });
      if (managerId !== target.managerAssignmentId) await tx.pOCAssignment.update({ where: { id }, data: { managerAssignmentId: managerId } });
      await tx.staffAudit.create({
        data: {
          actorId: actor.id,
          action: 'UPDATED',
          targetUserId: target.userId,
          categoryId: target.categoryId,
          summary: `Updated ${input.name ?? target.user.name}${managerId !== target.managerAssignmentId ? ' (new manager)' : ''}`,
        },
      });
    });
    return this.team(actor).then((t) => t.people.find((p) => p.id === id));
  }

  // ---- leave ------------------------------------------------------------------------------

  /** Parses the "back on" date. It is required, and it must be a future day. */
  private returnDate(until: string | undefined, now: Date): Date {
    if (!until) throw new BadRequestException('Choose when you will be back.');
    const date = new Date(`${until}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) throw new BadRequestException('Choose a return date in the future.');
    return date;
  }

  private async applyLeave(actor: Actor, a: Assignment, onLeave: boolean, until: string | undefined) {
    const now = new Date();
    const returnOn = onLeave ? this.returnDate(until, now) : null;
    let moved: HandoffResult = { reassigned: 0, escalated: 0, stranded: 0 };

    await this.prisma.$transaction(async (tx) => {
      await tx.pOCAssignment.update({ where: { id: a.id }, data: { onLeave, onLeaveUntil: returnOn } });
      // The assignment is flagged first, so the person is already out of the pool when tickets are handed over.
      if (onLeave && !a.onLeave) moved = await handOffOpenTickets(tx, a, actor.id, 'The previous owner is on leave');
      await tx.staffAudit.create({
        data: {
          actorId: actor.id,
          action: onLeave ? 'LEAVE_ON' : 'LEAVE_OFF',
          targetUserId: a.userId,
          categoryId: a.categoryId,
          summary: onLeave
            ? `${a.user.name} was put on leave${returnOn ? ` until ${until}` : ''}: ${moved.reassigned} ticket(s) reassigned, ${moved.escalated} escalated${moved.stranded ? `, ${moved.stranded} left with no one on duty` : ''}`
            : `${a.user.name} is back from leave`,
        },
      });
    });
    return { onLeave, onLeaveUntil: returnOn, moved };
  }

  /**
   * Nobody puts themselves on leave. It is set by the person's manager: an L1 by their L2 or an L3 above them, an
   * L2 by their L3, and an L3 by the Super Admin (who has no leave of their own). Someone outside the caller's
   * reach, including the caller themselves, is a 404.
   */
  async setLeave(actor: Actor, id: string, input: { onLeave: boolean; until?: string }) {
    const target = await this.inReach(actor, id);
    return this.applyLeave(actor, target, input.onLeave, input.until);
  }

  // ---- removing ---------------------------------------------------------------------------

  async remove(actor: Actor, id: string) {
    const target = await this.inReach(actor, id);
    if (target.userId === actor.id) throw new ForbiddenException('You cannot remove yourself.');

    const reports = await this.prisma.pOCAssignment.count({ where: { managerAssignmentId: id, active: true } });
    if (reports > 0) throw new ConflictException(`Move ${target.user.name}'s team to someone else first.`);
    const others = await this.prisma.pOCAssignment.count({
      where: { categoryId: target.categoryId, level: target.level, active: true, id: { not: id } },
    });
    if (others === 0) throw new ConflictException(`${target.user.name} is the only L${target.level} here. Add another L${target.level} first so tickets always have an owner.`);

    let moved: HandoffResult = { reassigned: 0, escalated: 0, stranded: 0 };
    await this.prisma.$transaction(async (tx) => {
      await tx.pOCAssignment.update({ where: { id }, data: { active: false, onLeave: false, onLeaveUntil: null } });
      moved = await handOffOpenTickets(tx, target, actor.id, 'The previous owner was removed from the team');
      const stillHasRole = await tx.pOCAssignment.count({ where: { userId: target.userId, active: true } });
      if (!stillHasRole) {
        await tx.user.update({ where: { id: target.userId }, data: { deactivatedAt: new Date() } });
        await tx.refreshToken.deleteMany({ where: { userId: target.userId } });
      }
      await tx.staffAudit.create({
        data: {
          actorId: actor.id,
          action: 'REMOVED',
          targetUserId: target.userId,
          categoryId: target.categoryId,
          summary: `Removed ${target.user.name} (L${target.level}): ${moved.reassigned} ticket(s) reassigned, ${moved.escalated} escalated${moved.stranded ? `, ${moved.stranded} left with no one on duty` : ''}`,
        },
      });
    });

    await this.mail.send(
      target.user.email,
      `You were removed from ${target.category.shortName || target.category.name}`,
      `You have been removed from the ${target.category.shortName || target.category.name} team (L${target.level}) on NST Connect. Your open tickets were handed to colleagues.`,
    );
    return { removed: true, moved };
  }

  // ---- invites ----------------------------------------------------------------------------

  /** The sign-up link in an invitation. It names the invited address, so only that address can use it. */
  private async inviteLink(email: string): Promise<string> {
    return `${this.config.getOrThrow<string>('WEB_URL')}/register?invite=${await signInvite(this.jwt, email)}`;
  }

  async resendInvite(actor: Actor, id: string) {
    const target = await this.inReach(actor, id);
    if (target.user.passwordHash !== null) throw new BadRequestException('This person has already registered.');
    await this.mail.send(
      target.user.email,
      `You are invited to NST Connect · ${target.category.shortName || target.category.name} (L${target.level})`,
      `You have been invited to NST Connect as L${target.level}.\n\nCreate your account with this link (it only works for this email address):\n${await this.inviteLink(target.user.email)}`,
    );
    await this.prisma.staffAudit.create({
      data: { actorId: actor.id, action: 'INVITE_SENT', targetUserId: target.userId, categoryId: target.categoryId, summary: `Re-sent the invite to ${target.user.name}` },
    });
    return { sent: true };
  }

  /** Ends leave whose return date has arrived. Called by the scheduled job. */
  async endExpiredLeaves(now = new Date()): Promise<number> {
    const res = await this.prisma.pOCAssignment.updateMany({ where: { onLeave: true, onLeaveUntil: { lte: now } }, data: { onLeave: false, onLeaveUntil: null } });
    return res.count;
  }
}
