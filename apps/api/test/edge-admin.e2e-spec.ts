import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail, startCleanup } from './helpers';

/**
 * Edge cases for what only the admin does: categories and topics, the escalation time, notes to POCs, and the
 * analytics date ranges and filters (including empty data).
 */
describe('Edge cases: admin tools and analytics (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  let l2: string;
  let student: string;
  const stamp = Date.now().toString(36);
  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const prisma = () => prismaOf(app);
  const post = (path: string, t: string, body: unknown = {}) => request(server()).post(path).set(auth(t)).send(body as object);
  const get = (path: string, t: string) => request(server()).get(path).set(auth(t));
  const name = (suffix: string) => `Catalog Test ${stamp} ${suffix}`;

  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    app = await createTestApp();
    cleanup = startCleanup(app);
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    l2 = await loginAsPoc(app, 'attendance.l2@newtonschool.co');
    student = await registerAndLogin(app, uniqueStudentEmail('adminedge'));
  });
  afterAll(async () => {
    await post('/settings/escalation', admin).catch(() => undefined);
    await request(server()).put('/settings/escalation').set(auth(admin)).send({ days: 2 });
    await cleanup();
    await app.close();
  });

  // ---- categories and topics -------------------------------------------------------------

  it('category names: exact limits, spaces collapsed, markup kept as text, duplicates refused in any capitals', async () => {
    const create = (body: Record<string, unknown>) => post('/catalog/categories', admin, body);
    await create({ name: 'ab', topics: ['A topic'] }).expect(400);
    await create({ name: '   ', topics: ['A topic'] }).expect(400);
    await create({ name: `${name('x')}`.padEnd(81, 'x'), topics: ['A topic'] }).expect(400);
    await create({ name: `${name('limit')}`.padEnd(80, 'x'), topics: ['A topic'] }).expect(201);
    await create({ name: name('short'), shortName: 'x', topics: ['A topic'] }).expect(400);
    await create({ name: name('short2'), shortName: 'x'.repeat(31), topics: ['A topic'] }).expect(400);
    await create({ name: name('short3'), shortName: 'x'.repeat(30), topics: ['A topic'] }).expect(201);
    await create({ topics: ['A topic'] }).expect(400);
    await create({ name: name('nt') }).expect(400);
    await create({ name: name('nt2'), topics: 'A topic' }).expect(400);
    await create({ name: 123, topics: ['A topic'] }).expect(400);

    const spaced = await create({ name: `  ${name('  spaced   out  ')}  `, topics: ['A topic'] }).expect(201);
    const row = await prisma().category.findUniqueOrThrow({ where: { id: spaced.body.id } });
    expect(row.name).toBe(`Catalog Test ${stamp} spaced out`);

    const html = await create({ name: name('<b>bold</b> & "quotes"'), topics: ["<script>alert(1)</script>", "Robert'); DROP TABLE category;--"] }).expect(201);
    expect((await prisma().category.findUniqueOrThrow({ where: { id: html.body.id } })).name).toContain('<b>bold</b>');

    const dup = await create({ name: name('DUPLICATE'), topics: ['A topic'] }).expect(201);
    await create({ name: name('duplicate'), topics: ['A topic'] }).expect(409);
    await create({ name: name('  Duplicate  '), topics: ['A topic'] }).expect(409);
    expect(dup.body.id).toBeTruthy();
  });

  it('topics when creating: at least one, at most 40, each up to 120, blanks and repeats dropped', async () => {
    const create = (topics: unknown, suffix: string) => post('/catalog/categories', admin, { name: name(suffix), topics });
    await create([], 't0').expect(400);
    await create(['', '   ', '\t'], 't1').expect(400); // all blank
    await create(['x'.repeat(121)], 't2').expect(400);
    await create(Array.from({ length: 41 }, (_, i) => `Topic number ${i}`), 't3').expect(400);
    await create([1, 2], 't4').expect(400);
    const forty = await create(Array.from({ length: 40 }, (_, i) => `Topic number ${i}`), 't5').expect(201);
    expect(await prisma().subCategory.count({ where: { categoryId: forty.body.id } })).toBe(40);
    const tidy = await create(['Laundry', 'laundry', '  LAUNDRY  ', '', 'Mess   timings', 'Mess timings'], 't6').expect(201);
    const topics = await prisma().subCategory.findMany({ where: { categoryId: tidy.body.id }, orderBy: { sortOrder: 'asc' } });
    expect(topics.map((t) => t.name)).toEqual(['Laundry', 'Mess timings']);
  });

  it('a topic is 3 to 120 characters whether it is added on its own or while creating the category', async () => {
    const make = await post('/catalog/categories', admin, { name: name('min'), topics: ['Valid topic'] }).expect(201);
    await post(`/catalog/categories/${make.body.id}/topics`, admin, { name: 'ab' }).expect(400);
    await post(`/catalog/categories/${make.body.id}/topics`, admin, { name: 'abc' }).expect(201);
    await post(`/catalog/categories/${make.body.id}/topics`, admin, { name: 'x'.repeat(121) }).expect(400);
    // The same minimum must hold when topics are given while creating the category.
    await post('/catalog/categories', admin, { name: name('min2'), topics: ['ab'] }).expect(400);
  });

  it('renaming: unchanged names do nothing, capitals-only changes are allowed, clashes are refused', async () => {
    const a = await post('/catalog/categories', admin, { name: name('ren-a'), topics: ['First topic', 'Second topic'] }).expect(201);
    const b = await post('/catalog/categories', admin, { name: name('ren-b'), topics: ['Only topic'] }).expect(201);
    const patch = (id: string, body: unknown) => request(server()).patch(`/catalog/categories/${id}`).set(auth(admin)).send(body as object);
    expect((await patch(a.body.id, { name: name('ren-a') }).expect(200)).body.updated).toBe(0);
    await patch(a.body.id, { name: name('REN-A') }).expect(200); // only capitals changed
    await patch(a.body.id, { name: name('ren-b') }).expect(409); // another category has it
    await patch(a.body.id, { name: name('REN-B') }).expect(409); // in other capitals too
    await patch(a.body.id, {}).expect(400);
    await patch(a.body.id, { name: 'ab' }).expect(400);
    await patch('not-a-uuid', { name: name('x') }).expect(400);
    await patch('00000000-0000-4000-8000-000000000000', { name: name('x') }).expect(404);

    const topics = await prisma().subCategory.findMany({ where: { categoryId: a.body.id }, orderBy: { sortOrder: 'asc' } });
    const rename = (id: string, body: unknown) => request(server()).patch(`/catalog/topics/${id}`).set(auth(admin)).send(body as object);
    await rename(topics[1].id, { name: 'FIRST TOPIC' }).expect(409); // clashes with the first, ignoring capitals
    expect((await rename(topics[1].id, { name: 'Second topic' }).expect(200)).body.updated).toBe(0);
    await rename(topics[1].id, { name: 'ab' }).expect(400);
    void b;
  });

  it('removing and restoring is idempotent, and nothing can be added to a removed category', async () => {
    const c = await post('/catalog/categories', admin, { name: name('rm'), topics: ['Topic one', 'Topic two'] }).expect(201);
    await post(`/catalog/categories/${c.body.id}/remove`, admin).expect(200);
    await post(`/catalog/categories/${c.body.id}/remove`, admin).expect(200); // again
    const refused = await post(`/catalog/categories/${c.body.id}/topics`, admin, { name: 'New topic' }).expect(400);
    expect(refused.body.message).toMatch(/restore/i);
    await post(`/catalog/categories/${c.body.id}/restore`, admin).expect(200);
    await post(`/catalog/categories/${c.body.id}/restore`, admin).expect(200); // again
    await post('/catalog/categories/not-a-uuid/remove', admin).expect(400);
    await post('/catalog/categories/00000000-0000-4000-8000-000000000000/remove', admin).expect(404);
    await post('/catalog/topics/00000000-0000-4000-8000-000000000000/remove', admin).expect(404);

    // Removing a removed name's twin: a removed category's name is still taken, and the message says to restore it.
    await post(`/catalog/categories/${c.body.id}/remove`, admin).expect(200);
    const clash = await post('/catalog/categories', admin, { name: name('rm'), topics: ['Another'] }).expect(409);
    expect(clash.body.message).toMatch(/restore/i);
  });

  it('only the admin can reach the catalogue, settings and notes endpoints', async () => {
    const calls: [string, string][] = [['get', '/catalog'], ['post', '/catalog/categories'], ['get', '/settings/escalation'], ['put', '/settings/escalation'], ['post', '/notes'], ['get', '/notes/sent']];
    for (const [method, path] of calls) {
      for (const token of [student, l2]) {
        const res = await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method](path).set(auth(token)).send({});
        expect(res.status).toBe(403);
      }
      const anonymous = await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method](path).send({});
      expect(anonymous.status).toBe(401);
    }
  });

  // ---- escalation time -------------------------------------------------------------------

  it('the escalation time only accepts whole days from 1 to 14', async () => {
    const put = (body: unknown) => request(server()).put('/settings/escalation').set(auth(admin)).send(body as object);
    for (const days of [0, -1, 15, 1.5, '2', null, true, [], {}, 1e9, NaN, undefined]) expect((await put({ days })).status).toBe(400);
    await put({}).expect(400);
    await put('text').expect(400);
    for (const days of [1, 14, 2]) {
      const res = await put({ days }).expect(200);
      expect(res.body).toMatchObject({ days, hours: days * 24 });
    }
    await put({ days: 2, extra: 'ignored' }).expect(200);
  });

  // ---- notes to POCs ---------------------------------------------------------------------

  it('notes: exact limits, audiences that match nobody, and mismatched filters', async () => {
    const send = (body: Record<string, unknown>) => post('/notes', admin, body);
    const category = await categoryByShortName(app, 'Attendance & Leave');
    await send({ body: 'ab', categoryId: category.id }).expect(400);
    await send({ body: '   ab   ', categoryId: category.id }).expect(400);
    await send({ body: 'n'.repeat(2001), categoryId: category.id }).expect(400);
    await send({ body: 'Valid note', categoryId: category.id, level: 0 }).expect(400);
    await send({ body: 'Valid note', categoryId: category.id, level: 4 }).expect(400);
    await send({ body: 'Valid note', categoryId: category.id, context: 'c'.repeat(201) }).expect(400);
    await send({ body: 'Valid note', categoryId: 'nope' }).expect(400);
    await send({ body: 'Valid note', categoryId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await send({ body: 'Valid note', pocId: '00000000-0000-4000-8000-000000000000' }).expect(400); // nobody matches

    const l1Person = await prisma().pOCAssignment.findFirstOrThrow({ where: { categoryId: category.id, level: 1, active: true } });
    await send({ body: 'Valid note', categoryId: category.id, level: 2, pocId: l1Person.userId }).expect(400); // that person is not level 2

    const hostile = `<img src=x onerror=alert(1)> 🙂 '); DROP TABLE admin_note;--`;
    await send({ body: hostile, categoryId: category.id, level: 2 }).expect(201);
    const sent = await get('/notes/sent', admin).expect(200);
    expect(sent.body.notes.map((n: { body: string }) => n.body)).toContain(hostile);
    await send({ body: 'n'.repeat(2000), categoryId: category.id, level: 2 }).expect(201);
  });

  it('a category with nobody assigned has no one to send a note to', async () => {
    const empty = await post('/catalog/categories', admin, { name: name('notes-empty'), topics: ['A topic'] }).expect(201);
    const res = await post('/notes', admin, { body: 'Is anyone there?', categoryId: empty.body.id }).expect(400);
    expect(res.body.message).toMatch(/No POCs/i);
  });

  // ---- analytics ranges and empty data ---------------------------------------------------

  it('analytics date ranges: one day, 366 days, one over, reversed, future, impossible and half-given', async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const q = (qs: string) => get(`/analytics/admin?${qs}`, admin);
    await q(`from=${day(0)}&to=${day(0)}`).expect(200); // a single day
    const full = await q(`from=${day(-365)}&to=${day(0)}`).expect(200); // exactly 366 days
    expect(full.body.range.days).toBe(366);
    await q(`from=${day(-366)}&to=${day(0)}`).expect(400); // 367 days
    await q(`from=${day(0)}&to=${day(-5)}`).expect(400); // reversed
    await q(`from=${day(5)}&to=${day(10)}`).expect(200); // entirely in the future: empty, not an error
    const accepted: string[] = [];
    for (const bad of ['from=2026-13-45&to=2026-13-46', 'from=garbage', 'to=garbage', 'from=2026-1-1', 'from=20261001', 'from=2026-10-01T00:00:00Z', 'from=', 'from=2026-02-30&to=2026-03-05', 'from=2026-04-31&to=2026-05-05', 'from=2026-02-29&to=2026-03-05']) {
      if ((await q(bad)).status !== 400) accepted.push(bad);
    }
    expect(accepted).toEqual([]); // a date that does not exist (30 February) must be refused, not quietly moved to March
    await q(`from=${day(-10)}`).expect(200); // only "from": runs to today
    await q(`to=${day(0)}`).expect(200); // only "to": the 30 days before it
    for (const bad of ['level=0', 'level=4', 'level=x', 'categoryId=nope', 'pocId=nope']) expect((await q(bad)).status).toBe(400);
    await q('categoryId=00000000-0000-4000-8000-000000000000').expect(404);
    await q('pocId=00000000-0000-4000-8000-000000000000').expect(200); // nobody: empty numbers
  });

  it('analytics with nothing to count returns zeros and empty lists, never an error or NaN', async () => {
    const empty = await post('/catalog/categories', admin, { name: name('analytics-empty'), topics: ['A topic'] }).expect(201);
    const res = await get(`/analytics/admin?categoryId=${empty.body.id}`, admin).expect(200);
    const h = res.body.headline;
    expect(h).toMatchObject({ solved: 0, closed: 0, escalated: 0, finished: 0, actionNeeded: 0, total: 0, reopened: 0 });
    for (const pct of [h.withinTatPct, h.reopenRatePct, h.feedback.satisfactionPct, h.avgFinishHours, h.medianFinishHours]) expect(pct).toBeNull();
    expect(res.body.categories).toEqual([]);
    expect(res.body.breakdown).toEqual([]);
    expect(JSON.stringify(res.body)).not.toMatch(/NaN|Infinity/);
    expect(res.body.finishTimes).toHaveLength(10);
  });

  it('POC analytics pages are refused to the wrong levels and to people with no team', async () => {
    const l1 = await loginAsPoc(app, 'attendance.l1.1@newtonschool.co');
    await get('/analytics/team', l1).expect(403); // L1 has no team analytics
    await get('/analytics/me', l1).expect(200);
    await get('/analytics/overall', l1).expect(200); // read-only view of the whole category
    await get('/analytics/admin', l1).expect(403);
    const nobody = await registerAndLogin(app, `staff.test.noteam${stamp}@newtonschool.co`, 'No Team');
    for (const path of ['me', 'team', 'overall']) await get(`/analytics/${path}`, nobody).expect(403);
    expect((await get('/analytics/access', nobody).expect(200)).body).toMatchObject({ me: false, team: false, overall: false, manage: false });
  });
});
