import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { Database } from '../../src/tenancy/database';

const API = '/api/v1';
const HOST = 'fm.test'; // facilities pack: labour on; technician, supervisor, manager, helpdesk
jest.setTimeout(30_000);

describe('Labour and job cost (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string, host = HOST) => (cookies[`${u}@${host}`] ??= await login(app, u, undefined, host));
  const get = async (path: string, user = 'manager') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch' | 'put' | 'delete', path: string, body: object, user = 'manager', headers: Record<string, string> = {}) => {
    let req = http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web');
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(body);
  };
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const newJob = async () => (await send('post', '/jobs', { component: 'AHU-3 fan belt', serialNo: `AHU${Math.random()}`, category: 'HVAC', originUnit: 'Level 3', repairUnit: 'HQ' }, 'helpdesk').then(st(201))).body.id as string;
  const today = new Date().toISOString().slice(0, 10);
  let job = '';

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    job = await newJob();
  });
  afterAll(() => app.close());

  it('sets hourly rates: the organisation\'s, by role and by person', async () => {
    expect((await send('put', '/labour/rates', { defaultRate: 30 }, 'technician')).status).toBe(403);
    expect((await send('put', '/labour/rates', { roleRates: { NOBODY: 10 } })).body.message).toBe('Unknown role NOBODY');
    const r = (await send('put', '/labour/rates', { defaultRate: 30, roleRates: { TECHNICIAN: 40, SUPERVISOR: 60 } }).then(st(200))).body;
    expect(r).toEqual(expect.objectContaining({ defaultRate: 30, roleRates: { TECHNICIAN: 40, SUPERVISOR: 60 } }));
    const after = (await send('put', '/labour/people/u-technician/rate', { hourlyRate: 50 }).then(st(200))).body;
    expect(after.people.find((p: { id: string }) => p.id === 'u-technician')).toEqual(expect.objectContaining({ hourlyRate: 50, effective: 50 }));
    expect(after.people.find((p: { id: string }) => p.id === 'u-helpdesk')).toEqual(expect.objectContaining({ hourlyRate: null, effective: 30 }));
  });

  it('logs time at the rate in force, and only people who manage labour see rates and cost', async () => {
    const e = (await send('post', `/jobs/${job}/time`, { minutes: 90, note: 'Replaced belt' }, 'technician').then(st(201))).body;
    expect(e).toEqual(expect.objectContaining({ minutes: 90, userId: 'u-technician', workDate: today }));
    expect(e.rate).toBeUndefined(); // a technician does not see rates
    expect((await send('post', `/jobs/${job}/time`, { minutes: 30, userId: 'u-supervisor' }, 'technician')).status).toBe(403);
    await send('post', `/jobs/${job}/time`, { minutes: 30, userId: 'u-supervisor' }, 'supervisor').then(st(201));

    const seen = (await get(`/jobs/${job}/time`, 'helpdesk').then(st(200))).body;
    expect(seen.minutes).toBe(120);
    expect(seen.cost).toBeUndefined();
    expect(seen.entries[0].cost).toBeUndefined();
    const managed = (await get(`/jobs/${job}/time`).then(st(200))).body;
    expect(managed.cost).toBe(105); // 1.5 h × 50 + 0.5 h × 60
    expect(managed.entries.map((x: { rate: number }) => x.rate)).toEqual([50, 60]);

    // A later change of rate does not rewrite what was logged.
    await send('put', '/labour/people/u-technician/rate', { hourlyRate: 80 }).then(st(200));
    expect((await get(`/jobs/${job}/time`)).body.cost).toBe(105);
    const audit = (await get(`/jobs/${job}`)).body.audit.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining([`Time logged: 1 h 30 min by Ravi Kumar on ${today} — Replaced belt`]));
  });

  it('checks the minutes, the date and the day\'s total', async () => {
    expect((await send('post', `/jobs/${job}/time`, { minutes: 0 }, 'technician')).body.message).toBe('Time: whole minutes, from 1 minute to 24 hours');
    expect((await send('post', `/jobs/${job}/time`, { minutes: 30, workDate: '2099-01-01' }, 'technician')).body.message).toBe('Work date cannot be in the future');
    expect((await send('post', `/jobs/${job}/time`, { minutes: 30, workDate: '2026-02-30' }, 'technician')).body.message).toBe('Work date: YYYY-MM-DD');
    expect((await send('post', `/jobs/${job}/time`, { minutes: 1400 }, 'technician')).body.message).toMatch(/more than 24 hours in a day/);
  });

  it('lets people correct or remove their own time, not others\'', async () => {
    const mine = (await send('post', `/jobs/${job}/time`, { minutes: 20 }, 'technician').then(st(201))).body;
    expect((await send('patch', `/time/${mine.id}`, { minutes: 25 }, 'helpdesk')).status).toBe(403); // no labour permission
    const sup = (await send('post', `/jobs/${job}/time`, { minutes: 10 }, 'supervisor').then(st(201))).body;
    expect((await send('patch', `/time/${sup.id}`, { minutes: 15 }, 'technician')).body.message).toBe('You can change only your own time');
    expect((await send('patch', `/time/${mine.id}`, { minutes: 25 }, 'technician').then(st(200))).body.minutes).toBe(25);
    await send('delete', `/time/${mine.id}`, {}, 'technician').then(st(204));
    await send('delete', `/time/${sup.id}`, {}, 'manager').then(st(204)); // labour.manage may correct anyone's
  });

  it('applies a resent entry from a phone once', async () => {
    const op = { 'X-Client-Op': `time-${Date.now()}` };
    await send('post', `/jobs/${job}/time`, { minutes: 15 }, 'technician', op).then(st(201));
    expect((await send('post', `/jobs/${job}/time`, { minutes: 15 }, 'technician', op).then(st(200))).body).toEqual({ duplicate: true });
  });

  it('adds parts, direct purchases and labour into the job cost without counting anything twice', async () => {
    // A part issued from stock.
    const part = (await get('/stock/parts', 'stores')).body.find((p: { onHand: number }) => p.onHand >= 1);
    await send('post', '/stock/issue', { partId: part.id, store: part.levels.find((l: { qty: number }) => l.qty >= 1).store, qty: 1, jobId: job }, 'stores').then(st(201));
    // A direct purchase of something not in the catalogue, ordered at the chosen quotation's price.
    const pool = app.get(Database).pool;
    await pool.query(`INSERT INTO t_fm.demands (id, "jobId", "partDescription", "partNo", qty, status, "statusSince", "raisedBy", branch, "evalSupplierId", "poRef")
      VALUES ('DM-T-0001', $1, 'Special coupling', '-', 1, 'ORDERED', now(), 'test', 'HQ', 'SUP-X', 'PO-T-1')`, [job]);
    await pool.query(`INSERT INTO t_fm.quotations ("demandId", "supplierId", supplier, "priceMYR", "eddDays", seq) VALUES ('DM-T-0001', 'SUP-Y', 'Other', 999, 5, 1), ('DM-T-0001', 'SUP-X', 'Chosen', 210, 3, 2)`);

    const cost = (await get(`/jobs/${job}/cost`).then(st(200))).body;
    const parts = (await get(`/jobs/${job}/parts`)).body.total as number;
    expect(cost).toEqual(expect.objectContaining({ currency: 'MYR', parts, purchases: expect.objectContaining({ total: 210 }), labour: { minutes: 135, cost: 125 } })); // 90 min at 50, 30 at 60, and 15 at the later rate of 80
    expect(cost.total).toBeCloseTo(parts + 210 + 125, 2);
    const blind = (await get(`/jobs/${job}/cost`, 'technician').then(st(200))).body;
    expect(blind).toEqual(expect.objectContaining({ total: null, labour: { minutes: 135, cost: null }, totalWithoutLabour: cost.totalWithoutLabour }));
  });

  it('refuses time on a closed work order', async () => {
    const other = await newJob();
    await send('patch', `/jobs/${other}/transition`, { to: 'CANCELLED', fields: { reason: 'Duplicate' } }, 'helpdesk').then(st(200));
    expect((await send('post', `/jobs/${other}/time`, { minutes: 10 }, 'technician')).body.message).toMatch(/is closed/);
  });

  it('reports hours and cost by person and work order, for people who manage labour', async () => {
    expect((await get(`/reports/labour?from=${today}&to=${today}&format=csv`, 'technician')).status).toBe(403);
    const csv = (await get(`/reports/labour?from=${today}&to=${today}&format=csv`).then(st(200))).text;
    expect(csv.split('\r\n')[0]).toBe('﻿Person,Hours,Entries,Work orders,Cost (MYR)');
    expect(csv).toMatch(/Ravi Kumar,1\.75,2,1,95\.00/); // 90 min at 50 + 15 at 80
    expect(csv).toMatch(/TOTAL,2\.25,3,,125\.00/);
  });

  it('stays off for aviation organisations', async () => {
    const res = await http.get(`${API}/jobs/PS-2026-0001/time`).set('Host', 'acme.test').set('Cookie', await as('aisyah', 'acme.test'));
    expect(res.body.code).toBe('MODULE_OFF');
  });
});
