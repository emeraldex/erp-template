import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { Mailer } from '../../src/notifications/mailer';
import { Database } from '../../src/tenancy/database';
import { PNG } from './fixtures';

const API = '/api/v1';
const HOST = 'fm.test';
jest.setTimeout(30_000);

describe('Request portal: triage, messages, completion and rating (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let mailer: Mailer;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const get = async (path: string, user = 'helpdesk') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch', path: string, body: object, user = 'helpdesk') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const pub = (path: string, body: object) => http.post(`${API}/public${path}`).set('Host', HOST).send(body);
  let seq = 0;
  const submit = async (fields: Record<string, string> = {}, photo = false) => {
    let req = http.post(`${API}/public/requests`).set('Host', HOST);
    const all = { description: 'Air-conditioning is dripping onto the desks', name: 'Lim Mei Ling', email: `mei${++seq}@tenant.example`, site: 'HQ', place: 'Level 12, open office', ...fields };
    for (const [k, v] of Object.entries(all)) req = req.field(k, v);
    if (photo) req = req.attach('photos', PNG, { filename: 'drip.png', contentType: 'image/png' });
    return (await req.then(st(201))).body as { id: string; track: string };
  };
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const mailFor = (id: string) => mailer.outbox.filter((m) => m.subject.startsWith(`${id}:`)).map((m) => m.subject.slice(id.length + 2));
  const upload = async (jobId: string, extra: Record<string, string>) => {
    let req = http.post(`${API}/attachments/job/${jobId}`).set('Host', HOST).set('Cookie', await as('technician')).set('X-Requested-With', 'erp-web')
      .attach('file', PNG, { filename: extra.kind === 'signature' ? 'sig.png' : 'after.png', contentType: 'image/png' });
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    return (await req.then(st(201))).body.id as string;
  };
  /** Take a facilities work order from open to completed, as the people who own each step. */
  const complete = async (jobId: string) => {
    await send('patch', `/jobs/${jobId}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-technician' } }).then(st(200));
    await send('patch', `/jobs/${jobId}/transition`, { to: 'IN_PROGRESS', fields: {} }, 'technician').then(st(200));
    const photoAfter = await upload(jobId, { kind: 'photo', caption: 'After' });
    const requesterSignature = await upload(jobId, { kind: 'signature', signedBy: 'Lim Mei Ling' });
    await send('patch', `/jobs/${jobId}/transition`, { to: 'COMPLETED', fields: { workDone: 'Cleared the drain line', rootCause: 'Blocked condensate drain', photoAfter, requesterSignature } }, 'technician').then(st(200));
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    mailer = app.get(Mailer);
  });
  afterAll(() => app.close());

  it('shows the inbox to the help desk only, urgent requests first', async () => {
    const plain = await submit();
    const urgent = await submit({ urgent: 'true', description: 'Water is pouring through the ceiling' });
    const list = (await get('/requests?status=NEW').then(st(200))).body as { id: string; urgent: boolean }[];
    expect(list.findIndex((r) => r.id === urgent.id)).toBeLessThan(list.findIndex((r) => r.id === plain.id));
    expect((await get('/requests', 'technician')).status).toBe(403);
    const one = (await get(`/requests/${urgent.id}`).then(st(200))).body;
    expect(one).toEqual(expect.objectContaining({ status: 'NEW', requesterName: 'Lim Mei Ling', requesterEmail: expect.stringMatching(/@tenant\.example$/), siteLabel: 'Head office tower' }));
    expect(one.trackLink).toBe(`http://localhost:3000/r/track#${urgent.track}`);
    expect((await get(`/requests?q=${encodeURIComponent('pouring')}`)).body.map((r: { id: string }) => r.id)).toEqual([urgent.id]);
  });

  it('accepts a request into a work order that carries the description and photos', async () => {
    mailer.outbox.length = 0;
    const req = await submit({ category: 'HVAC' }, true);
    const accepted = (await send('post', `/requests/${req.id}/accept`, {}).then(st(200))).body;
    expect(accepted).toEqual(expect.objectContaining({ status: 'ACCEPTED', jobId: expect.stringMatching(/^HD-/), decidedBy: expect.any(String), photos: 1 }));
    const job = (await get(`/jobs/${accepted.jobId}`).then(st(200))).body;
    expect(job).toEqual(expect.objectContaining({ component: 'Level 12, open office', serialNo: req.id, category: 'HVAC', repairUnit: 'HQ', originUnit: `Lim Mei Ling (request ${req.id})` }));
    const notes = job.audit.map((a: { action: string }) => a.action);
    expect(notes).toEqual(expect.arrayContaining([
      expect.stringContaining(`Note: Reported through the request portal (${req.id}) by Lim Mei Ling`),
      'Note: 1 photo from the requester attached',
    ]));
    const files = (await get(`/attachments/job/${accepted.jobId}`).then(st(200))).body;
    expect(files).toEqual([expect.objectContaining({ kind: 'photo', caption: 'Photo from the requester', filename: expect.stringMatching(new RegExp(`^${req.id}-photo-`)) })]);
    expect(mailFor(req.id)).toEqual(['we have your request', 'work has been booked']);
    expect((await pub('/track', { token: req.track })).body).toEqual(expect.objectContaining({ stage: 'accepted', photos: 1, canCancel: false }));
    expect((await send('post', `/requests/${req.id}/accept`, {})).status).toBe(409);
    // Anyone working the job can see who asked and how to reach them.
    const who = (await get(`/jobs/${accepted.jobId}/requests`, 'technician').then(st(200))).body;
    expect(who).toEqual([expect.objectContaining({ id: req.id, requesterName: 'Lim Mei Ling', requesterEmail: expect.any(String), description: expect.any(String) })]);
  });

  it('spots a duplicate from the same asset and adds it to the open work order', async () => {
    const asset = (await get('/assets')).body[0] as { id: string; tag: string };
    const first = await submit();
    // Staff log the first one against the asset (as a phone call would be).
    const logged = (await send('post', '/requests', { description: 'Chiller alarm keeps sounding', name: 'Security desk', phone: '03-1234 5678', site: 'HQ', assetId: asset.id }).then(st(201))).body;
    expect(logged).toEqual(expect.objectContaining({ source: 'STAFF', asset: expect.objectContaining({ id: asset.id }), trackLink: expect.stringContaining('/r/track#') }));
    const job = (await send('post', `/requests/${logged.id}/accept`, {}).then(st(200))).body.jobId;
    const second = (await send('post', '/requests', { description: 'Loud alarm from the plant room', name: 'Facilities office', email: 'office@tenant.example', site: 'HQ', assetId: asset.id }).then(st(201))).body;
    expect(second.duplicates.jobs.map((j: { id: string }) => j.id)).toContain(job);
    mailer.outbox.length = 0;
    const merged = (await send('post', `/requests/${second.id}/merge`, { jobId: job }).then(st(200))).body;
    expect(merged).toEqual(expect.objectContaining({ status: 'ACCEPTED', merged: true, jobId: job }));
    expect(mailFor(second.id)).toEqual(['already being dealt with']);
    expect((await get(`/jobs/${job}`)).body.audit.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining([expect.stringContaining(`Note: Also reported through the request portal (${second.id})`)]));
    expect((await send('post', `/requests/${first.id}/merge`, { jobId: 'HD-9999-0001' })).body.message).toContain('not found');
  });

  it('declines with a reason the requester sees, and purges spam', async () => {
    const req = await submit();
    expect((await send('post', `/requests/${req.id}/decline`, {})).body.message).toBe('Say why it is declined — the requester will see this');
    mailer.outbox.length = 0;
    await send('post', `/requests/${req.id}/decline`, { reason: 'This is the landlord\'s responsibility — please call building management' }).then(st(200));
    expect((await pub('/track', { token: req.track })).body).toEqual(expect.objectContaining({ stage: 'declined', declineReason: expect.stringContaining('landlord') }));
    expect(mailer.outbox.find((m) => m.subject.startsWith(req.id))?.text).toContain('Reason: This is the landlord');

    const spam = await submit({ description: 'Buy cheap watches at http://spam.example' }, true);
    mailer.outbox.length = 0;
    const purged = (await send('post', `/requests/${spam.id}/decline`, { spam: true }).then(st(200))).body;
    expect(purged).toEqual(expect.objectContaining({ status: 'DECLINED', spam: true, requesterName: 'Removed as spam', requesterEmail: '', photos: 0, trackLink: null }));
    expect(mailer.outbox).toEqual([]);
    expect((await pub('/track', { token: spam.track })).status).toBe(404);
  });

  it('erases a requester\'s contact details once the request is decided', async () => {
    const req = await submit();
    expect((await send('post', `/requests/${req.id}/erase`, {})).body.message).toContain('Decide the request first');
    await send('post', `/requests/${req.id}/decline`, { reason: 'Duplicate of a phone call' }).then(st(200));
    const erased = (await send('post', `/requests/${req.id}/erase`, {}).then(st(200))).body;
    expect(erased).toEqual(expect.objectContaining({ requesterName: 'Erased', requesterEmail: '', requesterPhone: '' }));
    expect((await pub('/track', { token: req.track })).status).toBe(404);
  });

  it('sends the team\'s messages to the requester without staff names', async () => {
    const req = await submit();
    await send('post', `/requests/${req.id}/accept`, {}).then(st(200));
    mailer.outbox.length = 0;
    await send('post', `/requests/${req.id}/messages`, { body: 'Is the drip near the window or the pillar?' }).then(st(200));
    expect(mailFor(req.id)).toEqual(['a message from the team']);
    const seen = (await pub('/track', { token: req.track })).body;
    expect(seen.messages).toEqual([expect.objectContaining({ from: 'TEAM', body: 'Is the drip near the window or the pillar?' })]);
    expect(seen.messages[0].by).not.toMatch(/Nur|Help/); // the team, never a staff member's name
  });

  it('lets the requester reply, then rate once the work is done', async () => {
    const req = await submit();
    const jobId = (await send('post', `/requests/${req.id}/accept`, {}).then(st(200))).body.jobId as string;
    await pub('/track/messages', { token: req.track, body: 'Near the window, desk 12-04' }).then(st(200));
    const notes = (await get('/notifications')).body.items;
    expect(notes.find((n: { title: string }) => n.title === `Reply on ${req.id} (${jobId}) from Lim Mei Ling`)).toEqual(expect.objectContaining({ link: `/jobs/${jobId}` }));
    mailer.outbox.length = 0;
    await complete(jobId);
    expect(mailFor(req.id)).toEqual(['the work is done']);
    const done = (await pub('/track', { token: req.track })).body;
    expect(done).toEqual(expect.objectContaining({ stage: 'done', canRate: true, canMessage: false }));
    expect((await pub('/track/rating', { token: req.track, rating: 7 })).body.message).toBe('Choose from 1 to 5 stars');
    const rated = (await pub('/track/rating', { token: req.track, rating: 2, comment: 'Took three days' }).then(st(200))).body;
    expect(rated).toEqual(expect.objectContaining({ rating: 2, ratingComment: 'Took three days', canRate: false }));
    expect((await pub('/track/rating', { token: req.track, rating: 5 })).body.message).toContain('already rated');
    expect((await get('/notifications', 'supervisor')).body.items.find((n: { title: string }) => n.title === `2★ rating on ${req.id} (${jobId})`)).toBeDefined();
    expect((await get(`/jobs/${jobId}/requests`)).body[0]).toEqual(expect.objectContaining({ rating: 2, ratingComment: 'Took three days', doneNotified: true }));
  });

  it('reminds the help desk once about a request left waiting', async () => {
    const req = await submit();
    await app.get(Database).pool.query(`UPDATE t_fm.service_requests SET "createdAt" = now() - interval '5 hours' WHERE id = $1`, [req.id]);
    expect((await send('post', '/requests/remind', {})).status).toBe(403);
    const first = (await send('post', '/requests/remind', {}, 'admin').then(st(200))).body.reminded;
    expect(first).toBeGreaterThanOrEqual(1);
    expect((await get('/notifications')).body.items.find((n: { title: string }) => n.title === `${req.id} has been waiting more than 4 h`)).toBeDefined();
    expect((await send('post', '/requests/remind', {}, 'admin').then(st(200))).body.reminded).toBe(0);
  });

  it('counts new requests and satisfaction on the dashboard, and reports requests', async () => {
    const k = (await get('/dashboard/kpis', 'admin').then(st(200))).body;
    expect(k.newRequests).toBeGreaterThan(0);
    expect(k.satisfaction).toEqual({ average: 2, ratings: 1 }); // the 2★ rating above
    expect((await http.get(`${API}/dashboard/kpis`).set('Host', 'acme.test').set('Cookie', await login(app, 'aisyah', undefined, 'acme.test'))).body.newRequests).toBeNull();

    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`/reports/requests?from=${today}&to=${today}&format=csv`, 'technician')).status).toBe(403);
    const csv = (await get(`/reports/requests?from=${today}&to=${today}&format=csv`).then(st(200))).text;
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('\uFEFFRequest,Date,From,Site,Type,Where,Urgent,Outcome,Work order,Hours to decide,Days to complete,Rating,Comment');
    expect(csv).toMatch(/,Logged by staff,Head office tower,/);
    expect(csv).toMatch(/,Spam,/);
    expect(csv).toMatch(/,Added to a work order,HD-/);
    expect(csv).toMatch(/,Accepted,HD-\d{4}-\d{4},0(\.\d)?,0(\.\d)?,2,Took three days/);
    expect((await get(`/reports/requests?from=${today}&to=${today}`).then(st(200))).headers['content-type']).toContain('spreadsheetml');
  });

  describe('QR posters and stickers', () => {
    it('prints a poster for a place; a scan fills in the place and needs no access code', async () => {
      expect((await send('post', '/requests/points', { label: 'Level 3 — east toilets', site: 'HQ' }, 'technician')).status).toBe(403);
      expect((await send('post', '/requests/points', { label: 'x' })).body.message).toBe('Name the place the poster is for');
      const point = (await send('post', '/requests/points', { label: 'Level 3 — east toilets', site: 'HQ' }).then(st(201))).body;
      expect(point.code).toMatch(/^[A-Za-z0-9]{8}$/);
      await send('patch', '/settings/portal', { accessCode: 'SECRET-1' }, 'admin').then(st(200));
      try {
        const info = (await http.get(`${API}/public/portal?p=${point.code}`).set('Host', HOST).then(st(200))).body;
        expect(info).toEqual(expect.objectContaining({ needsCode: false, point: expect.objectContaining({ label: 'Level 3 — east toilets', siteLabel: 'Head office tower' }) }));
        const req = await submit({ p: point.code, place: 'ignored', site: 'ANNEX', description: 'Tap will not turn off' });
        const one = (await get(`/requests/${req.id}`)).body;
        expect(one).toEqual(expect.objectContaining({ source: 'POSTER', place: 'Level 3 — east toilets', site: 'HQ', pointCode: point.code }));
        // A made-up code is just the plain form, which needs the code.
        expect((await http.post(`${API}/public/requests`).set('Host', HOST).field('p', 'AAAAAAAA').field('description', 'Tap will not turn off').field('name', 'Ali').field('email', 'ali@x.example')).status).toBe(400);
      } finally {
        await send('patch', '/settings/portal', { accessCode: '' }, 'admin').then(st(200));
      }
      const pdf = await get(`/requests/points/posters?codes=${point.code}`).then(st(200));
      expect(pdf.headers['content-type']).toBe('application/pdf');
      expect(pdf.headers['content-disposition']).toContain(`request-poster-${point.code}.pdf`);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
      expect((await get('/requests/points')).body.find((p: { code: string }) => p.code === point.code)).toEqual(expect.objectContaining({ requests: 1, active: true }));
    });

    it('makes one sticker point per asset, and a switched-off point opens the plain form', async () => {
      const assets = (await get('/assets')).body.slice(0, 2) as { id: string; tag: string }[];
      const { codes } = (await send('post', '/requests/points/assets', { assetIds: assets.map((a) => a.id) }).then(st(200))).body;
      expect(codes).toHaveLength(2);
      expect((await send('post', '/requests/points/assets', { assetIds: [assets[0].id] }).then(st(200))).body.codes).toEqual([codes[0]]);
      const stickers = await get(`/requests/points/posters?codes=${codes.join(',')}&format=stickers`).then(st(200));
      expect(stickers.headers['content-disposition']).toContain('request-stickers-2.pdf');
      const req = await submit({ p: codes[1], description: 'Strange noise from this unit' });
      expect((await get(`/requests/${req.id}`)).body.asset).toEqual(expect.objectContaining({ id: assets[1].id, tag: assets[1].tag }));

      await send('patch', `/requests/points/${codes[1]}`, { active: false }).then(st(200));
      expect((await http.get(`${API}/public/portal?p=${codes[1]}`).set('Host', HOST)).body.point).toBeNull();
      expect((await get(`/requests/points/posters?codes=${codes[1]}`)).body.message).toContain('is switched off');
      expect((await get('/requests/points/posters?codes=nope1234')).status).toBe(404);
    });
  });
});
