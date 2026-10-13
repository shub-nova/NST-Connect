import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, loginAsPoc, registerAndLogin, uniqueStudentEmail } from './helpers';

const UUID = '00000000-0000-4000-8000-000000000000';

/**
 * Hostile and malformed requests: browser protections, prototype pollution, nonsense bodies and ids against EVERY
 * endpoint with each kind of login. The rule: the answer is always a clean 4xx (or a normal success), never a 5xx.
 */
describe('Edge cases: hostile requests (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let poc: string;
  let admin: string;
  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await createTestApp();
    student = await registerAndLogin(app, uniqueStudentEmail('sec'));
    poc = await loginAsPoc(app, 'fees.l2@newtonschool.co');
    admin = await loginAsPoc(app, 'admin@newtonschool.co');
  });
  afterAll(async () => {
    await app.close();
  });

  // ---- browser protections ---------------------------------------------------------------

  it('only the web app’s own address is allowed by CORS, with credentials', async () => {
    const web = process.env.WEB_URL ?? 'http://localhost:3001';
    const ours = await request(server()).options('/auth/login').set('Origin', web).set('Access-Control-Request-Method', 'POST');
    expect(ours.headers['access-control-allow-origin']).toBe(web);
    expect(ours.headers['access-control-allow-credentials']).toBe('true');

    for (const origin of ['https://evil.example', 'http://localhost:9999', `${web}.evil.example`, 'null']) {
      const res = await request(server()).options('/auth/login').set('Origin', origin).set('Access-Control-Request-Method', 'POST');
      // The only address ever allowed is ours (a browser on another origin sees a mismatch and blocks the call): never the
      // other origin, never a wildcard.
      expect(res.headers['access-control-allow-origin']).toBe(web);
      const real = await request(server()).get('/health').set('Origin', origin);
      expect(real.headers['access-control-allow-origin']).not.toBe(origin);
      expect(real.headers['access-control-allow-origin']).not.toBe('*');
    }
  });

  it('sends the standard protective headers and does not advertise the framework', async () => {
    const res = await request(server()).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('answers unknown routes and wrong methods with a clean 404', async () => {
    for (const [method, path] of [['get', '/nope'], ['get', '/'], ['delete', '/tickets'], ['put', '/auth/login'], ['get', '/auth/login'], ['patch', '/health'], ['get', '/internal/escalation/run'], ['get', '/.env'], ['get', '/../../etc/passwd']] as const) {
      const res = await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method](path).set(auth(admin));
      expect([404, 405]).toContain(res.status);
    }
  });

  // ---- prototype pollution and body tricks -----------------------------------------------

  it('ignores __proto__ and constructor tricks in request bodies', async () => {
    const email = uniqueStudentEmail('proto');
    const payload = `{"email":"${email}","name":"Proto Test","password":"a-long-enough-password","__proto__":{"role":"SUPER_ADMIN","isAdmin":true},"constructor":{"prototype":{"role":"SUPER_ADMIN"}}}`;
    await request(server()).post('/auth/register').set('Content-Type', 'application/json').send(payload).expect(202);
    const polluted: Record<string, unknown> = {};
    expect(polluted.role).toBeUndefined(); // the process itself was not polluted
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    const created = await request(server()).post('/auth/login').send({ email, password: 'a-long-enough-password' });
    expect(created.status).toBe(403); // registered as a normal, unverified student
  });

  it('survives very deep and very wide JSON with a 4xx', async () => {
    const deep = `${'{"a":'.repeat(3000)}1${'}'.repeat(3000)}`;
    const res = await request(server()).post('/auth/register').set('Content-Type', 'application/json').send(deep);
    expect(res.status).toBeLessThan(500);
    const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i])));
    expect((await request(server()).post('/auth/register').set('Content-Type', 'application/json').send(wide)).status).toBeLessThan(500);
    const longUrl = await request(server()).get(`/tickets?x=${'a'.repeat(20000)}`).set(auth(student));
    expect(longUrl.status).toBeLessThan(500);
  });

  it('treats odd authorisation headers as not logged in', async () => {
    for (const header of ['Bearer  ' + student, 'bearer ' + student, 'Basic abc', 'Bearer', 'Bearer null', 'Bearer undefined', student, `Bearer ${student}x`]) {
      const res = await request(server()).get('/auth/me').set('Authorization', header);
      expect(res.status).toBe(401);
    }
  });

  it('the escalation trigger refuses wrong, empty, short and repeated secrets', async () => {
    const res = await request(server()).post('/internal/escalation/run');
    expect([401, 404]).toContain(res.status); // 404 when no secret is configured, 401 when one is
    for (const secret of ['', 'x', 'a'.repeat(5000), ' ', '%00']) {
      const attempt = await request(server()).post('/internal/escalation/run').set('x-job-secret', secret);
      expect([401, 404]).toContain(attempt.status);
    }
  });

  // ---- the never-crash sweep -------------------------------------------------------------

  const ROUTES: [string, string][] = [
    ['get', '/health'], ['post', '/auth/register'], ['post', '/auth/verify'], ['post', '/auth/login'], ['post', '/auth/refresh'], ['post', '/auth/logout'], ['get', '/auth/me'],
    ['post', '/auth/forgot-password'], ['post', '/auth/reset-password'], ['get', '/auth/invite'],
    ['get', '/categories'], ['post', '/tickets'], ['get', '/tickets'], [`get`, `/tickets/${UUID}`], ['post', `/tickets/${UUID}/close`], ['post', `/tickets/${UUID}/reopen`], ['post', `/tickets/${UUID}/feedback`],
    ['post', `/tickets/${UUID}/attachments`], ['post', `/attachments/${UUID}/confirm`], ['get', `/attachments/${UUID}/download`],
    ['get', '/poc/queue'], ['post', '/poc/tickets/bulk'], ['get', `/poc/tickets/${UUID}`], ['post', `/poc/tickets/${UUID}/comments`], ['post', `/poc/tickets/${UUID}/status`], ['post', `/poc/tickets/${UUID}/close`], ['get', `/poc/attachments/${UUID}/download`],
    ['get', '/staff/team'], ['get', '/staff/options'], ['get', '/staff/audit'], ['post', '/staff'], ['patch', `/staff/${UUID}`], ['post', `/staff/${UUID}/leave`], ['post', `/staff/${UUID}/remove`], ['post', `/staff/${UUID}/resend-invite`],
    ['get', '/catalog'], ['post', '/catalog/categories'], ['patch', `/catalog/categories/${UUID}`], ['post', `/catalog/categories/${UUID}/remove`], ['post', `/catalog/categories/${UUID}/restore`], ['post', `/catalog/categories/${UUID}/topics`], ['patch', `/catalog/topics/${UUID}`], ['post', `/catalog/topics/${UUID}/remove`], ['post', `/catalog/topics/${UUID}/restore`],
    ['get', '/settings/escalation'], ['put', '/settings/escalation'],
    ['post', '/notes'], ['get', '/notes/sent'], ['get', '/notes/mine'], ['post', `/notes/${UUID}/seen`],
    ['get', '/analytics/access'], ['get', '/analytics/me'], ['get', '/analytics/team'], ['get', '/analytics/overall'], ['get', '/analytics/admin'], ['get', '/analytics/admin/categories'],
  ];
  const BODIES: unknown[] = [
    {}, [], null, 'text', 12345, true, { a: { b: { c: [1, 2, { d: null }] } } },
    { title: null, description: [], subCategoryId: {}, body: {}, note: [], outcome: 5, ticketIds: { length: 3 }, days: 'x', email: [], name: {}, level: 'a', categoryId: 5, rating: [], comment: {}, token: 1, password: [], until: 5, onLeave: 'true' },
    { title: 'x'.repeat(50_000), description: 'y'.repeat(50_000), body: 'z'.repeat(50_000), note: 'n'.repeat(50_000) },
    { email: '\u0000@adypu.edu.in', name: '‮', password: '\ud800' },
    { __proto__: { admin: true }, constructor: 'x', toString: 'x' },
  ];
  const TOKENS: [string, () => string | null][] = [['no login', () => null], ['student', () => student], ['POC', () => poc], ['admin', () => admin]];

  it('no endpoint answers a server error (5xx) to nonsense bodies, with any kind of login', async () => {
    const failures: string[] = [];
    for (const [method, path] of ROUTES) {
      for (const [who, token] of TOKENS) {
        for (const body of BODIES) {
          const call = (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method](path);
          if (token()) call.set(auth(token()!));
          const res = method === 'get' ? await call : await call.set('Content-Type', 'application/json').send(typeof body === 'string' ? JSON.stringify(body) : (body as object));
          if (res.status >= 500) failures.push(`${who} ${method.toUpperCase()} ${path} body=${JSON.stringify(body).slice(0, 60)} -> ${res.status} ${JSON.stringify(res.body).slice(0, 120)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it('no endpoint answers a server error to nonsense in the path or query string', async () => {
    const failures: string[] = [];
    const queries = ['?limit=-1', '?limit=999999999999', '?cursor=%00', '?cursor=' + 'a'.repeat(3000), '?status[]=a&status[]=b', '?from=%E0%A4%A', '?sort=%27%3B--', '?view=open&view=done', '?level=1e309', '?x=1&x=2&x=3', '?token=' + 'x'.repeat(5000), '?inline=1&inline=1'];
    const getRoutes = ROUTES.filter(([m]) => m === 'get').map(([, p]) => p);
    for (const path of getRoutes) {
      for (const [who, token] of TOKENS) {
        for (const q of queries) {
          const call = request(server()).get(`${path}${q}`);
          if (token()) call.set(auth(token()!));
          const res = await call;
          if (res.status >= 500) failures.push(`${who} GET ${path}${q.slice(0, 40)} -> ${res.status}`);
        }
      }
    }
    for (const bad of ['/tickets/%00', '/tickets/..%2f..%2fetc%2fpasswd', '/tickets/%E0%A4%A', '/poc/tickets/%', '/staff/%00/remove', `/tickets/${UUID}%20`, '/catalog/categories/' + 'a'.repeat(5000) + '/remove']) {
      for (const method of ['get', 'post', 'patch'] as const) {
        const res = await (request(server()) as unknown as Record<string, (p: string) => request.Test>)[method](bad).set(auth(admin)).send({});
        if (res.status >= 500) failures.push(`${method.toUpperCase()} ${bad.slice(0, 50)} -> ${res.status}`);
      }
    }
    expect(failures).toEqual([]);
  }, 180_000);
});
