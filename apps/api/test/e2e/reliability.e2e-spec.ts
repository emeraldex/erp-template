import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';
import { PNG } from './fixtures';

const API = '/api/v1';
const HOST = 'fm.test'; // facilities: assets, PM, completion needs a photo and a signature
jest.setTimeout(30_000);

describe('Downtime, reliability and asset import (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string, host = HOST) => (cookies[`${u}@${host}`] ??= await login(app, u, undefined, host));
  const get = async (path: string, user = 'supervisor') => http.get(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user));
  const send = async (method: 'post' | 'patch', path: string, body: object, user = 'supervisor') =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const upload = async (path: string, csv: string, user = 'supervisor') =>
    http.post(`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').attach('file', Buffer.from(csv), 'assets.csv');
  const st = (code: number) => (r: request.Response) => {
    if (r.status !== code) throw new Error(`Expected ${code}, got ${r.status}: ${JSON.stringify(r.body)}`);
    return r;
  };
  const attach = async (jobId: string, extra: Record<string, string>) => {
    let req = http.post(`${API}/attachments/job/${jobId}`).set('Host', HOST).set('Cookie', await as('technician')).set('X-Requested-With', 'erp-web')
      .attach('file', PNG, { filename: extra.kind === 'signature' ? 'sig.png' : 'after.png', contentType: 'image/png' });
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    return (await req.then(st(201))).body.id as string;
  };
  const complete = async (jobId: string) => {
    await send('patch', `/jobs/${jobId}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-technician' } }, 'helpdesk').then(st(200));
    await send('patch', `/jobs/${jobId}/transition`, { to: 'IN_PROGRESS', fields: {} }, 'technician').then(st(200));
    const photoAfter = await attach(jobId, { kind: 'photo', caption: 'After' });
    const requesterSignature = await attach(jobId, { kind: 'signature', signedBy: 'Site manager' });
    await send('patch', `/jobs/${jobId}/transition`, { to: 'COMPLETED', fields: { workDone: 'Reset the trip', rootCause: 'Overload', photoAfter, requesterSignature } }, 'technician').then(st(200));
  };
  let assetId = '';

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
    assetId = (await get('/assets')).body.find((a: { status: string }) => a.status === 'IN_SERVICE').id;
  });
  afterAll(() => app.close());

  it('records downtime from "out of action" until the work is done', async () => {
    expect((await send('post', '/jobs', { component: 'x', serialNo: 'y', category: 'ELECTRICAL', originUnit: 'z', repairUnit: 'HQ', assetDown: true }, 'helpdesk')).body.message).toBe('Say which asset is out of action');
    const job = (await send('post', '/jobs', { assetId, category: 'ELECTRICAL', originUnit: 'Level 2', assetDown: true }, 'helpdesk').then(st(201))).body;
    expect(job.assetDown).toBe(true);
    let r = (await get(`/assets/${assetId}/reliability`).then(st(200))).body;
    expect(r.down).toBe(true);
    expect(r.downtime[0]).toEqual(expect.objectContaining({ jobId: job.id, toAt: null, reason: `Out of action — ${job.id}` }));
    expect((await get(`/assets/${assetId}`)).body.status).toBe('OUT_OF_SERVICE');

    await complete(job.id);
    expect((await get(`/jobs/${job.id}`)).body.doneAt).toEqual(expect.any(String));
    r = (await get(`/assets/${assetId}/reliability`)).body;
    expect(r.down).toBe(false);
    expect(r.downtime[0].toAt).toEqual(expect.any(String));
    expect(r.failures).toBeGreaterThanOrEqual(1);
    expect(r.mttrHours).not.toBeNull();
    expect(r.availabilityPct).toBeLessThanOrEqual(100);
    expect((await get(`/assets/${assetId}`)).body.status).toBe('IN_SERVICE');
    expect(r.cost).toEqual(expect.any(Number));
    expect((await get(`/assets/${assetId}/reliability`, 'technician')).body.cost).toBeNull(); // cost includes labour
  });

  it('opens and closes downtime when an asset is put out of service and back by hand', async () => {
    await send('patch', `/assets/${assetId}`, { status: 'OUT_OF_SERVICE' }).then(st(200));
    let r = (await get(`/assets/${assetId}/reliability`)).body;
    expect(r.downtime[0]).toEqual(expect.objectContaining({ jobId: null, toAt: null, reason: 'Put out of service' }));
    await send('patch', `/assets/${assetId}`, { status: 'IN_SERVICE' }).then(st(200));
    r = (await get(`/assets/${assetId}/reliability`)).body;
    expect(r.downtime[0].toAt).toEqual(expect.any(String));
  });

  it('remembers when preventive work was due', async () => {
    const raised = (await send('post', '/pm/run', {}, 'admin').then(st(200))).body.raised as string[];
    const all = (await get('/jobs')).body as { id: string; pmScheduleId?: string; pmDueAt?: string }[];
    const pm = all.filter((j) => j.pmScheduleId && raised.includes(j.id));
    for (const j of pm) expect(j.pmDueAt).toEqual(expect.any(String));
  });

  it('reports reliability by asset, type and site, for supervisors and managers', async () => {
    const today = new Date().toISOString().slice(0, 10);
    expect((await get(`/reports/reliability?from=2026-01-01&to=${today}&format=csv`, 'technician')).status).toBe(403);
    const csv = (await get(`/reports/reliability?from=2026-01-01&to=${today}&format=csv`).then(st(200))).text;
    expect(csv.split('\r\n')[0]).toBe('﻿Tag,Name,Type,Site,Criticality,Failures,Downtime (h),Availability %,MTTR (h),MTBF (h),PM due,PM on time,PM compliance %,Cost (MYR)');
    const tag = (await get(`/assets/${assetId}`)).body.tag as string;
    const line = csv.split('\r\n').find((l) => l.startsWith(`${tag},`))!;
    expect(Number(line.split(',')[5])).toBeGreaterThanOrEqual(1);
    const xlsx = await get(`/reports/reliability?from=2026-01-01&to=${today}`).then(st(200));
    expect(xlsx.headers['content-type']).toContain('spreadsheetml');
  });

  it('shows assets out of action and preventive compliance on the dashboard', async () => {
    const k = (await get('/dashboard/kpis', 'admin').then(st(200))).body;
    expect(typeof k.assetsDown).toBe('number');
    expect(k.pmCompliance90).toEqual(expect.objectContaining({ due: expect.any(Number), onTime: expect.any(Number) }));
    const acme = await http.get(`${API}/dashboard/kpis`).set('Host', 'acme.test').set('Cookie', await as('aisyah', 'acme.test'));
    expect(acme.body.assetsDown).toBeNull();
  });

  describe('asset import', () => {
    const header = 'tag,name,type,site,location,make,model,serialNo,criticality,status,parentTag,commissionedOn,meterKey,meterLabel,meterUnit,meterValue';

    it('checks every row: types, sites, new assets\' names, parents and loops', async () => {
      const bad = [
        header,
        'IMP-CH1,Chiller 1,CHILLER,Head office tower,,,,,HIGH,,,2024-03-01,RUNHRS,Run hours,h,1200',
        'IMP-CH2,,CHILLER,HQ,,,,,,,,,,,,',
        'IMP-X,Thing,SPACESHIP,HQ,,,,,,,,,,,,',
        'IMP-P1,Pump 1,PUMP,HQ,,,,,,,IMP-NOPE,,,,,',
        'IMP-L1,Loop 1,PUMP,HQ,,,,,,,IMP-L2,,,,,',
        'IMP-L2,Loop 2,PUMP,HQ,,,,,,,IMP-L1,,,,,',
        'IMP-CH1,Again,CHILLER,HQ,,,,,,,,,,,,',
      ].join('\n');
      expect((await upload('/assets/import?dryRun=1', bad, 'technician')).status).toBe(403);
      const dry = (await upload('/assets/import?dryRun=1', bad).then(st(200))).body;
      expect(dry.errors).toEqual([
        { row: 3, message: 'IMP-CH2 is new — give its name' },
        { row: 4, message: 'Unknown type "SPACESHIP"' },
        { row: 5, message: 'Parent IMP-NOPE is not in the register or the file' },
        { row: 6, message: 'IMP-L1: its parents loop back to it' },
        { row: 7, message: 'IMP-L2: its parents loop back to it' },
        { row: 8, message: 'IMP-CH1 is already on row 2' },
      ]);
      expect((await upload('/assets/import', bad)).status).toBe(400);
      expect((await get('/assets?q=IMP-')).body).toEqual([]);
    });

    it('imports parents and children in one file, with meters, and updates by tag', async () => {
      const good = [
        header,
        'IMP-AHU1,AHU 1 fan,AHU,HQ,Plant room,,,,,,IMP-PLANT,,,,,',
        'IMP-PLANT,Plant room,AHU,Head office tower,Level 1,Daikin,AHU-X,SN-1,high,in service,,2023-01-15,RUNHRS,Run hours,h,"1,250"',
      ].join('\n');
      const dry = (await upload('/assets/import?dryRun=1', good).then(st(200))).body;
      expect(dry).toEqual({ dryRun: true, rows: 2, created: ['IMP-AHU1', 'IMP-PLANT'], updated: [], meters: 1, errors: [] });
      await upload('/assets/import', good).then(st(200));
      const list = (await get('/assets?q=IMP-')).body as { id: string; tag: string; parentId: string | null; criticality: string; meters: { key: string; value: number }[] }[];
      const plant = list.find((a) => a.tag === 'IMP-PLANT')!;
      const ahu = list.find((a) => a.tag === 'IMP-AHU1')!;
      expect(ahu.parentId).toBe(plant.id);
      expect(plant).toEqual(expect.objectContaining({ criticality: 'HIGH', meters: [expect.objectContaining({ key: 'RUNHRS', value: 1250 })] }));

      const again = (await upload('/assets/import', [header, 'IMP-AHU1,AHU 1 supply fan,,,,,,,LOW,,,,,,,'].join('\n')).then(st(200))).body;
      expect(again.updated).toEqual(['IMP-AHU1']);
      expect((await get(`/assets/${ahu.id}`)).body).toEqual(expect.objectContaining({ name: 'AHU 1 supply fan', criticality: 'LOW', parentId: plant.id }));
    });
  });
});
