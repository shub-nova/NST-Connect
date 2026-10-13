import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

/** Student feedback and its analytics, in Internship & Placement (no other spec uses it). */
describe('Student feedback (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let otherStudent: string;
  let studentEmail: string;
  let l1: string;
  let l2: string;
  let admin: string;
  let feesL2: string;
  let categoryId: string;
  let subId: string;
  let staffSecrets: string[] = [];

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const get = (path: string, t: string) => request(server()).get(path).set(auth(t));
  const feedback = (token: string, id: string, body: object) => request(server()).post(`/tickets/${id}/feedback`).set(auth(token)).send(body);

  async function ticket(title: string) {
    return (
      await request(server())
        .post('/tickets')
        .set(auth(student))
        .send({ subCategoryId: subId, title, description: 'I would like help with my internship paperwork.' })
        .expect(201)
    ).body.id as string;
  }
  const finish = (id: string, outcome = 'SOLVED') =>
    request(server()).post(`/poc/tickets/${id}/close`).set(auth(l1)).send({ outcome, note: 'Handled for you.' }).expect(200);
  const detail = async (id: string) => (await get(`/tickets/${id}`, student).expect(200)).body;

  beforeAll(async () => {
    app = await createTestApp();
    studentEmail = uniqueStudentEmail();
    student = await registerAndLogin(app, studentEmail);
    otherStudent = await registerAndLogin(app, uniqueStudentEmail());
    l1 = await loginAsPoc(app, 'placements.l1.1@newtonschool.co');
    l2 = await loginAsPoc(app, 'placements.l2@newtonschool.co');
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    feesL2 = await loginAsPoc(app, 'fees.l2@newtonschool.co');
    const cat = await categoryByShortName(app, 'Internship & Placement');
    categoryId = cat.id;
    subId = cat.subCategories[0].id;
    staffSecrets = (await prisma().user.findMany({ where: { role: { in: ['POC', 'SUPER_ADMIN'] } } })).flatMap((u) => [u.id, u.email]);
  });
  afterAll(async () => {
    await app.close();
  });

  let first: string;

  it('only opens once the ticket is Solved or Closed', async () => {
    first = await ticket('Internship letter');
    expect((await detail(first)).canGiveFeedback).toBe(false);
    await feedback(student, first, { rating: 'SATISFIED' }).expect(409);

    await finish(first);
    expect(await detail(first)).toMatchObject({ canGiveFeedback: true, feedback: null });
  });

  it('records the answer and shows the student only their own answer, never staff', async () => {
    const res = await feedback(student, first, { rating: 'SATISFIED', comment: '  Quick and clear.  ' }).expect(200);
    expect(res.body).toEqual({ rating: 'SATISFIED', comment: 'Quick and clear.', canChange: true });
    const d = await detail(first);
    expect(d.feedback).toEqual({ rating: 'SATISFIED', comment: 'Quick and clear.', canChange: true });
    const text = JSON.stringify(d);
    for (const secret of staffSecrets) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/finishedBy|finished_by|finishEvent/i);
  });

  it('validates the answer and keeps other people out', async () => {
    await feedback(student, first, { rating: 'AMAZING' }).expect(400);
    await feedback(student, first, {}).expect(400);
    await feedback(student, first, { rating: 'OKAY', comment: 'x'.repeat(501) }).expect(400);
    await feedback(otherStudent, first, { rating: 'OKAY' }).expect(404); // not their ticket
    await feedback(l1, first, { rating: 'OKAY' }).expect(403);
    await request(server()).post(`/tickets/${first}/feedback`).send({ rating: 'OKAY' }).expect(401);
    expect(await prisma().ticketFeedback.count({ where: { ticketId: first } })).toBe(1);
  });

  it('does not offer, or accept, a rating after the student closed the ticket themselves, even if a POC had solved it earlier', async () => {
    const id = await ticket('Solved, reopened, then closed by the student');
    await finish(id); // a POC outcome exists in the history...
    await request(server()).post(`/tickets/${id}/reopen`).set(auth(student)).send({ comment: 'Still not working for me.' }).expect(200);
    await request(server()).post(`/tickets/${id}/close`).set(auth(student)).send({}).expect(200); // ...but the latest finish is the student's own

    const d = await detail(id);
    expect(d.status).toBe('CLOSED');
    expect(d.closedByYou).toBe(true);
    expect(d.canGiveFeedback).toBe(false); // no rating card
    expect(d.feedback).toBeNull();
    const refused = await feedback(student, id, { rating: 'SATISFIED' }).expect(409);
    expect(refused.body.message).toMatch(/closed this ticket yourself/i);
    expect(await prisma().ticketFeedback.count({ where: { ticketId: id } })).toBe(0); // nothing is credited to the earlier POC
  });

  it('lets the student change their answer for a week, then locks it', async () => {
    const changed = await feedback(student, first, { rating: 'NOT_SATISFIED' }).expect(200);
    expect(changed.body).toMatchObject({ rating: 'NOT_SATISFIED', comment: null });
    expect(await prisma().ticketFeedback.count({ where: { ticketId: first } })).toBe(1); // replaced, not added

    await prisma().ticketFeedback.updateMany({ where: { ticketId: first }, data: { createdAt: new Date(Date.now() - 8 * 86400000) } });
    await feedback(student, first, { rating: 'SATISFIED' }).expect(409);
    expect((await detail(first)).feedback).toMatchObject({ rating: 'NOT_SATISFIED', canChange: false });
  });

  it('asks again after a reopen and a second finish', async () => {
    await request(server()).post(`/tickets/${first}/reopen`).set(auth(student)).send({ comment: 'It is still not sorted out.' }).expect(200);
    expect((await detail(first)).canGiveFeedback).toBe(false); // open again
    await finish(first);
    expect(await detail(first)).toMatchObject({ canGiveFeedback: true, feedback: null });
    await feedback(student, first, { rating: 'SATISFIED', comment: 'Fixed this time.' }).expect(200);
    expect(await prisma().ticketFeedback.count({ where: { ticketId: first } })).toBe(2); // one per finish
  });

  it('does not show a percentage until there are enough answers', async () => {
    const { body } = await get('/analytics/me', l1).expect(200);
    expect(body.headline.feedback).toMatchObject({ responses: 2, satisfied: 1, notSatisfied: 1, satisfactionPct: null });
  });

  it('summarises the answers for the POC who finished the tickets, anonymously', async () => {
    for (const [title, rating, comment] of [
      ['Offer letter', 'SATISFIED', 'Great help.'],
      ['Report check', 'SATISFIED', 'Great help.'],
      ['Mentor question', 'OKAY', undefined],
      ['Plan change', 'NOT_SATISFIED', 'Still not sorted.'],
    ] as const) {
      const id = await ticket(title);
      await finish(id);
      await feedback(student, id, { rating, ...(comment ? { comment } : {}) }).expect(200);
    }

    // 6 answers: 3 satisfied (first, fixed, great), 1 okay, 2 not satisfied (the changed one, plan change)
    const me = (await get('/analytics/me', l1).expect(200)).body;
    expect(me.headline.feedback).toEqual({ responses: 6, satisfied: 3, okay: 1, notSatisfied: 2, satisfactionPct: 50 });
    // The most repeated phrases are shared (not single words); the comments themselves never are.
    expect(me.feedbackTerms).toEqual([{ term: 'great help', count: 2 }]);
    const text = JSON.stringify(me);
    expect(text).not.toContain('Still not sorted');
    expect(text).not.toContain(studentEmail);
    expect(text).not.toMatch(/studentId|student_id/i);
  });

  it('credits the POC who finished it, and shows it to managers and the admin', async () => {
    // L2 finished nothing, so their own page is empty; their team page includes the L1's answers.
    expect((await get('/analytics/me', l2).expect(200)).body.headline.feedback).toMatchObject({ responses: 0, satisfactionPct: null });
    expect((await get('/analytics/team', l2).expect(200)).body.headline.feedback).toMatchObject({ responses: 6, satisfactionPct: 50 });
    expect((await get(`/analytics/admin?categoryId=${categoryId}`, admin).expect(200)).body.headline.feedback.responses).toBe(6);
    // A POC in another category sees none of it.
    expect((await get('/analytics/overall', feesL2).expect(200)).body.headline.feedback.responses).toBe(0);
  });
});
