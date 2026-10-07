import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EscalationService } from '../src/escalation/escalation.service';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const HOUR = 36e5;

/**
 * The scenario runs in the Documents category, which no other spec uses, so every number is exact:
 *   A  L1 solves it                      B  L1 closes it
 *   C  L1 escalates, L2 solves it        D  L1 ignores it for 48h -> automatic escalation to L2, still open
 */
describe('Analytics (e2e)', () => {
  let app: INestApplication;
  let studentToken: string;
  let l1: string;
  let l2: string;
  let l3: string;
  let feesL2: string;
  let admin: string;
  let documentsId: string;
  let d: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const get = (path: string, token: string) => request(server()).get(path).set(auth(token));

  async function ticket(title: string, description: string, subIndex = 0) {
    const cat = await categoryByShortName(app, 'Documents');
    const res = await request(server())
      .post('/tickets')
      .set(auth(studentToken))
      .send({ subCategoryId: cat.subCategories[subIndex].id, title, description })
      .expect(201);
    return res.body.id as string;
  }
  const close = (token: string, id: string, outcome: string) =>
    request(server()).post(`/poc/tickets/${id}/close`).set(auth(token)).send({ outcome, note: 'Handled as asked.' }).expect(200);

  beforeAll(async () => {
    app = await createTestApp();
    studentToken = await registerAndLogin(app, uniqueStudentEmail());
    l1 = await loginAsPoc(app, 'documents.l1.1@newtonschool.co');
    l2 = await loginAsPoc(app, 'documents.l2@newtonschool.co');
    l3 = await loginAsPoc(app, 'documents.l3@newtonschool.co');
    feesL2 = await loginAsPoc(app, 'fees.l2@newtonschool.co');
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    documentsId = (await categoryByShortName(app, 'Documents')).id;

    const a = await ticket('Bonafide certificate needed', 'I need a bonafide certificate for a visa application.');
    const b = await ticket('Bonafide certificate again', 'Please issue a bonafide certificate, the earlier one expired.');
    const c = await ticket('Gap certificate request', 'Requesting a gap certificate for my records.', 1);
    d = await ticket('Upload fails on portal', 'Admission document upload fails with an error.', 2);

    await close(l1, a, 'SOLVED');
    await close(l1, b, 'CLOSED');
    await close(l1, c, 'ESCALATED');
    await close(l2, c, 'SOLVED');
    await prismaOf(app).ticket.update({ where: { id: d }, data: { tatDeadline: new Date(Date.now() - HOUR) } });
    await app.get(EscalationService).runOnce();
  });
  afterAll(async () => {
    await app.close();
  });

  it('My analytics for L1 counts what that POC did, including the automatic escalation away from them', async () => {
    const { body } = await get('/analytics/me', l1).expect(200);
    expect(body.headline).toMatchObject({
      solved: 1,
      closed: 1,
      escalated: 1,
      finished: 2,
      autoEscalatedFrom: 1, // D: held 48h without acting
      autoEscalatedTo: 0,
      actionNeeded: 0, // everything has left L1's queue
      total: 4,
    });
    expect(body.categories).toEqual([expect.objectContaining({ name: 'Documents', count: 4 })]);
    expect(body.headline.avgFinishHours).toBeGreaterThanOrEqual(0);
    expect(body.headline.withinTatPct).toBe(100);
    // Two tickets finished within the first day.
    expect(body.finishTimes).toHaveLength(10);
    expect(body.finishTimes[0]).toEqual({ days: 1, count: 2 });
  });

  it('My analytics for L2 shows the inherited ticket and the one they solved', async () => {
    const { body } = await get('/analytics/me', l2).expect(200);
    expect(body.headline).toMatchObject({
      solved: 1,
      closed: 0,
      autoEscalatedTo: 1, // D reached L2 because L1 ran out of time
      autoEscalatedFrom: 0,
      actionNeeded: 1, // D
      total: 2, // C and D
    });
    expect(body.finishTimes.reduce((n: number, b: { count: number }) => n + b.count, 0)).toBe(1); // C, counted from when the student raised it
  });

  it('Team analytics lists the POCs below, alphabetically, with their own numbers', async () => {
    const l2Team = (await get('/analytics/team', l2).expect(200)).body;
    expect(l2Team.members).toHaveLength(1);
    expect(l2Team.members[0].headline).toMatchObject({ solved: 1, closed: 1, escalated: 1, autoEscalatedFrom: 1 });
    expect(l2Team.headline.total).toBe(4);

    const l3Team = (await get('/analytics/team', l3).expect(200)).body;
    expect(l3Team.members.map((m: { level: number }) => m.level).sort()).toEqual([1, 2]);
  });

  it('splits open tickets by how much of their 48h is left', async () => {
    await prismaOf(app).ticket.update({ where: { id: d }, data: { tatDeadline: new Date(Date.now() + 10 * HOUR) } });
    const me = (await get('/analytics/me', l2).expect(200)).body;
    expect(me.timeLeft).toMatchObject({ overdue: 0, within12h: 1, later: 0 });
    await prismaOf(app).ticket.update({ where: { id: d }, data: { tatDeadline: new Date(Date.now() + 40 * HOUR) } });
  });

  it('ignores assignments left behind in retired categories', async () => {
    const prisma = prismaOf(app);
    const l2Row = await prisma.pOCAssignment.findFirstOrThrow({ where: { categoryId: documentsId, level: 2 }, include: { user: true } });
    const l1User = await prisma.user.findUniqueOrThrow({ where: { email: 'documents.l1.1@newtonschool.co' } });
    const retired = await prisma.category.create({ data: { name: `Retired ${Date.now()}`, shortName: '', active: false } });
    const stale = await prisma.pOCAssignment.create({
      data: { userId: l1User.id, categoryId: retired.id, level: 1, managerAssignmentId: l2Row.id, active: true },
    });
    try {
      const { body } = await get('/analytics/team', l2).expect(200);
      expect(body.members).toHaveLength(1);
      expect(body.categories.every((c: { name: string }) => c.name !== '')).toBe(true);
    } finally {
      await prisma.pOCAssignment.delete({ where: { id: stale.id } });
      await prisma.category.delete({ where: { id: retired.id } });
    }
  });

  it('Overall analytics covers the whole category, every level', async () => {
    const { body } = await get('/analytics/overall', l2).expect(200);
    expect(body.headline).toMatchObject({
      solved: 2,
      closed: 1,
      manualEscalations: 1,
      autoEscalatedFrom: 1,
      autoEscalatedTo: 1,
      total: 4,
      actionNeeded: 1,
    });
    expect(body.trend.reduce((n: number, p: { created: number }) => n + p.created, 0)).toBe(4);
    expect(body.trend.reduce((n: number, p: { autoEscalated: number }) => n + p.autoEscalated, 0)).toBe(1);
    expect(body.trend.reduce((n: number, p: { manualEscalated: number }) => n + p.manualEscalated, 0)).toBe(1);
    expect(body.phrases).toEqual(expect.arrayContaining([expect.objectContaining({ term: 'bonafide certificate', count: 2 })]));
    expect(body.subCategories.length).toBe(3);
  });

  it('keeps each POC to their own category', async () => {
    const { body } = await get('/analytics/overall', feesL2).expect(200);
    expect(body.headline.total).toBe(0);
    expect(body.categories).toEqual([]);
  });

  it('is closed to the wrong people', async () => {
    await get('/analytics/team', l1).expect(403);
    await get('/analytics/overall', l1).expect(200); // L1 may see the whole category, read only
    for (const path of ['me', 'team', 'overall', 'admin', 'admin/categories']) {
      await get(`/analytics/${path}`, studentToken).expect(403);
      await request(server()).get(`/analytics/${path}`).expect(401);
    }
    await get('/analytics/admin', l3).expect(403);
    await get('/analytics/me', admin).expect(403); // the admin has no queue of their own
  });

  it('gives the Super Admin everything, filterable by category, level and POC', async () => {
    const all = (await get('/analytics/admin', admin).expect(200)).body;
    expect(all.breakdown.length).toBeGreaterThanOrEqual(11); // one row per category
    const docsRow = all.breakdown.find((r: { name: string }) => r.name === 'Documents');
    expect(docsRow.headline).toMatchObject({ solved: 2, closed: 1, total: 4 });

    const one = (await get(`/analytics/admin?categoryId=${documentsId}`, admin).expect(200)).body;
    expect(one.headline.total).toBe(4);
    expect(one.breakdown.map((r: { level: number }) => r.level)).toEqual([1, 2, 3]); // POCs of that category

    const levelTwo = (await get(`/analytics/admin?categoryId=${documentsId}&level=2`, admin).expect(200)).body;
    expect(levelTwo.headline).toMatchObject({ solved: 1, total: 2 });
    // With a level chosen, the per-POC list holds only that level, not the whole category.
    expect(levelTwo.breakdown.map((r: { level: number }) => r.level)).toEqual([2]);

    const l2Id = (await prismaOf(app).user.findUniqueOrThrow({ where: { email: 'documents.l2@newtonschool.co' } })).id;
    const poc = (await get(`/analytics/admin?pocId=${l2Id}`, admin).expect(200)).body;
    expect(poc.headline).toMatchObject({ solved: 1, total: 2 });
  });

  it('tells the menu which pages each person may open', async () => {
    expect((await get('/analytics/access', l1).expect(200)).body).toMatchObject({ me: true, team: false, overall: true, admin: false });
    expect((await get('/analytics/access', l3).expect(200)).body).toMatchObject({ me: true, team: true, overall: true, admin: false });
    expect((await get('/analytics/access', admin).expect(200)).body).toMatchObject({ admin: true });
    await get('/analytics/access', studentToken).expect(403);
  });

  it('validates dates and ranges', async () => {
    await get('/analytics/me?from=2026-10-10&to=2026-10-01', l1).expect(400);
    await get('/analytics/me?from=2024-01-01&to=2026-10-01', l1).expect(400);
    await get('/analytics/me?from=yesterday', l1).expect(400);
    await get('/analytics/admin?categoryId=not-a-uuid', admin).expect(400);
    const week = (await get('/analytics/me?from=2026-10-01&to=2026-10-07', l1).expect(200)).body;
    expect(week.trend).toHaveLength(7);
  });
});
