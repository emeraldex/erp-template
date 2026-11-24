import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { pdfLines, pdfPageCount } from './pdf-text';

const API = '/api/v1';
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Invoice documents (FR-13)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let billing: string;

  const pdf = async (path: string, cookie = billing) => {
    const res = await http.get(`${API}${path}`).set('Cookie', cookie).buffer(true).parse(binary);
    return res;
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    billing = await login(app, 'hafiz'); // MM may download billing documents; auth tests change zara's password
  });
  afterAll(() => app.close());

  it('renders the tax invoice with amounts, tax and the amount in words', async () => {
    const res = await pdf('/invoicing/INV-2026-0051/documents/tax-invoice');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="F311-2026-0338-tax-invoice.pdf"');
    const body = res.body as Buffer;
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdfPageCount(body)).toBe(1);
    const text = pdfLines(body).join('\n');
    expect(text).toContain('TAX INVOICE');
    expect(text).toContain('F311-2026-0338');
    expect(text).toContain('RM 23,400.00');
    expect(text).toContain('GST @ 6%');
    expect(text).toContain('RM 24,804.00');
    expect(text).toContain('Ringgit Malaysia Twenty-Four Thousand Eight Hundred and Four Only');
    expect(text).not.toContain('DRAFT');
  });

  it('marks invoices that are not yet raised as DRAFT', async () => {
    const text = pdfLines((await pdf('/invoicing/INV-2026-0053/documents/tax-invoice')).body).join('\n');
    expect(text).toContain('DRAFT');
    expect(text).toContain('not yet raised');
  });

  it('stamps a Certified True Copy only when a CTC is recorded', async () => {
    const ctc = pdfLines((await pdf('/invoicing/INV-2026-0051/documents/tax-invoice?ctc=1')).body).join('\n');
    expect(ctc).toContain('CERTIFIED TRUE COPY');
    expect(ctc).toContain('Ref CTC-2026-0338');
    const res = await pdf('/invoicing/INV-2026-0053/documents/tax-invoice?ctc=1');
    expect(res.status).toBe(400);
  });

  it('builds the pack: covering letter, invoice, delivery note and checklist from the stream document set', async () => {
    const body = (await pdf('/invoicing/INV-2026-0051/documents/pack')).body;
    expect(pdfPageCount(body)).toBe(4);
    const text = pdfLines(body).join('\n');
    for (const s of ['SUBMISSION OF TAX INVOICE F311-2026-0338', 'Enclosures', 'Analysis Report (F117)', 'TAX INVOICE', 'DELIVERY NOTE', 'DOCUMENT SET CHECKLIST', 'Page 4 of 4']) {
      expect(text).toContain(s);
    }
  });

  it('builds a periodic (PBC) pack without a delivery note', async () => {
    const body = (await pdf('/invoicing/INV-2026-0050/documents/pack')).body;
    expect(pdfPageCount(body)).toBe(3);
    expect(pdfLines(body).join('\n')).not.toContain('DELIVERY NOTE');
    expect((await pdf('/invoicing/INV-2026-0050/documents/delivery-note')).status).toBe(400);
  });

  it('prints the company profile and tax settings', async () => {
    const admin = await login(app, 'aisyah');
    await http.patch(`${API}/settings/company`).set('Cookie', admin).set('X-Requested-With', 'erp-web')
      .send({ name: 'Apex Test Engineering Sdn. Bhd.', taxRegistrationNo: 'W10-1234-56789012', address: ['Lot 1, Jalan Ujian'] }).expect(200);
    const text = pdfLines((await pdf('/invoicing/INV-2026-0051/documents/tax-invoice')).body).join('\n');
    expect(text).toContain('Apex Test Engineering Sdn. Bhd.');
    expect(text).toContain('Tax Reg. No. W10-1234-56789012');
  });

  it('limits billing documents to billing roles and rejects unknown documents', async () => {
    const workshop = await login(app, 'meiling');
    expect((await pdf('/invoicing/INV-2026-0051/documents/tax-invoice', workshop)).status).toBe(403);
    expect((await pdf('/invoicing/INV-2026-0051/documents/receipt')).status).toBe(400);
    expect((await pdf('/invoicing/INV-404/documents/tax-invoice')).status).toBe(404);
  });
});

describe('Settings', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('lets ADMIN change tax; new invoices use it, existing ones keep theirs', async () => {
    const admin = await login(app, 'aisyah');
    const pce = await login(app, 'kumar');
    const send = (c: string) => (r: request.Test) => r.set('Cookie', c).set('X-Requested-With', 'erp-web');

    await send(pce)(http.patch(`${API}/settings/tax`)).send({ label: 'SST', ratePct: 8 }).expect(403);
    await send(admin)(http.patch(`${API}/settings/tax`)).send({ label: 'SST', ratePct: 120 }).expect(400);
    await send(admin)(http.patch(`${API}/settings/tax`)).send({ label: 'SST', ratePct: 8 }).expect(200);

    const inv = (await send(pce)(http.post(`${API}/invoicing`)).send({ stream: 'BRANCH_REPAIR', jobId: 'PS-2026-0338', amountMYR: 1000 }).expect(201)).body;
    expect(inv).toEqual(expect.objectContaining({ taxLabel: 'SST', gstRate: 8, gstMYR: 80, totalMYR: 1080 }));
    const old = (await http.get(`${API}/invoicing/INV-2026-0051`).set('Cookie', pce).expect(200)).body;
    expect(old).toEqual(expect.objectContaining({ taxLabel: 'GST', gstRate: 6 }));

    await send(admin)(http.patch(`${API}/settings/tax`)).send({ label: 'GST', ratePct: 6 }).expect(200);
  });
});
