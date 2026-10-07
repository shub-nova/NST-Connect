// Must be set before the app is created: it switches on the trigger endpoint.
process.env.JOB_SECRET = 'test-job-secret-0123456789';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EscalationService } from '../src/escalation/escalation.service';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const HOUR = 36e5;

describe('Automatic escalation (e2e)', () => {
  let app: INestApplication;
  let job: EscalationService;
  let studentToken: string;
  let academicsId: string;
  let academicsSubId: string;
  let forbidden: string[]; // every staff id, email and name: none may reach a student

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const L1 = 'academics.l1.1@newtonschool.co';
  const L2 = 'academics.l2@newtonschool.co';
  const L3 = 'academics.l3@newtonschool.co';

  const userId = async (email: string) => (await prisma().user.findUniqueOrThrow({ where: { email } })).id;

  async function newTicket() {
    const res = await request(server())
      .post('/tickets')
      .set(auth(studentToken))
      .send({ subCategoryId: academicsSubId, title: 'Portal error', description: 'The course portal shows an error page every time.' })
      .expect(201);
    return res.body.id as string;
  }

  /** Pretend the assigned POC has been silent for 48h by moving the deadline into the past. */
  const makeOverdue = (ticketId: string) =>
    prisma().ticket.update({ where: { id: ticketId }, data: { tatDeadline: new Date(Date.now() - HOUR) } });
  const setHoursLeft = (ticketId: string, hours: number) =>
    prisma().ticket.update({ where: { id: ticketId }, data: { tatDeadline: new Date(Date.now() + hours * HOUR) } });
  const row = (ticketId: string) => prisma().ticket.findUniqueOrThrow({ where: { id: ticketId } });
  const events = (ticketId: string, type: string) => prisma().ticketEvent.findMany({ where: { ticketId, type: type as never }, orderBy: { createdAt: 'asc' } });
  const studentView = (ticketId: string) => request(server()).get(`/tickets/${ticketId}`).set(auth(studentToken)).expect(200);

  async function withLevelsInactive<T>(levels: number[], fn: () => Promise<T>): Promise<T> {
    const before = await prisma().pOCAssignment.findMany({ where: { categoryId: academicsId, level: { in: [1, 2, 3] } } });
    await prisma().pOCAssignment.updateMany({ where: { categoryId: academicsId, level: { in: levels } }, data: { active: false } });
    try {
      return await fn();
    } finally {
      for (const a of before) await prisma().pOCAssignment.update({ where: { id: a.id }, data: { active: a.active } });
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    job = app.get(EscalationService);
    studentToken = await registerAndLogin(app, uniqueStudentEmail());
    const academics = await categoryByShortName(app, 'Academics');
    academicsId = academics.id;
    academicsSubId = academics.subCategories[0].id;
    const staff = await prisma().user.findMany({ where: { role: { in: ['POC', 'SUPER_ADMIN'] } } });
    forbidden = staff.flatMap((u) => [u.id, u.email, u.name]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('escalates a ticket whose POC did nothing for 48h: L1 → L2, with the miss logged against L1', async () => {
    const ticketId = await newTicket();
    const l1 = await userId(L1);
    const l2 = await userId(L2);
    await makeOverdue(ticketId);

    const result = await job.runOnce();
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    expect(await row(ticketId)).toMatchObject({ status: 'ESCALATED', currentLevel: 2, assignedPocId: l2, tatWarnedAt: null, critical: false });
    const hours = ((await row(ticketId)).tatDeadline!.getTime() - Date.now()) / HOUR;
    expect(hours).toBeGreaterThan(47.9); // a fresh 48h for L2
    expect(hours).toBeLessThanOrEqual(48);

    const [breach] = await events(ticketId, 'TAT_BREACHED');
    expect(breach).toMatchObject({ actorId: l1, fromLevel: 1, visibility: 'INTERNAL' }); // held against L1, hidden from students
    const [escalated] = await events(ticketId, 'ESCALATED');
    expect(escalated).toMatchObject({ actorId: null, fromLevel: 1, toLevel: 2, reason: 'TAT_BREACH', visibility: 'PUBLIC' });

    const notified = (userIdValue: string, type: string) => prisma().notification.count({ where: { ticketId, userId: userIdValue, type: type as never } });
    expect(await notified(l2, 'ESCALATION')).toBe(1);
    expect(await notified(l1, 'TAT_MISSED')).toBe(1);
    expect(await notified((await row(ticketId)).studentId, 'ESCALATION')).toBe(1);
  });

  it('what each side sees: the student only sees "Escalated"; staff see why', async () => {
    const ticketId = await newTicket();
    await makeOverdue(ticketId);
    await job.runOnce();

    const student = await studentView(ticketId);
    expect(student.body).toMatchObject({ status: 'ESCALATED', statusLabel: 'Escalated' });
    expect(student.body.timeline.map((e: { label: string }) => e.label)).toEqual(['Ticket created', 'Assigned to Academics team', 'Escalated to Academics team']);
    expect(JSON.stringify(student.body)).not.toMatch(/TAT_BREACH|time limit|no action|automatic|missed/i);
    const json = JSON.stringify(student.body);
    for (const value of forbidden) expect(json).not.toContain(value);

    // L1 no longer sees it; L2 does, with the reason.
    const l1Token = await loginAsPoc(app, L1);
    await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(l1Token)).expect(404);
    const l2Token = await loginAsPoc(app, L2);
    const detail = await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(l2Token)).expect(200);
    const labels = detail.body.thread.map((i: { label?: string }) => i.label);
    expect(labels).toContain('Missed the time limit');
    expect(labels).toContain('Escalated to level 2: no action within 48h');
    const queue = await request(server()).get('/poc/queue').set(auth(l2Token)).expect(200);
    expect(queue.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);
  });

  it('is idempotent: running again straight away does nothing', async () => {
    const ticketId = await newTicket();
    await makeOverdue(ticketId);
    await job.runOnce();
    const again = await job.runOnce();
    expect(again).toEqual({ escalated: 0, flaggedCritical: 0, warned: 0 });
    expect(await events(ticketId, 'ESCALATED')).toHaveLength(1);
    expect(await events(ticketId, 'TAT_BREACHED')).toHaveLength(1);
  });

  it('a POC acting (reply or mark in progress) restarts the clock, so nothing escalates', async () => {
    const replied = await newTicket();
    const marked = await newTicket();
    const l1Token = await loginAsPoc(app, L1);
    await makeOverdue(replied);
    await makeOverdue(marked);

    // The POC acts just before the job runs.
    await request(server()).post(`/poc/tickets/${replied}/comments`).set(auth(l1Token)).send({ body: 'On it.' }).expect(201);
    await request(server()).post(`/poc/tickets/${marked}/status`).set(auth(l1Token)).send({ status: 'IN_PROGRESS' }).expect(200);

    await job.runOnce();
    for (const id of [replied, marked]) {
      expect(await row(id)).toMatchObject({ status: 'IN_PROGRESS', currentLevel: 1 });
      expect(await events(id, 'ESCALATED')).toHaveLength(0);
    }

    // Silence after that does escalate: the limit is 48h of inaction, not 48h in total.
    await makeOverdue(replied);
    await job.runOnce();
    expect(await row(replied)).toMatchObject({ status: 'ESCALATED', currentLevel: 2 });
  });

  it('walks up L1 → L2 → L3, then flags the ticket critical and tells the admins (once)', async () => {
    const ticketId = await newTicket();
    const [l1, l2, l3] = [await userId(L1), await userId(L2), await userId(L3)];

    await makeOverdue(ticketId);
    await job.runOnce();
    expect(await row(ticketId)).toMatchObject({ currentLevel: 2, assignedPocId: l2 });
    await makeOverdue(ticketId);
    await job.runOnce();
    expect(await row(ticketId)).toMatchObject({ currentLevel: 3, assignedPocId: l3, status: 'ESCALATED', critical: false });

    // L3 is the top: nowhere to go, so it is flagged instead.
    await makeOverdue(ticketId);
    await job.runOnce();
    expect(await row(ticketId)).toMatchObject({ currentLevel: 3, assignedPocId: l3, critical: true, tatDeadline: null });
    expect((await events(ticketId, 'TAT_BREACHED')).map((e) => e.actorId)).toEqual([l1, l2, l3]);
    expect(await events(ticketId, 'ESCALATED')).toHaveLength(2); // only two moves; the third was a flag
    const admins = await prisma().user.findMany({ where: { role: 'SUPER_ADMIN' } });
    for (const admin of admins) {
      expect(await prisma().notification.count({ where: { ticketId, userId: admin.id, type: 'CRITICAL' } })).toBe(1);
    }

    // Further runs do not log the same miss again.
    await job.runOnce();
    await job.runOnce();
    expect(await events(ticketId, 'TAT_BREACHED')).toHaveLength(3);

    // When L3 acts, the flag clears and the 48h clock restarts.
    const l3Token = await loginAsPoc(app, L3);
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(l3Token)).send({ body: 'Sorry for the delay, looking now.' }).expect(201);
    const after = await row(ticketId);
    expect(after.critical).toBe(false);
    expect((after.tatDeadline!.getTime() - Date.now()) / HOUR).toBeGreaterThan(47.9);
  });

  it('skips a level with nobody on duty; with nobody above at all it flags critical', async () => {
    await withLevelsInactive([2], async () => {
      const ticketId = await newTicket();
      await makeOverdue(ticketId);
      await job.runOnce();
      expect(await row(ticketId)).toMatchObject({ currentLevel: 3, status: 'ESCALATED' }); // L1 → L3 directly
      expect(await events(ticketId, 'ESCALATED').then((e) => e[0])).toMatchObject({ fromLevel: 1, toLevel: 3 });
    });

    await withLevelsInactive([2, 3], async () => {
      const ticketId = await newTicket();
      await makeOverdue(ticketId);
      await job.runOnce();
      expect(await row(ticketId)).toMatchObject({ currentLevel: 1, status: 'ASSIGNED', critical: true, tatDeadline: null });
      expect(await events(ticketId, 'ESCALATED')).toHaveLength(0);
    });
  });

  it('never touches finished tickets', async () => {
    const ticketId = await newTicket();
    const l1Token = await loginAsPoc(app, L1);
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(l1Token)).send({ outcome: 'SOLVED', note: 'All sorted out.' }).expect(200);
    await prisma().ticket.update({ where: { id: ticketId }, data: { tatDeadline: new Date(Date.now() - 10 * HOUR) } }); // even with a stale deadline
    await job.runOnce();
    expect(await row(ticketId)).toMatchObject({ status: 'RESOLVED', currentLevel: 1 });
    expect(await events(ticketId, 'TAT_BREACHED')).toHaveLength(0);
  });

  it('warns the assigned POC 12h before the deadline, exactly once per deadline', async () => {
    const soon = await newTicket();
    const later = await newTicket();
    const l1 = await userId(L1);
    await setHoursLeft(soon, 6);
    await setHoursLeft(later, 30); // outside the warning window

    const first = await job.runOnce();
    expect(first.warned).toBeGreaterThanOrEqual(1);
    expect(await prisma().notification.count({ where: { ticketId: soon, userId: l1, type: 'TAT_WARNING' } })).toBe(1);
    expect((await row(soon)).tatWarnedAt).not.toBeNull();
    expect(await prisma().notification.count({ where: { ticketId: later, type: 'TAT_WARNING' } })).toBe(0);

    await job.runOnce(); // no duplicate
    expect(await prisma().notification.count({ where: { ticketId: soon, type: 'TAT_WARNING' } })).toBe(1);

    // Acting restarts the clock and re-arms the warning for the next deadline.
    const l1Token = await loginAsPoc(app, L1);
    await request(server()).post(`/poc/tickets/${soon}/comments`).set(auth(l1Token)).send({ body: 'Working on it.' }).expect(201);
    expect((await row(soon)).tatWarnedAt).toBeNull();
    await setHoursLeft(soon, 5);
    await job.runOnce();
    expect(await prisma().notification.count({ where: { ticketId: soon, userId: l1, type: 'TAT_WARNING' } })).toBe(2);
  });

  it('two runs at the same moment: a ticket is escalated exactly once', async () => {
    const ticketId = await newTicket();
    await makeOverdue(ticketId);
    const [a, b] = await Promise.all([job.runOnce(), job.runOnce()]);
    expect(a.escalated + b.escalated).toBe(1);
    expect(await events(ticketId, 'ESCALATED')).toHaveLength(1);
    expect(await events(ticketId, 'TAT_BREACHED')).toHaveLength(1);
    expect(await row(ticketId)).toMatchObject({ currentLevel: 2 });
  });

  it('a manual escalation is recorded as manual, not automatic', async () => {
    const ticketId = await newTicket();
    const l1Token = await loginAsPoc(app, L1);
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(l1Token)).send({ outcome: 'ESCALATED', note: 'Needs the lead.' }).expect(200);
    const [event] = await events(ticketId, 'ESCALATED');
    expect(event).toMatchObject({ reason: 'MANUAL', actorId: await userId(L1) });
    expect(await events(ticketId, 'TAT_BREACHED')).toHaveLength(0);
  });

  describe('trigger endpoint for an external scheduler', () => {
    it('needs the secret', async () => {
      await request(server()).post('/internal/escalation/run').expect(401);
      await request(server()).post('/internal/escalation/run').set('x-job-secret', 'wrong-secret-wrong-secret').expect(401);
      await request(server()).post('/internal/escalation/run').set('x-job-secret', 'short').expect(401);
    });

    it('runs the job with the right secret and records a heartbeat', async () => {
      const ticketId = await newTicket();
      await makeOverdue(ticketId);
      const res = await request(server()).post('/internal/escalation/run').set('x-job-secret', process.env.JOB_SECRET!).expect(200);
      expect(res.body).toEqual({ escalated: expect.any(Number), flaggedCritical: expect.any(Number), warned: expect.any(Number) });
      expect(res.body.escalated).toBeGreaterThanOrEqual(1);
      expect(await row(ticketId)).toMatchObject({ currentLevel: 2 });

      const beat = await prisma().jobHeartbeat.findUniqueOrThrow({ where: { jobName: 'escalation' } });
      expect(Date.now() - beat.lastRunAt.getTime()).toBeLessThan(10_000);
    });
  });
});
