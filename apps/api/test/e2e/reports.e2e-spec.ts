import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import ExcelJS = require('exceljs');
import { createApp, login } from './app';

const API = '/api/v1';
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
// The seed dates its records relative to today, so cover a wide window.
const WINDOW = 'from=2025-01-01&to=2027-12-31';

describe('Reports and exports (FR-12 / FR-14)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let finance: string;
  const get = (path: string, cookie = finance) => http.get(`${API}${path}`).set('Cookie', cookie).buffer(true).parse(binary);

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    finance = await login(app, 'kumar'); // PCE may run billing reports; auth tests lock farah temporarily
  });
  afterAll(() => app.close());

  it('exports the Sales Performance Report as a workbook with detail, totals and a summary', async () => {
    const res = await get(`/reports/sales-performance?${WINDOW}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toBe('attachment; filename="sales-performance_2025-01-01_2027-12-31.xlsx"');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    const ws = wb.getWorksheet('Invoices')!;
    const headers = (ws.getRow(3).values as string[]).filter(Boolean);
    expect(headers).toEqual(expect.arrayContaining(['Tax invoice no.', 'Total (MYR)', 'Outstanding', 'Days outstanding']));
    const totalCol = headers.indexOf('Total (MYR)') + 1;
    const dataRows = ws.rowCount - 4; // title, subtitle, header … totals
    expect(dataRows).toBeGreaterThanOrEqual(5);
    let sum = 0;
    for (let r = 4; r < ws.rowCount; r++) sum += Number(ws.getRow(r).getCell(totalCol).value);
    expect(Number(ws.getRow(ws.rowCount).getCell(totalCol).value)).toBeCloseTo(sum, 2);
    expect(wb.getWorksheet('Summary')).toBeDefined();
  });

  it('exports the same report as CSV', async () => {
    const res = await get(`/reports/sales-performance?${WINDOW}&format=csv`);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    const lines = res.body.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toMatch(/^Tax invoice no\.,Internal ref,Drafted/);
    expect(lines.some((l: string) => l.startsWith('F311-2026-0338,INV-2026-0051'))).toBe(true);
    expect(lines.at(-1)).toMatch(/^TOTAL \(\d+\)/);
  });

  it('produces the e-Payment file for ACD invoices, flagging what is not ready', async () => {
    const res = await get(`/reports/e-payment?${WINDOW}`);
    const lines = res.body.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('InvoiceNo,InvoiceDate,JobRef,Payer,NetAmount,TaxType,TaxAmount,GrossAmount,SPRRef,ReadyToSubmit');
    expect(lines.slice(1).every((l: string) => /,(Y|N)$/.test(l))).toBe(true);
    expect(lines.find((l: string) => l.startsWith('INV-2026-0053'))).toMatch(/,N$/);
  });

  it('lists outstanding payments by age', async () => {
    const res = await get('/reports/outstanding?format=csv');
    const lines = res.body.toString('utf8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Invoice,Stream,Customer,Status,Since,Days,Ageing,Total (MYR),Invoice currency,Exchange rate,Total (invoice currency)');
    expect(lines.some((l: string) => l.includes('INV-2026-0044') || l.includes('F311-2026-0322'))).toBe(false); // paid
  });

  it('exports the audit trail, optionally for one record type', async () => {
    const quality = await login(app, 'qistina');
    const all = (await get(`/reports/audit?${WINDOW}&format=csv`, quality)).body.toString('utf8').trim().split('\r\n');
    const jobs = (await get(`/reports/audit?${WINDOW}&entity=JOB&format=csv`, quality)).body.toString('utf8').trim().split('\r\n');
    expect(all.length).toBeGreaterThan(jobs.length);
    expect(jobs.slice(1).every((l: string) => l.split(',')[1] === 'JOB')).toBe(true);
    expect((await get(`/reports/audit?${WINDOW}&entity=NOPE`, quality)).status).toBe(400);
  });

  it('enforces roles and validates parameters', async () => {
    const stores = await login(app, 'rahim');
    expect((await get(`/reports/sales-performance?${WINDOW}`, stores)).status).toBe(403);
    expect((await get(`/reports/audit?${WINDOW}`)).status).toBe(403); // billing roles cannot export the audit trail
    expect((await get('/reports/sales-performance?from=2026-02-30&to=2026-03-01')).status).toBe(400);
    expect((await get(`/reports/sales-performance?${WINDOW}&format=pdf`)).status).toBe(400);
  });
});
