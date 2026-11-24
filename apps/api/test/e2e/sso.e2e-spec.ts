import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { Database } from '../../src/tenancy/database';
import { createApp, login } from './app';
import { MockOidc } from './mock-oidc';

const API = '/api/v1';
const HOST = 'gamma.test'; // a tenant of its own: these tests change how its users may sign in
const WEB = 'http://gamma.test:3000';

describe('Single sign-on (OpenID Connect)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let db: Database;
  const idp = new MockOidc();

  /** Run the whole browser round trip; return where the user ends up and any session cookie. */
  async function signIn(opts: { referer?: string; tamperState?: boolean } = {}) {
    const start = await http.get(`${API}/auth/sso/start`).set('Host', HOST).set('Referer', opts.referer ?? `${WEB}/login`).redirects(0);
    expect(start.status).toBe(302);
    const stateCookie = ([] as string[]).concat(start.headers['set-cookie'] ?? []).find((c) => c.startsWith('erp_sso='));
    const authorize = await fetch(start.headers.location, { redirect: 'manual' });
    if (authorize.status !== 302) return { location: start.headers.location, cookie: undefined };
    const back = new URL(authorize.headers.get('location')!);
    if (opts.tamperState) back.searchParams.set('state', 'forged');
    const cb = await http.get(`${back.pathname}${back.search}`).set('Host', HOST).set('Cookie', stateCookie?.split(';')[0] ?? '').redirects(0);
    const session = ([] as string[]).concat(cb.headers['set-cookie'] ?? []).find((c) => c.startsWith('erp_session='));
    return { location: cb.headers.location as string, cookie: session?.split(';')[0], start };
  }

  beforeAll(async () => {
    await idp.start('erp-gamma', 'client-secret-123');
    ({ app } = await createApp());
    db = app.get(Database);
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    await db.pool.query(`DELETE FROM t_gamma.settings WHERE key = 'sso'`); // leave gamma as it was
    await app.close();
    await idp.stop();
  });

  it('is configured by an administrator; the secret is stored sealed and never returned', async () => {
    const admin = await login(app, 'aisyah', undefined, HOST);
    const put = (body: object) => http.put(`${API}/auth/sso/settings`).set('Host', HOST).set('Cookie', admin).set('X-Requested-With', 'erp-web').send(body);
    expect((await put({ enabled: true, issuer: 'http://127.0.0.1:1', clientId: 'x' })).status).toBe(400); // discovery fails
    const res = await put({ enabled: true, issuer: idp.issuer, clientId: 'erp-gamma', clientSecret: 'client-secret-123', label: 'Gamma SSO' }).expect(200);
    expect(res.body).toEqual(expect.objectContaining({ enabled: true, hasClientSecret: true, callbackUrl: 'http://gamma.test/api/v1/auth/sso/callback' }));
    expect(JSON.stringify(res.body)).not.toContain('client-secret-123');
    const stored = (await db.pool.query(`SELECT value FROM t_gamma.settings WHERE key = 'sso'`)).rows[0].value;
    expect(stored.clientSecretEnc).toMatch(/^v1\./);
    expect(JSON.stringify(stored)).not.toContain('client-secret-123');
    await http.put(`${API}/auth/sso/settings`).set('Host', HOST).set('Cookie', await login(app, 'rahim', undefined, HOST))
      .set('X-Requested-With', 'erp-web').send({ enabled: false }).expect(403);
  });

  it('tells the sign-in page what to offer', async () => {
    expect((await http.get(`${API}/auth/sso`).set('Host', HOST).expect(200)).body).toEqual({ enabled: true, label: 'Gamma SSO', passwordLogin: true });
    expect((await http.get(`${API}/auth/sso`).expect(200)).body.enabled).toBe(false); // default tenant untouched
  });

  it('signs a registered user in through the identity provider', async () => {
    idp.nextEmail = 'rahim@company.example';
    const { location, cookie, start } = await signIn();
    const authorize = new URL(start!.headers.location);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://gamma.test/api/v1/auth/sso/callback');
    expect(location).toBe(`${WEB}/login?sso=ok`);
    const me = (await http.get(`${API}/auth/me`).set('Host', HOST).set('Cookie', cookie!).expect(200)).body.user;
    expect(me).toEqual(expect.objectContaining({ email: 'rahim@company.example', role: 'STORES', mustChangePassword: false }));
  });

  it('does not ask SSO users to change a password they do not use', async () => {
    await db.pool.query(`UPDATE t_gamma.users SET "mustChangePassword" = true WHERE email = 'daniel@company.example'`);
    idp.nextEmail = 'daniel@company.example';
    const { cookie } = await signIn();
    await http.get(`${API}/jobs`).set('Host', HOST).set('Cookie', cookie!).expect(200);
  });

  it('refuses people without an account, forged state, foreign signatures and replayed nonces', async () => {
    idp.nextEmail = 'stranger@elsewhere.example';
    expect((await signIn()).location).toBe(`${WEB}/login?sso_error=not_registered`);
    idp.nextEmail = 'rahim@company.example';
    expect((await signIn({ tamperState: true })).location).toBe(`${WEB}/login?sso_error=state_mismatch`);
    idp.tamper = { foreignKey: true };
    expect((await signIn()).location).toBe(`${WEB}/login?sso_error=token_invalid`);
    idp.tamper = { nonce: true };
    expect((await signIn()).location).toBe(`${WEB}/login?sso_error=nonce_mismatch`);
    idp.tamper = { emailVerified: false };
    expect((await signIn()).location).toBe(`${WEB}/login?sso_error=email_unverified`);
    idp.tamper = {};
    const noState = await http.get(`${API}/auth/sso/callback?code=x&state=y`).set('Host', HOST).redirects(0);
    expect(noState.headers.location).toMatch(/sso_error=state_missing$/);
  });

  it('only sends people back to a known web address', async () => {
    const { start } = await signIn({ referer: 'https://phish.example/login' });
    const back = await (async () => {
      const authorize = await fetch(start!.headers.location, { redirect: 'manual' });
      const u = new URL(authorize.headers.get('location')!);
      const cookie = ([] as string[]).concat(start!.headers['set-cookie']).find((c) => c.startsWith('erp_sso='))!.split(';')[0];
      return (await http.get(`${u.pathname}${u.search}`).set('Host', HOST).set('Cookie', cookie).redirects(0)).headers.location as string;
    })();
    expect(back.startsWith('https://phish.example')).toBe(false);
  });

  it('can require SSO, keeping password sign-in for administrators as a break-glass', async () => {
    const admin = await login(app, 'aisyah', undefined, HOST);
    await http.put(`${API}/auth/sso/settings`).set('Host', HOST).set('Cookie', admin).set('X-Requested-With', 'erp-web')
      .send({ allowPasswordLogin: false }).expect(200);
    const res = await http.post(`${API}/auth/login`).set('Host', HOST).send({ email: 'meiling@company.example', password: 'demo123' }).expect(403);
    expect(res.body).toEqual(expect.objectContaining({ code: 'SSO_REQUIRED', message: 'Sign in with Gamma SSO instead' }));
    await login(app, 'aisyah', undefined, HOST); // admin still can
    expect((await http.get(`${API}/auth/sso`).set('Host', HOST)).body.passwordLogin).toBe(false);
  });
});
