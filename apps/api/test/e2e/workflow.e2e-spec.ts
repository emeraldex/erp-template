import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';

const API = '/api/v1';

describe('Workflow over HTTP (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const as = async (user: string) => {
    const cookie = await login(app, user);
    return {
      get: (p: string) => http.get(`${API}${p}`).set('Cookie', cookie),
      post: (p: string, b: object) => http.post(`${API}${p}`).set('Cookie', cookie).set('X-Requested-With', 'erp-web').send(b),
      patch: (p: string, b: object) => http.patch(`${API}${p}`).set('Cookie', cookie).set('X-Requested-With', 'erp-web').send(b),
    };
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('registers a job, gates each stage by role, and persists the audit trail', async () => {
    const stores = await as('rahim');
    const workshop = await as('meiling');

    const created = await stores.post('/jobs', {
      component: 'Integration Test LRU', partNo: 'IT-1', serialNo: 'SN-IT-1', category: 'MILITARY', originUnit: 'CPU Central', repairUnit: 'CENTRAL',
    }).expect(201);
    const id = created.body.id;

    const denied = await workshop.patch(`/jobs/${id}/transition`, { to: 'AWAITING_TDI', fields: { f219Ref: 'F219-IT' } }).expect(403);
    expect(denied.body.message).toMatch(/Stage owned by: STORES/);

    await stores.patch(`/jobs/${id}/transition`, { to: 'AWAITING_TDI', fields: {} }).expect(400);
    await stores.patch(`/jobs/${id}/transition`, { to: 'AWAITING_TDI', fields: { f219Ref: 'F219-IT' } }).expect(200);
    await workshop.patch(`/jobs/${id}/transition`, { to: 'TDI', fields: { f116Ref: 'F116-IT', findings: 'PSU drift' } }).expect(200);

    const job = (await stores.get(`/jobs/${id}`).expect(200)).body;
    expect(job.status).toBe('TDI');
    expect(job.location).toBe('BAY');
    expect(job.records.map((r: { formNo: string }) => r.formNo)).toEqual(['F219', 'F116']);
    expect(job.audit.map((a: { role: string }) => a.role)).toEqual(['STORES', 'STORES', 'WORKSHOP']);
  });

  it('only lets ADMIN or QUALITY change an SLA timer, and the change takes effect', async () => {
    const stores = await as('rahim');
    const admin = await as('aisyah');
    await stores.patch('/config/sla/SLA-TDI', { days: 3 }).expect(403);
    await admin.patch('/config/sla/SLA-TDI', { days: 3 }).expect(200);
    const cfg = (await stores.get('/config').expect(200)).body;
    expect(cfg.slaRules.find((r: { id: string }) => r.id === 'SLA-TDI').days).toBe(3);
  });

  it('serves dashboard KPIs from the database', async () => {
    const admin = await as('aisyah');
    const k = (await admin.get('/dashboard/kpis').expect(200)).body;
    expect(k.openJobs).toBeGreaterThan(0);
    expect(Array.isArray(k.byStatus)).toBe(true);
  });
});
