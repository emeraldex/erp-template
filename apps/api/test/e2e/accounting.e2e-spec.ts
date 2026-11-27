import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { Database } from '../../src/tenancy/database';

const API = '/api/v1';
const HOST = 'acme.test'; // aviation demo: raised tax invoices, a payment, orders and vendor repairs
jest.setTimeout(30_000);

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('Accounting export (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const get = async (path: string, user = 'farah') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'put', path: string, body: object, user = 'farah') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 360 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('keeps the organisation\'s account codes', async () => {
    expect((await get('/accounting/settings', 'rahim')).status).toBe(403);
    const s = (await get('/accounting/settings').then(st(200))).body;
    expect(s).toEqual(expect.objectContaining({ receivables: '1200', bank: '1000', taxCode: 'SR' }));
    expect(s.streams.length).toBeGreaterThan(0);
    expect((await send('put', '/accounting/settings', { bank: '' })).body.message).toMatch(/Bank account/);
    expect((await send('put', '/accounting/settings', { revenueByStream: { NOPE: '4100' } })).body.message).toBe('Unknown invoicing stream NOPE');
    const stream = s.streams[0].id as string;
    const saved = (await send('put', '/accounting/settings', { bank: '1010-MBB', revenueByStream: { [stream]: '4100' } }).then(st(200))).body;
    expect(saved).toEqual(expect.objectContaining({ bank: '1010-MBB', revenueByStream: { [stream]: '4100' } }));
  });

  it('includes goods received on an order, dated by the receiving step', async () => {
    const cfg = (await get('/config')).body;
    const receive = cfg.demandTransitions.find((t: { effects?: { type: string }[] }) => (t.effects ?? []).some((e) => e.type === 'recordReceipt'));
    const pool = app.get(Database).pool;
    await pool.query(`INSERT INTO t_acme.demands (id, "partDescription", "partNo", qty, status, "statusSince", "raisedBy", branch, "evalSupplierId", "poRef")
      VALUES ('DM-ACC-0001', 'Bearing kit', 'BK-1', 2, $1, now(), 'test', 'HQ', 'SUP-001', 'PO-ACC-1')`, [receive.to]);
    await pool.query(`INSERT INTO t_acme.quotations ("demandId", "supplierId", supplier, "priceMYR", "eddDays", seq) VALUES ('DM-ACC-0001', 'SUP-001', 'Summit Defence & Services', 1840, 10, 1)`);
    await pool.query(`INSERT INTO t_acme.audit_entries (at, by, role, action, seq, "demandId") VALUES (now(), 'test', 'STORES', $1, 0, 'DM-ACC-0001')`, [`Status → ${receive.to}: ${receive.label}`]);
  });

  it('previews, exports once, and repeats only when asked', async () => {
    const before = (await get(`/accounting/preview?from=${from}&to=${to}`).then(st(200))).body;
    expect(before.sales.new).toBeGreaterThan(0);
    expect(before.receipts.new).toBeGreaterThan(0);
    expect(before.purchases.new).toBeGreaterThan(0);
    expect(before.sales.exported).toBe(0);

    const batch = (await send('post', '/accounting/exports', { from, to }).then(st(201))).body;
    expect(batch).toEqual(expect.objectContaining({ id: expect.stringMatching(/^EXP-\d{4}-0001$/), sales: before.sales.new, receipts: before.receipts.new, purchases: before.purchases.new }));
    const after = (await get(`/accounting/preview?from=${from}&to=${to}`)).body;
    expect(after.sales).toEqual({ new: 0, exported: before.sales.new });
    expect((await send('post', '/accounting/exports', { from, to })).body.message).toBe('Nothing new to export for that period');
    const again = (await send('post', '/accounting/exports', { from, to, includeExported: true }).then(st(201))).body;
    expect(again.sales).toBe(before.sales.new);
    expect((await get('/accounting/exports').then(st(200))).body.map((e: { id: string }) => e.id)).toEqual([again.id, batch.id]);
    expect((await send('post', '/accounting/exports', { from: to, to: from })).body.message).toBe('from must not be after to');
  });

  it('downloads a batch as Excel or as one CSV sheet at a time, with the account codes', async () => {
    const [batch] = (await get('/accounting/exports')).body as { id: string }[];
    const xlsx = await get(`/accounting/exports/${batch.id}/file`).then(st(200));
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
    const sales = (await get(`/accounting/exports/${batch.id}/file?format=csv&sheet=sales`).then(st(200))).text.split('\r\n');
    expect(sales[0]).toBe('﻿Invoice no.,Date,Customer,Description,Stream,Work order,Currency,Net,Tax code,Tax rate,Tax,Total,Revenue account,Receivable account,Tax account');
    expect(sales[1]).toMatch(/^F311-\d{4}-\d+,\d{4}-\d{2}-\d{2},.*,MYR,[\d.]+,SR,\d+(\.\d+)?,[\d.]+,[\d.]+,\d+,1200,2200$/);
    const receipts = (await get(`/accounting/exports/${batch.id}/file?format=csv&sheet=receipts`).then(st(200))).text;
    expect(receipts).toContain('CPU-PAY-2026-3391');
    expect(receipts).toContain('1010-MBB');
    const purchases = (await get(`/accounting/exports/${batch.id}/file?format=csv&sheet=purchases`).then(st(200))).text.split('\r\n');
    expect(purchases[0]).toBe('﻿Reference,Date,Supplier,Description,Quantity,Currency,Amount,Account,Work order,Source');
    expect((await get(`/accounting/exports/${batch.id}/file?format=csv&sheet=nope`)).status).toBe(400);
    expect((await get('/accounting/exports/EXP-1999-0001/file')).status).toBe(404);
  });
});
