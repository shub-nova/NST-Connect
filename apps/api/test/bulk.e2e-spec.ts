import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

/** Bulk actions in the POC queue, in the Campus & IT category (no other spec uses it). */
describe('Bulk actions on tickets (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let l1: string;
  let l2: string;
  let otherL1: string;
  let subId: string;
  let studentId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const bulk = (token: string, body: object) => request(server()).post('/poc/tickets/bulk').set(auth(token)).send(body);
  const row = (id: string) => prisma().ticket.findUniqueOrThrow({ where: { id } });

  async function tickets(n: number, title = 'Campus Wi-Fi is down') {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const res = await request(server())
        .post('/tickets')
        .set(auth(student))
        .send({ subCategoryId: subId, title: `${title} ${i + 1}`, description: 'The campus Wi-Fi has been down since the morning.' })
        .expect(201);
      ids.push(res.body.id);
    }
    return ids;
  }

  beforeAll(async () => {
    app = await createTestApp();
    student = await registerAndLogin(app, uniqueStudentEmail());
    studentId = (await prisma().user.findFirstOrThrow({ where: { role: 'STUDENT' }, orderBy: { createdAt: 'desc' } })).id;
    l1 = await loginAsPoc(app, 'campus.l1.1@newtonschool.co');
    l2 = await loginAsPoc(app, 'campus.l2@newtonschool.co');
    otherL1 = await loginAsPoc(app, 'fees.l1.1@newtonschool.co');
    subId = (await categoryByShortName(app, 'Campus & IT')).subCategories[0].id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('solves many tickets at once, each with its own history and its own student notice', async () => {
    const ids = await tickets(4);
    const res = await bulk(l1, { ticketIds: ids, action: 'SOLVED', note: 'The Wi-Fi controller was restarted.' }).expect(200);
    expect(res.body).toEqual({ done: 4, failed: [] });

    for (const id of ids) {
      expect(await row(id)).toMatchObject({ status: 'RESOLVED', tatDeadline: null });
      const ev = await prisma().ticketEvent.findFirstOrThrow({ where: { ticketId: id, type: 'RESOLVED' } });
      expect(ev.note).toBe('The Wi-Fi controller was restarted.');
      expect(await prisma().notification.count({ where: { ticketId: id, type: 'RESOLVED' } })).toBe(1);
    }
    // A student reads it like any other solved ticket.
    const view = (await request(server()).get(`/tickets/${ids[0]}`).set(auth(student)).expect(200)).body;
    expect(view.statusLabel).toBe('Solved');
  });

  it('closes many tickets at once', async () => {
    const ids = await tickets(2, 'Duplicate report');
    const res = await bulk(l1, { ticketIds: ids, action: 'CLOSED', note: 'Duplicate of the open Wi-Fi outage.' }).expect(200);
    expect(res.body.done).toBe(2);
    for (const id of ids) expect(await row(id)).toMatchObject({ status: 'CLOSED' });
  });

  it('escalates many tickets, balancing them across the next level, with the reason kept for staff', async () => {
    const ids = await tickets(3, 'Needs an engineer');
    const res = await bulk(l1, { ticketIds: ids, action: 'ESCALATED', note: 'Needs the network team.' }).expect(200);
    expect(res.body).toEqual({ done: 3, failed: [] });
    for (const id of ids) {
      expect(await row(id)).toMatchObject({ status: 'ESCALATED', currentLevel: 2 });
      const ev = await prisma().ticketEvent.findFirstOrThrow({ where: { ticketId: id, type: 'ESCALATED' } });
      expect(ev).toMatchObject({ reason: 'MANUAL', note: 'Needs the network team.' });
    }
    // Students see only a generic team label, never the reason.
    const view = JSON.stringify((await request(server()).get(`/tickets/${ids[0]}`).set(auth(student)).expect(200)).body);
    expect(view).toMatch(/Escalated to Campus & IT team/);
    expect(view).not.toContain('network team');
    // L2 can now bulk-solve what arrived.
    expect((await bulk(l2, { ticketIds: ids, action: 'SOLVED', note: 'Fixed by the network team.' }).expect(200)).body.done).toBe(3);
  });

  it('sends one reply to many tickets and marks them in progress', async () => {
    const ids = await tickets(3, 'Where is the update');
    const res = await bulk(l1, { ticketIds: ids, action: 'REPLY', note: 'We are working on it and will update you today.' }).expect(200);
    expect(res.body.done).toBe(3);
    for (const id of ids) {
      expect(await row(id)).toMatchObject({ status: 'IN_PROGRESS' });
      const c = await prisma().comment.findFirstOrThrow({ where: { ticketId: id } });
      expect(c).toMatchObject({ visibility: 'PUBLIC', body: 'We are working on it and will update you today.' });
      expect(c.authorId).not.toBe(studentId);
    }
  });

  it('reports the tickets it could not change and still does the rest', async () => {
    const [fresh, alreadyDone] = await tickets(2, 'Mixed batch');
    await bulk(l1, { ticketIds: [alreadyDone], action: 'SOLVED', note: 'Solved on its own.' }).expect(200);

    const res = await bulk(l1, { ticketIds: [fresh, alreadyDone, '11111111-1111-4111-8111-111111111111'], action: 'SOLVED', note: 'Sorted in bulk.' }).expect(200);
    expect(res.body.done).toBe(1);
    expect(res.body.failed.map((f: { id: string }) => f.id).sort()).toEqual([alreadyDone, '11111111-1111-4111-8111-111111111111'].sort());
    expect(res.body.failed.every((f: { reason: string }) => f.reason.length > 0)).toBe(true);
    expect(await row(fresh)).toMatchObject({ status: 'RESOLVED' });
  });

  it('counts a repeated id once', async () => {
    const [id] = await tickets(1, 'Repeated id');
    const res = await bulk(l1, { ticketIds: [id, id, id], action: 'SOLVED', note: 'Done once only.' }).expect(200);
    expect(res.body).toEqual({ done: 1, failed: [] });
    expect(await prisma().ticketEvent.count({ where: { ticketId: id, type: 'RESOLVED' } })).toBe(1);
  });

  it('never touches tickets outside the POC’s own category and level', async () => {
    const [id] = await tickets(1, 'Not yours');
    const res = await bulk(otherL1, { ticketIds: [id], action: 'CLOSED', note: 'Trying to close it.' }).expect(200);
    expect(res.body.done).toBe(0);
    expect(res.body.failed).toHaveLength(1);
    expect(await row(id)).toMatchObject({ status: 'ASSIGNED' });
    const [l2Scope] = await tickets(1, 'Still at level one');
    expect((await bulk(l2, { ticketIds: [l2Scope], action: 'SOLVED', note: 'Wrong level for me.' }).expect(200)).body.done).toBe(0);
  });

  it('validates the request', async () => {
    const [id] = await tickets(1, 'Validation');
    await bulk(l1, { ticketIds: [], action: 'SOLVED', note: 'Nothing selected.' }).expect(400);
    await bulk(l1, { ticketIds: Array.from({ length: 51 }, () => '11111111-1111-4111-8111-111111111111'), action: 'SOLVED', note: 'Too many at once.' }).expect(400);
    await bulk(l1, { ticketIds: [id], action: 'SOLVED', note: 'no' }).expect(400); // note too short to finish a ticket
    await bulk(l1, { ticketIds: [id], action: 'REPLY', note: '' }).expect(400);
    await bulk(l1, { ticketIds: ['not-a-uuid'], action: 'SOLVED', note: 'Bad id here.' }).expect(400);
    await bulk(l1, { ticketIds: [id], action: 'DELETE', note: 'Not an action.' }).expect(400);
    expect(await row(id)).toMatchObject({ status: 'ASSIGNED' }); // nothing happened
  });

  it('is closed to students and the signed-out', async () => {
    const [id] = await tickets(1, 'Student attempt');
    await bulk(student, { ticketIds: [id], action: 'SOLVED', note: 'I fixed it myself.' }).expect(403);
    await request(server()).post('/poc/tickets/bulk').send({ ticketIds: [id], action: 'SOLVED', note: 'No login at all.' }).expect(401);
    expect(await row(id)).toMatchObject({ status: 'ASSIGNED' });
  });
});
