import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { Database } from '../../src/tenancy/database';
import { TenantRegistry } from '../../src/tenancy/tenant-registry';
import { SchedulerService } from '../../src/scheduler/scheduler.service';
import { createApp, login, PASSWORD } from './app';

const API = '/api/v1';
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(512, 'x')]);

describe('Multi-tenancy: one schema per client organisation', () => {
  let app: INestApplication;
  let db: Database;
  let http: ReturnType<typeof request>;
  const at = (host: string, cookie?: string) => ({
    get: (p: string) => { const r = http.get(`${API}${p}`).set('Host', host); return cookie ? r.set('Cookie', cookie) : r; },
    post: (p: string, b: object) => {
      const r = http.post(`${API}${p}`).set('Host', host).set('X-Requested-With', 'erp-web');
      return (cookie ? r.set('Cookie', cookie) : r).send(b);
    },
    patch: (p: string, b: object) => http.patch(`${API}${p}`).set('Host', host).set('X-Requested-With', 'erp-web').set('Cookie', cookie!).send(b),
  });

  beforeAll(async () => {
    ({ app } = await createApp());
    db = app.get(Database);
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('resolves the organisation from the address, or from the page that sent the request', async () => {
    expect((await http.get(`${API}/tenant`).set('Host', 'acme.test')).body).toEqual({ id: 'acme', name: 'Acme Aero' });
    expect((await http.get(`${API}/tenant`).set('Host', 'beta.test')).body).toEqual({ id: 'beta', name: 'Beta Engineering' });
    expect((await http.get(`${API}/tenant`).set('Host', 'ACME.TEST:443')).body.id).toBe('acme');
    expect((await http.get(`${API}/tenant`).set('Host', 'api.internal').set('Origin', 'http://acme.test:3000')).body.id).toBe('acme');
    expect((await http.get(`${API}/tenant`).set('Host', 'elsewhere.test')).body.id).toBe('default');
  });

  it('keeps each organisation’s users and records apart', async () => {
    // The demo user exists in default and acme, not in beta (which only has its admin).
    await http.post(`${API}/auth/login`).set('Host', 'beta.test').send({ email: 'aisyah@company.example', password: PASSWORD }).expect(401);

    const acme = at('acme.test', await login(app, 'rahim', PASSWORD, 'acme.test'));
    const created = (await acme.post('/jobs', {
      component: 'Acme Only LRU', partNo: 'A', serialNo: 'S', category: 'NAS', originUnit: 'Acme Unit', repairUnit: 'CENTRAL',
    }).expect(201)).body;

    const acmeJobs = (await acme.get('/jobs').expect(200)).body;
    const defJobs = (await at('localhost', await login(app, 'rahim')).get('/jobs').expect(200)).body;
    expect(acmeJobs.some((j: { component: string }) => j.component === 'Acme Only LRU')).toBe(true);
    expect(defJobs.some((j: { component: string }) => j.component === 'Acme Only LRU')).toBe(false);
    expect(created.id).toMatch(/^PS-\d{4}-\d{4}$/); // numbered within acme's own sequence

    const counts = await db.pool.query(
      `SELECT (SELECT count(*) FROM t_acme.jobs WHERE component = 'Acme Only LRU') AS acme,
              (SELECT count(*) FROM public.jobs WHERE component = 'Acme Only LRU') AS def,
              (SELECT count(*) FROM t_beta.jobs) AS beta`,
    );
    expect(counts.rows[0]).toEqual({ acme: '1', def: '0', beta: '0' });
  });

  it('rejects a session at another organisation’s address, by cookie or token', async () => {
    const acmeCookie = await login(app, 'aisyah', PASSWORD, 'acme.test');
    const res = await at('localhost', acmeCookie).get('/jobs').expect(401);
    expect(res.body.message).toBe('Session belongs to another organisation');
    const token = (await http.post(`${API}/auth/login`).set('Host', 'localhost')
      .send({ email: 'aisyah@company.example', password: PASSWORD, tokenInBody: true })).body.token;
    await http.get(`${API}/jobs`).set('Host', 'acme.test').set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('keeps settings, tax and workflow rules per organisation', async () => {
    const acmeAdmin = at('acme.test', await login(app, 'aisyah', PASSWORD, 'acme.test'));
    const defAdmin = at('localhost', await login(app, 'aisyah'));
    await acmeAdmin.patch('/settings/tax', { label: 'SST', ratePct: 8 }).expect(200);
    await acmeAdmin.patch('/config/sla/SLA-TDI', { days: 9 }).expect(200);
    expect((await defAdmin.get('/settings').expect(200)).body.tax).toEqual({ label: 'GST', ratePct: 6 });
    const defSla = (await defAdmin.get('/config').expect(200)).body.slaRules.find((r: { id: string }) => r.id === 'SLA-TDI');
    const acmeSla = (await acmeAdmin.get('/config').expect(200)).body.slaRules.find((r: { id: string }) => r.id === 'SLA-TDI');
    expect([defSla.days, acmeSla.days]).toEqual([5, 9]);
  });

  it('starts a new organisation with one administrator who must change their password', async () => {
    const res = await http.post(`${API}/auth/login`).set('Host', 'beta.test').send({ email: 'ops@beta.test', password: 'wrong' });
    expect(res.status).toBe(401); // the temporary password was printed once by the CLI, not known here
    const rows = await db.pool.query('SELECT role, "mustChangePassword" FROM t_beta.users');
    expect(rows.rows).toEqual([{ role: 'ADMIN', mustChangePassword: true }]);
    const company = await db.pool.query(`SELECT value FROM t_beta.settings WHERE key = 'company'`);
    expect(company.rows[0].value.name).toBe('Beta Engineering');
  });

  it('stores attachments under the organisation’s own prefix', async () => {
    const cookie = await login(app, 'daniel', PASSWORD, 'acme.test');
    const up = await http.post(`${API}/attachments/job/PS-2026-0338`).set('Host', 'acme.test').set('Cookie', cookie)
      .set('X-Requested-With', 'erp-web').attach('file', PDF, { filename: 'acme.pdf', contentType: 'application/pdf' }).expect(201);
    const row = await db.pool.query('SELECT "storageKey" FROM t_acme.attachments WHERE id = $1', [up.body.id]);
    expect(row.rows[0].storageKey).toMatch(/^acme\/job\//);
    await http.get(`${API}/attachments/file/${up.body.id}`).set('Host', 'localhost').set('Cookie', await login(app, 'daniel')).expect(404);
  });

  it('runs background jobs for every organisation', async () => {
    await db.pool.query(`UPDATE t_acme.jobs SET "statusSince" = now() - interval '30 days' WHERE status = 'REGISTERED'`);
    await app.get(SchedulerService).forEachTenant('test-alerts', () => app.get(require('../../src/notifications/notifications.service').NotificationsService).runAlerts());
    const n = await db.pool.query(`SELECT count(*)::int AS c FROM t_acme.notifications`);
    expect(n.rows[0].c).toBeGreaterThan(0);
    const b = await db.pool.query(`SELECT count(*)::int AS c FROM t_beta.notifications`);
    expect(b.rows[0].c).toBe(0); // beta has no records, so nothing to alert on
  });

  it('can refuse unknown addresses, and blocks suspended organisations', async () => {
    process.env.TENANT_STRICT_HOSTS = 'true';
    try {
      await http.get(`${API}/tenant`).set('Host', 'elsewhere.test').expect(404);
      await http.get(`${API}/health`).set('Host', 'elsewhere.test').expect(200); // health needs no tenant
    } finally {
      delete process.env.TENANT_STRICT_HOSTS;
    }
    const registry = app.get(TenantRegistry);
    await db.pool.query(`UPDATE erp_control.tenants SET status = 'suspended' WHERE id = 'beta'`);
    await registry.refresh();
    try {
      expect((await http.get(`${API}/tenant`).set('Host', 'beta.test').expect(403)).body.message).toMatch(/suspended/);
    } finally {
      await db.pool.query(`UPDATE erp_control.tenants SET status = 'active' WHERE id = 'beta'`);
      await registry.refresh();
    }
  });

  it('allows credentialed CORS from a registered organisation’s web address', async () => {
    const ok = await http.options(`${API}/jobs`).set('Origin', 'http://acme.test:3000').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://acme.test:3000');
    const no = await http.options(`${API}/jobs`).set('Origin', 'http://stranger.test').set('Access-Control-Request-Method', 'GET');
    expect(no.headers['access-control-allow-origin']).toBeUndefined();
  });
});
