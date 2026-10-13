import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, PASSWORD, verificationTokenFor } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';

async function inviteTokenFor(address: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address} subject:"invited to NST Connect"`)}`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const { Text } = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string };
      const match = Text.match(/register\?invite=([A-Za-z0-9._-]+)/);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No invitation email with a sign-up link found for ${address}`);
}

/**
 * A staff invitation is for one email address. The link carries a signed token naming that address, the sign-up page
 * locks to it, and the server refuses to register an invitation with any other address.
 */
describe('Staff invitation links (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  let categoryId: string;
  const stamp = Date.now().toString(36);
  const invitedEmail = `staff.test.inv${stamp}@newtonschool.co`;
  const otherEmail = `staff.test.wrong${stamp}@newtonschool.co`;
  let assignmentId: string;
  let invite: string;

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
    categoryId = (await categoryByShortName(app, 'Other')).id;
  });
  afterAll(async () => {
    if (assignmentId) await request(server()).post(`/staff/${assignmentId}/remove`).set(auth(admin)).catch(() => undefined);
    await app.close();
  });

  it('sends a sign-up link that names the invited address', async () => {
    const res = await request(server()).post('/staff').set(auth(admin)).send({ name: 'Invited Person', email: invitedEmail, categoryId, level: 1 }).expect(201);
    assignmentId = res.body.id;
    invite = await inviteTokenFor(invitedEmail);

    const details = await request(server()).get('/auth/invite').query({ token: invite }).expect(200);
    expect(details.body).toEqual({ email: invitedEmail, name: 'Invited Person' });
  });

  it('refuses a link that is not a real invitation', async () => {
    await request(server()).get('/auth/invite').query({ token: 'not-a-real-token-at-all' }).expect(400);
    // A verification token must not work as an invitation (different purpose).
    await request(server()).post('/auth/register').send({ email: otherEmail, name: 'Someone', password: PASSWORD }).expect(202);
    const verifyToken = await verificationTokenFor(otherEmail);
    await request(server()).get('/auth/invite').query({ token: verifyToken }).expect(400);
  });

  it('refuses to register an invitation with a different email address', async () => {
    const wrong = `staff.test.mistyped${stamp}@newtonschool.co`;
    const res = await request(server()).post('/auth/register').send({ email: wrong, name: 'Invited Person', password: PASSWORD, invite }).expect(400);
    expect(res.body.message).toMatch(/different email address/i);
    expect(await prismaOf(app).user.findUnique({ where: { email: wrong } })).toBeNull(); // nothing was created
    // The invited person is still waiting.
    const invitedUser = await prismaOf(app).user.findUniqueOrThrow({ where: { email: invitedEmail } });
    expect(invitedUser.passwordHash).toBeNull();
  });

  it('refuses a garbage invitation on sign-up', async () => {
    await request(server()).post('/auth/register').send({ email: invitedEmail, name: 'Invited Person', password: PASSWORD, invite: 'not-a-real-token-at-all' }).expect(400);
  });

  it('lets the invited address register, verify, and see its queue', async () => {
    await request(server()).post('/auth/register').send({ email: invitedEmail, name: 'Invited Person', password: PASSWORD, invite }).expect(202);
    await request(server()).post('/auth/verify').send({ token: await verificationTokenFor(invitedEmail) }).expect(200);
    const login = await request(server()).post('/auth/login').send({ email: invitedEmail, password: PASSWORD }).expect(200);
    const queue = await request(server()).get('/poc/queue').set(auth(login.body.accessToken)).expect(200);
    expect(queue.body.assigned).toBe(true);
  });

  it('says the invitation was used once the account has a password', async () => {
    const res = await request(server()).get('/auth/invite').query({ token: invite }).expect(409);
    expect(res.body.message).toMatch(/already used/i);
  });

  it('still lets a staff address sign up without an invitation (it gets no access)', async () => {
    const plain = `staff.test.plain${stamp}@newtonschool.co`;
    await request(server()).post('/auth/register').send({ email: plain, name: 'Walk In', password: PASSWORD }).expect(202);
    await request(server()).post('/auth/verify').send({ token: await verificationTokenFor(plain) }).expect(200);
    const login = await request(server()).post('/auth/login').send({ email: plain, password: PASSWORD }).expect(200);
    const queue = await request(server()).get('/poc/queue').set(auth(login.body.accessToken)).expect(200);
    expect(queue.body.assigned).toBe(false);
  });
});
