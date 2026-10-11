import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

/**
 * The admin managing categories and topics. Works on its own categories (named "Catalog Test ..."), which the
 * global setup deletes before the next run, so no other spec sees them. Tests run in order and build on each other.
 */
describe('Managing categories and topics (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  let pocL1: string;
  let student: string;
  const stamp = Date.now().toString(36);
  const name = `Catalog Test ${stamp}`;
  let categoryId: string;
  let topicIds: string[] = [];
  let ticketId: string;
  const assignments: Record<number, string> = {};

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const get = (path: string, t: string) => request(app.getHttpServer()).get(path).set(auth(t));
  const post = (path: string, t: string, body: object = {}) => request(app.getHttpServer()).post(path).set(auth(t)).send(body);
  const patch = (path: string, t: string, body: object) => request(app.getHttpServer()).patch(path).set(auth(t)).send(body);
  const studentSees = async () => {
    const res = await get('/categories', student).expect(200);
    return (res.body as { id: string; name: string; subCategories: { id: string; name: string }[] }[]).find((c) => c.id === categoryId);
  };
  const adminSees = async () => {
    const res = await get('/catalog', admin).expect(200);
    return (res.body.categories as { id: string; name: string; shortName: string; active: boolean; staff: number; missingLevels: number[]; topics: { id: string; name: string; active: boolean }[] }[]).find((c) => c.id === categoryId)!;
  };
  async function addStaff(level: number) {
    const res = await post('/staff', admin, { name: `Catalog L${level}`, email: `staff.test.catalog${stamp}.l${level}@newtonschool.co`, categoryId, level }).expect(201);
    assignments[level] = res.body.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    pocL1 = await loginAsPoc(app, 'activities.l1.1@newtonschool.co');
    student = await registerAndLogin(app, uniqueStudentEmail());
  });
  afterAll(() => app.close());

  it('is for the Super Admin only', async () => {
    await get('/catalog', student).expect(403);
    await get('/catalog', pocL1).expect(403);
    await request(app.getHttpServer()).get('/catalog').expect(401);
    await post('/catalog/categories', pocL1, { name, topics: ['Anything at all'] }).expect(403);
  });

  it('adds a category with its first topics, tidied and without repeats', async () => {
    const res = await post('/catalog/categories', admin, { name, shortName: `CT ${stamp}`, topics: ['First topic here', '  second   topic  here ', 'FIRST topic here'] }).expect(201);
    categoryId = res.body.id;
    const mine = await adminSees();
    expect(mine).toMatchObject({ shortName: `CT ${stamp}`, active: true, staff: 0, missingLevels: [1, 2, 3] });
    expect(mine.topics.map((t) => t.name)).toEqual(['First topic here', 'second topic here']);
    topicIds = mine.topics.map((t) => t.id);
  });

  it('refuses a duplicate name (ignoring capitals), a missing topic and bad input', async () => {
    await post('/catalog/categories', admin, { name: name.toUpperCase(), topics: ['Another topic'] }).expect(409);
    await post('/catalog/categories', admin, { name: `Empty ${stamp}`, topics: [] }).expect(400);
    await post('/catalog/categories', admin, { name: `Blank ${stamp}`, topics: ['   '] }).expect(400);
    await post('/catalog/categories', admin, { name: 'ab', topics: ['Valid topic'] }).expect(400);
  });

  it('keeps the category away from students until every level has someone', async () => {
    expect(await studentSees()).toBeUndefined();
    const refused = await post('/tickets', student, { subCategoryId: topicIds[0], title: 'Too early', description: 'There is nobody to answer this yet.' }).expect(400);
    expect(refused.body.message).toMatch(/not taking tickets yet/);

    await addStaff(3);
    expect((await adminSees()).missingLevels).toEqual([1, 2]);
    expect(await studentSees()).toBeUndefined();

    await addStaff(2);
    expect((await adminSees()).missingLevels).toEqual([1]);
    expect(await studentSees()).toBeUndefined();

    await addStaff(1);
    const mine = await adminSees();
    expect(mine).toMatchObject({ missingLevels: [], staff: 3 });
    const seen = await studentSees();
    expect(seen?.name).toBe(name);
    expect(seen?.subCategories.map((s) => s.name)).toEqual(['First topic here', 'second topic here']);
  });

  it('routes a ticket in the staffed category to its L1', async () => {
    const res = await post('/tickets', student, { subCategoryId: topicIds[0], title: 'Testing a new category', description: 'This category now has a full team.' }).expect(201);
    ticketId = res.body.id;
    expect(res.body.status).toBe('ASSIGNED');
    const row = await prismaOf(app).ticket.findUniqueOrThrow({ where: { id: ticketId } });
    expect(row.currentLevel).toBe(1);
    expect(row.assignedPocId).not.toBeNull();
  });

  it('renames a topic, puts a note on the open tickets that use it, and records it', async () => {
    const res = await patch(`/catalog/topics/${topicIds[0]}`, admin, { name: 'First topic renamed' }).expect(200);
    expect(res.body).toMatchObject({ updated: 1 });

    // The student sees it on the ticket: the new name, and a note on the timeline. No staff identity anywhere.
    const detail = await get(`/tickets/${ticketId}`, student).expect(200);
    expect(detail.body.subCategory.name).toBe('First topic renamed');
    const note = detail.body.timeline.find((e: { type: string }) => e.type === 'RENAMED');
    expect(note).toMatchObject({ label: 'Name updated', message: 'The topic “First topic here” is now “First topic renamed”.' });

    // A topic with no open ticket gets no note anywhere.
    const quiet = await patch(`/catalog/topics/${topicIds[1]}`, admin, { name: 'Second topic renamed' }).expect(200);
    expect(quiet.body).toMatchObject({ updated: 0 });
    await patch(`/catalog/topics/${topicIds[1]}`, admin, { name: 'FIRST TOPIC RENAMED' }).expect(409); // clashes with the other topic

    const actions = (await prismaOf(app).staffAudit.findMany({ where: { categoryId }, select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['CATEGORY_ADDED', 'TOPIC_UPDATED']));
    expect(JSON.stringify((await get('/staff/audit', admin).expect(200)).body)).toContain('Second topic renamed');
  });

  it('renames the category, adds a note to the open ticket, and shows the new name', async () => {
    const res = await patch(`/catalog/categories/${categoryId}`, admin, { name: `${name} v2`, shortName: `CT2 ${stamp}` }).expect(200);
    expect(res.body).toMatchObject({ updated: 1 });
    const mine = await adminSees();
    expect(mine.shortName).toBe(`CT2 ${stamp}`);

    const detail = await get(`/tickets/${ticketId}`, student).expect(200);
    expect(detail.body.category.shortName).toBe(`CT2 ${stamp}`);
    const notes = detail.body.timeline.filter((e: { type: string }) => e.type === 'RENAMED');
    expect(notes.map((n: { message: string }) => n.message)).toEqual([
      'The topic “First topic here” is now “First topic renamed”.',
      `The category “${name}” is now “${name} v2”.`,
    ]);
    await patch(`/catalog/categories/${categoryId}`, admin, {}).expect(400);
  });

  it('will not remove a category or a topic that still has an open ticket', async () => {
    const cat = await post(`/catalog/categories/${categoryId}/remove`, admin).expect(409);
    expect(cat.body.message).toMatch(/1 open ticket/);
    const topic = await post(`/catalog/topics/${topicIds[0]}/remove`, admin).expect(409);
    expect(topic.body.message).toMatch(/1 open ticket/);
    expect((await adminSees()).active).toBe(true);
  });

  it('removes a topic without open tickets, but always keeps one topic in a live category', async () => {
    const added = await post(`/catalog/categories/${categoryId}/topics`, admin, { name: 'Third topic' }).expect(201);
    await post(`/catalog/categories/${categoryId}/topics`, admin, { name: 'third TOPIC' }).expect(409);

    await post(`/catalog/topics/${topicIds[1]}/remove`, admin).expect(200);
    expect((await studentSees())?.subCategories.map((s) => s.name)).toEqual(['First topic renamed', 'Third topic']);

    // Only the open ticket's topic and one other are left; removing the other leaves just the one in use.
    await post(`/catalog/topics/${added.body.id}/remove`, admin).expect(200);
    expect((await studentSees())?.subCategories.map((s) => s.name)).toEqual(['First topic renamed']);

    await post(`/catalog/topics/${topicIds[1]}/restore`, admin).expect(200);
    expect((await studentSees())?.subCategories.map((s) => s.name)).toEqual(['First topic renamed', 'Second topic renamed']);
  });

  it('hides the category again if a level loses everyone, and offers it again when they are back', async () => {
    await prismaOf(app).pOCAssignment.update({ where: { id: assignments[2] }, data: { active: false } });
    expect((await adminSees()).missingLevels).toEqual([2]);
    expect(await studentSees()).toBeUndefined();
    await post('/tickets', student, { subCategoryId: topicIds[1], title: 'Missing a level', description: 'Level two has nobody now.' }).expect(400);

    await prismaOf(app).pOCAssignment.update({ where: { id: assignments[2] }, data: { active: true } });
    expect((await studentSees())?.name).toBe(`${name} v2`);
  });

  it('removes a category once its tickets are finished, hides it from students, and restores it', async () => {
    await post(`/tickets/${ticketId}/close`, student).expect(200);

    await post(`/catalog/topics/${topicIds[0]}/remove`, admin).expect(200); // finished tickets no longer block a topic
    await post(`/catalog/topics/${topicIds[0]}/restore`, admin).expect(200);

    await post(`/catalog/categories/${categoryId}/remove`, admin).expect(200);
    expect(await studentSees()).toBeUndefined();
    await post('/tickets', student, { subCategoryId: topicIds[0], title: 'Should not work', description: 'The category was removed.' }).expect(400);
    expect((await adminSees()).active).toBe(false);
    await post('/catalog/categories', admin, { name: `${name} v2`, topics: ['Again'] }).expect(409); // the message says to restore it
    await post(`/catalog/categories/${categoryId}/topics`, admin, { name: 'Cannot add' }).expect(400);

    await post(`/catalog/categories/${categoryId}/restore`, admin).expect(200);
    expect((await studentSees())?.name).toBe(`${name} v2`);
  });

  it('shows the category in the staff form for the admin, and leaves it removed afterwards', async () => {
    const options = await get('/staff/options', admin).expect(200);
    expect(options.body.categories.some((c: { id: string }) => c.id === categoryId)).toBe(true);

    await post(`/catalog/categories/${categoryId}/remove`, admin).expect(200);
    const after = await get('/staff/options', admin).expect(200);
    expect(after.body.categories.some((c: { id: string }) => c.id === categoryId)).toBe(false);
  });
});
