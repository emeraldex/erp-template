import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';

const API = '/api/v1';
const HOST = 'fm.test'; // facilities demo, Ringgit
jest.setTimeout(30_000);

describe('Exchange rates and foreign-currency transactions (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string, host = HOST) => (cookies[`${u}@${host}`] ??= await login(app, u, undefined, host));
  const get = async (path: string, user = 'finance') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch' | 'put' | 'delete', path: string, body: object, user = 'finance') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const today = day(0);

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  describe('the rate table', () => {
    it('lets finance keep dated rates and everyone read them', async () => {
      expect((await send('put', '/fx/rates', { currency: 'USD', rate: 4.45 }, 'technician')).status).toBe(403);
      expect((await send('put', '/fx/rates', { currency: 'MYR', rate: 1 })).body.message).toMatch(/own currency/);
      expect((await send('put', '/fx/rates', { currency: 'XXX', rate: 1 })).body.message).toBe('Unknown currency XXX');
      expect((await send('put', '/fx/rates', { currency: 'USD', rate: 0 })).body.message).toMatch(/above 0/);
      expect((await send('put', '/fx/rates', { currency: 'USD', rate: 4.4, effectiveFrom: '2026-02-30' })).body.message).toBe('Effective from: YYYY-MM-DD');

      await send('put', '/fx/rates', { currency: 'USD', rate: 4.4, effectiveFrom: day(-40) }).then(st(200));
      await send('put', '/fx/rates', { currency: 'USD', rate: 4.45, effectiveFrom: day(-2) }).then(st(200));
      const r = (await send('put', '/fx/rates', { currency: 'SGD', rate: 3.3, effectiveFrom: day(-1) }).then(st(200))).body;
      expect(r.base).toBe('MYR');
      const usd = r.currencies.find((c: { code: string }) => c.code === 'USD');
      expect(usd).toEqual(expect.objectContaining({ rate: 4.45, effectiveFrom: day(-2), inverse: 0.2247191, stale: false }));
      expect(usd.history.map((h: { rate: number }) => h.rate)).toEqual([4.45, 4.4]);
      const seen = (await get('/fx/rates', 'technician').then(st(200))).body;
      expect(seen.currencies.map((c: { code: string }) => c.code)).toEqual(['SGD', 'USD']);
    });

    it('questions a rate that moved too far, and keeps it once confirmed', async () => {
      const res = await send('put', '/fx/rates', { currency: 'USD', rate: 0.2247, effectiveFrom: today });
      expect(res.status).toBe(400);
      expect(res.body).toEqual(expect.objectContaining({ code: 'RATE_JUMP', previous: 4.45 }));
      expect(res.body.message).toMatch(/95% below the last rate \(4\.45\)/);
      // A small move is fine; a future-dated rate waits for its day.
      await send('put', '/fx/rates', { currency: 'USD', rate: 4.5, effectiveFrom: day(30) }).then(st(200));
      const r = (await get('/fx/rates')).body;
      expect(r.currencies.find((c: { code: string }) => c.code === 'USD').rate).toBe(4.45);
      // Remove the future row again; deleting never touches recorded transactions.
      const future = r.currencies.find((c: { code: string }) => c.code === 'USD').history.find((h: { effectiveFrom: string }) => h.effectiveFrom === day(30));
      await send('delete', `/fx/rates/${future.id}`, {}).then(st(200));
      expect((await send('delete', `/fx/rates/${future.id}`, {})).status).toBe(404);
    });
  });

  describe('vendor repairs', () => {
    const ACME = 'acme.test';
    const ov = async (method: 'get' | 'patch', path: string, user: string, body?: object) => {
      const r = http[method](`${API}${path}`).set('Host', ACME).set('Cookie', await as(user, ACME)).set('X-Requested-With', 'erp-web');
      return body ? r.send(body) : r;
    };
    const go = (to: string, fields: Record<string, string>, user: string) => ov('patch', '/ov/OV-2026-031/transition', user, { to, fields });

    it('holds a foreign repair cost at today\'s rate and fixes it when the repair is closed', async () => {
      await http.put(`${API}/fx/rates`).set('Host', ACME).set('Cookie', await as('farah', ACME)).set('X-Requested-With', 'erp-web')
        .send({ currency: 'USD', rate: 4.4, effectiveFrom: day(-3) }).then(st(200));
      const costed = (await go('COST_ADVISED', { costMYR: '12000', costMYRCurrency: 'USD', eddDays: '30' }, 'kumar').then(st(200))).body;
      expect(costed).toEqual(expect.objectContaining({ currency: 'USD', cost: 12000, fxRate: 4.4, costMYR: 52800 }));
      expect(costed.costFixedAt).toBeUndefined();
      await go('QUOTE_APPROVED', { approvalRef: 'MSU-1' }, 'kumar').then(st(200));
      await go('RECEIVED_BACK', { relCertRef: 'REL-1' }, 'rahim').then(st(200));
      await http.put(`${API}/fx/rates`).set('Host', ACME).set('Cookie', await as('farah', ACME)).set('X-Requested-With', 'erp-web')
        .send({ currency: 'USD', rate: 4.42, effectiveFrom: today }).then(st(200));
      const closed = (await go('RETURNED', { f311Ref: 'F311-X', f117Ref: 'F117-X', f218Ref: 'F218-X' }, 'kumar').then(st(200))).body;
      expect(closed).toEqual(expect.objectContaining({ currency: 'USD', cost: 12000, fxRate: 4.42, costMYR: 53040, costFixedAt: expect.any(String) }));
    });
  });

  describe('purchasing', () => {
    const step = (id: string, to: string, fields: Record<string, string>, user: string) => send('patch', `/demands/${id}/transition`, { to, fields }, user);
    const quote = (id: string, body: object, user = 'purchasing') => send('post', `/demands/${id}/quotations`, { eddDays: 7, ...body }, user);
    let suppliers: { id: string; name: string }[] = [];
    const startedJob = async () => {
      const id = (await send('post', '/jobs', { component: 'Chiller pump', serialNo: `P${Math.random()}`, category: 'HVAC', originUnit: 'Level 1', repairUnit: 'HQ' }, 'helpdesk').then(st(201))).body.id as string;
      await send('patch', `/jobs/${id}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-technician' } }, 'helpdesk').then(st(200));
      await send('patch', `/jobs/${id}/transition`, { to: 'IN_PROGRESS', fields: {} }, 'technician').then(st(200));
      return id;
    };
    const request = async (job: string, fields: Record<string, string>) => {
      const held = (await send('patch', `/jobs/${job}/transition`, { to: 'ON_HOLD_PARTS', fields }, 'technician').then(st(200))).body;
      const dmId = held.demandIds.at(-1) as string;
      await step(dmId, 'APPROVED', {}, 'supervisor').then(st(200));
      await step(dmId, 'QUOTING', { rfqRef: `RFQ-${dmId}` }, 'purchasing').then(st(200));
      return dmId;
    };

    beforeAll(async () => {
      suppliers = ((await get('/registers/partners', 'purchasing')).body as { id: string; name: string; type: string }[]).filter((p) => p.type === 'SUPPLIER');
    });

    it('records quotations in their own currency and compares them in Ringgit', async () => {
      const [usdSupplier, myrSupplier] = suppliers;
      expect((await send('patch', `/registers/partners/${usdSupplier.id}/currency`, { currency: 'XYZ' }, 'purchasing')).body.message).toBe('Unknown currency XYZ');
      expect((await send('patch', `/registers/partners/${usdSupplier.id}/currency`, { currency: 'USD' }, 'purchasing').then(st(200))).body.currency).toBe('USD');

      const part = ((await get('/stock/parts', 'stores')).body as { id: string; avgCost: number }[])[0];
      const job = await startedJob();
      const dmId = await request(job, { part: part.id, qty: '2' });
      // The supplier's usual currency is used when none is named.
      const a = (await quote(dmId, { supplierId: usdSupplier.id, price: 100 }).then(st(201))).body.quotations.at(-1);
      expect(a).toEqual(expect.objectContaining({ currency: 'USD', price: 100, fxRate: 4.45, priceMYR: 445, supplier: usdSupplier.name }));
      // The old form: a price in Ringgit.
      const b = (await quote(dmId, { supplierId: myrSupplier.id, supplier: myrSupplier.name, priceMYR: 460 }).then(st(201))).body.quotations.at(-1);
      expect(b).toEqual(expect.objectContaining({ priceMYR: 460 }));
      expect(b.currency).toBeUndefined();
      // A rate typed by someone without fx.manage is ignored.
      const c = (await quote(dmId, { supplierId: 'SUP-SG', supplier: 'Lion Parts', price: 130, currency: 'SGD', rate: 9 }).then(st(201))).body;
      expect(c.quotations.at(-1)).toEqual(expect.objectContaining({ currency: 'SGD', price: 130, fxRate: 3.3, priceMYR: 429 }));
      expect(c.audit.at(-1).action).toBe('Quotation received — Lion Parts (S$ 130.00 = RM 429.00 at 3.3)');
      expect((await quote(dmId, { supplierId: 'SUP-JP', price: 1000, currency: 'JPY' })).body).toEqual(expect.objectContaining({ code: 'NO_RATE', message: 'No exchange rate for JPY — ask finance to add one' }));
      expect((await quote(dmId, { price: 10 })).body.message).toBe('Say which supplier quoted (supplierId)');
      expect((await quote(dmId, { supplierId: 'X', price: -1 })).body.message).toBe('Price must be a number of 0 or more');

      // Order the cheapest in Ringgit (Singapore), then the rate moves before the goods arrive.
      await step(dmId, 'ORDERED', { poRef: 'PO-FX-1', selectedSupplierId: 'SUP-SG' }, 'purchasing').then(st(200));
      await send('put', '/fx/rates', { currency: 'SGD', rate: 3.4, effectiveFrom: today }).then(st(200));
      const received = (await step(dmId, 'RECEIVED', { grnRef: 'GRN-FX-1', store: (await get(`/stock/parts/${part.id}`, 'stores')).body.levels[0].store }, 'stores').then(st(200))).body;
      expect(received.purchase).toEqual({ currency: 'SGD', rate: 3.4, amount: 130, amountBase: 442 });
      expect(received.unitCost).toBe(221); // SGD 65 each at 3.4
      expect(received.audit.map((x: { action: string }) => x.action)).toContain('Purchase fixed at receipt: S$ 130.00 = RM 442.00 at 3.4');
      const moves = (await get(`/stock/movements?partId=${part.id}`, 'stores')).body as { type: string; demandId: string; unitCost: number; currency?: string; fxRate?: number; unitCostFx?: number }[];
      expect(moves.find((m) => m.demandId === dmId && m.type === 'RECEIPT')).toEqual(expect.objectContaining({ unitCost: 221, currency: 'SGD', fxRate: 3.4, unitCostFx: 65 }));
      await step(dmId, 'ISSUED', {}, 'stores').then(st(200));
      expect((await get(`/jobs/${job}/parts`, 'stores')).body.total).toBeGreaterThan(0);
    });

    it('fixes a direct purchase for a work order at the receipt-day rate, in the job cost', async () => {
      const usdSupplier = suppliers[0];
      const job = await startedJob();
      const dmId = await request(job, { partDescription: 'Impeller (special order)', qty: '1' });
      await quote(dmId, { supplierId: usdSupplier.id, price: 200 }).then(st(201)); // USD 200 at 4.45 = RM 890
      await quote(dmId, { supplierId: suppliers[1].id, priceMYR: 990 }).then(st(201));
      await quote(dmId, { supplierId: 'SUP-X', priceMYR: 999 }).then(st(201));
      await step(dmId, 'ORDERED', { poRef: 'PO-FX-2', selectedSupplierId: usdSupplier.id }, 'purchasing').then(st(200));
      let cost = (await get(`/jobs/${job}/cost`, 'manager').then(st(200))).body;
      expect(cost.purchases.lines[0]).toEqual(expect.objectContaining({ amount: 890, currency: 'USD', amountFx: 200, rate: 4.45 }));
      await send('put', '/fx/rates', { currency: 'USD', rate: 4.5, effectiveFrom: today }).then(st(200));
      const received = (await step(dmId, 'RECEIVED', { grnRef: 'GRN-FX-2', store: 'MAIN' }, 'stores').then(st(200))).body;
      expect(received.purchase).toEqual({ currency: 'USD', rate: 4.5, amount: 200, amountBase: 900 });
      cost = (await get(`/jobs/${job}/cost`, 'manager')).body;
      expect(cost.purchases.lines[0]).toEqual(expect.objectContaining({ amount: 900, currency: 'USD', amountFx: 200, rate: 4.5 }));
    });

    it('converts a unit cost typed at receipt or on a direct receipt', async () => {
      const part = ((await get('/stock/parts', 'stores')).body as { id: string; levels: { store: string }[] }[])[1];
      const store = (await get(`/stock/parts/${part.id}`, 'stores')).body.levels[0]?.store ?? 'MAIN';
      const r = (await send('post', '/stock/receive', { partId: part.id, store, qty: 2, unitCost: 10, currency: 'USD', reason: 'Imported spares' }, 'stores').then(st(201))).body;
      expect(r.movement).toEqual(expect.objectContaining({ unitCost: 45, currency: 'USD', fxRate: 4.5, unitCostFx: 10 }));
      // Finance may type the rate, and a rate far off must be confirmed.
      expect((await send('post', '/stock/receive', { partId: part.id, store, qty: 1, unitCost: 10, currency: 'USD', rate: 0.22, reason: 'x' }, 'manager')).body.code).toBe('RATE_JUMP');
      const typed = (await send('post', '/stock/receive', { partId: part.id, store, qty: 1, unitCost: 10, currency: 'USD', rate: 4.6, reason: 'x' }, 'manager').then(st(201))).body;
      expect(typed.movement).toEqual(expect.objectContaining({ unitCost: 46, fxRate: 4.6 }));
    });
  });
});
