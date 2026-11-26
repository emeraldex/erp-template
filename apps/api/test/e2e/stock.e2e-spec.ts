import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { Database } from '../../src/tenancy/database';

const API = '/api/v1';
const HOST = 'fleet.test'; // fleet pack: the stock module is on, stores MAIN and NORTH_STORE
jest.setTimeout(20_000);

describe('Stock: catalogue and ledger (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const get = async (path: string, user = 'stores') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch' | 'put', path: string, body: object, user = 'stores', headers: Record<string, string> = {}) => {
    let req = http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web');
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(body);
  };
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const newJob = async () => (await send('post', '/jobs', {
    component: 'Van WXY 7001', partNo: 'Hiace', serialNo: `WXY${Math.random()}`, category: 'SERVICE', originUnit: 'Sales', repairUnit: 'HQ',
  }, 'helpdesk').then(st(201))).body.id as string;
  let partId = '';
  const level = async (store: string) => ((await get(`/stock/parts/${partId}`)).body.levels as { store: string; qty: number }[]).find((l) => l.store === store)?.qty ?? 0;

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('keeps a parts catalogue that stores staff manage', async () => {
    const cfg = (await get('/config')).body;
    expect(cfg.modules.stock).toBe(true);
    expect(cfg.dictionary.store.map((s: { key: string }) => s.key)).toEqual(['MAIN', 'NORTH_STORE']);
    expect((await send('post', '/stock/parts', { partNo: 'BP-100', name: 'Brake pads (front)' }, 'helpdesk')).status).toBe(403);
    expect((await send('post', '/stock/parts', { partNo: 'BP-100', name: 'Brake pads', unit: 'BARREL' })).body.message).toBe('Unknown unit BARREL');
    const part = (await send('post', '/stock/parts', { partNo: 'BP-100', name: 'Brake pads (front)', unit: 'SET', group: 'BRAKES', manufacturer: 'Bosch' }).then(st(201))).body;
    expect(part).toEqual(expect.objectContaining({ partNo: 'BP-100', unit: 'SET', onHand: 0, avgCost: 0, levels: [] }));
    expect((await send('post', '/stock/parts', { partNo: 'BP-100', name: 'Again' })).status).toBe(409);
    partId = part.id;
    expect((await get('/stock/parts?q=bosch', 'technician')).body.map((p: { id: string }) => p.id)).toContain(partId);
  });

  it('receives stock at a cost and keeps a moving average', async () => {
    expect((await send('post', '/stock/receive', { partId, store: 'MAIN', qty: 10, unitCost: 12.5 })).body.message).toBe('Say where the stock came from');
    await send('post', '/stock/receive', { partId, store: 'MAIN', qty: 10, unitCost: 12.5, reason: 'Opening stock' }).then(st(201));
    const r = (await send('post', '/stock/receive', { partId, store: 'MAIN', qty: 30, unitCost: 14, reason: 'Delivery DO-881' }).then(st(201))).body;
    expect(r.balance).toBe(40);
    const part = (await get(`/stock/parts/${partId}`)).body;
    expect(part).toEqual(expect.objectContaining({ onHand: 40, avgCost: 13.625, lastCost: 14, value: 545 }));
    expect(part.movements.map((m: { type: string; qty: number }) => [m.type, m.qty])).toEqual([['RECEIPT', 30], ['RECEIPT', 10]]);
  });

  it('issues to a work order, costs it, and takes back no more than was issued', async () => {
    const job = await newJob();
    expect((await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 3, jobId: job }, 'helpdesk')).status).toBe(403);
    const issued = (await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 3, jobId: job }, 'technician').then(st(201))).body;
    expect(issued.balance).toBe(37);
    const tooMany = await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 100, jobId: job }, 'technician');
    expect(tooMany.body.message).toBe('Only 37 SET of BP-100 in Main depot store (100 needed)');

    expect((await send('post', '/stock/return', { partId, store: 'MAIN', qty: 5, jobId: job }, 'technician')).body.message).toContain('Only 3 SET of BP-100 was issued');
    await send('post', '/stock/return', { partId, store: 'MAIN', qty: 1, jobId: job }, 'technician').then(st(201));
    expect(await level('MAIN')).toBe(38);

    const parts = (await get(`/jobs/${job}/parts`, 'technician').then(st(200))).body;
    expect(parts).toEqual({ lines: [expect.objectContaining({ partId, partNo: 'BP-100', qty: 2, cost: 27.25 })], total: 27.25 });
    const pack = (await get(`/jobs/${job}/pack`, 'technician')).body;
    expect(pack.parts.total).toBe(27.25);
    const actions = (await get(`/jobs/${job}`, 'technician')).body.audit.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      'Part issued: 3 SET BP-100 — Brake pads (front) from Main depot store',
      'Part returned: 1 SET BP-100 — Brake pads (front) to Main depot store',
    ]));

    await send('patch', `/jobs/${job}/transition`, { to: 'CANCELLED', fields: { reason: 'Duplicate' } }, 'helpdesk');
    expect((await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 1, jobId: job }, 'technician')).body.message).toContain('is closed');
  });

  it('gives the last unit to exactly one of two people asking at once', async () => {
    await send('post', '/stock/transfer', { partId, from: 'MAIN', to: 'NORTH_STORE', qty: 1 }).then(st(200));
    expect(await level('NORTH_STORE')).toBe(1);
    const [a, b] = [await newJob(), await newJob()];
    const results = await Promise.all([
      send('post', '/stock/issue', { partId, store: 'NORTH_STORE', qty: 1, jobId: a }, 'technician'),
      send('post', '/stock/issue', { partId, store: 'NORTH_STORE', qty: 1, jobId: b }, 'supervisor'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await level('NORTH_STORE')).toBe(0);
  });

  it('adjusts with a reason, and applies a resent issue once', async () => {
    expect((await send('post', '/stock/adjust', { partId, store: 'MAIN', qty: -1 })).body.message).toBe('Say why the stock is adjusted');
    expect((await send('post', '/stock/adjust', { partId, store: 'MAIN', qty: -1, reason: 'Damaged in store' }).then(st(201))).body.balance).toBe(36);
    const job = await newJob();
    const op = { 'X-Client-Op': `issue-${Date.now()}` };
    await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 1, jobId: job }, 'technician', op).then(st(201));
    expect((await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 1, jobId: job }, 'technician', op)).body).toEqual({ duplicate: true });
    expect(await level('MAIN')).toBe(35);
  });

  it('alerts stores staff once when stock falls to its reorder point, and again after it recovers', async () => {
    const alerts = async () => ((await get('/notifications')).body.items as { kind: string; ref: string; link: string }[])
      .filter((n) => n.kind === 'stock.low' && n.ref === partId);
    await send('put', `/stock/parts/${partId}/levels/MAIN`, { bin: 'A-03-2', reorderPoint: 34, reorderQty: 20 }).then(st(200));
    expect(await alerts()).toHaveLength(0);
    const job = await newJob();
    await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 1, jobId: job }, 'technician').then(st(201)); // 34: low
    await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 1, jobId: job }, 'technician').then(st(201)); // 33: still low
    const first = await alerts();
    expect(first).toHaveLength(1);
    expect(first[0].link).toBe(`/stock?part=${partId}`);
    expect((await get(`/stock/parts?low=1`)).body.map((p: { id: string }) => p.id)).toContain(partId);
    await send('post', '/stock/receive', { partId, store: 'MAIN', qty: 10, unitCost: 13, reason: 'Delivery' }).then(st(201)); // 43
    await send('post', '/stock/issue', { partId, store: 'MAIN', qty: 9, jobId: job }, 'technician').then(st(201)); // 34 again
    expect(await alerts()).toHaveLength(2);
  });

  it('switches off with its module', async () => {
    await send('patch', '/settings/modules', { stock: false }, 'admin').then(st(200));
    try {
      expect((await get('/stock/parts')).body.code).toBe('MODULE_OFF');
    } finally {
      await send('patch', '/settings/modules', { stock: true }, 'admin').then(st(200));
    }
  });

  it('stays off for aviation organisations, and gives older ones a store and units when switched on', async () => {
    const acme = 'acme.test';
    const admin = await login(app, 'aisyah', undefined, acme);
    const cfg = async () => (await http.get(`${API}/config`).set('Host', acme).set('Cookie', admin)).body;
    expect((await cfg()).modules.stock).toBe(false);
    expect((await http.get(`${API}/stock/parts`).set('Host', acme).set('Cookie', admin)).body.code).toBe('MODULE_OFF');
    // An organisation set up before stock existed has no stores or units.
    await app.get(Database).pool.query(`DELETE FROM t_acme.dictionary_entries WHERE kind IN ('store', 'unit')`);
    const patch = (body: object) => http.patch(`${API}/settings/modules`).set('Host', acme).set('Cookie', admin).set('X-Requested-With', 'erp-web').send(body);
    await patch({ stock: true }).then(st(200));
    try {
      const after = await cfg();
      expect(after.dictionary.store).toEqual([expect.objectContaining({ key: 'MAIN', label: 'Main store', meta: { site: 'HQ' } })]);
      expect(after.dictionary.unit.map((u: { key: string }) => u.key)).toEqual(['EA', 'SET', 'BOX', 'M', 'L', 'KG']);
    } finally {
      await patch({ stock: false }).then(st(200));
    }
  });
});
