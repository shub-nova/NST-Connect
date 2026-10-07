import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EscalationService } from '../src/escalation/escalation.service';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const HOUR = 36e5;

/** A student closing their own ticket, in Mess & Food (no other spec asserts on that category). */
describe('Student closes their own ticket (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let otherStudent: string;
  let l1: string;
  let l2: string;
  let admin: string;
  let categoryId: string;
  let subId: string;
  let staffSecrets: string[] = [];

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const get = (path: string, t: string) => request(server()).get(path).set(auth(t));
  const post = (path: string, t: string, body: object = {}) => request(server()).post(path).set(auth(t)).send(body);
  const row = (id: string) => prisma().ticket.findUniqueOrThrow({ where: { id } });
  const closeOwn = (id: string, token = student) => post(`/tickets/${id}/close`, token);

  async function ticket(title: string) {
    return (await post('/tickets', student, { subCategoryId: subId, title, description: 'The mess timings were changed without notice.' }).expect(201)).body.id as string;
  }
  const queue = async (token: string, view: 'open' | 'done') => (await get(`/poc/queue?view=${view}&limit=50`, token).expect(200)).body;

  beforeAll(async () => {
    app = await createTestApp();
    student = await registerAndLogin(app, uniqueStudentEmail());
    otherStudent = await registerAndLogin(app, uniqueStudentEmail());
    l1 = await loginAsPoc(app, 'mess.l1.1@newtonschool.co');
    l2 = await loginAsPoc(app, 'mess.l2@newtonschool.co');
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    const cat = await categoryByShortName(app, 'Mess & Food');
    categoryId = cat.id;
    subId = cat.subCategories[0].id;
    staffSecrets = (await prisma().user.findMany({ where: { role: { in: ['POC', 'SUPER_ADMIN'] } } })).flatMap((u) => [u.id, u.email]);
  });
  afterAll(async () => {
    await app.close();
  });

  let id: string;

  it('closes the ticket, stops its clock and tells the student plainly', async () => {
    id = await ticket('Mess timing changed');
    expect((await queue(l1, 'open')).tickets.map((t: { id: string }) => t.id)).toContain(id);

    const res = await closeOwn(id).expect(200);
    expect(res.body).toMatchObject({ status: 'CLOSED', statusLabel: 'Closed by you', closedByYou: true, canGiveFeedback: false, feedback: null, canReopen: true });
    expect(res.body.timeline.map((e: { label: string }) => e.label)).toContain('You closed this ticket');
    expect(await row(id)).toMatchObject({ status: 'CLOSED', closedByStudent: true, tatDeadline: null, critical: false });

    const text = JSON.stringify(res.body);
    for (const secret of staffSecrets) expect(text).not.toContain(secret);
  });

  it('removes it from the POC’s open queue and keeps it as history in Done', async () => {
    const open = await queue(l1, 'open');
    expect(open.tickets.map((t: { id: string }) => t.id)).not.toContain(id);
    const done = await queue(l1, 'done');
    const mine = done.tickets.find((t: { id: string }) => t.id === id);
    expect(mine).toMatchObject({ status: 'CLOSED', closedByStudent: true });
    expect(open.counts.done).toBeGreaterThanOrEqual(1);
  });

  it('leaves the POC a heads-up notification', async () => {
    const owner = (await row(id)).assignedPocId!;
    expect(await prisma().notification.count({ where: { userId: owner, ticketId: id, type: 'STATUS_CHANGE' } })).toBeGreaterThanOrEqual(1);
  });

  it('cannot be worked on any more, including in bulk and by the escalation job', async () => {
    await post(`/poc/tickets/${id}/comments`, l1, { body: 'Hello?' }).expect(409);
    await post(`/poc/tickets/${id}/close`, l1, { outcome: 'SOLVED', note: 'Trying to solve it.' }).expect(409);
    const bulk = await post('/poc/tickets/bulk', l1, { ticketIds: [id], action: 'SOLVED', note: 'Bulk attempt.' }).expect(200);
    expect(bulk.body).toMatchObject({ done: 0 });
    expect(bulk.body.failed).toHaveLength(1);

    await prisma().ticket.update({ where: { id }, data: { tatDeadline: new Date(Date.now() - HOUR) } }); // even with an old deadline
    await app.get(EscalationService).runOnce();
    expect(await row(id)).toMatchObject({ status: 'CLOSED', currentLevel: 1 });
  });

  it('does not count as a POC outcome in analytics, and gets no satisfaction question', async () => {
    const me = (await get('/analytics/me', l1).expect(200)).body.headline;
    expect(me).toMatchObject({ solved: 0, closed: 0, finished: 0, actionNeeded: 0 });
    const all = (await get(`/analytics/admin?categoryId=${categoryId}`, admin).expect(200)).body.headline;
    expect(all).toMatchObject({ solved: 0, closed: 0, finished: 0 });
    await post(`/tickets/${id}/feedback`, student, { rating: 'SATISFIED' }).expect(409);
  });

  it('can be reopened by the student, back to the level it was at', async () => {
    const t2 = await ticket('Escalated then closed');
    await post(`/poc/tickets/${t2}/close`, l1, { outcome: 'ESCALATED', note: 'Needs a senior look.' }).expect(200);
    expect(await row(t2)).toMatchObject({ currentLevel: 2 });

    await closeOwn(t2).expect(200);
    const reopened = await post(`/tickets/${t2}/reopen`, student, { comment: 'Actually I still need this.' }).expect(200);
    expect(reopened.body).toMatchObject({ status: 'REOPENED', closedByYou: false });
    expect(await row(t2)).toMatchObject({ status: 'REOPENED', currentLevel: 2, closedByStudent: false });
    expect((await queue(l2, 'open')).tickets.map((t: { id: string }) => t.id)).toContain(t2);

    // Closed by the student again at the top level: still reopenable, since no POC made a final decision.
    await post(`/poc/tickets/${t2}/close`, l2, { outcome: 'ESCALATED', note: 'Over to the top level.' }).expect(200);
    const l3 = await loginAsPoc(app, 'mess.l3@newtonschool.co');
    expect((await queue(l3, 'open')).tickets.map((t: { id: string }) => t.id)).toContain(t2);
    await closeOwn(t2).expect(200);
    await post(`/tickets/${t2}/reopen`, student, { comment: 'Please look again.' }).expect(200);
    expect(await row(t2)).toMatchObject({ currentLevel: 3, status: 'REOPENED' });
  });

  it('only works on the student’s own open tickets', async () => {
    const t3 = await ticket('Someone else’s ticket');
    await closeOwn(t3, otherStudent).expect(404);
    await closeOwn(t3, l1).expect(403);
    await request(server()).post(`/tickets/${t3}/close`).expect(401);
    await closeOwn(t3).expect(200);
    await closeOwn(t3).expect(409); // already closed

    const solved = await ticket('Solved by a POC');
    await post(`/poc/tickets/${solved}/close`, l1, { outcome: 'SOLVED', note: 'Fixed.' }).expect(200);
    await closeOwn(solved).expect(409); // finished by the team, nothing left to close
  });
});
