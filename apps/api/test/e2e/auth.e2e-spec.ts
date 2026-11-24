import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../../src/common/prisma.service';
import { bearer, createApp, login, PASSWORD } from './app';

const API = '/api/v1';

describe('Authentication & sessions (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  describe('health & headers', () => {
    it('reports the database as up, without signing in', async () => {
      const res = await http.get(`${API}/health`).expect(200);
      expect(res.body).toEqual(expect.objectContaining({ status: 'ok', database: 'up' }));
    });

    it('sends security headers', async () => {
      const res = await http.get(`${API}/health`);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows credentialed CORS only from WEB_ORIGIN', async () => {
      const ok = await http.options(`${API}/jobs`).set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
      expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(ok.headers['access-control-allow-credentials']).toBe('true');
      const evil = await http.options(`${API}/jobs`).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
      expect(evil.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('sign-in', () => {
    it('sets an httpOnly, SameSite=Strict cookie and returns no token by default', async () => {
      const res = await http.post(`${API}/auth/login`).send({ email: 'rahim@company.example', password: PASSWORD }).expect(200);
      const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('erp_session='))!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(res.body.token).toBeUndefined();
      expect(res.body.user).toEqual(expect.objectContaining({ email: 'rahim@company.example', role: 'STORES' }));
      expect(res.body.user.passwordHash).toBeUndefined();
    });

    it('gives the same answer for a wrong password and an unknown account', async () => {
      const wrong = await http.post(`${API}/auth/login`).send({ email: 'daniel@company.example', password: 'nope-nope' }).expect(401);
      const unknown = await http.post(`${API}/auth/login`).send({ email: 'nobody@company.example', password: 'nope-nope' }).expect(401);
      expect(wrong.body.message).toBe('Invalid email or password');
      expect(unknown.body.message).toBe(wrong.body.message);
      await prisma.user.update({ where: { email: 'daniel@company.example' }, data: { failedLogins: 0 } });
    });

    it('is case-insensitive on email', async () => {
      await http.post(`${API}/auth/login`).send({ email: 'Rahim@Company.Example', password: PASSWORD }).expect(200);
    });

    it('rejects malformed input', async () => {
      await http.post(`${API}/auth/login`).send({ email: 'not-an-email', password: 'x' }).expect(400);
    });

    it('locks the account after repeated failures, even for the right password', async () => {
      for (let i = 0; i < 2; i++) {
        await http.post(`${API}/auth/login`).send({ email: 'farah@company.example', password: 'wrong-pass' }).expect(401);
      }
      const third = await http.post(`${API}/auth/login`).send({ email: 'farah@company.example', password: 'wrong-pass' }).expect(401);
      expect(third.body.message).toMatch(/locked/);
      const right = await http.post(`${API}/auth/login`).send({ email: 'farah@company.example', password: PASSWORD }).expect(401);
      expect(right.body.message).toMatch(/locked/);

      await prisma.user.update({ where: { email: 'farah@company.example' }, data: { lockedUntil: new Date(Date.now() - 1000) } });
      await http.post(`${API}/auth/login`).send({ email: 'farah@company.example', password: PASSWORD }).expect(200);
    });
  });

  describe('session use', () => {
    it('requires a session for data endpoints, including /config', async () => {
      await http.get(`${API}/jobs`).expect(401);
      await http.get(`${API}/config`).expect(401);
    });

    it('accepts the cookie for reads', async () => {
      const cookie = await login(app, 'rahim');
      const res = await http.get(`${API}/jobs`).set('Cookie', cookie).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('rejects a cookie-authenticated write without X-Requested-With (CSRF)', async () => {
      const cookie = await login(app, 'rahim');
      const job = { component: 'CSRF probe', partNo: 'P', serialNo: 'S', category: 'NAS', originUnit: 'CPU Central', repairUnit: 'CENTRAL' };
      await http.post(`${API}/jobs`).set('Cookie', cookie).send(job).expect(403);
      await http.post(`${API}/jobs`).set('Cookie', cookie).set('X-Requested-With', 'erp-web').send(job).expect(201);
    });

    it('accepts a bearer token from scripts without the CSRF header', async () => {
      const auth = await bearer(app, 'rahim');
      await http.get(`${API}/auth/me`).set('Authorization', auth).expect(200);
    });

    it('rejects a tampered token', async () => {
      const auth = await bearer(app, 'rahim');
      const [body, sig] = auth.slice(7).split('.');
      const forged = Buffer.from(JSON.stringify({ sid: 'made-up', exp: Date.now() + 1e9 })).toString('base64url');
      await http.get(`${API}/auth/me`).set('Authorization', `Bearer ${forged}.${sig}`).expect(401);
      await http.get(`${API}/auth/me`).set('Authorization', `Bearer ${body}.${sig}x`).expect(401);
    });

    it('ends the session on sign-out, for cookie and token alike', async () => {
      const res = await http.post(`${API}/auth/login`).send({ email: 'kumar@company.example', password: PASSWORD, tokenInBody: true }).expect(200);
      const cookie = ([] as string[]).concat(res.headers['set-cookie']).find((c) => c.startsWith('erp_session='))!.split(';')[0];
      await http.post(`${API}/auth/logout`).set('Cookie', cookie).set('X-Requested-With', 'erp-web').expect(200);
      await http.get(`${API}/jobs`).set('Cookie', cookie).expect(401);
      await http.get(`${API}/jobs`).set('Authorization', `Bearer ${res.body.token}`).expect(401);
    });

    it('signs out after the idle timeout', async () => {
      const cookie = await login(app, 'suresh');
      await prisma.session.updateMany({
        where: { user: { email: 'suresh@company.example' }, revokedAt: null },
        data: { lastSeenAt: new Date(Date.now() - 2 * 3_600_000) },
      });
      const res = await http.get(`${API}/jobs`).set('Cookie', cookie).expect(401);
      expect(res.body.message).toMatch(/inactivity/);
    });

    it('enforces the absolute session expiry', async () => {
      const cookie = await login(app, 'qistina');
      await prisma.session.updateMany({
        where: { user: { email: 'qistina@company.example' }, revokedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await http.get(`${API}/jobs`).set('Cookie', cookie).expect(401);
    });
  });

  describe('forced password change', () => {
    const email = 'zara@company.example';
    const NEW = 'Kopi-O-Kosong-Panas-77';

    beforeAll(() => prisma.user.update({ where: { email }, data: { mustChangePassword: true } }));

    it('blocks data access until the password is changed, but allows /auth/me', async () => {
      const cookie = await login(app, 'zara');
      const blocked = await http.get(`${API}/jobs`).set('Cookie', cookie).expect(403);
      expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      const me = await http.get(`${API}/auth/me`).set('Cookie', cookie).expect(200);
      expect(me.body.user.mustChangePassword).toBe(true);
    });

    it('rejects a wrong current password and weak new passwords', async () => {
      const cookie = await login(app, 'zara');
      const post = (body: object) =>
        http.post(`${API}/auth/change-password`).set('Cookie', cookie).set('X-Requested-With', 'erp-web').send(body);
      expect((await post({ currentPassword: 'wrong', newPassword: NEW }).expect(400)).body.message).toMatch(/Current password/);
      expect((await post({ currentPassword: PASSWORD, newPassword: 'short' }).expect(400)).body.message).toMatch(/at least 12/);
      expect((await post({ currentPassword: PASSWORD, newPassword: 'zara-is-my-password' }).expect(400)).body.message).toMatch(/too easy/);
    });

    it('accepts a strong password, signs out other devices and unblocks access', async () => {
      const other = await login(app, 'zara');
      const cookie = await login(app, 'zara');
      const res = await http.post(`${API}/auth/change-password`).set('Cookie', cookie).set('X-Requested-With', 'erp-web')
        .send({ currentPassword: PASSWORD, newPassword: NEW }).expect(200);
      expect(res.body.user.mustChangePassword).toBe(false);
      await http.get(`${API}/jobs`).set('Cookie', cookie).expect(200);
      await http.get(`${API}/jobs`).set('Cookie', other).expect(401);
      await http.post(`${API}/auth/login`).send({ email, password: PASSWORD }).expect(401);
      await http.post(`${API}/auth/login`).send({ email, password: NEW }).expect(200);
    });
  });
});
