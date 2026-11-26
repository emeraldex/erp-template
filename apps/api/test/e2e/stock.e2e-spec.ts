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
    expect(tooMany.body.message).toBe('Only 37 Set of BP-100 in Main depot store (100 needed)');

    expect((await send('post', '/stock/return', { partId, store: 'MAIN', qty: 5, jobId: job }, 'technician')).body.message).toContain('Only 3 Set of BP-100 was issued');
    await send('post', '/stock/return', { partId, store: 'MAIN', qty: 1, jobId: job }, 'technician').then(st(201));
    expect(await level('MAIN')).toBe(38);

    const parts = (await get(`/jobs/${job}/parts`, 'technician').then(st(200))).body;
    expect(parts).toEqual({ lines: [expect.objectContaining({ partId, partNo: 'BP-100', qty: 2, cost: 27.25 })], total: 27.25 });
    const pack = (await get(`/jobs/${job}/pack`, 'technician')).body;
    expect(pack.parts.total).toBe(27.25);
    const actions = (await get(`/jobs/${job}`, 'technician')).body.audit.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining([
      'Part issued: 3 Set BP-100 — Brake pads (front) from Main depot store',
      'Part returned: 1 Set BP-100 — Brake pads (front) to Main depot store',
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

  describe('purchasing and work orders', () => {
    const part = async (partNo: string) => ((await get(`/stock/parts?q=${partNo}`)).body as { id: string; partNo: string }[]).find((p) => p.partNo === partNo)!;
    const qtyIn = async (id: string, store = 'MAIN') => ((await get(`/stock/parts/${id}`)).body.levels as { store: string; qty: number }[]).find((l) => l.store === store)?.qty ?? 0;
    const step = (id: string, to: string, fields: Record<string, string>, user: string) => send('patch', `/demands/${id}/transition`, { to, fields }, user);
    const quote = (id: string, supplierId: string, priceMYR: number) => send('post', `/demands/${id}/quotations`, { supplierId, supplier: supplierId, priceMYR, eddDays: 7 }, 'purchasing');
    const startedJob = async () => {
      const id = await newJob();
      await send('patch', `/jobs/${id}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-technician' } }, 'helpdesk').then(st(200));
      await send('patch', `/jobs/${id}/transition`, { to: 'IN_PROGRESS', fields: { odometer: '1000' } }, 'technician').then(st(200));
      return id;
    };

    it('requests a catalogue part on a work order and issues it from stock', async () => {
      const filter = await part('OF-HIACE');
      const before = await qtyIn(filter.id);
      const job = await startedJob();
      expect((await send('patch', `/jobs/${job}/transition`, { to: 'ON_HOLD_PARTS', fields: { qty: '2' } }, 'technician')).body.message)
        .toBe('Choose a part from the catalogue or describe what is needed');
      const held = (await send('patch', `/jobs/${job}/transition`, { to: 'ON_HOLD_PARTS', fields: { part: filter.id, qty: '2' } }, 'technician').then(st(200))).body;
      const dmId = held.demandIds.at(-1);
      const dm = (await get(`/demands/${dmId}`)).body;
      expect(dm).toEqual(expect.objectContaining({ partId: filter.id, partNo: 'OF-HIACE', partDescription: 'Oil filter (Hiace)', qty: 2, jobId: job }));
      const audit = held.audit.find((a: { action: string }) => a.action.startsWith('Status → ON_HOLD_PARTS'));
      expect(audit.fields.part).toBe('OF-HIACE — Oil filter (Hiace)');

      await step(dmId, 'APPROVED', {}, 'supervisor').then(st(200));
      const issued = (await step(dmId, 'ISSUED', { store: 'MAIN' }, 'stores').then(st(200))).body;
      expect(issued.stockCheck).toEqual(expect.objectContaining({ available: true, holdingUnit: 'Main depot store' }));
      expect(await qtyIn(filter.id)).toBe(before - 2);
      expect((await get(`/jobs/${job}/parts`)).body.lines).toEqual([expect.objectContaining({ partNo: 'OF-HIACE', qty: 2, cost: 64 })]);
    });

    it('refuses to issue more than the store holds, leaving the request where it was', async () => {
      const tyre = await part('TYR-215R16');
      const job = await startedJob();
      const held = (await send('patch', `/jobs/${job}/transition`, { to: 'ON_HOLD_PARTS', fields: { part: tyre.id, qty: '50' } }, 'technician').then(st(200))).body;
      const dmId = held.demandIds.at(-1);
      await step(dmId, 'APPROVED', {}, 'supervisor').then(st(200));
      const refused = await step(dmId, 'ISSUED', { store: 'MAIN' }, 'stores');
      expect(refused.body.message).toContain('of TYR-215R16 in Main depot store (50 needed)');
      expect((await get(`/demands/${dmId}`)).body.status).toBe('APPROVED');
    });

    it('buys a part for a work order, receives it into stock at the quoted cost, then issues it', async () => {
      const shoes = await part('BS-RR-NPR');
      const job = await startedJob();
      const held = (await send('patch', `/jobs/${job}/transition`, { to: 'ON_HOLD_PARTS', fields: { part: shoes.id, qty: '3' } }, 'technician').then(st(200))).body;
      const dmId = held.demandIds.at(-1);
      const before = await qtyIn(shoes.id);
      await step(dmId, 'APPROVED', {}, 'supervisor').then(st(200));
      await step(dmId, 'QUOTING', { rfqRef: 'RFQ-1' }, 'purchasing').then(st(200));
      await quote(dmId, 'SUP-2026-0001', 450).then(st(201));
      await quote(dmId, 'SUP-2026-0002', 480).then(st(201));
      await step(dmId, 'ORDERED', { poRef: 'PO-1', selectedSupplierId: 'SUP-2026-0001' }, 'purchasing').then(st(200));
      const received = (await step(dmId, 'RECEIVED', { grnRef: 'GRN-1', store: 'MAIN' }, 'stores').then(st(200))).body;
      expect(received).toEqual(expect.objectContaining({ status: 'RECEIVED', forStore: 'MAIN', unitCost: 150 }));
      expect(await qtyIn(shoes.id)).toBe(before + 3);
      // 2 on hand at 140 + 3 at 150 → 146
      expect((await get(`/stock/parts/${shoes.id}`)).body.avgCost).toBe(146);
      await step(dmId, 'ISSUED', {}, 'stores').then(st(200));
      expect(await qtyIn(shoes.id)).toBe(before);
      expect((await get(`/jobs/${job}/parts`)).body.lines).toEqual([expect.objectContaining({ partNo: 'BS-RR-NPR', qty: 3, cost: 438 })]);
    });

    it('raises a purchase request for stock from the reorder list, and closes it on receipt', async () => {
      const created = (await send('post', '/stock/parts', { partNo: 'FT-REORDER', name: 'Fuel filter', unit: 'EA', group: 'FILTERS' }).then(st(201))).body;
      await send('post', '/stock/receive', { partId: created.id, store: 'MAIN', qty: 2, unitCost: 10, reason: 'Opening stock' }).then(st(201));
      await send('put', `/stock/parts/${created.id}/levels/MAIN`, { reorderPoint: 5, reorderQty: 10 }).then(st(200));
      const line = ((await get('/stock/reorder')).body as { partId: string; store: string; suggested: number; openRequest: string | null }[]).find((l) => l.partId === created.id);
      expect(line).toEqual(expect.objectContaining({ store: 'MAIN', suggested: 10, openRequest: null }));

      expect((await send('post', '/stock/reorder', { items: [{ partId: created.id, store: 'MAIN', qty: 10 }] }, 'technician')).status).toBe(403);
      const { raised } = (await send('post', '/stock/reorder', { items: [{ partId: created.id, store: 'MAIN', qty: 10 }] }).then(st(201))).body;
      expect(raised).toHaveLength(1);
      expect((await send('post', '/stock/reorder', { items: [{ partId: created.id, store: 'MAIN', qty: 10 }] })).status).toBe(409);
      const dmId = raised[0];
      expect((await get(`/demands/${dmId}`)).body).toEqual(expect.objectContaining({ partId: created.id, forStore: 'MAIN', qty: 10, status: 'RAISED' }));
      expect((await get(`/demands/${dmId}`)).body.jobId).toBeUndefined();

      await step(dmId, 'APPROVED', {}, 'supervisor').then(st(200));
      await step(dmId, 'QUOTING', { rfqRef: 'RFQ-2' }, 'purchasing').then(st(200));
      await quote(dmId, 'SUP-2026-0001', 100).then(st(201));
      await quote(dmId, 'SUP-2026-0002', 120).then(st(201));
      await step(dmId, 'ORDERED', { poRef: 'PO-2', selectedSupplierId: 'SUP-2026-0001' }, 'purchasing').then(st(200));
      const done = (await step(dmId, 'RECEIVED', { grnRef: 'GRN-2', store: 'MAIN' }, 'stores').then(st(200))).body;
      expect(done.status).toBe('ISSUED');
      expect(done.audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['Received into stock: 10 into Main depot store at RM 10.00 each', 'Request closed — received into stock']));
      expect(await qtyIn(created.id)).toBe(12);
      expect(((await get('/stock/reorder')).body as { partId: string }[]).some((l) => l.partId === created.id)).toBe(false);
    });

    it('lets an optional field through empty but checks it when filled', async () => {
      const job = await startedJob();
      const held = (await send('patch', `/jobs/${job}/transition`, { to: 'ON_HOLD_PARTS', fields: { partDescription: 'Wiper blades', qty: '1' } }, 'technician').then(st(200))).body;
      const dmId = held.demandIds.at(-1);
      await step(dmId, 'APPROVED', {}, 'supervisor').then(st(200));
      await step(dmId, 'QUOTING', { rfqRef: 'RFQ-3' }, 'purchasing').then(st(200));
      await quote(dmId, 'SUP-2026-0001', 40).then(st(201));
      await quote(dmId, 'SUP-2026-0002', 42).then(st(201));
      await step(dmId, 'ORDERED', { poRef: 'PO-3', selectedSupplierId: 'SUP-2026-0001' }, 'purchasing').then(st(200));
      expect((await step(dmId, 'RECEIVED', { grnRef: 'GRN-3', store: 'MAIN', receivedQty: 'lots' }, 'stores')).body.message).toBe('Quantity received (if not as ordered): must be a number');
      // Not a catalogue part: nothing goes into stock.
      const r = (await step(dmId, 'RECEIVED', { grnRef: 'GRN-3', store: 'MAIN' }, 'stores').then(st(200))).body;
      expect(r.status).toBe('RECEIVED');
      expect(r.forStore).toBeUndefined();
    });
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
