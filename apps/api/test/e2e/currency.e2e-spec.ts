import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { pdfLines } from './pdf-text';
import { SettingsService } from '../../src/settings/settings.service';
import { TenantRegistry } from '../../src/tenancy/tenant-registry';
import { runWithTenant } from '../../src/tenancy/tenant';

const API = '/api/v1';
const HOST = 'sg.test'; // general pack, created with --currency SGD and demo data
jest.setTimeout(20_000);

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('An organisation\'s own currency (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const get = async (path: string, user = 'admin') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch', path: string, body: object, user = 'admin') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);

  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('tells every screen which currency to show', async () => {
    expect((await http.get(`${API}/tenant`).set('Host', HOST)).body.currency).toBe('SGD');
    expect((await get('/config', 'technician')).body.currency).toEqual(expect.objectContaining({ code: 'SGD', symbol: 'S$', decimals: 2, major: 'Singapore Dollars' }));
    expect((await http.get(`${API}/tenant`).set('Host', 'acme.test')).body.currency).toBe('MYR');
  });

  it('prints invoices in it, with the amount in words', async () => {
    const inv = (await send('post', '/invoicing', { stream: 'CONTRACT', customer: 'Marina Tower MCST', period: '2026-11', amountMYR: 1234.5 }, 'finance').then(st(201))).body;
    const body = (await http.get(`${API}/invoicing/${inv.id}/documents/tax-invoice`).set('Host', HOST).set('Cookie', await as('finance')).buffer(true).parse(binary).expect(200)).body as Buffer;
    const text = pdfLines(body).join('\n');
    expect(text).toContain('Amount (SGD)');
    expect(text).toContain('S$ 1,234.50');
    expect(text).toMatch(/Singapore Dollars One Thousand Three Hundred and \w+/);
    expect(text).not.toContain('RM ');
    expect(text).not.toContain('Ringgit');
  });

  it('heads report columns with it', async () => {
    const csv = (await get('/reports/stock-valuation?format=csv').then(st(200))).text;
    expect(csv.split('\r\n')[0]).toContain('Value (SGD)');
  });

  it('is locked once amounts are recorded, and free to change before', async () => {
    const list = (await get('/settings/currencies').then(st(200))).body;
    expect(list).toEqual(expect.objectContaining({ current: 'SGD', locked: true }));
    expect(list.list.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(['MYR', 'SGD', 'IDR', 'USD']));
    expect((await send('patch', '/settings/currency', { code: 'USD' })).body.message).toContain('Amounts are already recorded');
    expect((await send('patch', '/settings/currency', { code: 'XYZ' })).body.message).toContain('Choose one of');
    expect((await send('patch', '/settings/currency', { code: 'USD' }, 'finance')).status).toBe(403);

    // An organisation with nothing recorded yet (beta) may change it.
    const beta = app.get(TenantRegistry).all().find((t) => t.id === 'beta')!;
    const settings = app.get(SettingsService);
    await runWithTenant(beta, async () => {
      await settings.ensureLoaded();
      expect(await settings.moneyRecorded()).toBe(false);
      expect((await settings.updateCurrency('idr', 'test')).code).toBe('IDR');
      expect(settings.currency).toEqual(expect.objectContaining({ code: 'IDR', decimals: 0 }));
      await settings.updateCurrency('MYR', 'test');
    });
  });
});
