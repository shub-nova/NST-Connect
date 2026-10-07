import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

/** Wait for the real email to reach Mailpit, then return its text. */
async function emailTo(address: string, containing: string): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address} subject:"Note from the admin"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    for (const m of messages ?? []) {
      const body = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
      if (body.Text.includes(containing)) return body.Text;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

/** Admin notes go to the POCs the admin picked, show on their dashboard, are emailed, and tracked as seen. */
describe('Admin notes (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let admin: string;
  let attendanceL1: string;
  let attendanceL2: string;
  let attendanceId: string;
  let noteId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    app = await createTestApp();
    student = await registerAndLogin(app, uniqueStudentEmail());
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    attendanceL1 = await loginAsPoc(app, 'attendance.l1.1@newtonschool.co');
    attendanceL2 = await loginAsPoc(app, 'attendance.l2@newtonschool.co');
    attendanceId = (await categoryByShortName(app, 'Attendance & Leave')).id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('sends a note to one category and level, and says who it went to', async () => {
    const res = await request(server())
      .post('/notes')
      .set(auth(admin))
      .send({ body: 'Please clear the backlog before Friday.', categoryId: attendanceId, level: 1, context: 'Auto-escalated, last 30 days' })
      .expect(201);
    expect(res.body).toMatchObject({ recipients: 1, audience: 'Attendance & Leave · L1' });
    noteId = res.body.id;
  });

  it('shows it on the recipient dashboard as unread, and not to anyone else', async () => {
    const mine = (await request(server()).get('/notes/mine').set(auth(attendanceL1)).expect(200)).body;
    expect(mine.notes[0]).toMatchObject({ id: noteId, body: 'Please clear the backlog before Friday.', seen: false, context: 'Auto-escalated, last 30 days' });
    expect(JSON.stringify(mine)).not.toMatch(/admin@newtonschool/);

    expect((await request(server()).get('/notes/mine').set(auth(attendanceL2)).expect(200)).body.notes).toEqual([]);
    expect((await request(server()).get('/analytics/access').set(auth(attendanceL1)).expect(200)).body.unreadNotes).toBe(1);
  });

  it('emails the recipient', async () => {
    const text = await emailTo('attendance.l1.1@newtonschool.co', 'Please clear the backlog before Friday.');
    expect(text).toContain('Auto-escalated, last 30 days');
    expect(text).toContain('/poc/analytics');
  });

  it('lets the recipient mark it seen, and the admin sees the count', async () => {
    await request(server()).post(`/notes/${noteId}/seen`).set(auth(attendanceL1)).expect(200);
    await request(server()).post(`/notes/${noteId}/seen`).set(auth(attendanceL1)).expect(200); // idempotent
    expect((await request(server()).get('/notes/mine').set(auth(attendanceL1)).expect(200)).body.notes[0].seen).toBe(true);
    expect((await request(server()).get('/analytics/access').set(auth(attendanceL1)).expect(200)).body.unreadNotes).toBe(0);

    const sent = (await request(server()).get('/notes/sent').set(auth(admin)).expect(200)).body.notes;
    expect(sent[0]).toMatchObject({ id: noteId, recipients: 1, seen: 1 });
  });

  it("will not mark someone else's note as seen", async () => {
    await request(server()).post(`/notes/${noteId}/seen`).set(auth(attendanceL2)).expect(404);
  });

  it('can target one POC or a whole category', async () => {
    const l2 = await prismaOf(app).user.findUniqueOrThrow({ where: { email: 'attendance.l2@newtonschool.co' } });
    const one = (await request(server()).post('/notes').set(auth(admin)).send({ body: 'A note just for you.', categoryId: attendanceId, pocId: l2.id }).expect(201)).body;
    expect(one).toMatchObject({ recipients: 1, audience: l2.name }); // a single POC is addressed by name
    const category = (await request(server()).post('/notes').set(auth(admin)).send({ body: 'For the whole team.', categoryId: attendanceId }).expect(201)).body;
    expect(category.recipients).toBe(3);
  });

  it('rejects empty audiences and bad input', async () => {
    const other = await categoryByShortName(app, 'Hostel');
    const l2 = await prismaOf(app).user.findUniqueOrThrow({ where: { email: 'attendance.l2@newtonschool.co' } });
    await request(server()).post('/notes').set(auth(admin)).send({ body: 'Mismatch.', categoryId: other.id, pocId: l2.id }).expect(400);
    await request(server()).post('/notes').set(auth(admin)).send({ body: 'x' }).expect(400);
    await request(server()).post('/notes').set(auth(admin)).send({ body: 'Bad level.', level: 7 }).expect(400);
  });

  it('is closed to students and to POCs writing notes', async () => {
    for (const [method, path] of [['post', '/notes'], ['get', '/notes/sent'], ['get', '/notes/mine'], ['post', `/notes/${noteId}/seen`]] as const) {
      await request(server())[method](path).set(auth(student)).send({ body: 'hello there' }).expect(403);
      await request(server())[method](path).send({ body: 'hello there' }).expect(401);
    }
    await request(server()).post('/notes').set(auth(attendanceL1)).send({ body: 'Trying to write.' }).expect(403);
    await request(server()).get('/notes/sent').set(auth(attendanceL1)).expect(403);
    await request(server()).get('/notes/mine').set(auth(admin)).expect(403);
  });
});
