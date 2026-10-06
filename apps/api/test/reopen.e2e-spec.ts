import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

describe('Reopening a finished ticket (e2e)', () => {
  let app: INestApplication;
  let studentToken: string;
  let academicsId: string;
  let academicsSubId: string;
  let forbidden: string[]; // every staff id, email and name: none may reach a student

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const COMMENT = 'The fix did not work: the portal still shows the same error.';

  /** A fresh Academics ticket, plus the L1 POC it was routed to. */
  async function newTicket(token = studentToken) {
    const res = await request(server())
      .post('/tickets')
      .set(auth(token))
      .send({ subCategoryId: academicsSubId, title: 'Portal error', description: 'The course portal shows an error page every time.' })
      .expect(201);
    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: res.body.id }, include: { assignedPoc: true } });
    return { ticketId: res.body.id as string, l1Token: await loginAsPoc(app, row.assignedPoc!.email), l1Email: row.assignedPoc!.email };
  }

  const finish = (token: string, ticketId: string, outcome: 'SOLVED' | 'CLOSED', note = 'We fixed the portal access.') =>
    request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(token)).send({ outcome, note }).expect(200);

  const L2 = 'academics.l2@newtonschool.co';
  const L3 = 'academics.l3@newtonschool.co';
  const escalate = (token: string, ticketId: string) =>
    request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(token)).send({ outcome: 'ESCALATED', note: 'Needs the next level.' }).expect(200);

  const reopen = (ticketId: string, comment: unknown = COMMENT, token = studentToken) =>
    request(server()).post(`/tickets/${ticketId}/reopen`).set(auth(token)).send({ comment });

  function assertNoStaffIdentity(label: string, body: unknown) {
    const json = JSON.stringify(body);
    for (const value of forbidden) {
      if (json.includes(value)) throw new Error(`${label} leaked staff identity "${value}"`);
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    studentToken = await registerAndLogin(app, uniqueStudentEmail());
    const academics = await categoryByShortName(app, 'Academics');
    academicsId = academics.id;
    academicsSubId = academics.subCategories[0].id;
    const staff = await prismaOf(app).user.findMany({ where: { role: { in: ['POC', 'SUPER_ADMIN'] } } });
    forbidden = staff.flatMap((u) => [u.id, u.email, u.name]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('a student can reopen a Solved ticket with a comment; it returns to the same level and POC', async () => {
    const { ticketId, l1Token, l1Email } = await newTicket();
    const detail = () => request(server()).get(`/tickets/${ticketId}`).set(auth(studentToken)).expect(200);
    expect((await detail()).body.canReopen).toBe(false); // still open
    await finish(l1Token, ticketId, 'SOLVED');
    expect((await detail()).body.canReopen).toBe(true); // finished by L1: the student may reopen

    const res = await reopen(ticketId).expect(200);
    expect(res.body).toMatchObject({ status: 'REOPENED', statusLabel: 'Reopened', resolvedAt: null, canReopen: false });

    const prisma = prismaOf(app);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { assignedPoc: true } });
    expect(row).toMatchObject({ status: 'REOPENED', currentLevel: 1, resolvedAt: null, resolvedLevel: null });
    expect(row.assignedPoc!.email).toBe(l1Email);
    const hours = (row.tatDeadline!.getTime() - Date.now()) / 36e5;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);

    // Audit trail and notification.
    const event = await prisma.ticketEvent.findFirstOrThrow({ where: { ticketId, type: 'REOPENED' } });
    expect(event).toMatchObject({ fromStatus: 'RESOLVED', toStatus: 'REOPENED', fromLevel: 1, toLevel: 1 });
    expect(await prisma.notification.count({ where: { ticketId, userId: row.assignedPocId!, type: 'COMMENT' } })).toBeGreaterThan(0);

    // The student's own comment shows as "You"; nothing identifies staff.
    const labels = res.body.timeline.map((e: { label: string }) => e.label);
    expect(labels.slice(-3)).toEqual(['Solved', 'Reopened', 'You']);
    expect(res.body.timeline.at(-1).message).toBe(COMMENT);
    assertNoStaffIdentity('student detail after reopen', res.body);
  });

  it('the POC sees it back in their queue as Reopened, with the comment, and can work it again', async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'SOLVED');
    await reopen(ticketId).expect(200);

    const queue = await request(server()).get('/poc/queue').set(auth(l1Token)).expect(200);
    const item = queue.body.tickets.find((t: { id: string }) => t.id === ticketId);
    expect(item.status).toBe('REOPENED');
    const done = await request(server()).get('/poc/queue?view=done').set(auth(l1Token)).expect(200);
    expect(done.body.tickets.map((t: { id: string }) => t.id)).not.toContain(ticketId);

    const detail = await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(l1Token)).expect(200);
    const comment = detail.body.thread.find((i: { kind: string; author?: { role: string } }) => i.kind === 'comment' && i.author?.role === 'STUDENT');
    expect(comment.body).toBe(COMMENT);
    expect(detail.body.thread.some((i: { label?: string }) => i.label === 'Reopened')).toBe(true);

    // The first reply moves it to In progress, and it can be finished again.
    const replied = await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(l1Token)).send({ body: 'Thanks, taking another look.' }).expect(201);
    expect(replied.body.status).toBe('IN_PROGRESS');
    await finish(l1Token, ticketId, 'SOLVED', 'Cleared the cache on the server and re-tested.');
  });

  it('a Closed ticket can be reopened too', async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'CLOSED', 'Duplicate request.');
    const res = await reopen(ticketId, 'It is not a duplicate: this is a different course.').expect(200);
    expect(res.body.status).toBe('REOPENED');
  });

  it('it can be reopened again if the next fix does not work (repeatable)', async () => {
    const { ticketId, l1Token } = await newTicket();
    for (let round = 1; round <= 2; round++) {
      await finish(l1Token, ticketId, 'SOLVED', `Fix attempt number ${round}.`);
      await reopen(ticketId, `Still broken after attempt ${round}, please look again.`).expect(200);
    }
    expect((await prismaOf(app).ticketEvent.count({ where: { ticketId, type: 'REOPENED' } }))).toBe(2);
  });

  it('a ticket finished by L2 can be reopened and returns to L2, not L1', async () => {
    const { ticketId, l1Token } = await newTicket();
    await escalate(l1Token, ticketId);
    const l2Token = await loginAsPoc(app, L2);
    await finish(l2Token, ticketId, 'SOLVED', 'Agreed a schedule change.');

    const detail = await request(server()).get(`/tickets/${ticketId}`).set(auth(studentToken)).expect(200);
    expect(detail.body.canReopen).toBe(true); // L2 is not the top level

    const res = await reopen(ticketId).expect(200);
    expect(res.body.status).toBe('REOPENED');
    expect(await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ currentLevel: 2 });
    await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(l1Token)).expect(404);
    await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(l2Token)).expect(200);
  });

  it('a ticket finished by the top level (L3) is final and cannot be reopened', async () => {
    for (const outcome of ['SOLVED', 'CLOSED'] as const) {
      const { ticketId, l1Token } = await newTicket();
      await escalate(l1Token, ticketId);
      await escalate(await loginAsPoc(app, L2), ticketId);
      await finish(await loginAsPoc(app, L3), ticketId, outcome, 'The department head made the final decision.');

      const detail = await request(server()).get(`/tickets/${ticketId}`).set(auth(studentToken)).expect(200);
      expect(detail.body.canReopen).toBe(false);
      expect(detail.body.status).toBe(outcome === 'SOLVED' ? 'RESOLVED' : 'CLOSED');
      assertNoStaffIdentity('student detail of a final ticket', detail.body);

      const refused = await reopen(ticketId).expect(409);
      expect(JSON.stringify(refused.body)).toContain('final');
      expect((await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe(outcome === 'SOLVED' ? 'RESOLVED' : 'CLOSED');
      expect(await prismaOf(app).ticketEvent.count({ where: { ticketId, type: 'REOPENED' } })).toBe(0);
    }
  });

  it('a reopened ticket that L3 finishes becomes final', async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'SOLVED');
    await reopen(ticketId).expect(200);
    await escalate(l1Token, ticketId);
    await escalate(await loginAsPoc(app, L2), ticketId);
    await finish(await loginAsPoc(app, L3), ticketId, 'CLOSED', 'Final decision: not possible.');
    await reopen(ticketId).expect(409);
  });

  it('if nobody is on duty at the finishing level it goes to the next level up', async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'SOLVED');
    const prisma = prismaOf(app);
    // Remember exactly who was active so cleanup restores that, not "everyone".
    const before = await prisma.pOCAssignment.findMany({ where: { categoryId: academicsId, level: { in: [1, 2, 3] } } });
    await prisma.pOCAssignment.updateMany({ where: { categoryId: academicsId, level: 1 }, data: { active: false } });
    try {
      const res = await reopen(ticketId).expect(200);
      expect(res.body.status).toBe('REOPENED');
      expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ currentLevel: 2 });
    } finally {
      for (const a of before) await prisma.pOCAssignment.update({ where: { id: a.id }, data: { active: a.active } });
    }
  });

  it('if nobody at all is on duty to take it, the reopen is refused and nothing changes', async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'SOLVED');
    const prisma = prismaOf(app);
    const before = await prisma.pOCAssignment.findMany({ where: { categoryId: academicsId, level: { in: [1, 2, 3] } } });
    await prisma.pOCAssignment.updateMany({ where: { categoryId: academicsId, level: { in: [1, 2, 3] } }, data: { active: false } });
    try {
      const refused = await reopen(ticketId).expect(409);
      expect(JSON.stringify(refused.body)).toContain('cannot be reopened right now');
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('RESOLVED');
      expect(await prisma.comment.count({ where: { ticketId, author: { role: 'STUDENT' } } })).toBe(0);
    } finally {
      for (const a of before) await prisma.pOCAssignment.update({ where: { id: a.id }, data: { active: a.active } });
    }
  });

  it('needs a real comment', async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'SOLVED');
    await request(server()).post(`/tickets/${ticketId}/reopen`).set(auth(studentToken)).send({}).expect(400); // no comment at all
    await reopen(ticketId, '').expect(400);
    await reopen(ticketId, '   ').expect(400);
    await reopen(ticketId, 'no').expect(400);
    await reopen(ticketId, 'x'.repeat(2001)).expect(400);
    expect((await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('RESOLVED');
  });

  it('only a finished ticket can be reopened', async () => {
    const { ticketId, l1Token } = await newTicket();
    const open = await reopen(ticketId).expect(409); // assigned, not finished
    expect(JSON.stringify(open.body)).toContain('finished');
    await request(server()).post(`/poc/tickets/${ticketId}/status`).set(auth(l1Token)).send({ status: 'IN_PROGRESS' }).expect(200);
    await reopen(ticketId).expect(409);
    await finish(l1Token, ticketId, 'SOLVED');
    await reopen(ticketId).expect(200);
    await reopen(ticketId).expect(409); // already reopened
  });

  it("only the ticket's own student can reopen it; POCs and anonymous users cannot", async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'SOLVED');

    const other = await registerAndLogin(app, uniqueStudentEmail());
    await reopen(ticketId, COMMENT, other).expect(404);
    await reopen(ticketId, COMMENT, l1Token).expect(403);
    await request(server()).post(`/tickets/${ticketId}/reopen`).send({ comment: COMMENT }).expect(401);
    await request(server()).post('/tickets/not-a-uuid/reopen').set(auth(studentToken)).send({ comment: COMMENT }).expect(400);
    expect((await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('RESOLVED');
  });

  it('two simultaneous reopens: exactly one succeeds and only one event is written', async () => {
    const { ticketId, l1Token } = await newTicket();
    await finish(l1Token, ticketId, 'SOLVED');
    const results = await Promise.all([reopen(ticketId).then((r) => r.status), reopen(ticketId).then((r) => r.status)]);
    expect(results.sort()).toEqual([200, 409]);
    expect(await prismaOf(app).ticketEvent.count({ where: { ticketId, type: 'REOPENED' } })).toBe(1);
    expect(await prismaOf(app).comment.count({ where: { ticketId, author: { role: 'STUDENT' } } })).toBe(1);
  });
});
