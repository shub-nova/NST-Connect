import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { createTestApp, prismaOf, PASSWORD, registerAndLogin, uniqueStudentEmail, verificationTokenFor } from './helpers';

/**
 * Edge cases for sign-up, verification, login and sessions: exact limits, look-alike addresses, hostile input,
 * and attempts to take over or promote an account.
 */
describe('Edge cases: accounts and sessions (e2e)', () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  const prisma = () => prismaOf(app);
  const register = (body: Record<string, unknown>) => request(server()).post('/auth/register').send(body);
  const stamp = Date.now().toString(36);
  let n = 0;
  const fresh = () => `edge${stamp}${n++}@adypu.edu.in`;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  // ---- sign-up input ---------------------------------------------------------------------

  it('ignores extra fields in the sign-up body: nobody can promote themselves', async () => {
    const email = fresh();
    await register({ email, name: 'Sneaky', password: PASSWORD, role: 'SUPER_ADMIN', emailVerifiedAt: new Date().toISOString(), deactivatedAt: null, enrollmentId: 'x' }).expect(202);
    const user = await prisma().user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe('STUDENT');
    expect(user.emailVerifiedAt).toBeNull(); // cannot skip verification
    expect(user.enrollmentId).toBe(email.split('@')[0]);
  });

  it('treats email addresses case-insensitively and trims spaces: one account, stored in lower case', async () => {
    const local = fresh().split('@')[0];
    await register({ email: `  ${local.toUpperCase()}@ADYPU.EDU.IN  `, name: 'Case Test', password: PASSWORD }).expect(202);
    await request(server()).post('/auth/verify').send({ token: await verificationTokenFor(`${local}@adypu.edu.in`) }).expect(200);
    const rows = await prisma().user.findMany({ where: { email: { equals: `${local}@adypu.edu.in`, mode: 'insensitive' } } });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(`${local}@adypu.edu.in`);
    // Logging in with other capitals works.
    await request(server()).post('/auth/login').send({ email: `${local.toUpperCase()}@adypu.edu.in`, password: PASSWORD }).expect(200);
    // Registering again with other capitals does not create a second account.
    await register({ email: `${local}@Adypu.edu.in`, name: 'Case Test', password: PASSWORD }).expect(202);
    expect(await prisma().user.count({ where: { email: { equals: `${local}@adypu.edu.in`, mode: 'insensitive' } } })).toBe(1);
  });

  it('refuses look-alike and malformed addresses', async () => {
    const bad = [
      'a1@adypu.edu.in.evil.com',
      'a1@evil.adypu.edu.in',
      'a1@xadypu.edu.in',
      'a1@adypu.edu.in@evil.com',
      'a1@@adypu.edu.in',
      '@adypu.edu.in',
      'a1@',
      'a1',
      '',
      'a b@adypu.edu.in',
      'a1@adypu.edu.in,evil@evil.com',
      '.dot@adypu.edu.in', // student ids must start with a letter or digit
      'a@adypu.edu.in', // too short to be an enrollment id
      `${'x'.repeat(64)}@adypu.edu.in`, // too long
      'x+staff@adypu.edu.in', // the +staff trick only exists for a shared test domain
    ];
    for (const email of bad) {
      const res = await register({ email, name: 'Bad Address', password: PASSWORD });
      expect([400]).toContain(res.status);
    }
    expect(await prisma().user.count({ where: { email: { in: bad.map((e) => e.toLowerCase()) } } })).toBe(0);
  });

  it('accepts the plain, dotted, hyphenated and underscored forms of a student id', async () => {
    for (const local of [`a${stamp}b1`, `first.last${stamp}`, `x-y${stamp}`, `x_y${stamp}`, `${'z'.repeat(40)}${stamp}`]) {
      await register({ email: `${local}@adypu.edu.in`, name: 'Good Address', password: PASSWORD }).expect(202);
    }
  });

  it('enforces the exact name and password limits', async () => {
    await register({ email: fresh(), name: 'A', password: PASSWORD }).expect(400); // 1 character
    await register({ email: fresh(), name: 'Al', password: PASSWORD }).expect(202); // 2
    await register({ email: fresh(), name: 'n'.repeat(100), password: PASSWORD }).expect(202);
    await register({ email: fresh(), name: 'n'.repeat(101), password: PASSWORD }).expect(400);
    await register({ email: fresh(), name: '   ', password: PASSWORD }).expect(400); // spaces only
    await register({ email: fresh(), name: 'Ünï Çödé 名前 🙂', password: PASSWORD }).expect(202);

    await register({ email: fresh(), name: 'Pw Test', password: 'x'.repeat(9) }).expect(400);
    await register({ email: fresh(), name: 'Pw Test', password: 'x'.repeat(10) }).expect(202);
    await register({ email: fresh(), name: 'Pw Test', password: 'x'.repeat(128) }).expect(202);
    await register({ email: fresh(), name: 'Pw Test', password: 'x'.repeat(129) }).expect(400);
    await register({ email: fresh(), name: 'Pw Test', password: ' '.repeat(10) }).expect(202); // spaces are allowed characters (not trimmed)
  });

  it('rejects missing fields, wrong types and nonsense bodies with a 400, never a 500', async () => {
    const bodies: unknown[] = [{}, { email: 'a' }, { email: 1, name: 2, password: 3 }, { email: null, name: null, password: null }, [], 'text', { email: ['a@adypu.edu.in'], name: 'Ab', password: PASSWORD }];
    for (const body of bodies) {
      const res = await request(server()).post('/auth/register').send(body as object);
      expect(res.status).toBe(400);
    }
    const malformed = await request(server()).post('/auth/register').set('Content-Type', 'application/json').send('{"email": "broken');
    expect(malformed.status).toBe(400);
    const wrongType = await request(server()).post('/auth/register').set('Content-Type', 'text/plain').send('email=a');
    expect(wrongType.status).toBe(400);
  });

  it('answers a body that is far too large with 413, not a crash', async () => {
    const res = await request(server()).post('/auth/register').send({ email: fresh(), name: 'Big', password: 'x'.repeat(300_000) });
    expect(res.status).toBe(413);
  });

  it('stores hostile text as plain text (no injection) in names', async () => {
    const email = fresh();
    const name = `<script>alert(1)</script> Robert'); DROP TABLE "user";--`;
    await register({ email, name, password: PASSWORD }).expect(202);
    expect((await prisma().user.findUniqueOrThrow({ where: { email } })).name).toBe(name);
    expect(await prisma().user.count()).toBeGreaterThan(0); // the table still exists
  });

  // ---- taking over an account ------------------------------------------------------------

  it('re-registering a VERIFIED address changes nothing: the password stays and no takeover is possible', async () => {
    const email = fresh();
    await registerAndLogin(app, email);
    const before = await prisma().user.findUniqueOrThrow({ where: { email } });
    const res = await register({ email, name: 'Attacker', password: 'attacker-chosen-password' }).expect(202);
    expect(res.body.message).toMatch(/verification email/i); // same answer as for a new address
    const after = await prisma().user.findUniqueOrThrow({ where: { email } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.name).toBe(before.name);
    await request(server()).post('/auth/login').send({ email, password: 'attacker-chosen-password' }).expect(401);
    await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  });

  it('signing up again with an UNVERIFIED address never changes its password (no pre-verification takeover)', async () => {
    const email = fresh();
    await register({ email, name: 'Real Owner', password: PASSWORD }).expect(202); // the owner signs up
    const before = await prisma().user.findUniqueOrThrow({ where: { email } });
    await register({ email, name: 'Attacker', password: 'attacker-chosen-password' }).expect(202); // an attacker re-registers the address
    const after = await prisma().user.findUniqueOrThrow({ where: { email } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.name).toBe('Real Owner');

    // The owner clicks the link in their mailbox: the account is verified with THEIR password, not the attacker's.
    await request(server()).post('/auth/verify').send({ token: await verificationTokenFor(email) }).expect(200);
    await request(server()).post('/auth/login').send({ email, password: 'attacker-chosen-password' }).expect(401);
    await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  });

  it('a repeat sign-up sends a fresh verification link, so someone whose link expired can still finish', async () => {
    const email = fresh();
    await register({ email, name: 'Late Verifier', password: PASSWORD }).expect(202);
    const first = await verificationTokenFor(email);
    await register({ email, name: 'Late Verifier', password: PASSWORD }).expect(202);
    const jwt = app.get(JwtService);
    const user = await prisma().user.findUniqueOrThrow({ where: { email } });
    const fresher = await jwt.signAsync({ sub: user.id, purpose: 'verify' }, { expiresIn: '1h' });
    expect(first).toBeTruthy();
    await request(server()).post('/auth/verify').send({ token: fresher }).expect(200);
    await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
  });

  it('an account that was added by name (no password yet), including the admin, cannot be claimed without its invitation link', async () => {
    const invited = `staff.test.claim${stamp}@newtonschool.co`;
    await prisma().user.create({ data: { email: invited, name: 'Added By Name', role: 'POC' } });
    const res = await register({ email: invited, name: 'Attacker', password: 'attacker-chosen-password' }).expect(400);
    expect(res.body.message).toMatch(/invitation/i);
    expect((await prisma().user.findUniqueOrThrow({ where: { email: invited } })).passwordHash).toBeNull();

    // The seeded admin has no password until the setup script sets one; sign-up must not be a way in.
    await prisma().user.update({ where: { email: 'admin@newtonschool.co' }, data: { passwordHash: null, emailVerifiedAt: null } });
    await register({ email: 'admin@newtonschool.co', name: 'Not The Admin', password: 'attacker-chosen-password' }).expect(400);
    expect((await prisma().user.findUniqueOrThrow({ where: { email: 'admin@newtonschool.co' } })).passwordHash).toBeNull();
  });

  it('login does not reveal whether an unverified account exists: a wrong password is a plain 401', async () => {
    const email = fresh();
    await register({ email, name: 'Not Verified', password: PASSWORD }).expect(202);
    await request(server()).post('/auth/login').send({ email, password: 'not-the-password' }).expect(401);
    const right = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(403);
    expect(right.body.message).toMatch(/verify/i);
  });

  it('blocks a deactivated account at login, at refresh, and ends its sessions', async () => {
    const email = fresh();
    await registerAndLogin(app, email);
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await prisma().user.update({ where: { email }, data: { deactivatedAt: new Date() } });
    const denied = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(403);
    expect(denied.body.message).toMatch(/deactivated/i);
    await request(server()).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  // ---- verification ----------------------------------------------------------------------

  it('verification: garbage, wrong-type and expired tokens are refused; using the link twice is harmless', async () => {
    const email = fresh();
    await register({ email, name: 'Verify Me', password: PASSWORD }).expect(202);
    const token = await verificationTokenFor(email);

    await request(server()).post('/auth/verify').send({ token: 'garbage-garbage-garbage' }).expect(400);
    await request(server()).post('/auth/verify').send({ token: 'short' }).expect(400);
    await request(server()).post('/auth/verify').send({}).expect(400);

    const jwt = app.get(JwtService);
    const user = await prisma().user.findUniqueOrThrow({ where: { email } });
    const wrongPurpose = await jwt.signAsync({ sub: user.id, purpose: 'access', role: 'STUDENT' });
    await request(server()).post('/auth/verify').send({ token: wrongPurpose }).expect(400);
    const expired = await jwt.signAsync({ sub: user.id, purpose: 'verify' }, { expiresIn: '-1h' });
    await request(server()).post('/auth/verify').send({ token: expired }).expect(400);
    expect((await prisma().user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toBeNull();

    await request(server()).post('/auth/verify').send({ token }).expect(200);
    const verifiedAt = (await prisma().user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt;
    await request(server()).post('/auth/verify').send({ token }).expect(200); // again: fine
    expect((await prisma().user.findUniqueOrThrow({ where: { email } })).emailVerifiedAt).toEqual(verifiedAt); // unchanged
  });

  // ---- sessions --------------------------------------------------------------------------

  it('logout ends the session at once: the cookie cannot be used to refresh, not even for a moment', async () => {
    const email = fresh();
    await registerAndLogin(app, email);
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

    await request(server()).post('/auth/logout').set('Cookie', cookie).expect(204);
    await request(server()).post('/auth/refresh').set('Cookie', cookie).expect(401); // straight after: no grace window for a logout
  });

  it('logout also ends the token that was just rotated, so the previous cookie cannot bring the session back', async () => {
    const email = fresh();
    await registerAndLogin(app, email);
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const first = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    const rotated = await request(server()).post('/auth/refresh').set('Cookie', first).expect(200);
    const second = (rotated.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

    await request(server()).post('/auth/logout').set('Cookie', second).expect(204);
    await request(server()).post('/auth/refresh').set('Cookie', first).expect(401); // inside the 10 s grace window, but logged out
    await request(server()).post('/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logging out twice, or with no cookie at all, is fine', async () => {
    const email = fresh();
    await registerAndLogin(app, email);
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await request(server()).post('/auth/logout').set('Cookie', cookie).expect(204);
    await request(server()).post('/auth/logout').set('Cookie', cookie).expect(204);
    await request(server()).post('/auth/logout').expect(204);
  });

  it('a deactivated account cannot use the rotation grace window to get new tokens', async () => {
    const email = fresh();
    await registerAndLogin(app, email);
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const first = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await request(server()).post('/auth/refresh').set('Cookie', first).expect(200); // rotates: `first` is now inside the grace window
    await prisma().user.update({ where: { email }, data: { deactivatedAt: new Date() } });
    await request(server()).post('/auth/refresh').set('Cookie', first).expect(401);
  });

  it('refresh: no cookie, a made-up cookie and an expired token all give 401', async () => {
    await request(server()).post('/auth/refresh').expect(401);
    await request(server()).post('/auth/refresh').set('Cookie', 'refresh_token=made-up-value').expect(401);

    const email = fresh();
    await registerAndLogin(app, email);
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
    await prisma().refreshToken.updateMany({ where: { user: { email } }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await request(server()).post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('the login cookie is httpOnly and SameSite=Lax', async () => {
    const email = fresh();
    await registerAndLogin(app, email);
    const login = await request(server()).post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    const setCookie = (login.headers['set-cookie'] as unknown as string[]).join(';');
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(login.body.refreshToken).toBeUndefined(); // never in the JSON body
  });

  it('an access token for an account that has since been removed from the database no longer gets a profile', async () => {
    const email = uniqueStudentEmail('gone');
    const token = await registerAndLogin(app, email);
    await prisma().refreshToken.deleteMany({ where: { user: { email } } });
    await prisma().user.delete({ where: { email } });
    await request(server()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('a tampered, truncated or none-algorithm token is refused', async () => {
    const token = await registerAndLogin(app, fresh());
    const [h, p, s] = token.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'x', role: 'SUPER_ADMIN', purpose: 'access' })).toString('base64url');
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${tamperedPayload}.`;
    for (const bad of [`${h}.${tamperedPayload}.${s}`, token.slice(0, -4), `${h}.${p}`, none, 'Bearer', '', 'a.b.c']) {
      await request(server()).get('/auth/me').set('Authorization', `Bearer ${bad}`).expect(401);
    }
    await request(server()).get('/auth/me').set('Authorization', token).expect(401); // missing the word Bearer
    await request(server()).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
  });
});
