import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';

const API = '/api/v1';
const HOST = 'fleet.test'; // fleet pack: stock on, stores MAIN and NORTH_STORE
jest.setTimeout(20_000);

type Part = { id: string; partNo: string; name: string; avgCost: number; onHand: number; levels: { store: string; qty: number; bin: string; reorderPoint: number | null; countedAt: string | null }[]; movements: { type: string; qty: number; countId: string | null }[] };

describe('Stock: import, counts, labels and reports (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const get = async (path: string, user = 'stores') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch', path: string, body: object, user = 'stores') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const upload = async (csv: string, dryRun: boolean, user = 'stores') =>
    http.post(`${API}/stock/import${dryRun ? '?dryRun=1' : ''}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web')
      .attach('file', Buffer.from(csv, 'utf8'), 'parts.csv');
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const byNo = async (partNo: string): Promise<Part> => {
    const hit = (await get(`/stock/parts?q=${encodeURIComponent(partNo)}`)).body.find((p: { partNo: string }) => p.partNo === partNo);
    return (await get(`/stock/parts/${hit.id}`).then(st(200))).body;
  };
  const qtyIn = (p: Part, store: string) => p.levels.find((l) => l.store === store)?.qty ?? 0;
  const newJob = async () => (await send('post', '/jobs', {
    component: 'Truck BKR 9001', partNo: 'NPR', serialNo: `BKR${Math.random()}`, category: 'SERVICE', originUnit: 'Logistics', repairUnit: 'HQ',
  }, 'helpdesk').then(st(201))).body.id as string;

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  describe('spreadsheet import', () => {
    const header = 'partNo,name,unit,group,manufacturer,mfrPartNo,store,bin,qty,unitCost,reorderPoint,reorderQty';

    it('checks every row and changes nothing while any row has a problem', async () => {
      const bad = [
        header,
        'IMP-1,"Oil filter, heavy duty",EA,Filters,Sakura,C-1101,North depot store,N-01,10,20,4,10',
        'IMP-2,Coolant 5L,BARREL,FLUIDS,,,NORTH_STORE,N-02,5,30,,',
        'IMP-3,,EA,,,,NORTH_STORE,,,,,',
        'IMP-4,Wiper blade,EA,,,,NORTH_STORE,N-04,6,,,',
        'IMP-5,Fuse kit,EA,,,,,N-05,,,,',
        'IMP-1,Oil filter,EA,,,,NORTH_STORE,,,,,',
      ].join('\r\n');
      expect((await upload(bad, true, 'technician')).status).toBe(403);
      const dry = (await upload(bad, true).then(st(200))).body;
      expect(dry.dryRun).toBe(true);
      expect(dry.errors).toEqual([
        { row: 3, message: 'Unknown unit "BARREL"' },
        { row: 4, message: 'IMP-3 is not in the catalogue yet — give it a name' },
        { row: 5, message: 'unitCost is needed with an opening quantity' },
        { row: 6, message: 'store is needed with a bin, quantity or reorder level' },
        { row: 7, message: 'IMP-1 in North depot store is already on row 2' },
      ]);
      const real = await upload(bad, false);
      expect(real.status).toBe(400);
      expect(real.body.message).toBe('5 rows have problems — nothing was imported');
      expect(real.body.errors).toHaveLength(5);
      expect((await get('/stock/parts?q=IMP-')).body).toEqual([]);
    });

    it('creates parts, bins, reorder levels and opening stock in one go', async () => {
      const good = [
        // Store and group given by label, a quoted comma, a byte-order mark.
        '\uFEFF' + header,
        'IMP-1,"Oil filter, heavy duty",EA,Filters,Sakura,C-1101,North depot store,N-01,10,20,4,10',
        'IMP-2,Coolant 5L,ea,FLUIDS,,,NORTH_STORE,N-02,5,30,,',
        'IMP-2,,,,,,MAIN,M-22,,,2,',
      ].join('\n');
      const dry = (await upload(good, true).then(st(200))).body;
      expect(dry).toEqual({ dryRun: true, rows: 3, created: ['IMP-1', 'IMP-2'], updated: [], levels: 3, openings: 2, errors: [] });
      expect((await get('/stock/parts?q=IMP-')).body).toEqual([]);

      const done = (await upload(good, false).then(st(200))).body;
      expect(done).toEqual(expect.objectContaining({ dryRun: false, created: ['IMP-1', 'IMP-2'], errors: [] }));
      const one = await byNo('IMP-1');
      expect(one).toEqual(expect.objectContaining({ name: 'Oil filter, heavy duty', avgCost: 20, onHand: 10 }));
      expect(one.levels).toEqual([expect.objectContaining({ store: 'NORTH_STORE', bin: 'N-01', qty: 10, reorderPoint: 4 })]);
      expect(one.movements.map((m) => [m.type, m.qty])).toEqual([['OPENING', 10]]);
      const two = await byNo('IMP-2');
      expect(two.levels.map((l) => [l.store, l.bin, l.qty])).toEqual([['MAIN', 'M-22', 0], ['NORTH_STORE', 'N-02', 5]]);
    });

    it('updates existing parts but refuses opening stock where there is history', async () => {
      const again = [header, 'IMP-1,Oil filter HD,,,,,NORTH_STORE,N-01A,3,20,,'].join('\n');
      expect((await upload(again, true)).body.errors).toEqual([{ row: 2, message: 'IMP-1 already has stock history in North depot store — use a count or an adjustment' }]);
      const rename = [header, 'IMP-1,Oil filter HD,,,,,NORTH_STORE,N-01A,,,,'].join('\n');
      expect((await upload(rename, false).then(st(200))).body.updated).toEqual(['IMP-1']);
      const one = await byNo('IMP-1');
      expect(one).toEqual(expect.objectContaining({ name: 'Oil filter HD', onHand: 10 }));
      expect(one.levels[0].bin).toBe('N-01A');
      // Semicolon-separated, as saved by spreadsheets that write 2,5 for 2.5.
      await upload('partNo;name;store;qty;unitCost\nIMP-3;Grease 400g;NORTH_STORE;2,5;1.234,50', false).then(st(200));
      expect(await byNo('IMP-3')).toEqual(expect.objectContaining({ onHand: 2.5, avgCost: 1234.5 }));
      expect((await upload('name,unit\nThing,EA', true)).body.message).toContain('The header row must include partNo');
      expect((await upload(`${header}\nIMP-9,"Unclosed,EA`, true)).body.message).toContain('could not be read as CSV');
    });
  });

  describe('counts', () => {
    let countId = '';
    let one: Part;
    let two: Part;

    it('starts one count per store, snapshotting what is held', async () => {
      one = await byNo('IMP-1');
      two = await byNo('IMP-2');
      expect((await send('post', '/stock/counts', { store: 'NORTH_STORE' }, 'technician')).status).toBe(403);
      const c = (await send('post', '/stock/counts', { store: 'NORTH_STORE', note: 'Year-end' }).then(st(201))).body;
      countId = c.id;
      expect(c.id).toMatch(/^CNT-\d{4}-\d{4}$/);
      expect(c).toEqual(expect.objectContaining({ status: 'OPEN', store: 'NORTH_STORE', counted: 0, note: 'Year-end' }));
      expect(c.lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ partNo: 'IMP-1', systemQty: 10, countedQty: null, bin: 'N-01A' }),
        expect.objectContaining({ partNo: 'IMP-2', systemQty: 5, countedQty: null }),
      ]));
      expect((await send('post', '/stock/counts', { store: 'NORTH_STORE' })).body.message).toBe(`Count ${countId} is still open for North depot store — post or cancel it first`);
      expect((await get('/stock/counts?status=OPEN')).body.map((x: { id: string }) => x.id)).toContain(countId);
    });

    it('applies differences to the current quantity, keeping issues made during the count', async () => {
      expect((await send('patch', `/stock/counts/${countId}`, { lines: [{ partId: 'PRT-NOPE', countedQty: 1 }] })).body.message).toBe(`Part PRT-NOPE is not on count ${countId}`);
      expect((await send('patch', `/stock/counts/${countId}`, { lines: [{ partId: one.id, countedQty: -1 }] })).body.message).toBe('Line 1: the counted quantity must be 0 or more');
      const entered = (await send('patch', `/stock/counts/${countId}`, { lines: [{ partId: one.id, countedQty: 8 }, { partId: two.id, countedQty: 7 }] }).then(st(200))).body;
      expect(entered.counted).toBe(2);
      expect(entered.lines.find((l: { partNo: string }) => l.partNo === 'IMP-1')).toEqual(expect.objectContaining({ difference: -2, value: -40 }));
      expect(entered.differenceValue).toBe(20); // −2 × 20 + 2 × 30

      // Three filters go out while the count is under way.
      const job = await newJob();
      await send('post', '/stock/issue', { partId: one.id, store: 'NORTH_STORE', qty: 3, jobId: job }, 'technician').then(st(201));

      const posted = (await send('post', `/stock/counts/${countId}/post`, {}).then(st(200))).body;
      expect(posted).toEqual(expect.objectContaining({ status: 'POSTED', postedBy: expect.any(String) }));
      one = await byNo('IMP-1');
      two = await byNo('IMP-2');
      expect(qtyIn(one, 'NORTH_STORE')).toBe(5); // 10 − 3 issued − 2 short
      expect(qtyIn(two, 'NORTH_STORE')).toBe(7);
      expect(one.movements[0]).toEqual(expect.objectContaining({ type: 'COUNT', qty: -2, countId }));
      expect(one.levels.find((l) => l.store === 'NORTH_STORE')!.countedAt).not.toBeNull();
      expect((await send('post', `/stock/counts/${countId}/post`, {})).body.message).toBe(`Count ${countId} is posted — it can no longer be changed`);
    });

    it('stops a post that would take stock below zero, and can be cancelled', async () => {
      const c = (await send('post', '/stock/counts', { store: 'NORTH_STORE' }).then(st(201))).body;
      await send('patch', `/stock/counts/${c.id}`, { lines: [{ partId: one.id, countedQty: 0 }, { partId: two.id, countedQty: 9 }] }).then(st(200));
      const job = await newJob();
      await send('post', '/stock/issue', { partId: one.id, store: 'NORTH_STORE', qty: 3, jobId: job }, 'technician').then(st(201));
      const refused = await send('post', `/stock/counts/${c.id}/post`, {});
      expect(refused.status).toBe(400);
      expect(refused.body.message).toMatch(/^IMP-1: the count would take the stock below zero/);
      expect(qtyIn(await byNo('IMP-2'), 'NORTH_STORE')).toBe(7); // nothing applied
      expect((await send('post', `/stock/counts/${c.id}/cancel`, {}).then(st(200))).body.status).toBe('CANCELLED');
      expect((await send('patch', `/stock/counts/${c.id}`, { lines: [{ partId: one.id, countedQty: 2 }] })).status).toBe(400);
      expect((await send('post', '/stock/counts', { store: 'NORTH_STORE', group: 'NOPE' })).body.message).toBe('Unknown part group NOPE');
    });
  });

  it('prints QR labels for parts and their bins', async () => {
    const one = await byNo('IMP-1');
    const two = await byNo('IMP-2');
    const res = await get(`/stock/labels?ids=${one.id},${two.id}&store=NORTH_STORE`, 'technician').then(st(200));
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('part-labels-2.pdf');
    expect((res.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    expect((await get(`/stock/labels?ids=${one.id}`)).headers['content-disposition']).toContain('IMP-1-label.pdf');
    expect((await get('/stock/labels?ids=PRT-NOPE')).status).toBe(404);
    expect((await get(`/stock/labels?ids=${one.id}&store=NOWHERE`)).body.message).toBe('Unknown store NOWHERE');
  });

  it('reports stock value and parts used, for people who manage stock', async () => {
    expect((await get('/reports/stock-valuation?format=csv', 'technician')).status).toBe(403);
    const value = (await get('/reports/stock-valuation?format=csv').then(st(200))).text;
    expect(value.split('\r\n')[0]).toBe('\uFEFFStore,Part no.,Name,Group,Bin,On hand,Unit,Average cost,Value (MYR)');
    expect(value).toContain('North depot store,IMP-2,Coolant 5L,Oils and fluids,N-02,7,Each,30.00,210.00');
    const xlsx = await get('/reports/stock-valuation').then(st(200));
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');

    const today = new Date().toISOString().slice(0, 10);
    const used = (await get(`/reports/parts-usage?from=${today}&to=${today}&format=csv`).then(st(200))).text;
    expect(used).toContain('IMP-1,Oil filter HD,6,Each,2,120.00'); // two work orders, 3 each at 20
  });

  it('counts low-stock places on the dashboard when stock control is on', async () => {
    const k = (await get('/dashboard/kpis', 'admin').then(st(200))).body;
    expect(typeof k.lowStock).toBe('number');
    expect(k.lowStock).toBeGreaterThan(0); // the demo data has parts below their reorder point
    const acme = await login(app, 'aisyah', undefined, 'acme.test');
    expect((await http.get(`${API}/dashboard/kpis`).set('Host', 'acme.test').set('Cookie', acme)).body.lowStock).toBeNull();
  });
});
