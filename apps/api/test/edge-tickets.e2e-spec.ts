import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, loginAsPoc, prismaOf, registerAndLogin, uniqueStudentEmail, startCleanup } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/**
 * Edge cases for raising, listing, closing, reopening and rating tickets, and for attachments: exact limits, hostile
 * text, odd ids, extra fields, and states that should be refused.
 */
describe('Edge cases: tickets and attachments (e2e)', () => {
  let app: INestApplication;
  let student: string;
  let otherStudent: string;
  let poc: string;
  let subId: string;
  let categoryId: string;

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const prisma = () => prismaOf(app);
  const create = (body: Record<string, unknown>, t = student) => request(server()).post('/tickets').set(auth(t)).send(body);
  const valid = () => ({ title: 'Edge case ticket', description: 'A description that is long enough.', subCategoryId: subId });
  const newTicket = async (t = student) => (await create(valid(), t).expect(201)).body.id as string;

  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    app = await createTestApp();
    cleanup = startCleanup(app);
    student = await registerAndLogin(app, uniqueStudentEmail('edge'));
    otherStudent = await registerAndLogin(app, uniqueStudentEmail('edgeb'));
    poc = await loginAsPoc(app, 'academics.l1.1@newtonschool.co');
    const category = await categoryByShortName(app, 'Academics');
    categoryId = category.id;
    subId = category.subCategories[0].id;
  });
  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  // ---- raising a ticket ------------------------------------------------------------------

  it('enforces the exact title and description limits', async () => {
    await create({ ...valid(), title: 'ab' }).expect(400);
    await create({ ...valid(), title: 'abc' }).expect(201);
    await create({ ...valid(), title: 't'.repeat(200) }).expect(201);
    await create({ ...valid(), title: 't'.repeat(201) }).expect(400);
    await create({ ...valid(), title: '     ' }).expect(400); // spaces only
    await create({ ...valid(), title: '  abc  ' }).expect(201); // trimmed

    await create({ ...valid(), description: 'x'.repeat(9) }).expect(400);
    await create({ ...valid(), description: 'x'.repeat(10) }).expect(201);
    await create({ ...valid(), description: 'x'.repeat(5000) }).expect(201);
    await create({ ...valid(), description: 'x'.repeat(5001) }).expect(400);
    await create({ ...valid(), description: ' '.repeat(50) }).expect(400);
  });

  it('keeps hostile and unusual text exactly as typed (no injection, no loss)', async () => {
    const samples = [
      `<script>alert('xss')</script><img src=x onerror=alert(1)>`,
      `Robert'); DROP TABLE ticket;--`,
      `{{7*7}} \${7*7} %s %d \\n \\u0000`,
      '🙂 emoji 👩🏽‍💻 and 名前 and مرحبا (right to left) and ñ é ü',
      'line one\nline two\r\nline three\ttabbed',
      '../../etc/passwd',
    ];
    for (const text of samples) {
      const res = await create({ subCategoryId: subId, title: `T ${text}`.slice(0, 200), description: `${text} (the description)`.padEnd(12, '.') });
      if (res.status !== 201) throw new Error(`rejected: ${JSON.stringify(text)} -> ${JSON.stringify(res.body)}`);
      const detail = await request(server()).get(`/tickets/${res.body.id}`).set(auth(student)).expect(200);
      expect(detail.body.description).toBe(`${text} (the description)`.padEnd(12, '.').trim());
      expect(detail.body.title).toBe(`T ${text}`.slice(0, 200).trim());
    }
    expect(await prisma().ticket.count()).toBeGreaterThan(0); // the table still exists
  });

  it('rejects an unknown, malformed, retired or foreign topic', async () => {
    await create({ ...valid(), subCategoryId: 'not-a-uuid' }).expect(400);
    await create({ ...valid(), subCategoryId: '00000000-0000-4000-8000-000000000000' }).expect(400);
    const { subCategoryId: _omit, ...withoutTopic } = valid();
    void _omit;
    await create(withoutTopic).expect(400);

    const temp = await prisma().subCategory.create({ data: { categoryId, name: `Retired topic ${Date.now()}`, active: false, sortOrder: 99 } });
    try {
      await create({ ...valid(), subCategoryId: temp.id }).expect(400); // a hidden topic cannot be used by a direct call
    } finally {
      await prisma().subCategory.delete({ where: { id: temp.id } });
    }
  });

  it('ignores fields a student must not set (status, level, owner, student, deadline)', async () => {
    const other = await prisma().user.findFirstOrThrow({ where: { role: 'POC' } });
    const res = await create({
      ...valid(),
      status: 'RESOLVED',
      currentLevel: 3,
      assignedPocId: other.id,
      studentId: other.id,
      tatDeadline: '2000-01-01T00:00:00Z',
      critical: true,
      closedByStudent: true,
      createdAt: '2000-01-01T00:00:00Z',
    }).expect(201);
    const row = await prisma().ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.status).toBe('ASSIGNED');
    expect(row.currentLevel).toBe(1);
    expect(row.critical).toBe(false);
    expect(row.closedByStudent).toBe(false);
    expect(row.assignedPocId).not.toBe(other.id);
    expect(row.studentId).not.toBe(other.id);
    expect(row.tatDeadline!.getTime()).toBeGreaterThan(Date.now());
    expect(row.createdAt.getFullYear()).toBeGreaterThan(2020);
  });

  it('two tickets sent at the same moment both get created, each with its own history', async () => {
    const results = await Promise.all([create(valid()), create(valid()), create(valid())]);
    expect(results.every((r) => r.status === 201)).toBe(true);
    const ids = results.map((r) => r.body.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(await prisma().ticketEvent.count({ where: { ticketId: id, type: 'CREATED' } })).toBe(1);
  });

  // ---- reading and listing ---------------------------------------------------------------

  it('rejects bad list parameters with a 400, and never lets a cursor reach another student’s tickets', async () => {
    const get = (qs: string, t = student) => request(server()).get(`/tickets?${qs}`).set(auth(t));
    for (const qs of ['limit=0', 'limit=51', 'limit=-1', 'limit=abc', 'limit=1.5', 'cursor=not-a-uuid', 'status=BOGUS', 'status=resolved', 'categoryId=nope', 'from=garbage', 'to=garbage']) {
      expect((await get(qs)).status).toBe(400);
    }
    await get('limit=50').expect(200);
    await get('limit=1').expect(200);

    // A reversed date range is simply empty. A cursor from someone else's ticket must not leak anything.
    const reversed = await get('from=2030-01-01&to=2020-01-01').expect(200);
    expect(reversed.body.items).toHaveLength(0);
    const theirs = await newTicket(otherStudent);
    const res: request.Response = await get(`cursor=${theirs}&limit=50`);
    expect([200, 400, 404]).toContain(res.status);
    if (res.status === 200) expect(res.body.items.every((t: { id: string }) => t.id !== theirs)).toBe(true);
  });

  it('pages through a student’s tickets exactly once, newest first', async () => {
    const fresh = await registerAndLogin(app, uniqueStudentEmail('page'));
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.unshift(await newTicket(fresh)); // newest first
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const res: request.Response = await request(server()).get(`/tickets?limit=3${cursor ? `&cursor=${cursor}` : ''}`).set(auth(fresh)).expect(200);
      seen.push(...res.body.items.map((t: { id: string }) => t.id));
      cursor = res.body.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(ids);
  });

  it('a malformed, unknown or foreign ticket id is a 400 or 404, never a 500 or a leak', async () => {
    await request(server()).get('/tickets/not-a-uuid').set(auth(student)).expect(400);
    await request(server()).get('/tickets/00000000-0000-4000-8000-000000000000').set(auth(student)).expect(404);
    const id = await newTicket();
    await request(server()).get(`/tickets/${id}`).set(auth(otherStudent)).expect(404);
    for (const path of ['close', 'reopen', 'feedback']) await request(server()).post(`/tickets/${id}/${path}`).set(auth(otherStudent)).send({ comment: 'hello there', rating: 'OKAY' }).expect(404);
  });

  // ---- closing, reopening, rating --------------------------------------------------------

  it('closing twice, or closing a ticket the POC already finished, is refused', async () => {
    const id = await newTicket();
    await request(server()).post(`/tickets/${id}/close`).set(auth(student)).send({}).expect(200);
    await request(server()).post(`/tickets/${id}/close`).set(auth(student)).send({}).expect(409);

    const second = await newTicket();
    await request(server()).get(`/poc/tickets/${second}`).set(auth(poc)).expect(200); // theirs to work on
    await request(server()).post(`/poc/tickets/${second}/close`).set(auth(poc)).send({ outcome: 'SOLVED', note: 'Fixed it properly.' }).expect(200);
    await request(server()).post(`/tickets/${second}/close`).set(auth(student)).send({}).expect(409);
  });

  it('enforces the exact reopen-comment limits and trims spaces', async () => {
    const id = await newTicket();
    await request(server()).post(`/tickets/${id}/close`).set(auth(student)).send({}).expect(200);
    const reopen = (comment: unknown) => request(server()).post(`/tickets/${id}/reopen`).set(auth(student)).send({ comment });
    await reopen('abcd').expect(400);
    await reopen('    ab    ').expect(400); // 2 real characters
    await reopen('c'.repeat(2001)).expect(400);
    await reopen(undefined).expect(400);
    await reopen(12345).expect(400);
    await reopen('c'.repeat(2000)).expect(200);
    await request(server()).post(`/tickets/${id}/reopen`).set(auth(student)).send({ comment: 'again please' }).expect(409); // already open again
  });

  it('feedback: exact comment limit, odd ratings, whitespace-only comments and re-answering', async () => {
    const id = await newTicket();
    await request(server()).post(`/poc/tickets/${id}/close`).set(auth(poc)).send({ outcome: 'SOLVED', note: 'All sorted now.' }).expect(200);
    const rate = (body: Record<string, unknown>) => request(server()).post(`/tickets/${id}/feedback`).set(auth(student)).send(body);
    for (const rating of ['satisfied', 'GREAT', '', null, 5, undefined]) await rate({ rating }).expect(400);
    await rate({ rating: 'OKAY', comment: 'c'.repeat(501) }).expect(400);
    const ok = await rate({ rating: 'OKAY', comment: 'c'.repeat(500) }).expect(200);
    expect(ok.body.comment).toHaveLength(500);
    const blank = await rate({ rating: 'SATISFIED', comment: '     ' }).expect(200);
    expect(blank.body.comment).toBeNull(); // spaces only means no comment
    expect(await prisma().ticketFeedback.count({ where: { ticketId: id } })).toBe(1); // one answer per finish, updated in place
  });

  it('feedback cannot be given on an open ticket or on a ticket the student closed themselves', async () => {
    const open = await newTicket();
    await request(server()).post(`/tickets/${open}/feedback`).set(auth(student)).send({ rating: 'OKAY' }).expect(409);
    await request(server()).post(`/tickets/${open}/close`).set(auth(student)).send({}).expect(200);
    await request(server()).post(`/tickets/${open}/feedback`).set(auth(student)).send({ rating: 'OKAY' }).expect(409);
  });

  // ---- attachments -----------------------------------------------------------------------

  const requestUpload = (id: string, body: Record<string, unknown>, t = student) => request(server()).post(`/tickets/${id}/attachments`).set(auth(t)).send(body);
  async function uploadAndConfirm(id: string, bytes: Buffer, fileName: string, mimeType: string) {
    const slot = await requestUpload(id, { fileName, mimeType, sizeBytes: bytes.length }).expect(201);
    await fetch(slot.body.uploadUrl, { method: 'PUT', headers: slot.body.headers, body: new Uint8Array(bytes) });
    return request(server()).post(`/attachments/${slot.body.attachmentId}/confirm`).set(auth(student));
  }

  it('allows exactly 10 files on a ticket and refuses the 11th', async () => {
    const id = await newTicket();
    for (let i = 0; i < 10; i++) expect((await uploadAndConfirm(id, PNG, `pic${i}.png`, 'image/png')).status).toBe(200);
    const eleventh = await requestUpload(id, { fileName: 'one-too-many.png', mimeType: 'image/png', sizeBytes: PNG.length }).expect(400);
    expect(JSON.stringify(eleventh.body)).toMatch(/at most 10/);
    const detail = await request(server()).get(`/tickets/${id}`).set(auth(student)).expect(200);
    expect(detail.body.attachments).toHaveLength(10);
  });

  it('handles odd file names, capital extensions and wrong sizes', async () => {
    const id = await newTicket();
    const up = (body: Record<string, unknown>) => requestUpload(id, body);
    await up({ fileName: 'PHOTO.PNG', mimeType: 'image/png', sizeBytes: PNG.length }).expect(201); // capitals are fine
    await up({ fileName: 'png', mimeType: 'image/png', sizeBytes: PNG.length }).expect(400); // no extension
    await up({ fileName: 'picture.png.exe', mimeType: 'image/png', sizeBytes: PNG.length }).expect(400); // last extension wins
    await up({ fileName: 'photo.png', mimeType: 'IMAGE/PNG', sizeBytes: PNG.length }).expect(400); // type must match exactly
    await up({ fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 1.5 }).expect(400);
    await up({ fileName: 'photo.png', mimeType: 'image/png', sizeBytes: -5 }).expect(400);
    await up({ fileName: 'photo.png', mimeType: 'image/png', sizeBytes: '12' }).expect(400);
    await up({ fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 }).expect(201); // exactly 10 MB is allowed
    await up({ fileName: 'photo.png', mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 + 1 }).expect(400); // one byte over
    await up({ fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 100 * 1024 * 1024 }).expect(201); // exactly 100 MB
    await up({ fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 100 * 1024 * 1024 + 1 }).expect(400);
    await up({ fileName: '名前 résumé (final) 🙂.png', mimeType: 'image/png', sizeBytes: PNG.length }).expect(201);
    await up({ fileName: `${'long'.repeat(100)}.png`, mimeType: 'image/png', sizeBytes: PNG.length }).expect(400); // over 255 characters
    const stored = await prisma().attachment.findMany({ where: { ticketId: id } });
    for (const a of stored) {
      expect(a.fileName.length).toBeLessThanOrEqual(150);
      expect(a.storageKey).not.toContain(a.fileName); // the name is never part of the storage path
      expect(a.storageKey).toMatch(/^tickets\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    }
  });

  it('confirming twice is harmless, and an unreadable text file is refused and removed', async () => {
    const id = await newTicket();
    const slot = await requestUpload(id, { fileName: 'notes.txt', mimeType: 'text/plain', sizeBytes: 11 }).expect(201);
    await fetch(slot.body.uploadUrl, { method: 'PUT', headers: slot.body.headers, body: new Uint8Array(Buffer.from('hello world')) });
    const first = await request(server()).post(`/attachments/${slot.body.attachmentId}/confirm`).set(auth(student)).expect(200);
    const again = await request(server()).post(`/attachments/${slot.body.attachmentId}/confirm`).set(auth(student)).expect(200);
    expect(again.body).toEqual(first.body);

    const binary = Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x01, 0x02, 0x80, 0x81]);
    const bad = await uploadAndConfirm(id, binary, 'looks-like-text.txt', 'text/plain');
    expect(bad.status).toBe(422);
    expect(await prisma().attachment.count({ where: { ticketId: id } })).toBe(1); // the bad one was deleted
  });

  it('a student cannot attach to, or read files of, a ticket that is not theirs; a bad id is a 400', async () => {
    const id = await newTicket();
    await requestUpload(id, { fileName: 'a.png', mimeType: 'image/png', sizeBytes: PNG.length }, otherStudent).expect(404);
    await request(server()).post('/tickets/not-a-uuid/attachments').set(auth(student)).send({ fileName: 'a.png', mimeType: 'image/png', sizeBytes: 5 }).expect(400);
    await request(server()).post('/attachments/not-a-uuid/confirm').set(auth(student)).expect(400);
    await request(server()).get('/attachments/00000000-0000-4000-8000-000000000000/download').set(auth(student)).expect(404);
  });
});
