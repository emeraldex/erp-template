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
});
