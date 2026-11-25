import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';

const API = '/api/v1';
// The fleet organisation was created with `tenants-cli create fleet --pack fleet --demo`.
const HOST = 'fleet.test';

describe('Any sector: a fleet operator on the fleet pack (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (user: string) => (cookies[user] ??= await login(app, user, undefined, HOST));
  const get = async (path: string, user = 'admin') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch' | 'put', path: string, body: object, user = 'admin') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  /** Expect a status, showing the body when it differs (the API explains itself). */
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const move = (id: string, to: string, fields: Record<string, string>, user: string) => send('patch', `/jobs/${id}/transition`, { to, fields }, user);

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('serves the fleet vocabulary, statuses and modules', async () => {
    const cfg = (await get('/config').then(st(200))).body;
    expect(cfg.pack).toEqual({ id: 'fleet', name: 'Fleet & vehicles' });
    expect(cfg.terms).toEqual(expect.objectContaining({ job: 'Job card', component: 'Vehicle', site: 'Depot' }));
    expect(cfg.modules).toEqual(expect.objectContaining({ assets: true, pm: true, vendorRepair: true }));
    expect(Object.keys(cfg.jobStatusMeta)).toEqual(expect.arrayContaining(['OPEN', 'INSPECTION', 'CLOSED']));
    expect(cfg.jobStatusMeta.CLOSED).toEqual(expect.objectContaining({ phase: 'closed', final: true }));
    expect(cfg.dictionary.assetType.map((e: { key: string }) => e.key)).toContain('VAN');
    expect(Object.keys(cfg.priorityMeta)).toContain('VOR');
    // The aviation organisation next door is untouched.
    const aviation = (await http.get(`${API}/config`).set('Cookie', await login(app, 'rahim')).then(st(200))).body;
    expect(aviation.terms.job).toBe('Job');
    expect(Object.keys(aviation.jobStatusMeta)).toContain('AWAITING_TDI');
  });

  it('tells each person what they may do', async () => {
    const me = async (u: string) => (await get('/auth/me', u).then(st(200))).body.user.capabilities as string[];
    expect(await me('helpdesk')).toContain('jobs.register');
    expect(await me('technician')).not.toContain('jobs.register');
    expect(await me('admin')).toContain('org.admin');
  });

  it('runs a job card through the fleet workflow, raising a parts request on the way', async () => {
    const bad = await send('post', '/jobs', { component: 'Van', partNo: 'Hiace', serialNo: 'X1', category: 'MILITARY', originUnit: 'Sales', repairUnit: 'HQ' }, 'helpdesk');
    expect(bad.status).toBe(400);
    expect((await send('post', '/jobs', { component: 'Van', partNo: 'Hiace', serialNo: 'X1', category: 'SERVICE', originUnit: 'Sales', repairUnit: 'HQ' }, 'technician')).status).toBe(403);

    const job = (await send('post', '/jobs', {
      component: 'Van WXY 9001', partNo: 'Toyota Hiace', serialNo: 'WXY9001', category: 'SERVICE', originUnit: 'Deliveries', repairUnit: 'NORTH',
    }, 'helpdesk').then(st(201))).body;
    expect(job).toEqual(expect.objectContaining({ status: 'OPEN', location: 'YARD' }));
    expect(job.id).toMatch(/^JC-\d{4}-\d{4}$/);

    expect((await move(job.id, 'ASSIGNED', { assignee: 'Ravi' }, 'technician')).status).toBe(403);
    await move(job.id, 'ASSIGNED', { assignee: 'Ravi' }, 'helpdesk').then(st(200));
    const noOdo = await move(job.id, 'IN_PROGRESS', {}, 'technician');
    expect(noOdo.status).toBe(400);
    expect(noOdo.body.message).toContain('Odometer reading');
    await move(job.id, 'IN_PROGRESS', { odometer: '84211' }, 'technician').then(st(200));

    const parts = (await move(job.id, 'ON_HOLD_PARTS', { partDescription: 'Brake pads (front)', qty: '1' }, 'technician').then(st(200))).body;
    expect(parts.demandIds).toHaveLength(1);
    const demand = (await get(`/demands/${parts.demandIds[0]}`).then(st(200))).body;
    expect(demand).toEqual(expect.objectContaining({ status: 'RAISED', partDescription: 'Brake pads (front)', jobId: job.id }));

    await move(job.id, 'IN_PROGRESS', {}, 'technician').then(st(200));
    await move(job.id, 'INSPECTION', { workDone: 'Replaced front pads' }, 'technician').then(st(200));
    await move(job.id, 'COMPLETED', { roadTestBy: 'Farid', inspectionRef: 'RT-1' }, 'supervisor').then(st(200));
    const closed = (await move(job.id, 'CLOSED', { signedOffBy: 'Daniel' }, 'manager').then(st(200))).body;
    expect(closed.status).toBe('CLOSED');
    // Final statuses lock the record, whatever they are called.
    expect((await move(job.id, 'IN_PROGRESS', { reason: 'x' }, 'supervisor')).status).toBe(400);
  });

  it('lets the administrator switch a module off', async () => {
    await send('patch', '/settings/modules', { procurement: false }).then(st(200));
    const off = await get('/demands', 'purchasing');
    expect(off.status).toBe(403);
    expect(off.body.code).toBe('MODULE_OFF');
    expect((await send('patch', '/settings/modules', { pm: true, assets: false })).status).toBe(400);
    await send('patch', '/settings/modules', { procurement: true }).then(st(200));
    await get('/demands', 'purchasing').then(st(200));
  });

  it('lets the administrator decide what each role may do', async () => {
    const snap = (await get('/workflow').then(st(200))).body;
    const roles = snap.dictionaries.role;
    const granted = roles.entries.map((r: { key: string; meta: { capabilities: string[] } }) =>
      (r.key === 'TECHNICIAN' ? { ...r, meta: { capabilities: [...r.meta.capabilities, 'jobs.register'] } } : r));

    // Only administrators change access, not workflow editors.
    expect((await send('put', '/workflow/roles', { version: roles.version, entries: granted }, 'manager')).status).toBe(403);
    const dropped = await send('put', '/workflow/roles', { version: roles.version, entries: granted.filter((r: { key: string }) => r.key !== 'FINANCE') });
    expect(dropped.body.errors).toContain("FINANCE can't be deleted because records may use it — mark it inactive instead");
    const bogus = await send('put', '/workflow/roles', { version: roles.version, entries: [...granted, { key: 'X', label: 'X', meta: { capabilities: ['launch.rockets'] } }] });
    expect(bogus.body.errors).toContain('Entry 9: unknown permission launch.rockets');

    await send('put', '/workflow/roles', { version: roles.version, entries: granted }).then(st(200));
    const job = await send('post', '/jobs', { component: 'Forklift FL-09', partNo: '8FD25', serialNo: 'FL09', category: 'SERVICE', originUnit: 'Warehouse', repairUnit: 'HQ' }, 'technician');
    expect(job.status).toBe(201);
  });

  it('lets workflow editors grow their own lists and words', async () => {
    const snap = (await get('/workflow', 'manager').then(st(200))).body;
    const cats = snap.dictionaries.category;
    const entries = [...cats.entries, { key: 'EV_BATTERY', label: 'EV battery', labelMs: 'Bateri EV' }];
    expect((await send('put', '/workflow/dictionary/category', { version: cats.version, entries }, 'supervisor')).status).toBe(403);
    await send('put', '/workflow/dictionary/category', { version: cats.version, entries }, 'manager').then(st(200));
    await send('post', '/jobs', { component: 'Car VBC 1', partNo: 'BYD Atto 3', serialNo: 'VBC1', category: 'EV_BATTERY', originUnit: 'Sales', repairUnit: 'HQ' }, 'helpdesk')
      .then(st(201));

    const statuses = snap.dictionaries['status:JOB'];
    const noFinal = statuses.entries.map((s: { meta: object }) => ({ ...s, meta: { ...s.meta, final: false } }));
    expect((await send('put', '/workflow/dictionary/status:JOB', { version: statuses.version, entries: noFinal }, 'manager')).body.errors)
      .toContain('At least one active status must be final (closed)');

    await send('patch', '/settings/terms', { job: 'Work order', component: 'Vehicle / plant' }).then(st(200));
    expect((await get('/config').then(st(200))).body.terms).toEqual(expect.objectContaining({ job: 'Work order', component: 'Vehicle / plant' }));
  });
});
