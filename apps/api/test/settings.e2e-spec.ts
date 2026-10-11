import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EscalationService } from '../src/escalation/escalation.service';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const HOUR = 3_600_000;

/**
 * The admin-controlled escalation time. Uses the "Other" category (no other spec depends on its tickets) and puts the
 * setting back to the default at the end; the global setup clears it too.
 */
describe('Escalation time set by the admin (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  let student: string;
  let pocL1: string;
  let topicId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();
  const get = (path: string, t: string) => request(server()).get(path).set(auth(t));
  const put = (path: string, t: string, body: object) => request(server()).put(path).set(auth(t)).send(body);
  const post = (path: string, t: string, body: object = {}) => request(server()).post(path).set(auth(t)).send(body);
  const row = (id: string) => prismaOf(app).ticket.findUniqueOrThrow({ where: { id } });
  const hoursFromNow = (d: Date | null) => (d ? (d.getTime() - Date.now()) / HOUR : NaN);
  async function newTicket(title: string) {
    const res = await post('/tickets', student, { subCategoryId: topicId, title, description: 'Testing the escalation time setting.' }).expect(201);
    return res.body.id as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    pocL1 = await loginAsPoc(app, 'other.l1.1@newtonschool.co');
    student = await registerAndLogin(app, uniqueStudentEmail());
    topicId = (await categoryByShortName(app, 'Other')).subCategories[0].id;
  });
  afterAll(async () => {
    await prismaOf(app).appSetting.deleteMany();
    await app.close();
  });

  it('is for the Super Admin only', async () => {
    await get('/settings/escalation', student).expect(403);
    await get('/settings/escalation', pocL1).expect(403);
    await put('/settings/escalation', pocL1, { days: 3 }).expect(403);
    await request(server()).get('/settings/escalation').expect(401);
  });

  it('starts at 2 days and refuses nonsense', async () => {
    expect((await get('/settings/escalation', admin).expect(200)).body).toMatchObject({ hours: 48, days: 2, defaultDays: 2, minDays: 1, maxDays: 14 });
    for (const days of [0, -1, 15, 2.5, '3', null]) await put('/settings/escalation', admin, { days }).expect(400);
    await put('/settings/escalation', admin, {}).expect(400);
    expect((await get('/settings/escalation', admin).expect(200)).body.days).toBe(2);
  });

  it('shows when the escalation check last ran', async () => {
    await prismaOf(app).jobHeartbeat.deleteMany();
    expect((await get('/settings/escalation', admin).expect(200)).body.lastRunAt).toBeNull();
    await app.get(EscalationService).runOnce();
    const { lastRunAt } = (await get('/settings/escalation', admin).expect(200)).body;
    expect(Date.now() - new Date(lastRunAt).getTime()).toBeLessThan(60_000);
  });

  it('uses the new limit for tickets from then on, and leaves current deadlines alone', async () => {
    const before = await newTicket('Raised under the 2 day limit');
    expect(hoursFromNow((await row(before)).tatDeadline)).toBeCloseTo(48, 0);

    const res = await put('/settings/escalation', admin, { days: 3 }).expect(200);
    expect(res.body).toMatchObject({ hours: 72, days: 3 });
    expect((await get('/settings/escalation', admin).expect(200)).body.days).toBe(3);

    expect(hoursFromNow((await row(before)).tatDeadline)).toBeCloseTo(48, 0); // not touched
    const after = await newTicket('Raised under the 3 day limit');
    expect(hoursFromNow((await row(after)).tatDeadline)).toBeCloseTo(72, 0);
  });

  it('does not restart a ticket\'s clock when a POC replies, but a hand-over gives the next level the new limit', async () => {
    const id = await newTicket('Reply does not restart the clock');
    await prismaOf(app).ticket.update({ where: { id }, data: { tatDeadline: new Date(Date.now() + 5 * HOUR) } });
    await post(`/poc/tickets/${id}/comments`, pocL1, { body: 'Looking into it now.' }).expect(201);
    expect(hoursFromNow((await row(id)).tatDeadline)).toBeCloseTo(5, 0);

    await post(`/poc/tickets/${id}/close`, pocL1, { outcome: 'ESCALATED', note: 'Needs the lead.' }).expect(200);
    expect(hoursFromNow((await row(id)).tatDeadline)).toBeCloseTo(72, 0);
  });

  it('escalates an overdue ticket and gives the next level the new limit', async () => {
    const id = await newTicket('Overdue under the 3 day limit');
    await prismaOf(app).ticket.update({ where: { id }, data: { tatDeadline: new Date(Date.now() - HOUR) } });
    await app.get(EscalationService).runOnce();
    const t = await row(id);
    expect(t).toMatchObject({ currentLevel: 2, status: 'ESCALATED' });
    expect(hoursFromNow(t.tatDeadline)).toBeCloseTo(72, 0);
  });

  it('names the limit on the admin dashboard and measures "finished within" against it', async () => {
    const res = await get('/analytics/admin', admin).expect(200);
    expect(res.body.tatHours).toBe(72);
    expect(res.body.headline).toHaveProperty('withinTatPct');
  });

  it('records the change under Recent changes, and the limit can go back', async () => {
    const changes = JSON.stringify((await get('/staff/audit', admin).expect(200)).body);
    expect(changes).toContain('Changed the escalation time from 2 days to 3 days');
    await put('/settings/escalation', admin, { days: 2 }).expect(200);
    expect((await get('/settings/escalation', admin).expect(200)).body.days).toBe(2);
    await put('/settings/escalation', admin, { days: 2 }).expect(200); // no change, no new record
    const count = await prismaOf(app).staffAudit.count({ where: { action: 'SETTING_CHANGED' } });
    expect(count).toBe(2);
  });
});
