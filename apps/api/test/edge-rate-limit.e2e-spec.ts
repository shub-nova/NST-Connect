import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers';

/**
 * Rate limits are switched off in the test suite (NODE_ENV=test), so nothing else proves they work. Here they are
 * switched back on for this file only, and the proxy setting that production uses on Vercel is applied, so each visitor
 * has their own limit: one visitor hammering the login must not lock out anybody else.
 */
describe('Edge cases: rate limits per visitor (e2e)', () => {
  let app: INestApplication;
  let untrusted: INestApplication;
  const server = () => app.getHttpServer();
  let octet = 10;
  const nextIp = () => `203.0.113.${octet++}`; // documentation addresses: never a real visitor

  const login = (ip: string, email = 'nobody@adypu.edu.in') => request(server()).post('/auth/login').set('X-Forwarded-For', ip).send({ email, password: 'wrong-password-123' });

  beforeAll(async () => {
    process.env.TRUST_PROXY = 'true'; // what the app uses behind Vercel's proxy
    app = await createTestApp();
    delete process.env.TRUST_PROXY;
    untrusted = await createTestApp(); // no proxy trust: the forwarded address must be ignored
    process.env.NODE_ENV = 'development'; // the limiter checks this on every request: turn it on for this file only
  });
  afterAll(async () => {
    process.env.NODE_ENV = 'test';
    await app.close();
    await untrusted.close();
  });

  it('login: 10 wrong tries a minute per visitor, then 429; a different visitor is unaffected', async () => {
    const noisy = nextIp();
    for (let i = 0; i < 10; i++) expect((await login(noisy)).status).toBe(401);
    const blocked = await login(noisy);
    expect(blocked.status).toBe(429);
    expect(blocked.body.statusCode).toBe(429);

    const quiet = nextIp();
    expect((await login(quiet)).status).toBe(401); // not shared with the noisy visitor
    // The noisy visitor is also blocked on the correct credentials: the limit counts attempts, not failures.
    expect((await login(noisy)).status).toBe(429);
  });

  it('each route has its own counter: being blocked on login does not block the rest of the app', async () => {
    const ip = nextIp();
    for (let i = 0; i < 11; i++) await login(ip);
    expect((await login(ip)).status).toBe(429);
    const health = await request(server()).get('/health').set('X-Forwarded-For', ip);
    expect(health.status).toBe(200);
    const categories = await request(server()).get('/categories').set('X-Forwarded-For', ip);
    expect(categories.status).toBe(401); // needs a login, but it is not rate limited
  });

  it('sign-up allows 10 a minute per visitor', async () => {
    const ip = nextIp();
    const attempt = (_i: number) => request(server()).post('/auth/register').set('X-Forwarded-For', ip).send({ email: 'not-allowed-domain@example.com', name: 'Rate Test', password: 'a-long-enough-password' });
    for (let i = 0; i < 10; i++) expect((await attempt(i)).status).toBe(400);
    expect((await attempt(10)).status).toBe(429);
  });

  it('forgot password allows 5 a minute per visitor', async () => {
    const ip = nextIp();
    const ask = () => request(server()).post('/auth/forgot-password').set('X-Forwarded-For', ip).send({ email: 'nobody-here@adypu.edu.in' });
    for (let i = 0; i < 5; i++) expect((await ask()).status).toBe(202);
    expect((await ask()).status).toBe(429);
  }, 30_000);

  it('everything else allows 120 requests a minute per visitor', async () => {
    const ip = nextIp();
    const ping = () => request(server()).get('/health').set('X-Forwarded-For', ip);
    for (let i = 0; i < 120; i++) expect((await ping()).status).toBe(200);
    expect((await ping()).status).toBe(429);
    expect((await request(server()).get('/health').set('X-Forwarded-For', nextIp())).status).toBe(200);
  }, 60_000);

  it('without proxy trust a visitor cannot dodge the limit by inventing forwarded addresses', async () => {
    const attempt = (spoofed: string) => request(untrusted.getHttpServer()).post('/auth/login').set('X-Forwarded-For', spoofed).send({ email: 'nobody@adypu.edu.in', password: 'wrong-password-123' });
    for (let i = 0; i < 10; i++) expect((await attempt(nextIp())).status).toBe(401);
    expect((await attempt(nextIp())).status).toBe(429); // a new "address" each time makes no difference
  });
});
