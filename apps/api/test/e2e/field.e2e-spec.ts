import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { pdfLines, pdfPageCount } from './pdf-text';

const API = '/api/v1';
// PDFs, images and first sign-ins (scrypt) can exceed Jest's 5 s default on a busy CI runner.
jest.setTimeout(20_000);
const HOST = 'fm.test'; // facilities pack, demo data
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const op = () => `op-${Math.random().toString(36).slice(2)}-${Date.now()}`;

describe('Field API for the phone app (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const get = async (path: string, user: string) => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch', path: string, body: object, user: string, headers: Record<string, string> = {}) => {
    let req = http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web');
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(body);
  };
  const newJob = async (site = 'HQ', extra: object = {}) =>
    (await send('post', '/jobs', { component: 'Pump 7', partNo: 'Grundfos', serialNo: `P7-${Math.random()}`, category: 'PLUMBING', originUnit: 'Level 2', repairUnit: site, ...extra }, 'helpdesk')).body.id as string;
  const ids = (list: { id: string }[]) => list.map((j) => j.id);

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('lists my work, and free work at my site that my role can take', async () => {
    const assigned = await newJob();
    const free = await newJob();
    const elsewhere = await newJob('ANNEX');
    await send('patch', `/jobs/${assigned}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-technician' } }, 'helpdesk');
    // Free at ASSIGNED: the technician owns "Start work".
    await send('patch', `/jobs/${free}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-supervisor' } }, 'helpdesk');
    await send('patch', `/jobs/${free}/assignee`, { userId: null }, 'supervisor');
    await send('patch', `/jobs/${elsewhere}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-supervisor' } }, 'helpdesk');
    await send('patch', `/jobs/${elsewhere}/assignee`, { userId: null }, 'supervisor');

    const tech = (await get('/jobs/mine', 'technician')).body;
    expect(ids(tech.mine)).toContain(assigned);
    expect(ids(tech.available)).toContain(free);
    expect(ids(tech.available)).not.toContain(elsewhere);
    expect(ids(tech.available)).not.toContain(assigned);
    const card = tech.mine.find((j: { id: string }) => j.id === assigned);
    expect(card).toEqual(expect.objectContaining({
      status: 'ASSIGNED', statusLabel: 'Assigned', site: 'HQ', assignee: { id: 'u-technician', name: 'Ravi Kumar' },
      checklist: { done: 0, total: 0 }, sla: { days: 2, overdueBy: 0 }, priority: null,
    }));
    // OPEN work belongs to the help desk, not technicians.
    const open = await newJob();
    expect(ids((await get('/jobs/mine', 'technician')).body.available)).not.toContain(open);
    expect(ids((await get('/jobs/mine', 'helpdesk')).body.available)).toContain(open);
  });

  it('gives the phone one pack per job: job, asset, steps it may take, attachments', async () => {
    const [asset] = (await get('/assets?q=CH-02', 'supervisor')).body;
    const id = await newJob('HQ', { assetId: asset.id, component: '', partNo: '', serialNo: '' });
    await send('patch', `/jobs/${id}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-technician' } }, 'helpdesk');
    const pack = (await get(`/jobs/${id}/pack`, 'technician')).body;
    expect(pack.job).toEqual(expect.objectContaining({ id, assetId: asset.id, assigneeId: 'u-technician' }));
    expect(pack.asset).toEqual(expect.objectContaining({ id: asset.id, tag: 'CH-02', meters: [] }));
    expect(pack.steps.map((s: { to: string }) => s.to)).toEqual(['IN_PROGRESS']);
    expect(pack).toEqual(expect.objectContaining({ attachments: [], locked: false, pm: null, fetchedAt: expect.any(String) }));
    // A help-desk user may take different steps from here.
    expect((await get(`/jobs/${id}/pack`, 'helpdesk')).body.steps.map((s: { to: string }) => s.to)).toEqual([]);
  });

  it('applies a resent note, photo or meter reading only once', async () => {
    const id = await newJob();
    const once = op();
    const first = await send('post', `/jobs/${id}/notes`, { text: 'Belt squeals on start' }, 'technician', { 'X-Client-Op': once });
    expect(first.status).toBe(201);
    const again = await send('post', `/jobs/${id}/notes`, { text: 'Belt squeals on start' }, 'technician', { 'X-Client-Op': once });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ duplicate: true });
    const notes = (await get(`/jobs/${id}`, 'technician')).body.audit.filter((a: { action: string }) => a.action === 'Note: Belt squeals on start');
    expect(notes).toHaveLength(1);

    // A refused change does not use up its id, so it can be fixed and resent.
    const retry = op();
    expect((await send('post', `/jobs/${id}/notes`, { text: '' }, 'technician', { 'X-Client-Op': retry })).status).toBe(400);
    expect((await send('post', `/jobs/${id}/notes`, { text: 'Now with text' }, 'technician', { 'X-Client-Op': retry })).status).toBe(201);
    expect((await send('post', `/jobs/${id}/notes`, { text: 'x' }, 'technician', { 'X-Client-Op': 'bad id!' })).status).toBe(400);

    const photoOp = op();
    const upload = async () => http.post(`${API}/attachments/job/${id}`).set('Host', HOST).set('Cookie', await as('technician'))
      .set('X-Requested-With', 'erp-web').set('X-Client-Op', photoOp).attach('file', JPEG, { filename: 'leak.jpg', contentType: 'image/jpeg' }).field('kind', 'photo');
    expect((await upload()).status).toBe(201);
    expect((await upload()).body).toEqual({ duplicate: true });
    expect((await get(`/attachments/job/${id}`, 'technician')).body).toHaveLength(1);

    const [pump] = (await get('/assets?q=PMP-05', 'supervisor')).body;
    if (!pump.meters.length) await send('post', `/assets/${pump.id}/meters`, { key: 'HOURS', label: 'Run hours', unit: 'h', value: 100 }, 'supervisor');
    const readOp = op();
    const read = () => send('post', `/assets/${pump.id}/meters/HOURS/readings`, { value: 150 }, 'technician', { 'X-Client-Op': readOp });
    expect((await read()).status).toBe(201);
    expect((await read()).body).toEqual({ duplicate: true });
    const readings = (await get(`/assets/${pump.id}/meters/HOURS/readings`, 'technician')).body;
    expect(readings.filter((r: { value: number }) => r.value === 150)).toHaveLength(1);
  });

  it('keeps when offline changes were made, within limits', async () => {
    const id = await newJob();
    await send('patch', `/jobs/${id}/checklist`, { add: [{ label: 'Check seals' }] }, 'technician');
    const hourAhead = new Date(Date.now() + 3_600_000).toISOString();
    const longAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const earlier = new Date(Date.now() - 2 * 3_600_000).toISOString();
    expect((await send('patch', `/jobs/${id}/checklist`, { items: [{ key: 'c1', done: true }], at: hourAhead }, 'technician')).body.message).toBe('at cannot be in the future');
    expect((await send('patch', `/jobs/${id}/checklist`, { items: [{ key: 'c1', done: true }], at: longAgo }, 'technician')).body.message).toContain('more than 30 days ago');
    const job = (await send('patch', `/jobs/${id}/checklist`, { items: [{ key: 'c1', done: true }], at: earlier }, 'technician')).body;
    expect(job.checklist[0]).toEqual(expect.objectContaining({ done: true, at: earlier }));
    expect(job.audit.at(-1).action).toContain('recorded offline at');
  });

  it('prints QR labels for assets, ten to a page', async () => {
    const assets = (await get('/assets', 'supervisor')).body as { id: string; tag: string }[];
    const res = await http.get(`${API}/assets/labels?ids=${assets.map((a) => a.id).join(',')}`).set('Host', HOST)
      .set('Cookie', await as('technician')).set('Origin', 'http://fm.test').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const lines = pdfLines(res.body);
    for (const a of assets) expect(lines).toContain(a.tag);
    expect(lines).toContain('Head office tower');
    expect(pdfPageCount(res.body)).toBe(Math.ceil(assets.length / 10));
    expect((await get('/assets/labels?ids=AST-0000-9999', 'technician')).status).toBe(404);
    expect((await get(`/assets/labels?ids=${Array.from({ length: 101 }, (_, i) => `A${i}`).join(',')}`, 'technician')).status).toBe(400);
  });

  it('refuses notes on closed work', async () => {
    const id = await newJob();
    await send('patch', `/jobs/${id}/transition`, { to: 'CANCELLED', fields: { reason: 'Duplicate' } }, 'helpdesk');
    expect((await send('post', `/jobs/${id}/notes`, { text: 'Late note' }, 'technician')).body.message).toContain('editing locked');
  });
});
