import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { signInvite } from '../src/auth/invite';
import { EscalationService } from '../src/escalation/escalation.service';
import { categoryByShortName, createTestApp, loginAsPoc, PASSWORD, prismaOf, registerAndLogin, uniqueStudentEmail, startCleanup } from './helpers';

/**
 * Edge cases for the staff side: reply and note limits, bulk input, odd ids, a person removed while holding a valid
 * token, one person in two categories, and the rules for adding, removing and putting people on leave.
 */
describe('Edge cases: POC work, team management and leave (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  let l1: string;
  let l2: string;
  let student: string;
  let categoryId: string;
  let subId: string;
  const stamp = Date.now().toString(36);
  const added: string[] = []; // assignment ids to clean up

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const prisma = () => prismaOf(app);
  const post = (path: string, t: string, body: unknown = {}) => request(server()).post(path).set(auth(t)).send(body as object);
  const get = (path: string, t: string) => request(server()).get(path).set(auth(t));
  const newTicket = async () =>
    (await post('/tickets', student, { title: 'Edge case ticket', description: 'A description that is long enough.', subCategoryId: subId }).expect(201)).body.id as string;
  const staffEmail = (tag: string) => `staff.test.${tag}${stamp}@newtonschool.co`;

  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    app = await createTestApp();
    cleanup = startCleanup(app);
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    l1 = await loginAsPoc(app, 'other.l1.1@newtonschool.co');
    l2 = await loginAsPoc(app, 'other.l2@newtonschool.co');
    student = await registerAndLogin(app, uniqueStudentEmail('pocedge'));
    const category = await categoryByShortName(app, 'Other');
    categoryId = category.id;
    subId = category.subCategories[0].id;
  });
  afterAll(async () => {
    for (const id of added) await post(`/staff/${id}/remove`, admin).catch(() => undefined);
    await cleanup();
    await app.close();
  });

  // ---- replying and finishing ------------------------------------------------------------

  it('replies: exactly 5000 characters are fine, 5001 or only spaces are not, unicode and markup are kept as text', async () => {
    const id = await newTicket();
    const reply = (body: unknown) => post(`/poc/tickets/${id}/comments`, l1, { body });
    await reply('r'.repeat(5001)).expect(400);
    await reply('     ').expect(400);
    await reply('').expect(400);
    await reply(undefined).expect(400);
    await reply(123).expect(400);
    await reply('r'.repeat(5000)).expect(201);
    const hostile = `<b onmouseover=alert(1)>bold</b> 🙂 名前 '); DROP TABLE comment;--`;
    await reply(hostile).expect(201);
    const detail = await get(`/poc/tickets/${id}`, l1).expect(200);
    expect(detail.body.thread.filter((t: { kind: string }) => t.kind === 'comment').map((c: { body: string }) => c.body)).toContain(hostile);
    const seen = await get(`/tickets/${id}`, student).expect(200);
    expect(seen.body.timeline.map((e: { message: string | null }) => e.message)).toContain(hostile);
  });

  it('notes on solve, close and escalate: 5 to 2000 characters after trimming', async () => {
    const finish = (id: string, outcome: unknown, note: unknown) => post(`/poc/tickets/${id}/close`, l1, { outcome, note });
    const id = await newTicket();
    await finish(id, 'SOLVED', 'abcd').expect(400);
    await finish(id, 'SOLVED', '   ab   ').expect(400);
    await finish(id, 'SOLVED', 'n'.repeat(2001)).expect(400);
    await finish(id, 'SOLVED', undefined).expect(400);
    await finish(id, 'SOLVED', 12345).expect(400);
    await finish(id, 'solved', 'Fixed it properly.').expect(400); // outcome is exact
    await finish(id, 'REOPENED', 'Fixed it properly.').expect(400);
    await finish(id, undefined, 'Fixed it properly.').expect(400);
    await finish(id, 'SOLVED', 'n'.repeat(2000)).expect(200);

    const other = await newTicket();
    await finish(other, 'CLOSED', 'abcde').expect(200); // exactly 5
  });

  it('bulk actions: strict input, and unknown ids are reported instead of crashing', async () => {
    const bulk = (body: unknown) => post('/poc/tickets/bulk', l1, body);
    const ids = await Promise.all([newTicket(), newTicket()]);
    await bulk({ ticketIds: [], action: 'SOLVED', note: 'Fixed it properly.' }).expect(400);
    await bulk({ ticketIds: Array.from({ length: 51 }, () => '00000000-0000-4000-8000-000000000000'), action: 'SOLVED', note: 'Fixed it properly.' }).expect(400);
    await bulk({ ticketIds: ['not-a-uuid'], action: 'SOLVED', note: 'Fixed it properly.' }).expect(400);
    await bulk({ ticketIds: 'abc', action: 'SOLVED', note: 'Fixed it properly.' }).expect(400);
    await bulk({ ticketIds: ids, action: 'solved', note: 'Fixed it properly.' }).expect(400);
    await bulk({ ticketIds: ids, action: 'SOLVED', note: 'abcd' }).expect(400);
    await bulk({ ticketIds: ids, action: 'REPLY', note: '    ' }).expect(400);
    await bulk({ ticketIds: ids, action: 'SOLVED' }).expect(400);
    await bulk({ ticketIds: ids }).expect(400);

    const mixed = await bulk({ ticketIds: [ids[0], '00000000-0000-4000-8000-000000000000'], action: 'REPLY', note: 'One reply for both.' }).expect(200);
    expect(mixed.body.done).toBe(1);
    expect(mixed.body.failed).toHaveLength(1);
    expect(mixed.body.failed[0].reason).toMatch(/not found/i);
    const fifty = await bulk({ ticketIds: Array.from({ length: 50 }, () => ids[1]), action: 'REPLY', note: 'Fifty copies of one id.' }).expect(200);
    expect(fifty.body.done).toBe(1); // duplicates count once
  });

  it('queue and ticket routes reject bad parameters and ids with 400 or 404, never 500', async () => {
    for (const qs of ['limit=0', 'limit=51', 'limit=abc', 'sort=best', 'view=archive', 'cursor=@@@', 'limit=1.5']) expect((await get(`/poc/queue?${qs}`, l1)).status).toBe(400);
    await get('/poc/queue?limit=50&view=done&sort=oldest', l1).expect(200);
    await get('/poc/tickets/not-a-uuid', l1).expect(400);
    await get('/poc/tickets/00000000-0000-4000-8000-000000000000', l1).expect(404);
    await post('/poc/tickets/00000000-0000-4000-8000-000000000000/comments', l1, { body: 'hello' }).expect(404);
    await post('/poc/tickets/00000000-0000-4000-8000-000000000000/close', l1, { outcome: 'SOLVED', note: 'Fixed it properly.' }).expect(404);
    await post('/poc/tickets/00000000-0000-4000-8000-000000000000/status', l1, { status: 'IN_PROGRESS' }).expect(404);
    const id = await newTicket();
    await post(`/poc/tickets/${id}/status`, l1, { status: 'RESOLVED' }).expect(400); // only IN_PROGRESS can be set this way
    await post(`/poc/tickets/${id}/status`, l1, {}).expect(400);
  });

  it('nobody can escalate above the top level, and a ticket on a level without people cannot be escalated into', async () => {
    const id = await newTicket();
    await post(`/poc/tickets/${id}/close`, l1, { outcome: 'ESCALATED', note: 'Needs the next level.' }).expect(200);
    await post(`/poc/tickets/${id}/close`, l1, { outcome: 'ESCALATED', note: 'Trying again after it left.' }).expect(404); // no longer theirs
    await post(`/poc/tickets/${id}/close`, l2, { outcome: 'ESCALATED', note: 'Needs the top level now.' }).expect(200);
    const l3 = await loginAsPoc(app, 'other.l3@newtonschool.co');
    const refused = await post(`/poc/tickets/${id}/close`, l3, { outcome: 'ESCALATED', note: 'There is nowhere higher.' }).expect(409);
    expect(refused.body.message).toMatch(/highest level/i);
    await post(`/poc/tickets/${id}/close`, l3, { outcome: 'SOLVED', note: 'Top level finished it.' }).expect(200);
  });

  // ---- a person removed while still holding a valid token --------------------------------

  it('a removed POC’s old access token reveals and changes nothing, and they cannot log in again', async () => {
    const email = staffEmail('gone');
    const res = await post('/staff', admin, { name: 'Soon Gone', email, categoryId, level: 1 }).expect(201);
    added.push(res.body.id);
    const token = await registerAndLogin(app, email, 'Soon Gone');
    expect((await get('/poc/queue', token).expect(200)).body.assigned).toBe(true);

    const ticketId = await newTicket(); // might land on either L1; make sure this person holds one
    await prisma().ticket.update({ where: { id: ticketId }, data: { assignedPocId: (await prisma().user.findUniqueOrThrow({ where: { email } })).id } });
    await get(`/poc/tickets/${ticketId}`, token).expect(200);

    await post(`/staff/${res.body.id}/remove`, admin).expect(200);

    // The token is still valid for a few minutes, but the person has no assignment any more.
    const queue = await get('/poc/queue', token).expect(200);
    expect(queue.body.assigned).toBe(false);
    expect(queue.body.tickets).toHaveLength(0);
    await get(`/poc/tickets/${ticketId}`, token).expect(404);
    await post(`/poc/tickets/${ticketId}/comments`, token, { body: 'I should not be able to do this.' }).expect(404);
    await post(`/poc/tickets/${ticketId}/close`, token, { outcome: 'SOLVED', note: 'Nor this at all.' }).expect(404);
    await get('/staff/team', token).expect(403);
    await get('/analytics/me', token).expect(403);

    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(403);
    expect(login.body.message).toMatch(/deactivated/i);
    // Their ticket was handed over, not lost.
    const row = await prisma().ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.assignedPocId).not.toBe(await prisma().user.findUniqueOrThrow({ where: { email } }).then((u) => u.id));
  });

  it('one person on two teams sees the tickets of both and nothing else', async () => {
    const email = staffEmail('two');
    const academics = await categoryByShortName(app, 'Academics');
    const a = await post('/staff', admin, { name: 'Two Teams', email, categoryId, level: 1 }).expect(201);
    const b = await post('/staff', admin, { name: 'Two Teams', email, categoryId: academics.id, level: 1 }).expect(201); // same person, second category
    added.push(a.body.id, b.body.id);
    const token = await registerAndLogin(app, email, 'Two Teams');
    const me = await prisma().user.findUniqueOrThrow({ where: { email } });

    const mine = await prisma().ticket.create({ data: { title: 'In Other', description: 'In the first team.', categoryId, subCategoryId: subId, studentId: (await prisma().user.findFirstOrThrow({ where: { role: 'STUDENT' } })).id, status: 'ASSIGNED', currentLevel: 1, assignedPocId: me.id, tatDeadline: new Date(Date.now() + 86400000) } });
    const second = await prisma().ticket.create({ data: { title: 'In Academics', description: 'In the second team.', categoryId: academics.id, subCategoryId: academics.subCategories[0].id, studentId: mine.studentId, status: 'ASSIGNED', currentLevel: 1, assignedPocId: me.id, tatDeadline: new Date(Date.now() + 86400000) } });
    const higher = await prisma().ticket.create({ data: { title: 'At level 2', description: 'Not at their level.', categoryId, subCategoryId: subId, studentId: mine.studentId, status: 'ESCALATED', currentLevel: 2, assignedPocId: me.id, tatDeadline: new Date(Date.now() + 86400000) } });
    try {
      const queue = await get('/poc/queue?limit=50', token).expect(200);
      const ids = queue.body.tickets.map((t: { id: string }) => t.id);
      expect(ids).toContain(mine.id);
      expect(ids).toContain(second.id);
      expect(ids).not.toContain(higher.id); // a different level is not theirs
      await get(`/poc/tickets/${higher.id}`, token).expect(404);
    } finally {
      await prisma().ticket.deleteMany({ where: { id: { in: [mine.id, second.id, higher.id] } } });
    }
  });

  it('a POC who has been added but has not registered yet is not given tickets while a registered colleague is available', async () => {
    const email = staffEmail('notyet');
    const res = await post('/staff', admin, { name: 'Not Yet Registered', email, categoryId, level: 1 }).expect(201);
    added.push(res.body.id);
    const waiting = await prisma().user.findUniqueOrThrow({ where: { email } });
    expect(waiting.passwordHash).toBeNull(); // invited, no account yet

    // Whoever else is on this team and has an account may receive tickets; the newcomer (zero tickets, so "least loaded"
    // on load alone) must not.
    const registered = (await prisma().pOCAssignment.findMany({ where: { categoryId, level: 1, active: true, onLeave: false, user: { passwordHash: { not: null } } }, select: { userId: true } })).map((a) => a.userId);
    expect(registered.length).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      const owner = (await prisma().ticket.findUniqueOrThrow({ where: { id: await newTicket() } })).assignedPocId;
      expect(registered).toContain(owner);
    }
    expect(await prisma().ticket.count({ where: { assignedPocId: waiting.id } })).toBe(0);

    // Once they register they join the rotation like anyone else (and, having no tickets, are picked next).
    await registerAndLogin(app, email, 'Not Yet Registered');
    const next = await prisma().ticket.findUniqueOrThrow({ where: { id: await newTicket() } });
    expect(next.assignedPocId).toBe(waiting.id);
  });

  it('when nobody registered is available, an unregistered POC still receives the ticket (it is never left without an owner)', async () => {
    const email = staffEmail('onlyinvited');
    const res = await post('/staff', admin, { name: 'Only Invited', email, categoryId, level: 1 }).expect(201);
    added.push(res.body.id);
    const them = await prisma().user.findUniqueOrThrow({ where: { email } });
    // Everyone registered at this level is away.
    const away = await prisma().pOCAssignment.findMany({ where: { categoryId, level: 1, active: true, id: { not: res.body.id }, user: { passwordHash: { not: null } } } });
    await prisma().pOCAssignment.updateMany({ where: { id: { in: away.map((a) => a.id) } }, data: { onLeave: true } });
    try {
      const t = await prisma().ticket.findUniqueOrThrow({ where: { id: await newTicket() }, include: { assignedPoc: true } });
      expect(t.status).toBe('ASSIGNED'); // not left ownerless
      expect(t.assignedPoc!.passwordHash).toBeNull(); // given to someone who has not registered, as nobody else is available
      expect(t.currentLevel).toBe(1);
      void them;
    } finally {
      await prisma().pOCAssignment.updateMany({ where: { id: { in: away.map((a) => a.id) } }, data: { onLeave: false } });
    }
  });

  it('a ticket raised while nobody is on duty gets an owner from the scheduled job as soon as someone is back', async () => {
    const exams = await categoryByShortName(app, 'Exams & Grading');
    const subExam = exams.subCategories[0].id;
    const everyone = await prisma().pOCAssignment.findMany({ where: { categoryId: exams.id, active: true } });
    await prisma().pOCAssignment.updateMany({ where: { id: { in: everyone.map((a) => a.id) } }, data: { onLeave: true } });
    try {
      const raised = await post('/tickets', student, { title: 'Nobody is on duty', description: 'Raised while the whole team is on leave.', subCategoryId: subExam }).expect(201);
      const id = raised.body.id as string;
      let row = await prisma().ticket.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('CREATED'); // waiting, no owner, no deadline
      expect(row.assignedPocId).toBeNull();
      expect(row.tatDeadline).toBeNull();

      const job = app.get(EscalationService);
      await job.runOnce(); // still nobody available: it must wait, not fail
      expect((await prisma().ticket.findUniqueOrThrow({ where: { id } })).status).toBe('CREATED');

      await prisma().pOCAssignment.updateMany({ where: { id: { in: everyone.map((a) => a.id) } }, data: { onLeave: false } });
      await job.runOnce();
      row = await prisma().ticket.findUniqueOrThrow({ where: { id } });
      expect(row.status).toBe('ASSIGNED');
      expect(row.currentLevel).toBe(1);
      expect(row.assignedPocId).not.toBeNull();
      expect(row.tatDeadline!.getTime()).toBeGreaterThan(Date.now()); // its clock starts now
      expect(await prisma().ticketEvent.count({ where: { ticketId: id, type: 'ASSIGNED' } })).toBe(1);
      expect(await prisma().notification.count({ where: { ticketId: id, type: 'NEW_TICKET', userId: row.assignedPocId! } })).toBe(1);

      await job.runOnce(); // running again changes nothing
      expect(await prisma().ticketEvent.count({ where: { ticketId: id, type: 'ASSIGNED' } })).toBe(1);
    } finally {
      await prisma().pOCAssignment.updateMany({ where: { id: { in: everyone.map((a) => a.id) } }, data: { onLeave: false } });
    }
  });

  // ---- adding people ---------------------------------------------------------------------

  it('adding people: capitals, wrong domains, odd levels and names, and the same person twice', async () => {
    const add = (body: Record<string, unknown>, t = admin) => post('/staff', t, body);
    const email = staffEmail('add');
    const first = await add({ name: 'Added Person', email: email.toUpperCase(), categoryId, level: 1 }).expect(201);
    added.push(first.body.id);
    expect(first.body.email).toBe(email); // stored in lower case
    await add({ name: 'Added Again', email, categoryId, level: 1 }).expect(409);
    await add({ name: 'Added Again', email: email.toUpperCase(), categoryId, level: 1 }).expect(409); // capitals do not make it a different person

    await add({ name: 'Wrong Domain', email: `staff.test.w${stamp}@adypu.edu.in`, categoryId, level: 1 }).expect(400);
    await add({ name: 'Look Alike', email: `staff.test.l${stamp}@newtonschool.co.evil.com`, categoryId, level: 1 }).expect(400);
    await add({ name: 'Look Alike', email: `staff.test.m${stamp}@evil-newtonschool.co`, categoryId, level: 1 }).expect(400);
    await add({ name: 'Bad Level', email: staffEmail('l0'), categoryId, level: 0 }).expect(400);
    await add({ name: 'Bad Level', email: staffEmail('l4'), categoryId, level: 4 }).expect(400);
    await add({ name: 'Bad Level', email: staffEmail('ls'), categoryId, level: '1' }).expect(400);
    await add({ name: 'Bad Level', email: staffEmail('lf'), categoryId, level: 1.5 }).expect(400);
    await add({ name: 'X', email: staffEmail('n1'), categoryId, level: 1 }).expect(400);
    await add({ name: 'Bad Email', email: 'not-an-email', categoryId, level: 1 }).expect(400);
    await add({ name: 'No Category', email: staffEmail('nc'), level: 1 }).expect(400);
    await add({ name: 'Bad Category', email: staffEmail('bc'), categoryId: 'nope', level: 1 }).expect(400);
    await add({ name: 'Unknown Category', email: staffEmail('uc'), categoryId: '00000000-0000-4000-8000-000000000000', level: 1 }).expect(404);
    await add({ name: 'Admin Clone', email: 'admin@newtonschool.co', categoryId, level: 1 }).expect(409); // an admin cannot be made a POC
    await add({ name: 'A Student', email: (await prisma().user.findFirstOrThrow({ where: { role: 'STUDENT' } })).email, categoryId, level: 1 }).expect(400); // student domain is refused first
  });

  it('a manager must be one level up and in the same category', async () => {
    const academics = await categoryByShortName(app, 'Academics');
    const foreignManager = await prisma().pOCAssignment.findFirstOrThrow({ where: { categoryId: academics.id, level: 2, active: true } });
    await post('/staff', admin, { name: 'Wrong Manager', email: staffEmail('wm'), categoryId, level: 1, managerAssignmentId: foreignManager.id }).expect(400);
    await post('/staff', admin, { name: 'Bad Manager', email: staffEmail('bm'), categoryId, level: 1, managerAssignmentId: 'nope' }).expect(400);
    await post('/staff', admin, { name: 'Ghost Manager', email: staffEmail('gm'), categoryId, level: 1, managerAssignmentId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    expect(await prisma().user.count({ where: { email: { in: [staffEmail('wm'), staffEmail('bm'), staffEmail('gm')] } } })).toBe(0); // nothing half-created
  });

  // ---- leave -----------------------------------------------------------------------------

  it('leave: a return date is required, must be a real future day, and repeating it is harmless', async () => {
    const email = staffEmail('leave');
    const res = await post('/staff', admin, { name: 'Leave Test', email, categoryId, level: 1 }).expect(201);
    added.push(res.body.id);
    const leave = (body: unknown) => post(`/staff/${res.body.id}/leave`, l2, body);
    const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);

    await leave({ onLeave: true }).expect(400); // no date
    await leave({ onLeave: true, until: day(-1) }).expect(400); // yesterday
    await leave({ onLeave: true, until: day(0) }).expect(400); // today has already begun
    await leave({ onLeave: true, until: '31-12-2030' }).expect(400);
    await leave({ onLeave: true, until: '2030-13-45' }).expect(400);
    await leave({ onLeave: true, until: 'tomorrow' }).expect(400);
    await leave({ onLeave: 'yes', until: day(3) }).expect(400);
    await leave({ until: day(3) }).expect(400);
    await leave({ onLeave: true, until: day(3) }).expect(200);
    await leave({ onLeave: true, until: day(4) }).expect(200); // again, with a later date
    const row = await prisma().pOCAssignment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.onLeave).toBe(true);
    expect(row.onLeaveUntil!.toISOString().slice(0, 10)).toBe(day(4));
    await leave({ onLeave: false }).expect(200);
    await leave({ onLeave: false }).expect(200); // back twice
    expect((await prisma().pOCAssignment.findUniqueOrThrow({ where: { id: res.body.id } })).onLeave).toBe(false);
  });

  it('removing: twice, an unknown id, a bad id, and sending an invite to a removed person', async () => {
    const email = staffEmail('rm');
    const res = await post('/staff', admin, { name: 'Remove Me', email, categoryId, level: 1 }).expect(201);
    await post(`/staff/${res.body.id}/remove`, admin).expect(200);
    await post(`/staff/${res.body.id}/remove`, admin).expect(404); // already gone
    await post(`/staff/${res.body.id}/resend-invite`, admin).expect(404);
    await post(`/staff/${res.body.id}/leave`, admin, { onLeave: false }).expect(404);
    await post('/staff/00000000-0000-4000-8000-000000000000/remove', admin).expect(404);
    await post('/staff/not-a-uuid/remove', admin).expect(400);
    // Added back later, the same person is reactivated, not duplicated.
    const back = await post('/staff', admin, { name: 'Remove Me', email, categoryId, level: 1 }).expect(201);
    added.push(back.body.id);
    expect(await prisma().user.count({ where: { email } })).toBe(1);
  });

  it('a newly added person must use their invitation link, which also verifies their address', async () => {
    const email = staffEmail('verify');
    const res = await post('/staff', admin, { name: 'Needs Verify', email, categoryId, level: 1 }).expect(201);
    added.push(res.body.id);
    // Without the invitation link nobody can set the first password for this address.
    const refused = await request(server()).post('/auth/register').send({ email, name: 'Needs Verify', password: PASSWORD }).expect(400);
    expect(refused.body.message).toMatch(/invitation/i);
    expect((await prisma().user.findUniqueOrThrow({ where: { email } })).passwordHash).toBeNull();

    const invite = await signInvite(app.get(JwtService), email);
    const ok = await request(server()).post('/auth/register').send({ email, name: 'Needs Verify', password: PASSWORD, invite }).expect(202);
    expect(ok.body.verified).toBe(true); // the invitation was only ever emailed to this mailbox, so no second email is needed
    await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  });
});
