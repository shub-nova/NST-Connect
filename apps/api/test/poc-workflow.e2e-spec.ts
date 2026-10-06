import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  categoryByShortName,
  createTestApp,
  loginAsPoc,
  prismaOf,
  registerAndLogin,
  uniqueStudentEmail,
} from './helpers';

// A real 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('POC workflow (e2e)', () => {
  let app: INestApplication;
  let studentToken: string;
  let academicsSubId: string;
  let forbidden: string[]; // every staff id, email and name: none may reach a student

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  /** A fresh Academics ticket, and a login for the L1 POC it was routed to. */
  async function ticketWithOwner(withAttachment = false) {
    const created = await request(server())
      .post('/tickets')
      .set(auth(studentToken))
      .send({ subCategoryId: academicsSubId, title: 'Portal error', description: 'The course portal shows an error page every time.' })
      .expect(201);
    const ticketId = created.body.id as string;

    if (withAttachment) {
      const slot = await request(server())
        .post(`/tickets/${ticketId}/attachments`)
        .set(auth(studentToken))
        .send({ fileName: 'error.png', mimeType: 'image/png', sizeBytes: PNG.length })
        .expect(201);
      await fetch(slot.body.uploadUrl, { method: 'PUT', headers: slot.body.headers, body: new Uint8Array(PNG) });
      await request(server()).post(`/attachments/${slot.body.attachmentId}/confirm`).set(auth(studentToken)).expect(200);
    }

    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId }, include: { assignedPoc: true } });
    const pocToken = await loginAsPoc(app, row.assignedPoc!.email);
    return { ticketId, pocToken, pocId: row.assignedPocId!, pocEmail: row.assignedPoc!.email };
  }

  const studentView = (ticketId: string) =>
    request(server()).get(`/tickets/${ticketId}`).set(auth(studentToken)).expect(200);

  function assertNoStaffIdentity(label: string, body: unknown) {
    const json = JSON.stringify(body);
    for (const value of forbidden) {
      if (json.includes(value)) throw new Error(`${label} leaked staff identity "${value}"`);
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    studentToken = await registerAndLogin(app, uniqueStudentEmail());
    academicsSubId = (await categoryByShortName(app, 'Academics')).subCategories[0].id;
    const staff = await prismaOf(app).user.findMany({ where: { role: { in: ['POC', 'SUPER_ADMIN'] } } });
    forbidden = staff.flatMap((u) => [u.id, u.email, u.name]);
  });
  afterAll(async () => {
    await app.close();
  });

  it('a POC can open a ticket in their queue, with the student and attachments', async () => {
    const { ticketId, pocToken } = await ticketWithOwner(true);
    const res = await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(pocToken)).expect(200);

    expect(res.body).toMatchObject({
      title: 'Portal error',
      status: 'ASSIGNED',
      category: { shortName: 'Academics' },
      currentLevel: 1,
    });
    expect(res.body.student.email).toMatch(/@adypu\.edu\.in$/);
    expect(res.body.attachments).toHaveLength(1);

    const dl = await request(server()).get(`/poc/attachments/${res.body.attachments[0].id}/download`).set(auth(pocToken)).expect(200);
    const file = await fetch(dl.body.url);
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);

    const queue = await request(server()).get('/poc/queue').set(auth(pocToken)).expect(200);
    expect(queue.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);
  });

  it('a POC cannot see or touch tickets outside their own category', async () => {
    const { ticketId } = await ticketWithOwner(true);
    const other = await loginAsPoc(app, 'hostel.l1.1@newtonschool.co');

    await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(other)).expect(404);
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(other)).send({ body: 'hello' }).expect(404);
    await request(server()).post(`/poc/tickets/${ticketId}/status`).set(auth(other)).send({ status: 'IN_PROGRESS' }).expect(404);
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(other)).send({ outcome: 'SOLVED', note: 'Done, thanks' }).expect(404);

    const attachment = await prismaOf(app).attachment.findFirstOrThrow({ where: { ticketId } });
    await request(server()).get(`/poc/attachments/${attachment.id}/download`).set(auth(other)).expect(404);

    const queue = await request(server()).get('/poc/queue').set(auth(other)).expect(200);
    expect(queue.body.tickets.map((t: { id: string }) => t.id)).not.toContain(ticketId);

    // And nothing changed.
    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.status).toBe('ASSIGNED');
  });

  it('students cannot use any POC endpoint', async () => {
    const { ticketId } = await ticketWithOwner();
    await request(server()).get('/poc/queue').set(auth(studentToken)).expect(403);
    await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(studentToken)).expect(403);
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(studentToken)).send({ body: 'hi' }).expect(403);
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(studentToken)).send({ outcome: 'SOLVED', note: 'self-resolve' }).expect(403);
    await request(server()).get(`/poc/tickets/${ticketId}`).expect(401);
  });

  it('replying marks the ticket in progress, claims it, restarts the clock and notifies the student', async () => {
    const { ticketId, pocToken, pocId } = await ticketWithOwner();
    const res = await request(server())
      .post(`/poc/tickets/${ticketId}/comments`)
      .set(auth(pocToken))
      .send({ body: 'Looking into this now, can you share a screenshot?' })
      .expect(201);

    expect(res.body.status).toBe('IN_PROGRESS');
    const comments = res.body.thread.filter((i: { kind: string }) => i.kind === 'comment');
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ body: 'Looking into this now, can you share a screenshot?', visibility: 'PUBLIC' });

    const prisma = prismaOf(app);
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.assignedPocId).toBe(pocId);
    const hours = (row.tatDeadline!.getTime() - Date.now()) / 36e5;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);

    const events = (await prisma.ticketEvent.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } })).map((e) => e.type);
    expect(events).toEqual(['CREATED', 'ASSIGNED', 'COMMENTED', 'STATUS_CHANGED']);

    const note = await prisma.notification.findFirstOrThrow({ where: { ticketId, type: 'COMMENT' } });
    expect(note.commentId).toBeTruthy();

    // A second reply adds a comment but no second status change.
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(pocToken)).send({ body: 'Thanks, got it.' }).expect(201);
    expect(await prisma.ticketEvent.count({ where: { ticketId, type: 'STATUS_CHANGED' } })).toBe(1);
  });

  it('what the student sees: the reply and the status, labelled by team, with no staff identity', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(pocToken)).send({ body: 'Please try clearing your cache.' }).expect(201);

    const res = await studentView(ticketId);
    expect(res.body.status).toBe('IN_PROGRESS');
    const labels = res.body.timeline.map((e: { label: string }) => e.label);
    expect(labels).toEqual(['Ticket created', 'Assigned to Academics team', 'Academics team replied', 'Marked in progress']);
    const reply = res.body.timeline.find((e: { type: string }) => e.type === 'COMMENTED');
    expect(reply.message).toBe('Please try clearing your cache.');
    assertNoStaffIdentity('student detail after reply', res.body);

    const list = await request(server()).get('/tickets').set(auth(studentToken)).expect(200);
    assertNoStaffIdentity('student list after reply', list.body);
  });

  it('marking in progress without replying works once, then reports a conflict', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const res = await request(server()).post(`/poc/tickets/${ticketId}/status`).set(auth(pocToken)).send({ status: 'IN_PROGRESS' }).expect(200);
    expect(res.body.status).toBe('IN_PROGRESS');
    await request(server()).post(`/poc/tickets/${ticketId}/status`).set(auth(pocToken)).send({ status: 'IN_PROGRESS' }).expect(409);
    await request(server()).post(`/poc/tickets/${ticketId}/status`).set(auth(pocToken)).send({ status: 'RESOLVED' }).expect(400);
    expect(await prismaOf(app).notification.count({ where: { ticketId, type: 'STATUS_CHANGE' } })).toBe(1);
  });

  it('solving needs a note; the student then sees the resolution', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const resolve = (body: Record<string, unknown>) =>
      request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(pocToken)).send({ outcome: 'SOLVED', ...body });

    await resolve({}).expect(400);
    await resolve({ note: '   ' }).expect(400);
    await resolve({ note: 'ok' }).expect(400);
    expect((await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('ASSIGNED');

    const res = await resolve({ note: 'Your portal access was restored. Please log in again.' }).expect(200);
    expect(res.body.status).toBe('RESOLVED');

    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row).toMatchObject({ status: 'RESOLVED', resolvedLevel: 1, tatDeadline: null });
    expect(row.resolvedAt).not.toBeNull();
    expect(await prismaOf(app).notification.count({ where: { ticketId, type: 'RESOLVED' } })).toBe(1);

    const student = await studentView(ticketId);
    expect(student.body.status).toBe('RESOLVED');
    expect(student.body.resolvedAt).toBeTruthy();
    const resolved = student.body.timeline.find((e: { type: string }) => e.type === 'RESOLVED');
    expect(resolved).toMatchObject({ label: 'Solved', message: 'Your portal access was restored. Please log in again.' });
    assertNoStaffIdentity('student detail after resolve', student.body);

    // It leaves the open queue and appears in the resolved one.
    const open = await request(server()).get('/poc/queue').set(auth(pocToken)).expect(200);
    expect(open.body.tickets.map((t: { id: string }) => t.id)).not.toContain(ticketId);
    const done = await request(server()).get('/poc/queue?view=done').set(auth(pocToken)).expect(200);
    expect(done.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);
  });

  it('a resolved ticket cannot be changed any more', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(pocToken)).send({ outcome: 'SOLVED', note: 'Resolved for now.' }).expect(200);
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(pocToken)).send({ body: 'late reply' }).expect(409);
    await request(server()).post(`/poc/tickets/${ticketId}/status`).set(auth(pocToken)).send({ status: 'IN_PROGRESS' }).expect(409);
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(pocToken)).send({ outcome: 'SOLVED', note: 'Resolved again.' }).expect(409);
  });

  it('rejects empty or oversized replies', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const reply = (body: unknown) => request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(pocToken)).send({ body });
    await reply('').expect(400);
    await reply('   ').expect(400);
    await reply('x'.repeat(5001)).expect(400);
    expect(await prismaOf(app).comment.count({ where: { ticketId } })).toBe(0);
  });

  it('finishing needs an explicit outcome and a note', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const finish = (body: Record<string, unknown>) =>
      request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(pocToken)).send(body);

    await finish({ note: 'No outcome chosen here' }).expect(400);
    await finish({ outcome: 'DONE', note: 'Not a real outcome' }).expect(400);
    for (const outcome of ['SOLVED', 'CLOSED', 'ESCALATED']) {
      await finish({ outcome }).expect(400);
      await finish({ outcome, note: 'ok' }).expect(400);
    }
    expect((await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } })).status).toBe('ASSIGNED');
  });

  it('closing without a fix: the student sees "Closed" and the reason', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const res = await request(server())
      .post(`/poc/tickets/${ticketId}/close`)
      .set(auth(pocToken))
      .send({ outcome: 'CLOSED', note: 'This is a duplicate of an existing request, so we are closing it.' })
      .expect(200);
    expect(res.body.status).toBe('CLOSED');

    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row).toMatchObject({ status: 'CLOSED', tatDeadline: null });
    expect(row.resolvedAt).not.toBeNull();
    expect(await prismaOf(app).ticketEvent.count({ where: { ticketId, type: 'CLOSED' } })).toBe(1);

    const student = await studentView(ticketId);
    expect(student.body).toMatchObject({ status: 'CLOSED', statusLabel: 'Closed' });
    const closed = student.body.timeline.find((e: { type: string }) => e.type === 'CLOSED');
    expect(closed).toMatchObject({ label: 'Closed', message: 'This is a duplicate of an existing request, so we are closing it.' });
    assertNoStaffIdentity('student detail after close', student.body);

    const done = await request(server()).get('/poc/queue?view=done').set(auth(pocToken)).expect(200);
    expect(done.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(pocToken)).send({ body: 'late' }).expect(409);
  });

  it('escalating passes the ticket up a level (L1 → L2 → L3); the student sees only that it was escalated', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const reason = 'Needs a decision from the team lead about the lab schedule.';
    const res = await request(server())
      .post(`/poc/tickets/${ticketId}/close`)
      .set(auth(pocToken))
      .send({ outcome: 'ESCALATED', note: reason })
      .expect(200);
    expect(res.body).toEqual({ escalated: true });

    const prisma = prismaOf(app);
    const l2 = await prisma.user.findUniqueOrThrow({ where: { email: 'academics.l2@newtonschool.co' } });
    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row).toMatchObject({ status: 'ESCALATED', currentLevel: 2, assignedPocId: l2.id });
    const hours = (row.tatDeadline!.getTime() - Date.now()) / 36e5;
    expect(hours).toBeGreaterThan(47.9);
    const event = await prisma.ticketEvent.findFirstOrThrow({ where: { ticketId, type: 'ESCALATED' } });
    expect(event).toMatchObject({ fromLevel: 1, toLevel: 2, note: reason });
    expect(await prisma.notification.count({ where: { ticketId, type: 'ESCALATION', userId: l2.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { ticketId, type: 'ESCALATION', userId: row.studentId } })).toBe(1);

    // The L1 POC no longer sees it.
    await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(pocToken)).expect(404);
    const l1Queue = await request(server()).get('/poc/queue').set(auth(pocToken)).expect(200);
    expect(l1Queue.body.tickets.map((t: { id: string }) => t.id)).not.toContain(ticketId);

    // The L2 POC does, with the reason.
    const l2Token = await loginAsPoc(app, l2.email);
    const detail = await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(l2Token)).expect(200);
    expect(detail.body).toMatchObject({ status: 'ESCALATED', currentLevel: 2 });
    const item = detail.body.thread.find((i: { label?: string }) => i.label === 'Escalated to level 2');
    expect(item.note).toBe(reason);
    const l2Queue = await request(server()).get('/poc/queue').set(auth(l2Token)).expect(200);
    expect(l2Queue.body.tickets.map((t: { id: string }) => t.id)).toContain(ticketId);

    // The student sees that it was escalated, but not why, not the level, and not who.
    const student = await studentView(ticketId);
    expect(student.body).toMatchObject({ status: 'ESCALATED', statusLabel: 'Escalated' });
    const entry = student.body.timeline.find((e: { type: string }) => e.type === 'ESCALATED');
    expect(entry).toMatchObject({ label: 'Escalated to Academics team', message: null });
    expect(JSON.stringify(student.body)).not.toContain(reason);
    assertNoStaffIdentity('student detail after escalation', student.body);

    // L2 can pick it up and, in turn, escalate it to L3. L3 is the top level, so it cannot go higher.
    await request(server()).post(`/poc/tickets/${ticketId}/comments`).set(auth(l2Token)).send({ body: 'Picking this up.' }).expect(201);
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(l2Token)).send({ outcome: 'ESCALATED', note: 'Needs the department head.' }).expect(200);
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ currentLevel: 3, status: 'ESCALATED' });
    await request(server()).get(`/poc/tickets/${ticketId}`).set(auth(l2Token)).expect(404); // L2 no longer sees it

    const l3Token = await loginAsPoc(app, 'academics.l3@newtonschool.co');
    const top = await request(server())
      .post(`/poc/tickets/${ticketId}/close`)
      .set(auth(l3Token))
      .send({ outcome: 'ESCALATED', note: 'Nobody above me.' })
      .expect(409);
    expect(JSON.stringify(top.body)).toContain('highest level');
    expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ currentLevel: 3 });

    // L3 can still finish it, and the student still sees only the team label.
    await request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(l3Token)).send({ outcome: 'SOLVED', note: 'Agreed a new schedule with the lab team.' }).expect(200);
    assertNoStaffIdentity('student detail after the full escalation chain', (await studentView(ticketId)).body);
  });

  it('cannot escalate when nobody is on duty at the next level, and nothing changes', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const prisma = prismaOf(app);
    const academics = await categoryByShortName(app, 'Academics');
    await prisma.pOCAssignment.updateMany({ where: { categoryId: academics.id, level: 2 }, data: { active: false } });
    try {
      const res = await request(server())
        .post(`/poc/tickets/${ticketId}/close`)
        .set(auth(pocToken))
        .send({ outcome: 'ESCALATED', note: 'Please take this one.' })
        .expect(409);
      expect(JSON.stringify(res.body)).toContain('No one is on duty');
      expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).toMatchObject({ status: 'ASSIGNED', currentLevel: 1 });
      expect(await prisma.ticketEvent.count({ where: { ticketId, type: 'ESCALATED' } })).toBe(0);
    } finally {
      await prisma.pOCAssignment.updateMany({ where: { categoryId: academics.id, level: 2 }, data: { active: true } });
    }
  });

  it('two POCs resolving at the same moment: exactly one wins, one event is written', async () => {
    const { ticketId, pocToken } = await ticketWithOwner();
    const attempt = (note: string) =>
      request(server()).post(`/poc/tickets/${ticketId}/close`).set(auth(pocToken)).send({ outcome: 'SOLVED', note }).then((r) => r.status);
    const results = await Promise.all([attempt('Resolved by attempt one'), attempt('Resolved by attempt two')]);

    expect(results.sort()).toEqual([200, 409]);
    expect(await prismaOf(app).ticketEvent.count({ where: { ticketId, type: 'RESOLVED' } })).toBe(1);
  });
});
