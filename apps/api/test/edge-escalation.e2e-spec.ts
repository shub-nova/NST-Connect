import type { INestApplication } from '@nestjs/common';
import { EscalationService } from '../src/escalation/escalation.service';
import { categoryByShortName, createTestApp, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

/**
 * Edge cases for the automatic escalation job: the batch cap, exact deadline and warning boundaries, tickets with no
 * owner, and tickets the job must leave alone. Uses the "Documents" team, and cleans up every ticket it makes.
 */
describe('Edge cases: automatic escalation (e2e)', () => {
  let app: INestApplication;
  let job: EscalationService;
  let categoryId: string;
  let subId: string;
  let studentId: string;
  let l1UserId: string;
  const created: string[] = [];
  const prisma = () => prismaOf(app);
  const HOUR = 3600_000;

  const row = (id: string) => prisma().ticket.findUniqueOrThrow({ where: { id } });
  async function make(data: { status?: 'ASSIGNED' | 'CREATED' | 'RESOLVED' | 'CLOSED'; deadline: Date | null; owner?: string | null; critical?: boolean; level?: number }) {
    const t = await prisma().ticket.create({
      data: {
        title: 'Escalation edge case',
        description: 'Created directly for an escalation edge case.',
        categoryId,
        subCategoryId: subId,
        studentId,
        status: data.status ?? 'ASSIGNED',
        currentLevel: data.level ?? 1,
        assignedPocId: data.owner === undefined ? l1UserId : data.owner,
        tatDeadline: data.deadline,
        critical: data.critical ?? false,
      },
    });
    created.push(t.id);
    return t.id;
  }

  /** Put every other open ticket's deadline far in the future so only this file's tickets can be overdue. */
  async function quietTheRest() {
    await prisma().ticket.updateMany({ where: { id: { notIn: created }, tatDeadline: { not: null } }, data: { tatDeadline: new Date(Date.now() + 90 * 24 * HOUR), tatWarnedAt: new Date() } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    job = app.get(EscalationService);
    const category = await categoryByShortName(app, 'Documents');
    categoryId = category.id;
    subId = category.subCategories[0].id;
    await registerAndLogin(app, uniqueStudentEmail('escedge'));
    studentId = (await prisma().user.findFirstOrThrow({ where: { role: 'STUDENT' }, orderBy: { createdAt: 'desc' } })).id;
    const l1 = await prisma().pOCAssignment.findFirstOrThrow({ where: { categoryId, level: 1, active: true } });
    l1UserId = l1.userId;
  });
  afterAll(async () => {
    await prisma().notification.deleteMany({ where: { ticketId: { in: created } } });
    await prisma().ticketEvent.deleteMany({ where: { ticketId: { in: created } } });
    await prisma().ticket.deleteMany({ where: { id: { in: created } } });
    await app.close();
  });

  it('handles at most 500 overdue tickets in one run and finishes the rest on the next', async () => {
    await quietTheRest();
    const past = new Date(Date.now() - 3 * HOUR);
    await prisma().ticket.createMany({
      data: Array.from({ length: 505 }, () => ({
        title: 'Overdue in bulk',
        description: 'Created for the batch cap.',
        categoryId,
        subCategoryId: subId,
        studentId,
        status: 'ASSIGNED' as const,
        currentLevel: 1,
        assignedPocId: l1UserId,
        tatDeadline: past,
      })),
    });
    const bulk = await prisma().ticket.findMany({ where: { title: 'Overdue in bulk', studentId }, select: { id: true } });
    created.push(...bulk.map((t) => t.id));
    expect(bulk).toHaveLength(505);

    const first = await job.runOnce();
    expect(first.escalated + first.flaggedCritical).toBe(500); // the cap
    const second = await job.runOnce();
    expect(second.escalated + second.flaggedCritical).toBe(5); // the remainder
    const third = await job.runOnce();
    expect(third.escalated + third.flaggedCritical).toBe(0); // nothing is handled twice

    const states = await prisma().ticket.groupBy({ by: ['currentLevel'], where: { id: { in: bulk.map((t) => t.id) } }, _count: { _all: true } });
    expect(states).toEqual([{ currentLevel: 2, _count: { _all: 505 } }]); // each moved up exactly one level
    expect(await prisma().ticketEvent.count({ where: { ticketId: { in: bulk.map((t) => t.id) }, type: 'TAT_BREACHED' } })).toBe(505); // one miss each
  }, 120_000);

  it('a ticket is overdue at the exact moment of its deadline, but not a millisecond before it', async () => {
    await quietTheRest();
    const now = new Date();
    const exactly = await make({ deadline: now });
    const justAfter = await make({ deadline: new Date(now.getTime() + 1) });
    await job.runOnce(now);
    expect((await row(exactly)).status).toBe('ESCALATED');
    expect((await row(justAfter)).status).toBe('ASSIGNED');
    expect((await row(justAfter)).currentLevel).toBe(1);
  });

  it('the 12-hour warning covers a deadline exactly 12 hours away, and not one a millisecond further', async () => {
    await quietTheRest();
    const now = new Date();
    const edge = await make({ deadline: new Date(now.getTime() + 12 * HOUR) });
    const beyond = await make({ deadline: new Date(now.getTime() + 12 * HOUR + 1) });
    await job.runOnce(now);
    expect((await row(edge)).tatWarnedAt).not.toBeNull();
    expect((await row(beyond)).tatWarnedAt).toBeNull();
    // Warned once: running again adds nothing.
    const before = await prisma().notification.count({ where: { ticketId: edge, type: 'TAT_WARNING' } });
    await job.runOnce(now);
    expect(await prisma().notification.count({ where: { ticketId: edge, type: 'TAT_WARNING' } })).toBe(before);
  });

  it('leaves alone finished tickets and critical tickets, and gives a ticket with no owner an owner without escalating it', async () => {
    await quietTheRest();
    const ownerless = await make({ status: 'CREATED', deadline: null, owner: null });
    const solved = await make({ status: 'RESOLVED', deadline: new Date(Date.now() - 10 * HOUR) }); // a stale deadline on a finished ticket
    const closed = await make({ status: 'CLOSED', deadline: new Date(Date.now() - 10 * HOUR) });
    const critical = await make({ deadline: null, critical: true, level: 3 });
    const before = await Promise.all([solved, closed, critical].map(row));
    const result = await job.runOnce();
    expect(result.escalated + result.flaggedCritical).toBe(0);
    const after = await Promise.all([solved, closed, critical].map(row));
    for (let i = 0; i < before.length; i++) {
      expect(after[i].status).toBe(before[i].status);
      expect(after[i].currentLevel).toBe(before[i].currentLevel);
      expect(after[i].critical).toBe(before[i].critical);
    }
    const adopted = await row(ownerless);
    expect(adopted.status).toBe('ASSIGNED'); // someone is on duty, so it now has an owner and a clock...
    expect(adopted.currentLevel).toBe(1); // ...at the first level, not escalated
    expect(adopted.assignedPocId).not.toBeNull();
    expect(adopted.tatDeadline!.getTime()).toBeGreaterThan(Date.now());
  });

  it('a ticket whose owner is missing is still escalated, and the miss is recorded without a person', async () => {
    await quietTheRest();
    const orphan = await make({ deadline: new Date(Date.now() - HOUR), owner: null });
    await job.runOnce();
    expect((await row(orphan)).status).toBe('ESCALATED');
    expect((await row(orphan)).currentLevel).toBe(2);
    const miss = await prisma().ticketEvent.findFirstOrThrow({ where: { ticketId: orphan, type: 'TAT_BREACHED' } });
    expect(miss.actorId).toBeNull();
    expect(miss.visibility).toBe('INTERNAL');
  });

  it('a very long overdue ticket is escalated one level per run, never skipping, and ends critical at the top', async () => {
    await quietTheRest();
    const id = await make({ deadline: new Date(Date.now() - 365 * 24 * HOUR) }); // a year overdue
    await job.runOnce();
    expect((await row(id)).currentLevel).toBe(2); // not straight to the top
    await prisma().ticket.update({ where: { id }, data: { tatDeadline: new Date(Date.now() - HOUR) } });
    await job.runOnce();
    expect((await row(id)).currentLevel).toBe(3);
    await prisma().ticket.update({ where: { id }, data: { tatDeadline: new Date(Date.now() - HOUR) } });
    await job.runOnce();
    const top = await row(id);
    expect(top.critical).toBe(true);
    expect(top.tatDeadline).toBeNull();
    await job.runOnce(); // and stays that way
    expect((await row(id)).critical).toBe(true);
  });

  it('two overlapping runs of the whole job never handle a ticket twice', async () => {
    await quietTheRest();
    const ids = await Promise.all(Array.from({ length: 12 }, () => make({ deadline: new Date(Date.now() - HOUR) })));
    await Promise.all([job.runOnce(), job.runOnce(), job.runOnce()]);
    for (const id of ids) {
      expect((await row(id)).currentLevel).toBe(2);
      expect(await prisma().ticketEvent.count({ where: { ticketId: id, type: 'TAT_BREACHED' } })).toBe(1);
      expect(await prisma().ticketEvent.count({ where: { ticketId: id, type: 'ESCALATED' } })).toBe(1);
    }
  });
});
