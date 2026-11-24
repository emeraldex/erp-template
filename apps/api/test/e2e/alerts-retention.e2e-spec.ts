import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../../src/common/prisma.service';
import { Mailer } from '../../src/notifications/mailer';
import { createApp, login } from './app';

const API = '/api/v1';
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000 - 3_600_000);

describe('SLA alerts and notifications (FR-10)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let admin: string;
  const post = (path: string, cookie: string) => http.post(`${API}${path}`).set('Cookie', cookie).set('X-Requested-With', 'erp-web');

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    http = request(app.getHttpServer());
    admin = await login(app, 'aisyah');
  });
  afterAll(() => app.close());

  it('notifies the owning role, escalates breaches to MM, emails a digest, and never repeats', async () => {
    // A job left 9 days in REGISTERED (allowance 5): STORES must dispatch it.
    const job = (await post('/jobs', await login(app, 'rahim')).send({
      component: 'Alert Probe LRU', partNo: 'AP-1', serialNo: 'SN-AP', category: 'NAS', originUnit: 'CPU Central', repairUnit: 'CENTRAL',
    }).expect(201)).body;
    await prisma.job.update({ where: { id: job.id }, data: { statusSince: daysAgo(9) } });
    const mailer = app.get(Mailer);
    mailer.outbox.length = 0;

    const first = (await post('/alerts/run', admin).expect(200)).body;
    expect(first.newAlerts).toBeGreaterThan(0);

    const stores = await login(app, 'rahim');
    const mine = (await http.get(`${API}/notifications`).set('Cookie', stores).expect(200)).body;
    const n = mine.items.find((i: { ref: string }) => i.ref === job.id);
    expect(n).toEqual(expect.objectContaining({
      kind: 'sla.breached', title: `SLA breached: ${job.id} — 4 days overdue`, link: `/jobs/${job.id}`, read: false,
    }));
    expect(n.body).toContain('Alert Probe LRU');
    expect(mine.unread).toBeGreaterThan(0);

    const mm = (await http.get(`${API}/notifications`).set('Cookie', await login(app, 'hafiz')).expect(200)).body;
    expect(mm.items.some((i: { ref: string }) => i.ref === job.id)).toBe(true);
    const workshop = (await http.get(`${API}/notifications`).set('Cookie', await login(app, 'meiling')).expect(200)).body;
    expect(workshop.items.some((i: { ref: string }) => i.ref === job.id)).toBe(false);

    const mail = mailer.outbox.find((m) => m.to === 'rahim@company.example');
    expect(mail?.subject).toMatch(/SLA alert/);
    expect(mail?.text).toContain(job.id);

    const second = (await post('/alerts/run', admin).expect(200)).body;
    expect(second.newAlerts).toBe(0);
  });

  it('marks notifications read, one or all, only for their owner', async () => {
    const stores = await login(app, 'rahim');
    const { items } = (await http.get(`${API}/notifications`).set('Cookie', stores)).body;
    await post(`/notifications/${items[0].id}/read`, admin).expect(404);
    await post(`/notifications/${items[0].id}/read`, stores).expect(200);
    await post('/notifications/read-all', stores).expect(200);
    expect((await http.get(`${API}/notifications`).set('Cookie', stores)).body.unread).toBe(0);
  });

  it('only lets ADMIN trigger a run', async () => {
    await post('/alerts/run', await login(app, 'rahim')).expect(403);
  });
});

describe('Archiving and retention (FR-12)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('archives long-closed jobs out of the active list, keeping them readable and read-only', async () => {
    const admin = await login(app, 'aisyah');
    await prisma.job.update({ where: { id: 'PS-2026-0322' }, data: { statusSince: daysAgo(400) } });
    const run = (await http.post(`${API}/retention/archive`).set('Cookie', admin).set('X-Requested-With', 'erp-web').expect(200)).body;
    expect(run.archived).toBeGreaterThanOrEqual(1);

    const active = (await http.get(`${API}/jobs`).set('Cookie', admin).expect(200)).body;
    expect(active.some((j: { id: string }) => j.id === 'PS-2026-0322')).toBe(false);
    const archived = (await http.get(`${API}/jobs?archived=only`).set('Cookie', admin).expect(200)).body;
    expect(archived.map((j: { id: string }) => j.id)).toContain('PS-2026-0322');
    const job = (await http.get(`${API}/jobs/PS-2026-0322`).set('Cookie', admin).expect(200)).body;
    expect(job.archivedAt).toBeDefined();
    expect(job.audit.length).toBeGreaterThan(0);

    const res = await http.patch(`${API}/jobs/PS-2026-0322/transition`).set('Cookie', admin).set('X-Requested-With', 'erp-web')
      .send({ to: 'WIP', fields: {} }).expect(400);
    expect(res.body.message).toMatch(/archived/);
    await http.get(`${API}/jobs?archived=sometimes`).set('Cookie', admin).expect(400);
  });

  it('reports retention dates and never deletes', async () => {
    const quality = await login(app, 'qistina');
    const csv = (await http.get(`${API}/retention/report?format=csv`).set('Cookie', quality).expect(200)).text.replace(/^﻿/, '');
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toBe('Job (PS no.),Component,Serial no.,Closed,Archived,Retain until,State');
    expect(lines.find((l) => l.startsWith('PS-2026-0322'))).toMatch(/,Archived$/);
    expect(await prisma.job.count({ where: { id: 'PS-2026-0322' } })).toBe(1);
    await http.get(`${API}/retention/report`).set('Cookie', await login(app, 'rahim')).expect(403);
  });
});
