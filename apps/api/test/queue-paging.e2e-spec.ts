import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const HOUR = 36e5;

/** Paging, server-side sorting and counts, in Exams & Grading (no other spec uses it). */
describe('Queue paging (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let l1: string;
  let otherL1: string;
  let ids: string[] = []; // created oldest to newest
  let subId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const queue = (token: string, query: string) => request(server()).get(`/poc/queue?${query}`).set(auth(token));

  /** Walks every page and returns the ids in the order they came. */
  async function walk(query: string, limit = 3) {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 20; guard++) {
      const res: { body: { tickets: { id: string }[]; nextCursor: string | null } } = await queue(l1, `${query}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`).expect(200);
      seen.push(...res.body.tickets.map((t) => t.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    return seen;
  }

  beforeAll(async () => {
    app = await createTestApp();
    student = await registerAndLogin(app, uniqueStudentEmail());
    l1 = await loginAsPoc(app, 'exams.l1.1@newtonschool.co');
    otherL1 = await loginAsPoc(app, 'fees.l1.1@newtonschool.co');
    subId = (await categoryByShortName(app, 'Exams & Grading')).subCategories[0].id;

    for (let i = 0; i < 7; i++) {
      const res = await request(server())
        .post('/tickets')
        .set(auth(student))
        .send({ subCategoryId: subId, title: `Marks query ${i + 1}`, description: 'My marks do not match the answer sheet.' })
        .expect(201);
      ids.push(res.body.id);
    }
    // Deadlines: #4 is critical (no clock), #7 has no deadline, the rest are spread out in a scrambled order.
    const hours = [30, 12, 40, null, 6, 20, null];
    for (const [i, h] of hours.entries()) {
      await prisma().ticket.update({
        where: { id: ids[i] },
        data: { tatDeadline: h === null ? null : new Date(Date.now() + h * HOUR), critical: i === 3 },
      });
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns a page with a cursor, a total, and counts for both tabs', async () => {
    const res = await queue(l1, 'view=open&sort=oldest&limit=3').expect(200);
    expect(res.body.tickets).toHaveLength(3);
    expect(res.body.nextCursor).toEqual(expect.any(String));
    expect(res.body.total).toBe(7);
    expect(res.body.counts).toEqual({ open: 7, done: 0 });
    expect(res.body.tickets.map((t: { id: string }) => t.id)).toEqual(ids.slice(0, 3));
  });

  it('pages through everything exactly once, in the chosen order', async () => {
    expect(await walk('view=open&sort=oldest')).toEqual(ids);
    expect(await walk('view=open&sort=newest')).toEqual([...ids].reverse());
  });

  it('puts critical tickets first, then the least time left, and tickets with no deadline last', async () => {
    // critical #4, then deadlines ascending: #5 (6h), #2 (12h), #6 (20h), #1 (30h), #3 (40h), then #7 (none)
    const expected = [ids[3], ids[4], ids[1], ids[5], ids[0], ids[2], ids[6]];
    expect(await walk('view=open&sort=time-left')).toEqual(expected);
    expect(await walk('view=open&sort=time-left', 2)).toEqual(expected); // same order with another page size
  });

  it('stays correct when a ticket is solved between pages', async () => {
    const first = await queue(l1, 'view=open&sort=oldest&limit=3').expect(200);
    const firstIds: string[] = first.body.tickets.map((t: { id: string }) => t.id);
    // Solve one that is already on screen, and one that has not been loaded yet.
    await request(server()).post(`/poc/tickets/${ids[0]}/close`).set(auth(l1)).send({ outcome: 'SOLVED', note: 'Marks corrected.' }).expect(200);
    await request(server()).post(`/poc/tickets/${ids[5]}/close`).set(auth(l1)).send({ outcome: 'CLOSED', note: 'Duplicate query.' }).expect(200);

    const second = await queue(l1, `view=open&sort=oldest&limit=10&cursor=${first.body.nextCursor}`).expect(200);
    const rest: string[] = second.body.tickets.map((t: { id: string }) => t.id);
    expect(rest).toEqual([ids[3], ids[4], ids[6]]); // nothing repeated, nothing skipped, the closed #6 is gone
    expect(new Set([...firstIds, ...rest]).size).toBe(firstIds.length + rest.length);
    expect(second.body.nextCursor).toBeNull();
    expect(second.body.counts).toEqual({ open: 5, done: 2 });
  });

  it('pages the Done tab too, newest finished first', async () => {
    const all = await walk('view=done', 1);
    expect(all).toEqual([ids[5], ids[0]]);
    expect((await queue(l1, 'view=done&sort=oldest').expect(200)).body.tickets.map((t: { id: string }) => t.id)).toEqual([ids[0], ids[5]]);
  });

  it('keeps each POC to their own category and level', async () => {
    const res = await queue(otherL1, 'view=open').expect(200);
    expect(res.body).toMatchObject({ tickets: [], total: 0, counts: { open: 0, done: 0 }, nextCursor: null });
  });

  it('rejects bad input and keeps students out', async () => {
    await queue(l1, 'limit=0').expect(400);
    await queue(l1, 'limit=51').expect(400);
    await queue(l1, 'sort=sideways').expect(400);
    await queue(l1, 'cursor=garbage').expect(400);
    await queue(l1, `cursor=${Buffer.from(JSON.stringify({ k1: 'x' })).toString('base64url')}`).expect(400);
    await queue(student, 'view=open').expect(403);
    await request(server()).get('/poc/queue').expect(401);
  });
});
