import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { makePng, PNG } from './fixtures';
import { pdfLines } from './pdf-text';

const API = '/api/v1';
const HOST = 'fm.test'; // facilities pack: plain documents
jest.setTimeout(20_000);

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Branding and plain documents (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string, host = HOST) => (cookies[`${u}@${host}`] ??= await login(app, u, undefined, host));
  const send = async (method: 'post' | 'patch', path: string, body: object, user = 'admin') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const upload = async (buf: Buffer, name: string, type: string, user = 'admin') =>
    http.put(`${API}/settings/logo`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').attach('file', buf, { filename: name, contentType: type });
  const pdf = async (path: string, user = 'finance', host = HOST) =>
    (await http.get(`${API}${path}`).set('Host', host).set('Cookie', await as(user, host)).buffer(true).parse(binary)).body as Buffer;
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('takes a brand colour only if white text stays readable on it', async () => {
    expect((await send('patch', '/settings/brand', { accent: '#ffd400' })).body.message).toMatch(/hard to read/);
    expect((await send('patch', '/settings/brand', { accent: '#0b6e4f' }, 'helpdesk')).status).toBe(403);
    expect((await send('patch', '/settings/brand', { accent: '#0B6E4F', defaultTheme: 'light' }).then(st(200))).body).toEqual({ accent: '#0b6e4f', defaultTheme: 'light' });
    expect((await send('patch', '/settings/brand', { defaultTheme: 'sepia' })).status).toBe(400);
    const t = (await http.get(`${API}/tenant`).set('Host', HOST)).body;
    expect(t.brand).toEqual({ accent: '#0b6e4f', defaultTheme: 'light', logo: null });
  });

  it('takes a PNG or JPEG logo, never SVG, and serves it to anyone safely', async () => {
    expect((await upload(PNG, 'tiny.png', 'image/png')).body.message).toMatch(/too small/);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    expect((await upload(svg, 'logo.svg', 'image/svg+xml')).body.message).toBe('The logo must be a PNG or JPEG image');
    expect((await upload(makePng(200, 80), 'logo.png', 'image/png', 'helpdesk')).status).toBe(403);
    const ok = (await upload(makePng(200, 80), 'logo.png', 'image/png').then(st(200))).body;
    expect(ok).toEqual(expect.objectContaining({ width: 200, height: 80, contentType: 'image/png', version: expect.stringMatching(/^[0-9a-f]{12}$/) }));

    const res = await http.get(`${API}/tenant/logo`).set('Host', HOST).buffer(true).parse(binary).then(st(200));
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'");
    expect((res.body as Buffer).subarray(1, 4).toString()).toBe('PNG');
    expect((await http.get(`${API}/tenant/logo`).set('Host', HOST).set('If-None-Match', res.headers.etag)).status).toBe(304);
    expect((await http.get(`${API}/tenant`).set('Host', HOST)).body.brand.logo).toBe(ok.version);
    expect((await http.get(`${API}/tenant/logo`).set('Host', 'fleet.test')).status).toBe(404); // another organisation has none
  });

  it('prints the logo and plain words on a non-aviation organisation\'s documents', async () => {
    const job = (await http.get(`${API}/jobs`).set('Host', HOST).set('Cookie', await as('finance'))).body[0].id as string;
    const inv = (await send('post', '/invoicing', { stream: 'SERVICE', jobId: job, customer: 'Menara Utama Sdn Bhd', amountMYR: 2500 }, 'finance').then(st(201))).body;
    const pack = await pdf(`/invoicing/${inv.id}/documents/pack`);
    const text = pdfLines(pack).join('\n');
    expect(text).toContain('TAX INVOICE');
    expect(text).toContain('Tax invoice');
    expect(text).toContain('Delivery note no.');
    expect(text).toContain('Work order');
    for (const aviation of ['F311', 'F218', 'PS no.', 'QP.']) expect(text).not.toContain(aviation);
    expect(pack.includes('/Subtype /Image')).toBe(true);

    const cardPdf = await pdf(`/job-cards?ids=${job}`, 'helpdesk');
    expect(cardPdf.subarray(0, 4).toString()).toBe('%PDF');
    const card = pdfLines(cardPdf).join('\n');
    expect(card).toContain('WORK ORDER CARD');
    expect(card).not.toContain('QP.44');
  });

  it('leaves aviation documents exactly as they were', async () => {
    const text = pdfLines(await pdf('/invoicing/INV-2026-0051/documents/pack', 'farah', 'localhost')).join('\n');
    expect(text).toContain('Tax Invoice (F311)');
    expect(text).toContain('Job (PS no.)');
  });

  it('removes the logo', async () => {
    await http.delete(`${API}/settings/logo`).set('Host', HOST).set('Cookie', await as('admin')).set('X-Requested-With', 'erp-web').then(st(204));
    expect((await http.get(`${API}/tenant/logo`).set('Host', HOST)).status).toBe(404);
    await send('patch', '/settings/brand', { accent: null, defaultTheme: 'dark' }).then(st(200));
  });
});
