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

  // First, before any request has loaded an organisation's settings.
  it('runs preventive maintenance from the timer for every organisation', async () => {
    const { SchedulerService } = await import('../../src/scheduler/scheduler.service');
    const { PmService } = await import('../../src/assets/pm.service');
    const failures: string[] = [];
    const scheduler = app.get(SchedulerService);
    const log = (scheduler as unknown as { log: { error: (m: string) => void } }).log;
    const original = log.error.bind(log);
    log.error = (m: string) => { failures.push(m); };
    try {
      await scheduler.forEachTenant('pm', () => app.get(PmService).generateDue());
    } finally {
      log.error = original;
    }
    expect(failures).toEqual([]);
  });

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

  describe('assets, meters and preventive maintenance', () => {
    it('lists the demo fleet with odometers', async () => {
      const fleet = (await get('/assets').then(st(200))).body;
      expect(fleet).toHaveLength(6);
      expect(fleet[0].meters[0]).toEqual(expect.objectContaining({ key: 'ODOMETER', unit: 'km' }));
      expect((await get('/pm/schedules').then(st(200))).body.length).toBe(6);
    });

    it('raises a service when the odometer comes within reach, and rolls it forward when done', async () => {
      const bad = await send('post', '/assets', { tag: 'VAN 9', name: 'Van 9', type: 'SUBMARINE', site: 'HQ' }, 'supervisor');
      expect(bad.body.errors).toContain('Unknown asset type SUBMARINE');
      expect((await send('post', '/assets', { tag: 'VAN 9', name: 'Van 9', type: 'VAN', site: 'HQ' }, 'technician')).status).toBe(403);
      const van = (await send('post', '/assets', {
        tag: 'WXY 9009', name: 'Van WXY 9009', type: 'VAN', site: 'NORTH', make: 'Toyota', model: 'Hiace',
        meters: [{ key: 'ODOMETER', label: 'Odometer', unit: 'km', value: 20000 }],
      }, 'supervisor').then(st(201))).body;
      expect((await send('post', '/assets', { tag: 'WXY 9009', name: 'Dup', type: 'VAN', site: 'HQ' }, 'supervisor')).status).toBe(409);

      const pm = (await send('post', '/pm/schedules', {
        assetId: van.id, title: '10 000 km service', meterKey: 'ODOMETER', intervalMeter: 10000, leadMeter: 500,
        jobType: 'PREVENTIVE', category: 'SERVICE', checklist: [{ label: 'Engine oil and filter' }, { label: 'Brakes checked' }],
      }, 'supervisor').then(st(201))).body;
      expect(pm).toEqual(expect.objectContaining({ nextDueMeter: 30000, openJobId: null }));

      const reading = (v: number, extra: object = {}) => send('post', `/assets/${van.id}/meters/ODOMETER/readings`, { value: v, ...extra }, 'technician');
      expect((await reading(19000)).body.message).toContain('below the last one');
      expect((await reading(25000).then(st(201))).body.raised).toEqual([]);
      const due = (await reading(29600).then(st(201))).body;
      expect(due.raised).toHaveLength(1);
      expect((await reading(29700).then(st(201))).body.raised).toEqual([]); // one open job per cycle

      const jobId = due.raised[0];
      const job = (await get(`/jobs/${jobId}`).then(st(200))).body;
      expect(job).toEqual(expect.objectContaining({ assetId: van.id, pmScheduleId: pm.id, jobType: 'PREVENTIVE', status: 'OPEN', component: 'Van WXY 9009', repairUnit: 'NORTH' }));
      expect(job.checklist.map((c: { label: string }) => c.label)).toEqual(['Engine oil and filter', 'Brakes checked']);

      await move(jobId, 'ASSIGNED', { assignee: 'Ravi' }, 'helpdesk').then(st(200));
      // The odometer entered when work starts goes onto the vehicle — and may not go backwards.
      expect((await move(jobId, 'IN_PROGRESS', { odometer: '100' }, 'technician')).status).toBe(400);
      await move(jobId, 'IN_PROGRESS', { odometer: '29750' }, 'technician').then(st(200));
      expect((await get(`/assets/${van.id}`)).body.meters[0].value).toBe(29750);
      await move(jobId, 'INSPECTION', { workDone: 'Serviced' }, 'technician').then(st(200));
      const blocked = await move(jobId, 'COMPLETED', { roadTestBy: 'Farid', inspectionRef: 'RT-9' }, 'supervisor');
      expect(blocked.body.message).toBe('Checklist incomplete: Engine oil and filter; Brakes checked');

      await send('patch', `/jobs/${jobId}/checklist`, { items: [{ key: 'c1', done: true }, { key: 'c2', done: true, note: 'Pads 60%' }] }, 'technician').then(st(200));
      await move(jobId, 'COMPLETED', { roadTestBy: 'Farid', inspectionRef: 'RT-9' }, 'supervisor').then(st(200));
      const rolled = (await get(`/pm/schedules/${pm.id}`).then(st(200))).body;
      expect(rolled).toEqual(expect.objectContaining({ openJobId: null, lastDoneMeter: 29750, nextDueMeter: 39750 }));

      const history = (await get(`/assets/${van.id}`)).body;
      expect(history.jobs.map((j: { id: string }) => j.id)).toContain(jobId);
      const readings = (await get(`/assets/${van.id}/meters/ODOMETER/readings`).then(st(200))).body;
      expect(readings[0]).toEqual(expect.objectContaining({ value: 29750, source: `job:${jobId}` }));
    });

    it('raises calendar maintenance when it falls due, and can skip a cycle with a reason', async () => {
      const [asset] = (await get('/assets?q=FL03').then(st(200))).body;
      const today = new Date().toISOString().slice(0, 10);
      const pm = (await send('post', '/pm/schedules', { assetId: asset.id, title: 'Weekly LPG check', intervalDays: 7, leadDays: 0, firstDue: today }, 'supervisor').then(st(201))).body;
      expect(pm.openJobId).toMatch(/^JC-/);
      expect((await send('post', `/pm/schedules/${pm.id}/skip`, { reason: 'Off hire' }, 'supervisor')).status).toBe(400);
      const later = (await send('post', '/pm/schedules', { assetId: asset.id, title: 'Annual LOLER exam', intervalDays: 365 }, 'supervisor').then(st(201))).body;
      expect((await send('post', `/pm/schedules/${later.id}/skip`, {}, 'supervisor')).status).toBe(400);
      const skipped = (await send('post', `/pm/schedules/${later.id}/skip`, { reason: 'Examined by insurer' }, 'supervisor').then(st(200))).body;
      expect(new Date(skipped.nextDueAt).getTime()).toBeGreaterThan(new Date(later.nextDueAt).getTime());
      const forecast = (await get('/pm/forecast?days=30').then(st(200))).body;
      expect(forecast.some((s: { id: string }) => s.id === pm.id)).toBe(true);
    });

    it('switches off with its module', async () => {
      await send('patch', '/settings/modules', { pm: false, assets: false }).then(st(200));
      expect((await get('/assets')).body.code).toBe('MODULE_OFF');
      await send('patch', '/settings/modules', { assets: true, pm: true }).then(st(200));
    });
  });
});
