import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { createTestApp, loginAsPoc, PASSWORD, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

const MAILPIT = process.env.MAILPIT_URL ?? 'http://localhost:8025';
const SUBJECT = 'Reset your NST Connect password';

async function resetMails(address: string): Promise<{ ID: string }[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address} subject:"${SUBJECT}"`)}`);
  return ((await res.json()) as { messages: { ID: string }[] }).messages ?? [];
}

/** The token from the newest reset email, waiting for it to arrive. */
async function resetTokenFor(address: string): Promise<string> {
  for (let attempt = 0; attempt < 24; attempt++) {
    const [latest] = await resetMails(address);
    if (latest) {
      const { Text } = (await (await fetch(`${MAILPIT}/api/v1/message/${latest.ID}`)).json()) as { Text: string };
      const match = Text.match(/reset-password\?token=([A-Za-z0-9._-]+)/);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No reset email for ${address}`);
}

/** Proof that nothing arrives: give a send time to happen, then look. */
async function noResetMail(address: string) {
  await new Promise((r) => setTimeout(r, 1200));
  expect(await resetMails(address)).toHaveLength(0);
}

describe('Forgot password (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const forgot = (email: string) => request(server()).post('/auth/forgot-password').send({ email });
  const reset = (token: string, password: string) => request(server()).post('/auth/reset-password').send({ token, password });
  const login = (email: string, password: string) => request(server()).post('/auth/login').send({ email, password });
  const fingerprint = (hash: string) => createHash('sha256').update(hash).digest('hex').slice(0, 24);
  async function signed(email: string, claims: { purpose: string }, expiresIn: string | number = '1h') {
    const user = await prisma().user.findUniqueOrThrow({ where: { email } });
    return app.get(JwtService).signAsync({ sub: user.id, fp: fingerprint(user.passwordHash!), ...claims }, { expiresIn: expiresIn as never });
  }

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());

  it('answers the same for an address that has no account, and sends nothing', async () => {
    const email = uniqueStudentEmail('nobody');
    const res = await forgot(email).expect(202);
    expect(res.body.message).toMatch(/If an account exists/);
    await noResetMail(email);
    await forgot('not-an-email').expect(400);
  });

  it('emails a registered student a link that sets a new password, and ends their sessions', async () => {
    const email = uniqueStudentEmail('pw');
    await registerAndLogin(app, email);
    await login(email, PASSWORD).expect(200); // a second session
    const user = await prisma().user.findUniqueOrThrow({ where: { email } });
    expect(await prisma().refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBeGreaterThanOrEqual(2);

    const answer = await forgot(email).expect(202);
    expect(answer.body.message).toMatch(/If an account exists/); // the same wording as for an unknown address
    const token = await resetTokenFor(email);

    await reset(token, 'a-brand-new-password-1').expect(200);
    await login(email, 'a-brand-new-password-1').expect(200);
    await login(email, PASSWORD).expect(401);
    expect(await prisma().refreshToken.count({ where: { userId: user.id, revokedAt: null } })).toBe(1); // only the login just made
  });

  it('an old session cannot be refreshed after a reset, not even straight afterwards', async () => {
    const email = uniqueStudentEmail('oldsession');
    await registerAndLogin(app, email);
    const session = await login(email, PASSWORD).expect(200);
    const cookie = (session.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(200); // alive before the reset
    const live = (await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie)).headers['set-cookie'] as unknown as string[] | undefined;
    const latest = (live ?? (session.headers['set-cookie'] as unknown as string[])).map((c) => c.split(';')[0]).join('; ');

    await forgot(email).expect(202);
    await reset(await resetTokenFor(email), 'another-new-password-1').expect(200);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', latest).expect(401);
    await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('works only once', async () => {
    const email = uniqueStudentEmail('once');
    await registerAndLogin(app, email);
    await forgot(email).expect(202);
    const token = await resetTokenFor(email);
    await reset(token, 'first-new-password-1').expect(200);
    const again = await reset(token, 'second-new-password-1').expect(400);
    expect(again.body.message).toMatch(/invalid or has expired/);
    await login(email, 'first-new-password-1').expect(200);
    await login(email, 'second-new-password-1').expect(401);
  });

  it('refuses a made-up token, a token of another kind, an expired one, and a weak password', async () => {
    const email = uniqueStudentEmail('bad');
    await registerAndLogin(app, email);
    await reset('not-a-real-token-at-all', 'whatever-password-1').expect(400);
    await reset(await signed(email, { purpose: 'verify' }), 'whatever-password-1').expect(400); // a sign-up link is not a reset link
    await reset(await signed(email, { purpose: 'access' }), 'whatever-password-1').expect(400);
    await reset(await signed(email, { purpose: 'reset' }, -60), 'whatever-password-1').expect(400); // expired

    const good = await signed(email, { purpose: 'reset' });
    await reset(good, 'short').expect(400);
    await login(email, PASSWORD).expect(200); // still the old password
    await reset(good, 'long-enough-password-1').expect(200);
  });

  it('does not accept a reset token as a login, and a sign-up token does not reset', async () => {
    const email = uniqueStudentEmail('kind');
    await registerAndLogin(app, email);
    const token = await signed(email, { purpose: 'reset' });
    await request(server()).get('/auth/me').set({ Authorization: `Bearer ${token}` }).expect(401);
  });

  it('sends nothing to accounts that never finished signing up, were deactivated, or were never registered', async () => {
    const unverified = uniqueStudentEmail('unv');
    await request(server()).post('/auth/register').send({ email: unverified, name: 'Never Verified', password: PASSWORD }).expect(202);
    await forgot(unverified).expect(202);
    await noResetMail(unverified);

    const gone = uniqueStudentEmail('gone');
    await registerAndLogin(app, gone);
    await prisma().user.update({ where: { email: gone }, data: { deactivatedAt: new Date() } });
    await forgot(gone).expect(202);
    await noResetMail(gone);
    await reset(await signed(gone, { purpose: 'reset' }), 'long-enough-password-1').expect(400);

    // A seeded staff account nobody has registered yet has no password to reset.
    await prisma().user.update({ where: { email: 'attendance.l1.1@newtonschool.co' }, data: { passwordHash: null, emailVerifiedAt: null } });
    await forgot('attendance.l1.1@newtonschool.co').expect(202);
    await noResetMail('attendance.l1.1@newtonschool.co');
  });

  it('does not send a second email straight away, so an inbox cannot be flooded', async () => {
    const email = uniqueStudentEmail('flood');
    await registerAndLogin(app, email);
    for (let i = 0; i < 4; i++) await forgot(email).expect(202);
    await resetTokenFor(email);
    expect(await resetMails(email)).toHaveLength(1);

    // After the cooldown another is sent.
    await prisma().user.update({ where: { email }, data: { passwordResetSentAt: new Date(Date.now() - 3 * 60 * 1000) } });
    await forgot(email).expect(202);
    for (let attempt = 0; attempt < 20 && (await resetMails(email)).length < 2; attempt++) await new Promise((r) => setTimeout(r, 250));
    expect(await resetMails(email)).toHaveLength(2);
  });

  it('works for staff too', async () => {
    await loginAsPoc(app, 'attendance.l2@newtonschool.co');
    await forgot('attendance.l2@newtonschool.co').expect(202);
    const token = await resetTokenFor('attendance.l2@newtonschool.co');
    await reset(token, 'staff-new-password-1').expect(200);
    await login('attendance.l2@newtonschool.co', 'staff-new-password-1').expect(200);
  });
});
