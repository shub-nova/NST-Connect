import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EscalationService } from '../src/escalation/escalation.service';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

async function emailTo(address: string, subjectPart: string): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address} subject:"${subjectPart}"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) return ((await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string }).Text;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/**
 * Settings and leave, in the Student Life category (no other spec uses it). Starting layout: one L1,
 * one L2, one L3. Tests run in order and build on each other.
 */
describe('Settings: managing POCs, and leave (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let admin: string;
  let l1: string;
  let l2: string;
  let l3: string;
  let feesL2: string;
  let categoryId: string;
  let subId: string;
  let staffIds: string[] = [];
  const stamp = Date.now().toString(36);
  const backOn = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10); // leave always needs a return date
  const emailB = `staff.test.b${stamp}@newtonschool.co`;
  let assignmentB: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const get = (path: string, t: string) => request(server()).get(path).set(auth(t));
  const post = (path: string, t: string, body: object = {}) => request(server()).post(path).set(auth(t)).send(body);
  const userIdOf = async (email: string) => (await prisma().user.findUniqueOrThrow({ where: { email } })).id;
  const assignmentOf = async (email: string) =>
    prisma().pOCAssignment.findFirstOrThrow({ where: { categoryId, user: { email } } });

  async function newTicket(title = 'Club room booking') {
    const res = await post('/tickets', student, { subCategoryId: subId, title, description: 'We need the club room for our weekly meeting.' }).expect(201);
    return res.body.id as string;
  }
  const row = (id: string) => prisma().ticket.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    app = await createTestApp();
    student = await registerAndLogin(app, uniqueStudentEmail());
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    l1 = await loginAsPoc(app, 'activities.l1.1@newtonschool.co');
    l2 = await loginAsPoc(app, 'activities.l2@newtonschool.co');
    l3 = await loginAsPoc(app, 'activities.l3@newtonschool.co');
    feesL2 = await loginAsPoc(app, 'fees.l2@newtonschool.co');
    const cat = await categoryByShortName(app, 'Student Life');
    categoryId = cat.id;
    subId = cat.subCategories[0].id;
    staffIds = (await prisma().user.findMany({ where: { role: { in: ['POC', 'SUPER_ADMIN'] } } })).flatMap((u) => [u.id, u.email]);
  });
  afterAll(async () => {
    await app.close();
  });

  // ---- who can reach what ----------------------------------------------------------------

  it('keeps Settings away from L1, students and the signed-out', async () => {
    await get('/staff/team', l1).expect(403);
    await get('/staff/options', l1).expect(403);
    for (const path of ['/staff/team', '/staff/options', '/staff/audit']) {
      await get(path, student).expect(403);
      await request(server()).get(path).expect(401);
    }
    await post('/staff', student, { name: 'Nope', email: 'x@newtonschool.co', categoryId, level: 1 }).expect(403);
  });

  it('shows each person only the team below them, in their own category', async () => {
    const asL3 = (await get('/staff/team', l3).expect(200)).body.people;
    expect(asL3.map((p: { level: number }) => p.level)).toEqual([2, 1]);
    const asL2 = (await get('/staff/team', l2).expect(200)).body.people;
    expect(asL2).toHaveLength(1);
    expect(asL2[0]).toMatchObject({ level: 1, status: 'active', openTickets: 0 });
    expect(JSON.stringify(asL2)).not.toMatch(/passwordHash|password_hash/);

    const fees = (await get('/staff/team', feesL2).expect(200)).body.people;
    expect(fees.every((p: { category: { name: string } }) => p.category.name === 'Fees & Finance')).toBe(true);

    const all = (await get(`/staff/team?categoryId=${categoryId}`, admin).expect(200)).body.people;
    expect(all.map((p: { level: number }) => p.level)).toEqual([3, 2, 1]);
  });

  it('refuses to touch anyone outside the caller’s reach (plain 404)', async () => {
    const target = await assignmentOf('activities.l1.1@newtonschool.co');
    await post(`/staff/${target.id}/remove`, feesL2).expect(404);
    await post(`/staff/${target.id}/leave`, feesL2, { onLeave: true, until: backOn }).expect(404);
    await request(server()).patch(`/staff/${target.id}`).set(auth(feesL2)).send({ name: 'Hacked' }).expect(404);
    await post(`/staff/${target.id}/resend-invite`, feesL2).expect(404);
  });

  // ---- adding ----------------------------------------------------------------------------

  it('lets an L2 add an L1 under them, invites them by email, and applies the rules', async () => {
    const res = await post('/staff', l2, { name: 'Ravi B', email: emailB, categoryId, level: 1 }).expect(201);
    expect(res.body).toMatchObject({ name: 'Ravi B', level: 1, status: 'invited' });
    assignmentB = res.body.id;
    const l2Assignment = await assignmentOf('activities.l2@newtonschool.co');
    expect((await prisma().pOCAssignment.findUniqueOrThrow({ where: { id: assignmentB } })).managerAssignmentId).toBe(l2Assignment.id);

    const mail = await emailTo(emailB, 'invited to NST Connect');
    expect(mail).toContain('/register');

    await post('/staff', l2, { name: 'Ravi B', email: emailB, categoryId, level: 1 }).expect(409); // already on the team
    await post('/staff', l2, { name: 'Outsider', email: 'someone@gmail.com', categoryId, level: 1 }).expect(400); // wrong domain
    await post('/staff', l2, { name: 'Peer', email: `staff.test.p${stamp}@newtonschool.co`, categoryId, level: 2 }).expect(403); // not below L2
    await post('/staff', feesL2, { name: 'Elsewhere', email: `staff.test.e${stamp}@newtonschool.co`, categoryId, level: 1 }).expect(403); // other category
  });

  it('lets only the admin add a top-level POC', async () => {
    await post('/staff', l3, { name: 'Peer L3', email: `staff.test.t${stamp}@newtonschool.co`, categoryId, level: 3 }).expect(403);
    const res = await post('/staff', admin, { name: 'Second L3', email: `staff.test.t${stamp}@newtonschool.co`, categoryId, level: 3 }).expect(201);
    expect(res.body.level).toBe(3);
    await post(`/staff/${res.body.id}/remove`, admin).expect(200); // tidy: back to one L3
  });

  it('renames a POC and rejects an invalid manager', async () => {
    const res = await request(server()).patch(`/staff/${assignmentB}`).set(auth(l2)).send({ name: 'Ravi Bhatt' }).expect(200);
    expect(res.body.name).toBe('Ravi Bhatt');
    const l1Assignment = await assignmentOf('activities.l1.1@newtonschool.co');
    await request(server()).patch(`/staff/${assignmentB}`).set(auth(l2)).send({ managerAssignmentId: l1Assignment.id }).expect(400); // an L1 cannot be a manager
  });

  it('re-sends an invite only to someone who has not registered', async () => {
    await post(`/staff/${assignmentB}/resend-invite`, l2).expect(200);
    const registered = await assignmentOf('activities.l1.1@newtonschool.co');
    await post(`/staff/${registered.id}/resend-invite`, l2).expect(400);
  });

  // ---- leave -----------------------------------------------------------------------------

  let ticketsOfL1: string[] = [];

  it('hands a POC’s open tickets to the other L1 when they go on leave, without students seeing it', async () => {
    const ids = [await newTicket('Booking 1'), await newTicket('Booking 2'), await newTicket('Booking 3'), await newTicket('Booking 4')];
    const l1Id = await userIdOf('activities.l1.1@newtonschool.co');
    const bId = await userIdOf(emailB);
    ticketsOfL1 = (await Promise.all(ids.map(row))).filter((t) => t.assignedPocId === l1Id).map((t) => t.id);
    expect(ticketsOfL1.length).toBeGreaterThan(0); // balanced between the two L1s

    const l1Assignment = await assignmentOf('activities.l1.1@newtonschool.co');
    const res = await post(`/staff/${l1Assignment.id}/leave`, l2, { onLeave: true, until: backOn }).expect(200); // the L2 above sets it
    expect(res.body.moved).toMatchObject({ reassigned: ticketsOfL1.length, escalated: 0, stranded: 0 });

    for (const id of ticketsOfL1) {
      expect(await row(id)).toMatchObject({ assignedPocId: bId, currentLevel: 1 });
      const ev = await prisma().ticketEvent.findFirstOrThrow({ where: { ticketId: id, type: 'REASSIGNED' } });
      expect(ev).toMatchObject({ visibility: 'INTERNAL', assigneeId: bId });
      const view = (await get(`/tickets/${id}`, student).expect(200)).body;
      const text = JSON.stringify(view);
      for (const secret of staffIds) expect(text).not.toContain(secret);
      expect(text).not.toMatch(/leave|reassign|handed/i);
    }
  });

  it('escalates to L2 when nobody else at the level is on duty, and starts new tickets at L2', async () => {
    const res = await post(`/staff/${assignmentB}/leave`, l2, { onLeave: true, until: backOn }).expect(200); // a manager sets it for their report
    expect(res.body.moved.escalated).toBeGreaterThan(0);

    const l2Id = await userIdOf('activities.l2@newtonschool.co');
    const moved = await row(ticketsOfL1[0]);
    expect(moved).toMatchObject({ currentLevel: 2, status: 'ESCALATED', assignedPocId: l2Id });
    const ev = await prisma().ticketEvent.findFirstOrThrow({ where: { ticketId: moved.id, type: 'ESCALATED' }, orderBy: { createdAt: 'desc' } });
    expect(ev).toMatchObject({ reason: 'ON_LEAVE', visibility: 'PUBLIC', actorId: null });
    expect(JSON.stringify((await get(`/tickets/${moved.id}`, student).expect(200)).body)).toMatch(/Escalated to Student Life team/);

    const fresh = await newTicket('While everyone is away');
    expect(await row(fresh)).toMatchObject({ currentLevel: 2, assignedPocId: l2Id, status: 'ASSIGNED' });
  });

  it('does not count leave moves as manual or automatic escalations in analytics', async () => {
    const { body } = await get(`/analytics/admin?categoryId=${categoryId}`, admin).expect(200);
    expect(body.headline).toMatchObject({ manualEscalations: 0, autoEscalatedFrom: 0 });
    expect(body.trend.reduce((n: number, p: { manualEscalated: number; autoEscalated: number }) => n + p.manualEscalated + p.autoEscalated, 0)).toBe(0);
  });

  it('puts returning POCs back in rotation for new tickets', async () => {
    await post(`/staff/${(await assignmentOf('activities.l1.1@newtonschool.co')).id}/leave`, l2, { onLeave: false }).expect(200);
    const l1Id = await userIdOf('activities.l1.1@newtonschool.co');
    const next = await newTicket('Back in rotation');
    expect(await row(next)).toMatchObject({ currentLevel: 1, assignedPocId: l1Id });
    expect((await get('/analytics/access', l1).expect(200)).body).toMatchObject({ onLeave: false, manage: false });
  });

  it('lets nobody put themselves on leave: only the level above can', async () => {
    const l1A = await assignmentOf('activities.l1.1@newtonschool.co');
    const l2A = await assignmentOf('activities.l2@newtonschool.co');
    const l3A = await assignmentOf('activities.l3@newtonschool.co');
    const until = backOn;

    // No self-service: the old route is gone, and nobody can change their own assignment or a level above theirs.
    await request(server()).put('/staff/me/leave').set(auth(l1)).send({ onLeave: true, until }).expect(404);
    await post(`/staff/${l1A.id}/leave`, l1, { onLeave: true, until }).expect(403); // L1 has no Settings at all
    await post(`/staff/${l2A.id}/leave`, l1, { onLeave: true, until }).expect(403);
    await post(`/staff/${l2A.id}/leave`, l2, { onLeave: true, until }).expect(404); // not their own
    await post(`/staff/${l3A.id}/leave`, l3, { onLeave: true, until }).expect(404);
    await post(`/staff/${l3A.id}/leave`, l2, { onLeave: true, until }).expect(404); // and not the level above them
    await post(`/staff/${l1A.id}/leave`, feesL2, { onLeave: true, until }).expect(404); // another category's L2
    expect(await prisma().pOCAssignment.count({ where: { id: { in: [l1A.id, l2A.id, l3A.id] }, onLeave: true } })).toBe(0);

    // The level above can: L3 sets L2's leave, and the Super Admin sets L3's. The admin has no leave of their own.
    await post(`/staff/${l2A.id}/leave`, l3, { onLeave: true, until }).expect(200);
    await post(`/staff/${l2A.id}/leave`, l3, { onLeave: false }).expect(200);
    await post(`/staff/${l3A.id}/leave`, admin, { onLeave: true, until }).expect(200);
    expect((await get('/analytics/access', l3).expect(200)).body).toMatchObject({ onLeave: true });
    await post(`/staff/${l3A.id}/leave`, admin, { onLeave: false }).expect(200);
    expect((await get('/analytics/access', l3).expect(200)).body).toMatchObject({ onLeave: false });
  });

  it('ends leave by itself on the return date', async () => {
    const until = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const l1Id = (await assignmentOf('activities.l1.1@newtonschool.co')).id;
    await post(`/staff/${l1Id}/leave`, l3, { onLeave: true, until }).expect(200); // an L3 reaches the L1s under their L2
    expect((await get('/analytics/access', l1).expect(200)).body).toMatchObject({ onLeave: true });
    await post(`/staff/${l1Id}/leave`, l2, { onLeave: true, until: '2020-01-01' }).expect(400); // past date
    await post(`/staff/${l1Id}/leave`, l2, { onLeave: true }).expect(400); // a return date is required

    const mine = await assignmentOf('activities.l1.1@newtonschool.co');
    await prisma().pOCAssignment.update({ where: { id: mine.id }, data: { onLeaveUntil: new Date(Date.now() - 1000) } });
    await app.get(EscalationService).runOnce();
    expect(await prisma().pOCAssignment.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ onLeave: false, onLeaveUntil: null });
  });

  // ---- removing --------------------------------------------------------------------------

  it('blocks removals that would leave tickets without an owner or a team without a manager', async () => {
    const l2Assignment = await assignmentOf('activities.l2@newtonschool.co');
    await post(`/staff/${l2Assignment.id}/remove`, l3).expect(409); // L2 still has L1s under them
    const l1Assignment = await assignmentOf('activities.l1.1@newtonschool.co');
    await post(`/staff/${assignmentB}/remove`, l2).expect(200); // fine: another L1 remains
    await post(`/staff/${l1Assignment.id}/remove`, l2).expect(409); // now the last L1
  });

  it('removes a POC for good: tickets handed over, login switched off, history kept', async () => {
    const bId = await userIdOf(emailB);
    const b = await prisma().pOCAssignment.findUniqueOrThrow({ where: { id: assignmentB } });
    expect(b.active).toBe(false);
    expect((await prisma().user.findUniqueOrThrow({ where: { id: bId } })).deactivatedAt).not.toBeNull();
    expect(await prisma().ticket.count({ where: { assignedPocId: bId, status: { notIn: ['RESOLVED', 'CLOSED'] } } })).toBe(0);
    expect((await get('/staff/team', l2).expect(200)).body.people.some((p: { id: string }) => p.id === assignmentB)).toBe(false);
    expect(await prisma().ticketEvent.count({ where: { OR: [{ actorId: bId }, { assigneeId: bId }] } })).toBeGreaterThan(0); // history stays

    const mail = await emailTo(emailB, 'removed from');
    expect(mail).toContain('removed');
  });

  it('can add a removed POC back, which re-enables them', async () => {
    const res = await post('/staff', l2, { name: 'Ravi Bhatt', email: emailB, categoryId, level: 1 }).expect(201);
    expect(res.body.status).toBe('invited');
    expect((await prisma().user.findUniqueOrThrow({ where: { email: emailB } })).deactivatedAt).toBeNull();
  });

  it('gives someone who signed up on their own access once a manager adds them', async () => {
    const email = `staff.test.walkin${stamp}@newtonschool.co`;
    const token = await registerAndLogin(app, email, 'Walk In');
    expect((await get('/poc/queue', token).expect(200)).body).toMatchObject({ assigned: false, tickets: [] });

    const added = (await post('/staff', admin, { name: 'Walk In', email, categoryId, level: 1 }).expect(201)).body;
    expect(added).toMatchObject({ level: 1, status: 'active' }); // already registered, so no invite is needed
    expect((await get('/poc/queue', token).expect(200)).body).toMatchObject({ assigned: true });
    expect((await get('/analytics/me', token).expect(200)).body.view).toBe('me');
    await post(`/staff/${added.id}/remove`, admin).expect(200); // tidy up
    expect((await get('/poc/queue', token).expect(200)).body).toMatchObject({ assigned: false });
  });

  // ---- the paper trail -------------------------------------------------------------------

  it('records every change and shows it only to people responsible for that category', async () => {
    const mine = (await get('/staff/audit', l2).expect(200)).body.changes;
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.map((c: { action: string }) => c.action)).toEqual(expect.arrayContaining(['ADDED', 'REMOVED', 'LEAVE_ON', 'LEAVE_OFF', 'UPDATED']));
    expect((await get('/staff/audit', feesL2).expect(200)).body.changes.some((c: { summary: string }) => /Ravi/.test(c.summary))).toBe(false);
    expect((await get('/staff/audit', admin).expect(200)).body.changes.length).toBeGreaterThan(5);
  });
});
