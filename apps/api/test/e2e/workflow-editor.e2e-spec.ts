import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';

const API = '/api/v1';
// Runs against the acme organisation, so edits never touch the default tenant other tests use.
const HOST = 'acme.test';

describe('Workflow editor (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let quality: string;
  const send = (method: 'put' | 'post', path: string, body: object, cookie = quality) =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', cookie).set('X-Requested-With', 'erp-web').send(body);
  const get = (path: string, cookie = quality) => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', cookie);
  const as = (user: string) => login(app, user, undefined, HOST);

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    quality = await as('qistina');
  });
  afterAll(() => app.close());

  it('gives the editor statuses, roles, protected rules and versions', async () => {
    const snap = (await get('/workflow').expect(200)).body;
    const job = snap.kinds.find((k: { kind: string }) => k.kind === 'JOB');
    expect(job).toEqual(expect.objectContaining({ initial: 'REGISTERED', version: expect.any(String) }));
    expect(job.statuses).toContain('AWAITING_SPARE');
    expect(job.protected).toEqual(expect.arrayContaining([{ from: 'TDI', to: 'AWAITING_SPARE', keys: ['f212Ref'] }]));
    expect(snap.roles).toContain('QUALITY');
    expect(snap.sla.version).toEqual(expect.any(String));
  });

  it('saves a change, applies it immediately, and records who changed what', async () => {
    const snap = (await get('/workflow')).body;
    const job = snap.kinds.find((k: { kind: string }) => k.kind === 'JOB');
    const edited = job.transitions.map((r: { from: string; roles: string[]; requires: object[] }) =>
      r.from === 'REGISTERED' ? { ...r, roles: [...r.roles, 'PCE'], requires: [...r.requires, { key: 'binNo', label: 'Bin number' }] } : r);
    const saved = (await send('put', '/workflow/transitions/job', { version: job.version, transitions: edited }).expect(200)).body;
    expect(saved.version).not.toBe(job.version);

    // A PCE can now dispatch, and must give the new bin number.
    const pce = await as('kumar');
    const created = (await send('post', '/jobs', {
      component: 'Editor Probe', partNo: 'E', serialNo: 'S', category: 'NAS', originUnit: 'X', repairUnit: 'CENTRAL',
    }, await as('rahim')).expect(201)).body;
    const missing = await http.patch(`${API}/jobs/${created.id}/transition`).set('Host', HOST).set('Cookie', pce).set('X-Requested-With', 'erp-web')
      .send({ to: 'AWAITING_TDI', fields: { f219Ref: 'F219-X' } }).expect(400);
    expect(missing.body.message).toMatch(/Bin number/);
    await http.patch(`${API}/jobs/${created.id}/transition`).set('Host', HOST).set('Cookie', pce).set('X-Requested-With', 'erp-web')
      .send({ to: 'AWAITING_TDI', fields: { f219Ref: 'F219-X', binNo: 'B-12' } }).expect(200);

    const history = (await get('/workflow/history').expect(200)).body;
    expect(history[0]).toEqual(expect.objectContaining({ by: 'Qistina Yusof', role: 'QUALITY', area: 'transitions:JOB' }));
    expect(history[0].summary).toMatch(/JOB workflow: \d+ transitions/);
  });

  it('refuses a save based on an out-of-date copy', async () => {
    const snap = (await get('/workflow')).body;
    const ov = snap.kinds.find((k: { kind: string }) => k.kind === 'OV');
    await send('put', '/workflow/transitions/ov', { version: 'stale', transitions: ov.transitions }).expect(409);
  });

  it('refuses to remove what the system depends on, listing every problem', async () => {
    const snap = (await get('/workflow')).body;
    const inv = snap.kinds.find((k: { kind: string }) => k.kind === 'INVOICE');
    const broken = inv.transitions.filter((r: { to: string }) => r.to !== 'PAID');
    const res = await send('put', '/workflow/transitions/invoice', { version: inv.version, transitions: broken }).expect(400);
    expect(res.body.errors).toContain('SUBMITTED → PAID is used by the system and cannot be removed');
    const preview = (await send('post', '/workflow/transitions/invoice/preview', { transitions: broken }).expect(200)).body;
    expect(preview.ok).toBe(false);
  });

  it('edits SLA rules and invoicing streams', async () => {
    const snap = (await get('/workflow')).body;
    const rules = [...snap.sla.rules, { id: 'SLA-WIP', entity: 'JOB', status: 'WIP', days: 30, rule: 'Complete repair within 30 days', source: 'Contract' }];
    const saved = (await send('put', '/workflow/sla', { version: snap.sla.version, rules }).expect(200)).body;
    expect(saved.rules.find((r: { id: string }) => r.id === 'SLA-WIP')).toEqual(expect.objectContaining({ days: 30 }));
    const bad = await send('put', '/workflow/sla', { version: saved.version, rules: [{ id: 'X1Y', entity: 'JOB', status: 'NOPE', days: 0, rule: '' }] }).expect(400);
    expect(bad.body.errors).toEqual(expect.arrayContaining(['Rule 1: JOB has no status NOPE', 'Rule 1: days must be a whole number from 1 to 3650']));

    const pbc = snap.streams.find((s: { id: string }) => s.id === 'PBC');
    const stream = (await send('put', '/workflow/streams/PBC', { version: pbc.version, docSet: [...pbc.docSet, 'Monthly availability report'] }).expect(200)).body;
    expect(stream.docSet).toContain('Monthly availability report');
  });

  it('changes only this organisation’s workflow', async () => {
    const def = (await http.get(`${API}/config`).set('Cookie', await login(app, 'rahim')).expect(200)).body;
    const dispatch = def.jobTransitions.find((r: { from: string }) => r.from === 'REGISTERED');
    expect(dispatch.roles).toEqual(['STORES']);
    expect(dispatch.requires.map((f: { key: string }) => f.key)).not.toContain('binNo');
  });

  it('is limited to ADMIN and QUALITY', async () => {
    await get('/workflow', await as('rahim')).expect(403);
    await get('/workflow', await as('aisyah')).expect(200);
  });
});
