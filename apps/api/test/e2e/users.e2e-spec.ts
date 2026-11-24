import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';

const API = '/api/v1';
const HOST = 'acme.test';

describe('User management (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let admin: string;
  const call = (method: 'get' | 'post' | 'patch', path: string, body?: object, cookie = admin) => {
    const r = http[method](`${API}${path}`).set('Host', HOST).set('Cookie', cookie).set('X-Requested-With', 'erp-web');
    return body ? r.send(body) : r;
  };
  const signIn = (email: string, password: string) => http.post(`${API}/auth/login`).set('Host', HOST).send({ email, password });

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    admin = await login(app, 'aisyah', undefined, HOST);
  });
  afterAll(() => app.close());

  it('adds a user with a one-time password that must be changed', async () => {
    const res = await call('post', '/users', { name: 'Nurul Huda', email: 'Nurul@Acme.Example', role: 'WORKSHOP', designation: 'Tst', branch: 'EAST' }).expect(201);
    expect(res.body.user).toEqual(expect.objectContaining({ email: 'nurul@acme.example', role: 'WORKSHOP', branch: 'EAST', mustChangePassword: true }));
    expect(res.body.user.passwordHash).toBeUndefined();
    const ok = await signIn('nurul@acme.example', res.body.temporaryPassword).expect(200);
    expect(ok.body.user.mustChangePassword).toBe(true);
    await call('post', '/users', { name: 'Dup', email: 'nurul@acme.example', role: 'MIS' }).expect(409);
    await call('post', '/users', { name: 'Bad', email: 'not-an-email', role: 'MIS' }).expect(400);
    await call('post', '/users', { name: 'Bad', email: 'x@y.example', role: 'JANITOR' }).expect(400);
  });

  it('lists users without secrets, with last sign-in', async () => {
    const list = (await call('get', '/users').expect(200)).body;
    const nurul = list.find((u: { email: string }) => u.email === 'nurul@acme.example');
    expect(nurul.lastSignIn).toEqual(expect.any(String));
    expect(JSON.stringify(list)).not.toContain('scrypt$');
  });

  it('changes role and details, but not your own role', async () => {
    const list = (await call('get', '/users')).body;
    const nurul = list.find((u: { email: string }) => u.email === 'nurul@acme.example');
    const me = list.find((u: { email: string }) => u.email === 'aisyah@company.example');
    expect((await call('patch', `/users/${nurul.id}`, { role: 'MIS', branch: 'NORTH' }).expect(200)).body).toEqual(expect.objectContaining({ role: 'MIS', branch: 'NORTH' }));
    expect((await call('patch', `/users/${me.id}`, { role: 'MIS' }).expect(403)).body.message).toMatch(/own role/);
  });

  it('deactivates (ending sessions and sign-in) and reactivates, never on yourself', async () => {
    const created = (await call('post', '/users', { name: 'Leaving Soon', email: 'leaving@acme.example', role: 'STORES' }).expect(201)).body;
    const cookie = ([] as string[]).concat((await signIn('leaving@acme.example', created.temporaryPassword)).headers['set-cookie']).find((c) => c.startsWith('erp_session='))!.split(';')[0];
    await call('post', `/users/${created.user.id}/deactivate`).expect(200);
    await http.get(`${API}/auth/me`).set('Host', HOST).set('Cookie', cookie).expect(401);
    expect((await signIn('leaving@acme.example', created.temporaryPassword).expect(401)).body.message).toBe('Invalid email or password');
    await call('post', `/users/${created.user.id}/reactivate`).expect(200);
    await signIn('leaving@acme.example', created.temporaryPassword).expect(200);
    const me = (await call('get', '/users')).body.find((u: { email: string }) => u.email === 'aisyah@company.example');
    expect((await call('post', `/users/${me.id}/deactivate`).expect(403)).body.message).toMatch(/yourself/);
  });

  it('resets a password (ending sessions) and unlocks accounts', async () => {
    const created = (await call('post', '/users', { name: 'Forgetful', email: 'forgot@acme.example', role: 'MIS' }).expect(201)).body;
    const cookie = ([] as string[]).concat((await signIn('forgot@acme.example', created.temporaryPassword)).headers['set-cookie']).find((c) => c.startsWith('erp_session='))!.split(';')[0];
    for (let i = 0; i < 3; i++) await signIn('forgot@acme.example', 'wrong-guess');
    expect((await signIn('forgot@acme.example', created.temporaryPassword)).body.message).toMatch(/locked/);
    await call('post', `/users/${created.user.id}/unlock`).expect(200);
    await signIn('forgot@acme.example', created.temporaryPassword).expect(200);
    const reset = (await call('post', `/users/${created.user.id}/reset-password`).expect(200)).body;
    await http.get(`${API}/auth/me`).set('Host', HOST).set('Cookie', cookie).expect(401);
    await signIn('forgot@acme.example', created.temporaryPassword).expect(401);
    await signIn('forgot@acme.example', reset.temporaryPassword).expect(200);
  });

  it('records every change and is for administrators only', async () => {
    const history = (await call('get', '/workflow/history').expect(200)).body.filter((h: { area: string }) => h.area === 'users');
    expect(history.map((h: { summary: string }) => h.summary)).toEqual(expect.arrayContaining([
      'Added Nurul Huda <nurul@acme.example> as WORKSHOP', 'Deactivated Leaving Soon', 'Reset the password of Forgetful',
    ]));
    await call('get', '/users', undefined, await login(app, 'rahim', undefined, HOST)).expect(403);
  });
});
