import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { Mailer } from '../../src/notifications/mailer';
import { PNG } from './fixtures';

const API = '/api/v1';
const HOST = 'fm.test'; // facilities pack: the request portal is on; buildings HQ, ANNEX, WAREHOUSE
jest.setTimeout(20_000);


describe('Request portal: the public side (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let mailer: Mailer;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const staffGet = async (path: string, user = 'helpdesk') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const staffPatch = async (path: string, body: object, user = 'admin') => http.patch(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const pub = (path: string, host = HOST) => http.get(`${API}/public${path}`).set('Host', host);
  const post = (path: string, body: object, host = HOST) => http.post(`${API}/public${path}`).set('Host', host).send(body);
  let seq = 0;
  /** Send a request through the form (multipart), with optional photos. */
  const submit = (fields: Record<string, string>, photos: { body: Buffer; name: string; type: string }[] = [], host = HOST) => {
    let req = http.post(`${API}/public/requests`).set('Host', host);
    const all = { description: 'The lights in the lift lobby keep flickering', name: 'Siti Aminah', email: `siti${++seq}@tenant.example`, site: 'HQ', place: 'Level 3 lift lobby', ...fields };
    for (const [k, v] of Object.entries(all)) req = req.field(k, v);
    for (const p of photos) req = req.attach('photos', p.body, { filename: p.name, contentType: p.type });
    return req;
  };
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    mailer = app.get(Mailer);
  });
  afterAll(() => app.close());

  it('tells the form what to show', async () => {
    const info = (await pub('/portal').then(st(200))).body;
    expect(info).toEqual(expect.objectContaining({ org: expect.any(String), open: true, needsCode: false, maxPhotos: 3, point: null }));
    expect(info.sites.map((s: { key: string }) => s.key)).toEqual(['HQ', 'ANNEX', 'WAREHOUSE']);
    expect(info.categories.map((c: { key: string }) => c.key)).toContain('ELECTRICAL');
  });

  it('takes a request with a photo, answers with a private tracking token, and tells the help desk', async () => {
    mailer.outbox.length = 0;
    const res = (await submit({ category: 'ELECTRICAL', urgent: 'true', lang: 'ms' }, [{ body: PNG, name: 'lobby.png', type: 'image/png' }]).then(st(201))).body;
    expect(res.id).toMatch(/^REQ-\d{4}-\d{4}$/);
    expect(res.track).toMatch(new RegExp(`^${res.id}\\.[A-Za-z0-9_-]{27}$`));

    const view = (await post('/track', { token: res.track }).then(st(200))).body;
    expect(view).toEqual(expect.objectContaining({
      id: res.id, stage: 'received', place: 'Level 3 lift lobby', site: 'Head office tower', category: 'Electrical', urgent: true, photos: 1,
      canCancel: true, canMessage: true, canRate: false, messages: [], lang: 'ms',
    }));
    expect(JSON.stringify(view)).not.toMatch(/trackSalt|ipHash|requesterEmail|siti\d+@/);

    const mail = mailer.outbox.find((m) => m.subject.startsWith(res.id));
    expect(mail?.subject).toBe(`${res.id}: permohonan anda diterima`);
    expect(mail?.text).toContain(`/r/track#${res.track}`);
    expect(mail?.text).not.toContain('flickering'); // never echo the requester's words

    const notes = (await staffGet('/notifications')).body;
    expect(notes.items.find((n: { ref: string }) => n.ref === res.id)).toEqual(expect.objectContaining({ title: `URGENT request ${res.id} — Level 3 lift lobby`, link: `/requests?id=${res.id}` }));
  });

  it('checks the form and the photos before keeping anything', async () => {
    const bad = await submit({ description: 'bad', name: 'x', email: 'nope', site: 'MOON' });
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual(['Say what is wrong (at least 5 characters)', 'Give your name', 'That email address does not look right', 'Choose one of the sites listed']);
    expect((await submit({ site: '' })).body.message).toBe('Choose the site');
    const fake = await submit({}, [{ body: Buffer.from('<script>alert(1)</script>'), name: 'x.png', type: 'image/png' }]);
    expect(fake.body.message).toBe('Photos must be JPEG, PNG or WebP images');
    const four = await submit({}, [1, 2, 3, 4].map((i) => ({ body: PNG, name: `${i}.png`, type: 'image/png' })));
    expect(four.status).toBeGreaterThanOrEqual(400);
    const before = (await staffGet('/notifications')).body.items.length;
    // An automated form-filler fills the hidden field: quietly dropped.
    expect((await submit({ website: 'http://spam.example' }).then(st(201))).body).toEqual({ id: null, track: null });
    expect((await staffGet('/notifications')).body.items.length).toBe(before);
  });

  it('answers 404 for a wrong or altered token', async () => {
    const { track } = (await submit({}).then(st(201))).body;
    const altered = track.slice(0, -2) + (track.endsWith('AA') ? 'BB' : 'AA');
    for (const token of [altered, 'REQ-2026-9999.' + 'A'.repeat(27), 'nonsense', undefined]) {
      expect((await post('/track', { token })).status).toBe(404);
    }
    // A token from one organisation does not open anything at another.
    expect((await post('/track', { token: track }, 'fleet.test')).status).toBe(404);
  });

  it('lets the requester add information, cancel while new, and not rate before the work is done', async () => {
    const { track } = (await submit({}).then(st(201))).body;
    expect((await post('/track/rating', { token: track, rating: 5 })).body.message).toBe('You can rate the work once it is done');
    const after = (await post('/track/messages', { token: track, body: 'It is the light nearest the stairs' }).then(st(200))).body;
    expect(after.messages).toEqual([expect.objectContaining({ from: 'REQUESTER', by: 'Siti Aminah', body: 'It is the light nearest the stairs' })]);
    const cancelled = (await post('/track/cancel', { token: track }).then(st(200))).body;
    expect(cancelled).toEqual(expect.objectContaining({ stage: 'cancelled', canCancel: false, canMessage: false }));
    expect((await post('/track/cancel', { token: track })).body.message).toBe('This request has already been dealt with and can no longer be cancelled');
    expect((await post('/track/messages', { token: track, body: 'Hello?' })).body.message).toBe('This request is closed');
  });

  it('limits how many requests one email address can send in an hour', async () => {
    const email = 'busy@tenant.example';
    for (let i = 0; i < 3; i++) await submit({ email }).then(st(201));
    expect((await submit({ email })).status).toBe(429);
  });

  it('asks for the access code when one is set (administrators only see it)', async () => {
    expect((await staffPatch('/settings/portal', { accessCode: 'x' })).body.message).toContain('Access code');
    expect((await staffPatch('/settings/portal', { accessCode: 'TOWER-7' }, 'helpdesk')).status).toBe(403);
    await staffPatch('/settings/portal', { accessCode: 'TOWER-7' }).then(st(200));
    try {
      expect((await pub('/portal')).body.needsCode).toBe(true);
      expect((await submit({})).body.message).toContain('access code is not right');
      await submit({ accessCode: 'tower-7' }).then(st(201));
      expect((await staffGet('/settings')).body.portal.accessCode).toBe('********');
      expect((await staffGet('/settings', 'admin')).body.portal.accessCode).toBe('TOWER-7');
    } finally {
      await staffPatch('/settings/portal', { accessCode: '' }).then(st(200));
    }
  });

  it('disappears when the portal is closed or the module is off, and for aviation organisations', async () => {
    const { track } = (await submit({}).then(st(201))).body;
    await staffPatch('/settings/portal', { open: false }).then(st(200));
    try {
      expect((await submit({})).status).toBe(404);
      expect((await pub('/portal').then(st(200))).body.open).toBe(false); // the page can say so
      expect((await post('/track', { token: track })).status).toBe(200); // existing requests can still be followed
    } finally {
      await staffPatch('/settings/portal', { open: true }).then(st(200));
    }
    await staffPatch('/settings/modules', { requests: false }).then(st(200));
    try {
      expect((await pub('/portal')).status).toBe(404);
      expect((await post('/track', { token: track })).status).toBe(404);
    } finally {
      await staffPatch('/settings/modules', { requests: true }).then(st(200));
    }
    expect((await pub('/portal', 'acme.test')).status).toBe(404);
    expect((await submit({}, [], 'acme.test')).status).toBe(404);
  });
});
