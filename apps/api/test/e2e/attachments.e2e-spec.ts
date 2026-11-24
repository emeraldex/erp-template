import { INestApplication } from '@nestjs/common';
import { createHash } from 'crypto';
import { writeFileSync } from 'fs';
import { join } from 'path';
import request = require('supertest');
import { PrismaService } from '../../src/common/prisma.service';
import { createApp, login } from './app';

const API = '/api/v1';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048, 'x')]);
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Attachments (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let cookie: string;
  const upload = (path: string, body: Buffer, filename: string, contentType: string, formNo?: string) => {
    const r = http.post(`${API}/attachments/${path}`).set('Cookie', cookie).set('X-Requested-With', 'erp-web')
      .attach('file', body, { filename, contentType });
    return formNo ? r.field('formNo', formNo) : r;
  };

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    http = request(app.getHttpServer());
    cookie = await login(app, 'daniel');
  });
  afterAll(() => app.close());

  it('stores a file with its checksum, lists it and records it on the audit trail', async () => {
    const res = await upload('job/PS-2026-0338', PDF, 'F174 release cert.pdf', 'application/pdf', 'F174').expect(201);
    expect(res.body).toEqual(expect.objectContaining({
      entity: 'JOB', entityId: 'PS-2026-0338', formNo: 'F174', filename: 'F174 release cert.pdf',
      contentType: 'application/pdf', sizeBytes: PDF.length, sha256: createHash('sha256').update(PDF).digest('hex'), uploadedBy: 'Daniel Wong',
    }));
    const list = (await http.get(`${API}/attachments/job/PS-2026-0338`).set('Cookie', cookie).expect(200)).body;
    expect(list.map((a: { id: string }) => a.id)).toContain(res.body.id);
    const job = (await http.get(`${API}/jobs/PS-2026-0338`).set('Cookie', cookie).expect(200)).body;
    expect(job.audit.at(-1)).toEqual(expect.objectContaining({ by: 'Daniel Wong', action: 'Attachment added: F174 release cert.pdf (F174)' }));
  });

  it('downloads the exact bytes as an attachment, with safe headers', async () => {
    const { body: meta } = await upload('invoice/INV-2026-0051', PDF, 'signed invoice é.pdf', 'application/pdf').expect(201);
    const res = await http.get(`${API}/attachments/file/${meta.id}`).set('Cookie', cookie).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(res.body, PDF)).toBe(0);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="signed invoice _.pdf"; filename*=UTF-8''signed%20invoice%20%C3%A9.pdf`);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain('sandbox');
    expect(res.headers['x-checksum-sha256']).toBe(meta.sha256);
  });

  it('detects a stored file that has been altered', async () => {
    const { body: meta } = await upload('demand/F212-2026-118', PDF, 'quote.pdf', 'application/pdf').expect(201);
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: meta.id } });
    writeFileSync(join(process.env.ATTACHMENTS_DIR!, row.storageKey), Buffer.from('%PDF-tampered'));
    await http.get(`${API}/attachments/file/${meta.id}`).set('Cookie', cookie).expect(500);
    const quality = await login(app, 'qistina');
    const check = (await http.get(`${API}/attachments/file/${meta.id}/verify`).set('Cookie', quality).expect(200)).body;
    expect(check).toEqual(expect.objectContaining({ ok: false, sha256: meta.sha256 }));
    await http.get(`${API}/attachments/file/${meta.id}/verify`).set('Cookie', cookie).expect(403); // MIS may not run checks
  });

  it('rejects disallowed, disguised, empty and oversized files', async () => {
    expect((await upload('job/PS-2026-0338', Buffer.from('<script>alert(1)</script>'), 'x.html', 'text/html').expect(400)).body.message).toMatch(/not allowed/);
    expect((await upload('job/PS-2026-0338', Buffer.from('MZ....'), 'cert.pdf', 'application/pdf').expect(400)).body.message).toMatch(/not a valid PDF/);
    await upload('job/PS-2026-0338', Buffer.alloc(0), 'empty.pdf', 'application/pdf').expect(400);
    const big = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(1024 * 1024 + 10)]);
    await upload('job/PS-2026-0338', big, 'big.pdf', 'application/pdf').expect(413);
  });

  it('refuses unknown records, unknown record types and closed jobs', async () => {
    await upload('job/PS-404', PDF, 'a.pdf', 'application/pdf').expect(404);
    await upload('users/u1', PDF, 'a.pdf', 'application/pdf').expect(400);
    const closed = (await upload('job/PS-2026-0322', PDF, 'a.pdf', 'application/pdf').expect(400)).body.message;
    expect(closed).toMatch(/closed/);
  });

  it('requires a session and the CSRF header', async () => {
    await http.post(`${API}/attachments/job/PS-2026-0338`).attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' }).expect(401);
    await http.post(`${API}/attachments/job/PS-2026-0338`).set('Cookie', cookie)
      .attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' }).expect(403);
    await http.get(`${API}/attachments/file/not-a-uuid`).set('Cookie', cookie).expect(404);
  });
});
