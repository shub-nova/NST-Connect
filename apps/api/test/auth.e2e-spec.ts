import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  PASSWORD,
  createTestApp,
  prismaOf,
  registerAndLogin,
  uniqueStudentEmail,
  verificationTokenFor,
} from './helpers';

describe('Identity (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects email domains that are not allowed', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'someone@gmail.com', name: 'Some One', password: PASSWORD })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('adypu.edu.in');
  });

  it('rejects student-domain addresses that are not valid enrollment-style ids', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: '!!bad@adypu.edu.in', name: 'Bad Id', password: PASSWORD })
      .expect(400);
  });

  it('rejects weak passwords with a clear message', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: uniqueStudentEmail(), name: 'Short Pass', password: 'short' })
      .expect(400);
    expect(JSON.stringify(res.body)).toContain('at least 10');
  });

  it('student: register, verify by email, login, refresh rotation and reuse detection', async () => {
    const server = app.getHttpServer();
    const email = uniqueStudentEmail();

    await request(server).post('/auth/register').send({ email, name: 'Aarav Test', password: PASSWORD }).expect(202);

    // Not verified yet: login is refused.
    await request(server).post('/auth/login').send({ email, password: PASSWORD }).expect(403);

    const token = await verificationTokenFor(email);
    await request(server).post('/auth/verify').send({ token }).expect(200);

    const agent = request.agent(server);
    const login = await agent.post('/auth/login').send({ email, password: PASSWORD }).expect(200);
    expect(login.body.user).toMatchObject({ email, role: 'STUDENT' });
    expect(login.body.user.passwordHash).toBeUndefined();
    const cookie = login.headers['set-cookie'][0];
    expect(cookie).toContain('refresh_token=');
    expect(cookie).toContain('HttpOnly');

    const me = await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(email);

    // Refresh rotates the token...
    const oldCookie = cookie.split(';')[0];
    const refreshed = await request(server).post('/auth/refresh').set('Cookie', oldCookie).expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    const newCookie = refreshed.headers['set-cookie'][0].split(';')[0];
    expect(newCookie).not.toBe(oldCookie);

    // A racing request (the old token a moment later) is tolerated inside the grace window...
    const raced = await request(server).post('/auth/refresh').set('Cookie', oldCookie).expect(200);
    expect(raced.body.accessToken).toBeTruthy();

    // ...but once the grace window has passed, replaying the old token is treated as theft
    // and every session of that user is revoked.
    const prisma = prismaOf(app);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    await request(server).post('/auth/refresh').set('Cookie', oldCookie).expect(401);
    await request(server).post('/auth/refresh').set('Cookie', newCookie).expect(401);
  });

  it('login fails with the same error for a wrong password and an unknown user', async () => {
    const server = app.getHttpServer();
    const email = uniqueStudentEmail();
    await registerAndLogin(app, email);
    const wrong = await request(server).post('/auth/login').send({ email, password: 'wrong-password-123' }).expect(401);
    const unknown = await request(server)
      .post('/auth/login')
      .send({ email: uniqueStudentEmail(), password: 'wrong-password-123' })
      .expect(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('stores passwords hashed, never in plain text', async () => {
    const email = uniqueStudentEmail();
    await registerAndLogin(app, email);
    const user = await prismaOf(app).user.findUniqueOrThrow({ where: { email } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('staff addresses cannot self-register into a role unless they were invited', async () => {
    const server = app.getHttpServer();
    const email = `uninvited${Date.now().toString(36)}@newtonschool.co`;
    await request(server).post('/auth/register').send({ email, name: 'Not Invited', password: PASSWORD }).expect(202);
    expect(await prismaOf(app).user.findUnique({ where: { email } })).toBeNull();
    await request(server).post('/auth/login').send({ email, password: PASSWORD }).expect(401);
  });

  it('invited POC can complete registration and reach POC-only endpoints', async () => {
    const email = 'academics.l1.1@newtonschool.co';
    const prisma = prismaOf(app);
    // Reset so the test can run repeatedly against the same seeded database.
    await prisma.refreshToken.deleteMany({ where: { user: { email } } });
    await prisma.user.update({ where: { email }, data: { passwordHash: null, emailVerifiedAt: null } });

    const accessToken = await registerAndLogin(app, email, 'Academics L1 #1');
    const res = await request(app.getHttpServer())
      .get('/poc/queue')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(Array.isArray(res.body.tickets)).toBe(true);
  });

  describe('access control is deny-by-default', () => {
    it('401 without a token', async () => {
      await request(app.getHttpServer()).get('/auth/me').expect(401);
      await request(app.getHttpServer()).get('/poc/queue').expect(401);
    });

    it('401 for a garbage or wrong-type token (a verify token is not an access token)', async () => {
      const email = uniqueStudentEmail();
      await request(app.getHttpServer()).post('/auth/register').send({ email, name: 'Wrong Token', password: PASSWORD });
      const verifyToken = await verificationTokenFor(email);
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', 'Bearer not-a-token').expect(401);
      await request(app.getHttpServer()).get('/auth/me').set('Authorization', `Bearer ${verifyToken}`).expect(401);
    });

    it('a student is forbidden from the POC area', async () => {
      const accessToken = await registerAndLogin(app, uniqueStudentEmail());
      await request(app.getHttpServer())
        .get('/poc/queue')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
    });

    it('health stays public and reports the database', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', database: 'up' });
    });
  });
});
