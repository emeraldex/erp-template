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
});
