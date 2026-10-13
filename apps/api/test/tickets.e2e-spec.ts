import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

describe('Tickets (e2e)', () => {
  let app: INestApplication;
  let studentToken: string;
  let otherStudentToken: string;
  let academicsId: string; // main category ids
  let hostelId: string;
  let academicsSubId: string; // a sub-category inside each
  let hostelSubId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const newTicket = (token: string, overrides: Record<string, unknown> = {}) =>
    request(app.getHttpServer())
      .post('/tickets')
      .set(auth(token))
      .send({
        title: 'Cannot access my course portal',
        description: 'The portal shows an error after I log in, every time.',
        subCategoryId: academicsSubId,
        ...overrides,
      });

  beforeAll(async () => {
    app = await createTestApp();
    studentToken = await registerAndLogin(app, uniqueStudentEmail());
    otherStudentToken = await registerAndLogin(app, uniqueStudentEmail());
    const academics = await categoryByShortName(app, 'Academics');
    const hostel = await categoryByShortName(app, 'Hostel');
    academicsId = academics.id;
    hostelId = hostel.id;
    academicsSubId = academics.subCategories[0].id;
    hostelSubId = hostel.subCategories[0].id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists the active categories with their sub-categories, and hides retired ones', async () => {
    const res = await request(app.getHttpServer()).get('/categories').set(auth(studentToken)).expect(200);
    const names = res.body.map((c: { name: string }) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['Hostel & Accommodation', 'Food, Mess & Canteen', 'Attendance & Leave', 'Post Admission Document Requirements']),
    );
    expect(res.body).toHaveLength(11);
    for (const c of res.body) {
      expect(c.shortName).toBeTruthy(); // retired placeholder categories have none and are hidden
      expect(c.subCategories.length).toBeGreaterThan(0);
    }
    const hostel = res.body.find((c: { shortName: string }) => c.shortName === 'Hostel');
    expect(hostel.subCategories[0].name).toBe('Room Allocation, Change & Retention Requests');
    expect(hostel.subCategories).toHaveLength(7);

    // "Other" is for anything not covered: it has a single sub-category.
    const other = res.body.find((c: { shortName: string }) => c.shortName === 'Other');
    expect(other.subCategories).toHaveLength(1);
    expect(res.body[res.body.length - 1].shortName).toBe('Other'); // listed last
  });

  it('"Other" accepts anything and routes to its own team', async () => {
    const other = await categoryByShortName(app, 'Other');
    const res = await newTicket(studentToken, {
      subCategoryId: other.subCategories[0].id,
      title: 'Request for a quiet study room',
      description: 'None of the categories fit: I would like a quiet study room booked for exams.',
    }).expect(201);
    expect(res.body).toMatchObject({ assignedTo: 'Other team', category: { shortName: 'Other' }, status: 'ASSIGNED' });

    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: res.body.id }, include: { assignedPoc: true } });
    expect(row.assignedPoc!.email).toBe('other.l1.1@newtonschool.co');
    expect(row.currentLevel).toBe(1);
  });

  it('creates a ticket, routes it to the category team, and records the timeline', async () => {
    const res = await newTicket(studentToken).expect(201);
    expect(res.body).toMatchObject({
      title: 'Cannot access my course portal',
      status: 'ASSIGNED',
      statusLabel: 'Assigned',
      assignedTo: 'Academics team',
      category: { shortName: 'Academics' },
      subCategory: { id: academicsSubId },
    });
    expect(res.body.timeline.map((e: { label: string }) => e.label)).toEqual([
      'Ticket created',
      'Assigned to Academics team',
    ]);

    // Internally the ticket holds an L1 owner and a 48h deadline.
    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.currentLevel).toBe(1);
    expect(row.assignedPocId).not.toBeNull();
    const hours = (row.tatDeadline!.getTime() - row.createdAt.getTime()) / 36e5;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThan(48.1);
  });

  it('spreads new tickets across an L1 pool (least-loaded first)', async () => {
    // The seed has one L1 per category, so this test adds a temporary second one.
    const prisma = prismaOf(app);
    const email = `balance.${Date.now().toString(36)}@newtonschool.co`;
    // Both L1s count as registered (have an account): people who have not registered yet are only used as a last resort,
    // which has its own test. Original values are put back afterwards.
    const extra = await prisma.user.create({ data: { email, name: 'Balance Test L1', role: 'POC', passwordHash: 'placeholder-not-a-real-hash' } });
    await prisma.pOCAssignment.create({ data: { userId: extra.id, categoryId: academicsId, level: 1 } });
    const seeded = await prisma.user.findMany({ where: { id: { not: extra.id }, pocAssignments: { some: { categoryId: academicsId, level: 1, active: true } } }, select: { id: true, passwordHash: true } });
    await prisma.user.updateMany({ where: { id: { in: seeded.map((u) => u.id) } }, data: { passwordHash: 'placeholder-not-a-real-hash' } });
    try {
      const openLoad = async () => {
        const pool = await prisma.pOCAssignment.findMany({ where: { categoryId: academicsId, level: 1, active: true } });
        const load = new Map<string, number>();
        for (const p of pool) {
          load.set(
            p.userId,
            await prisma.ticket.count({ where: { assignedPocId: p.userId, status: { notIn: ['RESOLVED', 'CLOSED'] } } }),
          );
        }
        return load;
      };

      // The rule: each new ticket goes to whoever has the fewest open tickets at that moment.
      // (Checked step by step, so it does not depend on how many tickets earlier tests left.)
      let toExtra = 0;
      for (let i = 0; i < 4; i++) {
        const before = await openLoad();
        expect(before.size).toBe(2);
        const created = await newTicket(studentToken).expect(201);
        const owner = (await prisma.ticket.findUniqueOrThrow({ where: { id: created.body.id } })).assignedPocId!;
        expect(before.get(owner)).toBe(Math.min(...before.values()));
        if (owner === extra.id) toExtra++;
      }
      expect(toExtra).toBeGreaterThan(0); // the new POC really received tickets
    } finally {
      for (const u of seeded) await prisma.user.update({ where: { id: u.id }, data: { passwordHash: u.passwordHash } });
      // Leave no trace: hand their tickets back, then remove the account.
      await prisma.ticket.updateMany({ where: { assignedPocId: extra.id }, data: { assignedPocId: null } });
      await prisma.notification.deleteMany({ where: { userId: extra.id } });
      await prisma.pOCAssignment.deleteMany({ where: { userId: extra.id } });
      await prisma.user.delete({ where: { id: extra.id } });
    }
  });

  it("the routed ticket appears in the owning POC's queue", async () => {
    const res = await newTicket(studentToken, { title: 'Marks missing from my transcript' }).expect(201);
    const prisma = prismaOf(app);
    const row = await prisma.ticket.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { assignedPoc: true },
    });
    // Log in as that POC (reset their password for the test) and read their queue.
    const email = row.assignedPoc!.email;
    await prisma.refreshToken.deleteMany({ where: { userId: row.assignedPocId! } });
    await prisma.user.update({ where: { email }, data: { passwordHash: null, emailVerifiedAt: null } });
    const pocToken = await registerAndLogin(app, email, 'POC User');
    const queue = await request(app.getHttpServer()).get('/poc/queue').set(auth(pocToken)).expect(200);
    expect(queue.body.tickets.map((t: { id: string }) => t.id)).toContain(res.body.id);
  });

  it('validates input', async () => {
    await newTicket(studentToken, { title: 'hi' }).expect(400);
    await newTicket(studentToken, { description: 'too short' }).expect(400);
    await newTicket(studentToken, { subCategoryId: 'not-a-uuid' }).expect(400);
    await newTicket(studentToken, { subCategoryId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    // A main-category id is not a sub-category id.
    await newTicket(studentToken, { subCategoryId: academicsId }).expect(400);
  });

  it('requires a title and a long-enough description', async () => {
    const send = (body: Record<string, unknown>) =>
      request(app.getHttpServer()).post('/tickets').set(auth(studentToken)).send(body);
    const valid = { subCategoryId: academicsSubId, title: 'Fee receipt missing', description: 'I paid on 3 Oct and never got a receipt.' };

    await send(valid).expect(201);
    const { title: _title, ...noTitle } = valid;
    const missing = await send(noTitle).expect(400);
    expect(JSON.stringify(missing.body)).toContain('title');
    await send({ ...valid, title: '   ' }).expect(400);
    await send({ ...valid, title: 'hi' }).expect(400);
    await send({ ...valid, description: 'Demo' }).expect(400);
  });

  it('students have no priority: a priority they send is ignored and never returned', async () => {
    const res = await newTicket(studentToken, { priority: 'HIGH' }).expect(201);
    expect(res.body).not.toHaveProperty('priority');
    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).not.toHaveProperty('priority'); // there is no priority column at all: what the student sent is simply dropped

    const list = await request(app.getHttpServer()).get('/tickets').set(auth(studentToken)).expect(200);
    expect(JSON.stringify(list.body)).not.toContain('priority');
    const detail = await request(app.getHttpServer()).get(`/tickets/${res.body.id}`).set(auth(studentToken)).expect(200);
    expect(JSON.stringify(detail.body)).not.toContain('priority');
  });

  it('"My Tickets" returns only the caller\'s tickets, with filters and pagination', async () => {
    const mine = await registerAndLogin(app, uniqueStudentEmail());
    await newTicket(mine, { title: 'Academics question one' }).expect(201);
    await newTicket(mine, { title: 'Hostel water problem', subCategoryId: hostelSubId }).expect(201);
    await newTicket(mine, { title: 'Academics question two' }).expect(201);

    const all = await request(app.getHttpServer()).get('/tickets').set(auth(mine)).expect(200);
    expect(all.body.items).toHaveLength(3);
    // Newest first.
    expect(all.body.items[0].title).toBe('Academics question two');

    const hostel = await request(app.getHttpServer())
      .get('/tickets')
      .query({ categoryId: hostelId })
      .set(auth(mine))
      .expect(200);
    expect(hostel.body.items).toHaveLength(1);
    expect(hostel.body.items[0].category.shortName).toBe('Hostel');
    expect(hostel.body.items[0].subCategory.id).toBe(hostelSubId);

    const resolved = await request(app.getHttpServer())
      .get('/tickets')
      .query({ status: 'RESOLVED' })
      .set(auth(mine))
      .expect(200);
    expect(resolved.body.items).toHaveLength(0);

    const page1 = await request(app.getHttpServer()).get('/tickets').query({ limit: 2 }).set(auth(mine)).expect(200);
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.nextCursor).toBeTruthy();
    const page2 = await request(app.getHttpServer())
      .get('/tickets')
      .query({ limit: 2, cursor: page1.body.nextCursor })
      .set(auth(mine))
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();

    // Someone else's list does not contain my tickets.
    const theirs = await request(app.getHttpServer()).get('/tickets').set(auth(otherStudentToken)).expect(200);
    expect(theirs.body.items).toHaveLength(0);
  });

  it("a student cannot read another student's ticket (404, not 403)", async () => {
    const mine = await newTicket(studentToken).expect(201);
    await request(app.getHttpServer()).get(`/tickets/${mine.body.id}`).set(auth(otherStudentToken)).expect(404);
    await request(app.getHttpServer()).get(`/tickets/${mine.body.id}`).set(auth(studentToken)).expect(200);
    await request(app.getHttpServer()).get('/tickets/not-a-uuid').set(auth(studentToken)).expect(400);
  });

  it('requires login', async () => {
    await request(app.getHttpServer()).get('/tickets').expect(401);
    await request(app.getHttpServer()).post('/tickets').send({}).expect(401);
  });
});
