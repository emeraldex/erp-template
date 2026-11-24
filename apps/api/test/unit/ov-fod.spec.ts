import { OvService } from '../../src/ov/ov.service';
import { FodService } from '../../src/fod/fod.service';
import type { OvRepair } from '../../src/common/types';
import { actor, FakeStore, makeJob, makePartner } from './fake-store';

const makeOv = (over: Partial<OvRepair> = {}): OvRepair => ({
  id: 'OV-1', jobId: 'PS-2026-9001', defectReportRef: 'F135-1', am75Ref: 'AM75-1',
  status: 'RECEIVED_HQ', statusSince: new Date().toISOString(), records: [], audit: [], ...over,
} as OvRepair);

describe('OvService — outside-vendor repair (QP.33 / FR-09)', () => {
  let store: FakeStore;
  let svc: OvService;

  beforeEach(() => {
    store = new FakeStore();
    svc = new OvService(store.asStore());
    store.newJob(makeJob({ status: 'REC_OV', location: 'HQ' }));
  });

  it('records the identified vendor by name from the register', async () => {
    store.newPartner(makePartner({ id: 'SUB-1', name: 'Vector Comms Repair Centre', type: 'SUBCONTRACTOR' }));
    store.newOv(makeOv());
    const ov = await svc.transition('OV-1', 'VENDOR_IDENTIFIED', { vendorId: 'SUB-1' }, actor('PCE'));
    expect(ov).toEqual(expect.objectContaining({ vendorId: 'SUB-1', vendorName: 'Vector Comms Repair Centre' }));
    expect(store.jobsById.get('PS-2026-9001')!.audit.at(-1)!.action).toBe('OV OV-1: VENDOR_IDENTIFIED');
  });

  it('closes the job and returns the item when the customer rejects the OV request', async () => {
    store.newOv(makeOv({ status: 'F134_SUBMITTED' }));
    await svc.transition('OV-1', 'REJECTED', {}, actor('MM'));
    const job = store.jobsById.get('PS-2026-9001')!;
    expect(job).toEqual(expect.objectContaining({ status: 'CLOSED', location: 'CUSTOMER' }));
  });

  it('tracks where the item physically is', async () => {
    store.newOv(makeOv({ status: 'PO_ISSUED' }));
    await svc.transition('OV-1', 'AT_VENDOR', { f218Ref: 'F218-1' }, actor('STORES'));
    expect(store.jobsById.get('PS-2026-9001')!.location).toBe('VENDOR');
  });

  it('captures cost, EDD and the above-indent flag', async () => {
    store.newOv(makeOv({ status: 'AT_VENDOR' }));
    const ov = await svc.transition('OV-1', 'COST_ADVISED', { costMYR: '12500.50', eddDays: '30', aboveIndent: 'true', f119Ref: 'F119-1' }, actor('PCE'));
    expect(ov).toEqual(expect.objectContaining({ costMYR: 12500.5, eddDays: 30, aboveIndent: true, f119Ref: 'F119-1' }));
  });

  it('reports a missing OV record', async () => {
    await expect(svc.get('OV-404')).rejects.toThrow('OV repair OV-404 not found');
  });
});

describe('FodService — FOD incidents and tool accountability (QP.46 / FR-11)', () => {
  let store: FakeStore;
  let svc: FodService;

  beforeEach(() => {
    store = new FakeStore();
    svc = new FodService(store.asStore());
  });

  it('files an incident with sensible defaults and routes it to the focal point', async () => {
    const inc = await svc.report({ area: 'CRITICAL', location: 'Bay 2' } as never, actor('WORKSHOP', 'Mei Ling'));
    expect(inc).toEqual(expect.objectContaining({
      status: 'OPEN', area: 'CRITICAL', reporter: 'Mei Ling', partName: 'Unspecified object', focalPoint: 'Qistina Yusof',
    }));
    expect(inc.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('will not close an incident without a root cause', async () => {
    const inc = await svc.report({} as never, actor('WORKSHOP'));
    await expect(svc.updateIncident(inc.id, { status: 'CLOSED' }, actor('QUALITY'))).rejects.toThrow('Root cause is mandatory');
    const closed = await svc.updateIncident(inc.id, { status: 'CLOSED', rootCause: 'Loose washer', correctiveAction: 'Toolbox audit' }, actor('QUALITY'));
    expect(closed).toEqual(expect.objectContaining({ status: 'CLOSED', rootCause: 'Loose washer' }));
  });

  it('signs a tool out to a holder and back in', async () => {
    store.toolsByTag.set('T-1', { tag: 'T-1', name: 'Torque driver', board: 'Board A', status: 'IN', since: '' });
    expect(await svc.toolAction('T-1', 'OUT', 'Rahim', actor('STORES'))).toEqual(expect.objectContaining({ status: 'OUT', holder: 'Rahim' }));
    const back = await svc.toolAction('T-1', 'IN', undefined, actor('STORES'));
    expect(back.status).toBe('IN');
    expect(back.holder).toBeUndefined();
  });

  it('escalates a missing tool to a FOD incident', async () => {
    store.toolsByTag.set('T-2', { tag: 'T-2', name: 'Crimp tool', board: 'Board B', status: 'OUT', holder: 'X', since: '' });
    await svc.toolAction('T-2', 'MISSING', undefined, actor('STORES', 'Rahim'));
    const [incident] = [...store.fodById.values()];
    expect(incident).toEqual(expect.objectContaining({
      partName: 'Crimp tool', serialNo: 'T-2', area: 'CONTROL', location: 'Board B', discovered: 'Tool Missing Report by Rahim',
    }));
  });
});
