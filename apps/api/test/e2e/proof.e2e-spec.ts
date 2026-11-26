import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createApp, login } from './app';

const API = '/api/v1';
// Created with `tenants-cli create fm --pack facilities --demo`.
const HOST = 'fm.test';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 2)]);
const PDF = Buffer.from('%PDF-1.4\n%test\n');

describe('Proof of work: photo and signature steps (integration)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  const cookies: Record<string, string> = {};
  const as = async (u: string) => (cookies[u] ??= await login(app, u, undefined, HOST));
  const send = async (method: 'post' | 'patch', path: string, body: object, user: string) =>
    http[method](`${API}${path}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web').send(body);
  const upload = async (jobId: string, buf: Buffer, filename: string, contentType: string, fields: Record<string, string>, user = 'technician') => {
    let req = http.post(`${API}/attachments/job/${jobId}`).set('Host', HOST).set('Cookie', await as(user)).set('X-Requested-With', 'erp-web')
      .attach('file', buf, { filename, contentType });
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req;
  };
  const newStartedJob = async () => {
    const job = (await send('post', '/jobs', { component: 'AHU 9', partNo: 'Trane', serialNo: 'AHU-09', category: 'HVAC', originUnit: 'Level 9', repairUnit: 'HQ' }, 'helpdesk')).body;
    expect((await send('patch', `/jobs/${job.id}/transition`, { to: 'ASSIGNED', fields: { assignee: 'u-technician' } }, 'helpdesk')).status).toBe(200);
    expect((await send('patch', `/jobs/${job.id}/transition`, { to: 'IN_PROGRESS', fields: {} }, 'technician')).status).toBe(200);
    return job.id as string;
  };

  beforeAll(async () => {
    ({ app } = await createApp());
    http = request(app.getHttpServer());
  });
  afterAll(() => app.close());

  it('needs a photo and a signature on this job before work is completed', async () => {
    const id = await newStartedJob();
    const other = await newStartedJob();
    const base = { workDone: 'Replaced belt', rootCause: 'Worn belt' };

    const missing = await send('patch', `/jobs/${id}/transition`, { to: 'COMPLETED', fields: base }, 'technician');
    expect(missing.body.message).toContain('Mandatory fields missing: Photo of the completed work, Requester sign-off');

    expect((await upload(id, PDF, 'report.pdf', 'application/pdf', { kind: 'photo' })).body.message).toBe('A photo must be an image');
    expect((await upload(id, PNG, 'sig.png', 'image/png', { kind: 'signature' })).body.message).toContain('name of the person signing');
    expect((await upload(id, JPEG, 'sig.jpg', 'image/jpeg', { kind: 'signature', signedBy: 'Siti Aminah' })).body.message).toBe('A signature must be a PNG image');

    const photo = (await upload(id, JPEG, 'after.jpg', 'image/jpeg', { kind: 'photo', caption: 'Belt replaced' })).body;
    expect(photo).toEqual(expect.objectContaining({ kind: 'photo', caption: 'Belt replaced' }));
    const otherPhoto = (await upload(other, JPEG, 'other.jpg', 'image/jpeg', { kind: 'photo' })).body;
    const sig = (await upload(id, PNG, 'signature.png', 'image/png', { kind: 'signature', signedBy: 'Siti Aminah' })).body;
    expect(sig).toEqual(expect.objectContaining({ kind: 'signature', signedBy: 'Siti Aminah' }));
    const file = (await upload(id, PDF, 'report.pdf', 'application/pdf', {})).body;

    const wrong = await send('patch', `/jobs/${id}/transition`, {
      to: 'COMPLETED', fields: { ...base, photoAfter: otherPhoto.id, requesterSignature: photo.id },
    }, 'technician');
    expect(wrong.status).toBe(400);
    expect(wrong.body.errors).toEqual([
      'Photo of the completed work: attach the photo to this record first',
      "Requester sign-off: must be a signature with the signer's name",
    ]);
    expect((await send('patch', `/jobs/${id}/transition`, { to: 'COMPLETED', fields: { ...base, photoAfter: file.id, requesterSignature: sig.id } }, 'technician')).body.message)
      .toBe('Photo of the completed work: must be a photo');

    const done = await send('patch', `/jobs/${id}/transition`, { to: 'COMPLETED', fields: { ...base, photoAfter: photo.id, requesterSignature: sig.id } }, 'technician');
    expect(done.status).toBe(200);
    const step = done.body.audit.find((a: { action: string }) => a.action.startsWith('Status → COMPLETED'));
    expect(step.fields).toEqual(expect.objectContaining({ photoAfter: 'photo after.jpg', requesterSignature: 'signed by Siti Aminah' }));
    const actions = done.body.audit.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['Photo added: Belt replaced', 'Signature added (signed by Siti Aminah)']));
  });

  it('checks numbers in typed fields', async () => {
    const id = await newStartedJob();
    const bad = await send('patch', `/jobs/${id}/transition`, { to: 'ON_HOLD_PARTS', fields: { partDescription: 'Belt', qty: 'two' } }, 'technician');
    expect(bad.body.message).toBe('Quantity: must be a number');
    expect((await send('patch', `/jobs/${id}/transition`, { to: 'ON_HOLD_PARTS', fields: { partDescription: 'Belt', qty: '2' } }, 'technician')).status).toBe(200);
  });
});
