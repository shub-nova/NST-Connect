import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

/**
 * NFR-02 contract test: nothing a student can fetch may reveal who inside the school
 * handles a ticket. We collect every staff member's id, email and name from the database
 * and fail if ANY of them (or an identity-bearing field name) shows up in a student response.
 */
describe('Identity protection contract (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let forbiddenValues: string[];

  const FORBIDDEN_KEYS = ['assignedPoc', 'assignedPocId', 'actor', 'actorId', 'poc', 'currentLevel', 'level', 'tatDeadline', 'critical'];

  beforeAll(async () => {
    app = await createTestApp();
    token = await registerAndLogin(app, uniqueStudentEmail());
    const staff = await prismaOf(app).user.findMany({ where: { role: { in: ['POC', 'SUPER_ADMIN'] } } });
    forbiddenValues = staff.flatMap((u) => [u.id, u.email, u.name]);
    expect(forbiddenValues.length).toBeGreaterThan(50);
  });
  afterAll(async () => {
    await app.close();
  });

  function assertNoLeak(label: string, body: unknown) {
    const json = JSON.stringify(body);
    for (const value of forbiddenValues) {
      if (json.includes(value)) throw new Error(`${label} leaked staff identity "${value}": ${json}`);
    }
    if (/@newtonschool\.co/i.test(json)) throw new Error(`${label} contains a staff email domain: ${json}`);
    const keys = new Set<string>();
    (function walk(v: unknown) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object')
        for (const [k, child] of Object.entries(v)) {
          keys.add(k);
          walk(child);
        }
    })(body);
    for (const key of FORBIDDEN_KEYS) {
      if (keys.has(key)) throw new Error(`${label} exposes internal field "${key}": ${json}`);
    }
  }

  it('create, list and detail responses contain no staff identity or internal fields', async () => {
    const category = await categoryByShortName(app, 'Academics');
    const auth = { Authorization: `Bearer ${token}` };

    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(auth)
      .send({
        title: 'Identity contract ticket',
        description: 'A ticket used to check that no staff identity is exposed.',
        subCategoryId: category.subCategories[0].id,
      })
      .expect(201);
    assertNoLeak('POST /tickets', created.body);

    // Add internal-only history that students must never see.
    await prismaOf(app).ticketEvent.create({
      data: {
        ticketId: created.body.id,
        type: 'NUDGED',
        visibility: 'INTERNAL',
        note: 'Reminder from the team lead: this one is overdue',
      },
    });

    const list = await request(app.getHttpServer()).get('/tickets').set(auth).expect(200);
    assertNoLeak('GET /tickets', list.body);

    const detail = await request(app.getHttpServer()).get(`/tickets/${created.body.id}`).set(auth).expect(200);
    assertNoLeak('GET /tickets/:id', detail.body);
    expect(JSON.stringify(detail.body)).not.toContain('overdue');
    expect(detail.body.timeline.every((e: { type: string }) => e.type !== 'NUDGED')).toBe(true);

    const cats = await request(app.getHttpServer()).get('/categories').set(auth).expect(200);
    assertNoLeak('GET /categories', cats.body);

    const me = await request(app.getHttpServer()).get('/auth/me').set(auth).expect(200);
    assertNoLeak('GET /auth/me', me.body);
  });

  it('error responses do not leak staff identity either', async () => {
    const res = await request(app.getHttpServer())
      .get('/tickets/00000000-0000-4000-8000-000000000000')
      .set({ Authorization: `Bearer ${token}` })
      .expect(404);
    assertNoLeak('404 body', res.body);
  });

  it('the detector itself works (it fails when a leak is present)', () => {
    expect(() => assertNoLeak('probe', { assignedPocId: 'x' })).toThrow();
    expect(() => assertNoLeak('probe', { note: forbiddenValues[1] })).toThrow();
  });
});
