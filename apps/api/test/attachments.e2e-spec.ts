import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { categoryByShortName, createTestApp, prismaOf, registerAndLogin, uniqueStudentEmail } from './helpers';

// A real 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('Attachments (e2e)', () => {
  let app: INestApplication;
  let token: string;
  let otherToken: string;
  let ticketId: string;

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const server = () => app.getHttpServer();

  const requestUpload = (t: string, body: Record<string, unknown>, id = ticketId) =>
    request(server()).post(`/tickets/${id}/attachments`).set(auth(t)).send(body);

  /** Request a URL and PUT the bytes to storage, the way the browser will. */
  async function upload(bytes: Buffer, fileName: string, mimeType: string) {
    const res = await requestUpload(token, { fileName, mimeType, sizeBytes: bytes.length }).expect(201);
    const put = await fetch(res.body.uploadUrl, { method: 'PUT', headers: res.body.headers, body: new Uint8Array(bytes) });
    return { attachmentId: res.body.attachmentId as string, putStatus: put.status };
  }

  beforeAll(async () => {
    app = await createTestApp();
    token = await registerAndLogin(app, uniqueStudentEmail());
    otherToken = await registerAndLogin(app, uniqueStudentEmail());
    const category = await categoryByShortName(app, 'Academics');
    const t = await request(server())
      .post('/tickets')
      .set(auth(token))
      .send({
        title: 'Ticket with attachments',
        description: 'I need to attach a screenshot of the error I see.',
        subCategoryId: category.subCategories[0].id,
      })
      .expect(201);
    ticketId = t.body.id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('uploads a real file end to end: request URL, PUT to storage, confirm, see it, download it', async () => {
    const { attachmentId, putStatus } = await upload(PNG, 'screenshot.png', 'image/png');
    expect(putStatus).toBe(200);

    // Not visible on the ticket until confirmed.
    let detail = await request(server()).get(`/tickets/${ticketId}`).set(auth(token)).expect(200);
    expect(detail.body.attachments).toHaveLength(0);

    const confirmed = await request(server()).post(`/attachments/${attachmentId}/confirm`).set(auth(token)).expect(200);
    expect(confirmed.body).toEqual({ id: attachmentId, fileName: 'screenshot.png', mimeType: 'image/png', sizeBytes: PNG.length });

    detail = await request(server()).get(`/tickets/${ticketId}`).set(auth(token)).expect(200);
    expect(detail.body.attachments).toEqual([confirmed.body]);

    const dl = await request(server()).get(`/attachments/${attachmentId}/download`).set(auth(token)).expect(200);
    const file = await fetch(dl.body.url);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-disposition')).toContain('screenshot.png');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('lets the student view a safe file in the page, and still downloads types a browser cannot show', async () => {
    const png = await upload(PNG, 'view.png', 'image/png');
    await request(server()).post(`/attachments/${png.attachmentId}/confirm`).set(auth(token)).expect(200);

    const viewed = await request(server()).get(`/attachments/${png.attachmentId}/download?inline=1`).set(auth(token)).expect(200);
    expect(viewed.body).toMatchObject({ inline: true, expiresInSeconds: 600 });
    const shown = await fetch(viewed.body.url);
    expect(shown.headers.get('content-disposition')).toMatch(/^inline/);
    expect(shown.headers.get('content-type')).toBe('image/png');

    // Without the flag it is still a download.
    const plain = await request(server()).get(`/attachments/${png.attachmentId}/download`).set(auth(token)).expect(200);
    expect(plain.body).toMatchObject({ inline: false, expiresInSeconds: 60 });
    expect((await fetch(plain.body.url)).headers.get('content-disposition')).toMatch(/^attachment/);

    // A Word file cannot be shown by a browser, so asking to view it falls back to a download.
    const word = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not really a document, but it starts like a zip')]);
    const doc = await upload(word, 'notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    await request(server()).post(`/attachments/${doc.attachmentId}/confirm`).set(auth(token)).expect(200);
    const fallback = await request(server()).get(`/attachments/${doc.attachmentId}/download?inline=1`).set(auth(token)).expect(200);
    expect(fallback.body.inline).toBe(false);
    expect((await fetch(fallback.body.url)).headers.get('content-disposition')).toMatch(/^attachment/);

    await request(server()).get(`/attachments/${png.attachmentId}/download?inline=yes`).set(auth(token)).expect(400);
    await request(server()).get(`/attachments/${png.attachmentId}/download?inline=1`).set(auth(otherToken)).expect(404); // not theirs
  });

  it('storage allows browser uploads from the web app origin (CORS preflight)', async () => {
    // The browser PUTs straight to storage from the web origin, so storage must allow it.
    // Node tests do not enforce CORS, which is how this once slipped past them.
    const res = await requestUpload(token, { fileName: 'cors.png', mimeType: 'image/png', sizeBytes: PNG.length }).expect(201);
    const preflight = await fetch(res.body.uploadUrl, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://localhost:3001',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    expect(preflight.status).toBe(200);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:3001');
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
  });

  it('never exposes the storage key or uploader to the student', async () => {
    const detail = await request(server()).get(`/tickets/${ticketId}`).set(auth(token)).expect(200);
    expect(JSON.stringify(detail.body)).not.toMatch(/storageKey|tickets\/[0-9a-f-]{36}\/|uploader/);
  });

  it('rejects disallowed types, oversized files and mismatched extensions before any upload', async () => {
    const mb = 1024 * 1024;
    await requestUpload(token, { fileName: 'run.exe', mimeType: 'application/x-msdownload', sizeBytes: 1000 }).expect(400);
    await requestUpload(token, { fileName: 'pic.svg', mimeType: 'image/svg+xml', sizeBytes: 1000 }).expect(400);
    const tooBig = await requestUpload(token, { fileName: 'big.png', mimeType: 'image/png', sizeBytes: 11 * mb }).expect(400);
    expect(JSON.stringify(tooBig.body)).toContain('10 MB');
    await requestUpload(token, { fileName: 'huge.mp4', mimeType: 'video/mp4', sizeBytes: 101 * mb }).expect(400);
    await requestUpload(token, { fileName: 'virus.exe', mimeType: 'image/png', sizeBytes: 1000 }).expect(400);
    await requestUpload(token, { fileName: 'empty.png', mimeType: 'image/png', sizeBytes: 0 }).expect(400);
  });

  it('rejects a file whose contents are not what it claims to be, and deletes it', async () => {
    const fake = Buffer.from('MZ\x90\x00 this is really a program, not a picture');
    const { attachmentId, putStatus } = await upload(fake, 'holiday.png', 'image/png');
    expect(putStatus).toBe(200);

    const res = await request(server()).post(`/attachments/${attachmentId}/confirm`).set(auth(token)).expect(422);
    expect(JSON.stringify(res.body)).toContain('do not match');
    expect(await prismaOf(app).attachment.findUnique({ where: { id: attachmentId } })).toBeNull();
  });

  it('refuses to confirm a file that was never uploaded', async () => {
    const res = await requestUpload(token, { fileName: 'ghost.png', mimeType: 'image/png', sizeBytes: PNG.length }).expect(201);
    await request(server()).post(`/attachments/${res.body.attachmentId}/confirm`).set(auth(token)).expect(409);
    // And it stays hidden and undownloadable.
    await request(server()).get(`/attachments/${res.body.attachmentId}/download`).set(auth(token)).expect(404);
  });

  it('does not accept bytes that differ from the declared size or type', async () => {
    const res = await requestUpload(token, { fileName: 'lie.png', mimeType: 'image/png', sizeBytes: 500 }).expect(201);
    const put = await fetch(res.body.uploadUrl, { method: 'PUT', headers: res.body.headers, body: new Uint8Array(PNG) });
    if (put.ok) {
      // Storage let it through; our confirm step must still catch it.
      await request(server()).post(`/attachments/${res.body.attachmentId}/confirm`).set(auth(token)).expect(422);
    } else {
      expect(put.status).toBeGreaterThanOrEqual(400);
    }
  });

  it("another student cannot upload to, confirm or download someone else's attachments", async () => {
    const { attachmentId } = await upload(PNG, 'private.png', 'image/png');
    await request(server()).post(`/attachments/${attachmentId}/confirm`).set(auth(token)).expect(200);

    await requestUpload(otherToken, { fileName: 'x.png', mimeType: 'image/png', sizeBytes: PNG.length }).expect(404);
    await request(server()).post(`/attachments/${attachmentId}/confirm`).set(auth(otherToken)).expect(404);
    await request(server()).get(`/attachments/${attachmentId}/download`).set(auth(otherToken)).expect(404);
  });

  it('requires login', async () => {
    await request(server()).post(`/tickets/${ticketId}/attachments`).send({}).expect(401);
    await request(server()).get('/attachments/00000000-0000-4000-8000-000000000000/download').expect(401);
  });

  it('keeps file names safe (no paths in what we store or show)', async () => {
    const { attachmentId } = await upload(PNG, '../../etc/evil.png', 'image/png');
    const row = await prismaOf(app).attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(row.fileName).toBe('evil.png');
    expect(row.storageKey).not.toContain('evil');
  });
});
