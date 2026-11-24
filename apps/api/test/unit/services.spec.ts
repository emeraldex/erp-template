import { BadRequestException } from '@nestjs/common';
import { DemandsService } from '../../src/demands/demands.service';
import { InvoicingService } from '../../src/invoicing/invoicing.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { RegistersService } from '../../src/registers/registers.service';
import { actor, FakeStore, makeDemand, makeJob, makePartner } from './fake-store';

const quote = (n: number) => ({ supplierId: `SUP-${n}`, supplier: `Supplier ${n}`, priceMYR: 1000 * n, eddDays: 30 });

describe('DemandsService — QP.14 minimum-three-quotations rule (FR-08)', () => {
  let store: FakeStore;
  let svc: DemandsService;
  const evaluate = { f221Ref: 'F221-1', selectedSupplierId: 'SUP-1' };

  beforeEach(() => {
    store = new FakeStore();
    svc = new DemandsService(store.asStore());
  });

  it('blocks evaluation with fewer than three quotations', async () => {
    store.newDemand(makeDemand({ quotations: [quote(1), quote(2)] }));
    await expect(svc.transition('F212-2026-9001', 'EVALUATED', evaluate, actor('PURCHASING')))
      .rejects.toThrow('minimum of three quotations (2 received)');
  });

  it('allows evaluation with three quotations', async () => {
    store.newDemand(makeDemand({ quotations: [quote(1), quote(2), quote(3)] }));
    const dm = await svc.transition('F212-2026-9001', 'EVALUATED', evaluate, actor('PURCHASING'));
    expect(dm.status).toBe('EVALUATED');
    expect(dm.evaluation).toEqual({ f221Ref: 'F221-1', selectedSupplierId: 'SUP-1' });
  });

  it('allows a local purchase (F241) with a single quotation', async () => {
    store.newDemand(makeDemand({ quotations: [quote(1)] }));
    const dm = await svc.transition('F212-2026-9001', 'EVALUATED', { ...evaluate, f241Ref: 'F241-1' }, actor('PURCHASING'));
    expect(dm.evaluation).toEqual(expect.objectContaining({ localPurchase: true, f241Ref: 'F241-1' }));
  });

  it('rejects selecting a supplier with no quotation on file', async () => {
    store.newDemand(makeDemand({ quotations: [quote(1), quote(2), quote(3)] }));
    await expect(svc.transition('F212-2026-9001', 'EVALUATED', { ...evaluate, selectedSupplierId: 'SUP-9' }, actor('PURCHASING')))
      .rejects.toThrow('Selected supplier has no quotation on file');
  });

  it('only records quotations while the RFQ is open', async () => {
    store.newDemand(makeDemand({ status: 'APPROVED' }));
    await expect(svc.addQuotation('F212-2026-9001', quote(1), actor('PURCHASING'))).rejects.toThrow(BadRequestException);
  });
});

describe('RegistersService — performance formula and CAR deregistration (FR-07)', () => {
  let store: FakeStore;
  let svc: RegistersService;

  beforeEach(() => {
    store = new FakeStore();
    svc = new RegistersService(store.asStore());
  });

  it('computes (non-conformances ÷ factors evaluated) × 100, to one decimal', () => {
    expect(svc.performance(makePartner({ nonConformances: 1, factorsEvaluated: 3 }))).toBe(33.3);
    expect(svc.performance(makePartner({ nonConformances: 2, factorsEvaluated: 8 }))).toBe(25);
    expect(svc.performance(makePartner({ nonConformances: 0, factorsEvaluated: 4 }))).toBe(0);
  });

  it('returns null when nothing has been evaluated', () => {
    expect(svc.performance(makePartner({ factorsEvaluated: 0 }))).toBeNull();
  });

  it('drops a Not-Suitable partner on the second CAR, not the first', async () => {
    store.newPartner(makePartner({ rating: 1 }));
    let p = await svc.issueCar('SUP-2026-9001', { ref: 'F516-1', reason: 'Late' }, actor('QUALITY'));
    expect(p.status).toBe('REGISTERED');
    p = await svc.issueCar('SUP-2026-9001', { ref: 'F516-2', reason: 'Late again' }, actor('QUALITY'));
    expect(p.status).toBe('DROPPED');
    expect(p.lists).toEqual([]);
  });

  it('keeps a Suitable partner registered after two CARs', async () => {
    store.newPartner(makePartner({ rating: 2 }));
    await svc.issueCar('SUP-2026-9001', { ref: 'F516-1', reason: 'x' }, actor('QUALITY'));
    const p = await svc.issueCar('SUP-2026-9001', { ref: 'F516-2', reason: 'y' }, actor('QUALITY'));
    expect(p.status).toBe('REGISTERED');
  });

  it('enforces the selection sequence: evaluate → JTP approve → register', async () => {
    store.newPartner(makePartner({ status: 'APPLIED', lists: [] }));
    await expect(svc.register('SUP-2026-9001', { lists: [] }, actor('QUALITY'))).rejects.toThrow('Registration follows JTP approval');
    await svc.evaluate('SUP-2026-9001', { evaluationRef: 'F225-1' }, actor('QUALITY'));
    await svc.jtpApprove('SUP-2026-9001', { minuteRef: 'JTP-1' }, actor('QUALITY'));
    const p = await svc.register('SUP-2026-9001', { lists: [] }, actor('QUALITY'));
    expect(p.status).toBe('REGISTERED');
    expect(p.lists).toEqual(['F224']);
    expect(p.nextReassessment).toMatch(/^\d{4}-03-31$/);
  });
});

describe('InvoicingService — GST and stream gates (FR-13 / FR-14)', () => {
  let store: FakeStore;
  let svc: InvoicingService;

  beforeEach(() => {
    store = new FakeStore();
    svc = new InvoicingService(store.asStore());
    store.newJob(makeJob({ id: 'PS-1', status: 'SERVICEABLE' }));
  });

  it('drafts an invoice with 6% GST and links it to the job', async () => {
    const inv = await svc.create({ stream: 'BRANCH_REPAIR', jobId: 'PS-1', amountMYR: 23400 }, actor('PCE'));
    expect(inv).toEqual(expect.objectContaining({ amountMYR: 23400, gstRate: 6, gstMYR: 1404, totalMYR: 24804, status: 'DRAFTED' }));
    expect(store.jobsById.get('PS-1')!.invoiceIds).toEqual([inv.id]);
  });

  it('requires a job for per-job streams', async () => {
    await expect(svc.create({ stream: 'BRANCH_REPAIR' }, actor('PCE'))).rejects.toThrow('jobId required');
  });

  it('recomputes GST when the tax invoice amount is entered', async () => {
    const inv = await svc.create({ stream: 'BRANCH_REPAIR', jobId: 'PS-1', amountMYR: 100 }, actor('PCE'));
    await svc.transition(inv.id, 'CERTIFIED', { customerSignRef: 'S-1', ctcRef: 'CTC-1' }, actor('BILLING'));
    const raised = await svc.transition(inv.id, 'TAX_RAISED', { f311Ref: 'F311-1', amountMYR: '1234.567' }, actor('BILLING'));
    expect(raised).toEqual(expect.objectContaining({ gstMYR: 74.07, totalMYR: 1308.64 }));
  });

  it('blocks ACD submission until keyed into the Sales Performance Report', async () => {
    const inv = await svc.create({ stream: 'ACD', jobId: 'PS-1', amountMYR: 1000 }, actor('PCE'));
    Object.assign(store.invoicesById.get(inv.id)!, { status: 'CORRECTNESS_CHECK' });
    await expect(svc.transition(inv.id, 'SUBMITTED', { correctnessBy: 'QA' }, actor('BILLING'))).rejects.toThrow('salesPerfRef');
    const ok = await svc.transition(inv.id, 'SUBMITTED', { correctnessBy: 'QA', salesPerfRef: 'SPR-1' }, actor('BILLING'));
    expect(ok.status).toBe('SUBMITTED');
  });

  it('clears the outstanding flag only on payment', async () => {
    const inv = await svc.create({ stream: 'BRANCH_REPAIR', jobId: 'PS-1', amountMYR: 100 }, actor('PCE'));
    Object.assign(store.invoicesById.get(inv.id)!, { status: 'SUBMITTED' });
    const paid = await svc.transition(inv.id, 'PAID', { paymentRef: 'PAY-1' }, actor('FINANCE'));
    expect(paid.outstanding).toBe(false);
    expect(paid.paidAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('JobsService — lifecycle guards and side effects', () => {
  let store: FakeStore;
  let svc: JobsService;

  beforeEach(() => {
    store = new FakeStore();
    svc = new JobsService(store.asStore());
  });

  it('locks a closed job against further transitions (FR-12)', async () => {
    store.newJob(makeJob({ status: 'CLOSED' }));
    await expect(svc.transition('PS-2026-9001', 'WIP', {}, actor('ADMIN'))).rejects.toThrow('editing locked');
  });

  it('raises a spares demand when a TDI routes to AWAITING_SPARE', async () => {
    store.newJob(makeJob({ status: 'TDI' }));
    const job = await svc.transition('PS-2026-9001', 'AWAITING_SPARE', { f212Ref: 'F212-X', partDescription: 'Cap kit' }, actor('WORKSHOP'));
    expect(job.demandIds).toEqual(['F212-X']);
    expect(store.demandsById.get('F212-X')).toEqual(expect.objectContaining({ status: 'RAISED', jobId: 'PS-2026-9001' }));
  });

  it('opens an outside-vendor repair when routed to REC_OV', async () => {
    store.newJob(makeJob({ status: 'TDI' }));
    const job = await svc.transition('PS-2026-9001', 'REC_OV', { f135Ref: 'F135-1' }, actor('PCE'));
    expect(job.ovId).toBeDefined();
    expect(store.ovsById.get(job.ovId!)).toEqual(expect.objectContaining({ status: 'RECEIVED_HQ', defectReportRef: 'F135-1' }));
  });

  it('allows one open priority at a time, and requires a COL reference (FR-15)', async () => {
    store.newJob(makeJob({ status: 'WIP' }));
    await expect(svc.raisePriority('PS-2026-9001', { type: 'AOG', route: 'OV', colRef: ' ' }, actor('PCE')))
      .rejects.toThrow('COL AOG/ROA column reference is required');
    await svc.raisePriority('PS-2026-9001', { type: 'AOG', route: 'OV', colRef: 'COL-1' }, actor('PCE'));
    await expect(svc.raisePriority('PS-2026-9001', { type: 'ROA', route: 'OV', colRef: 'COL-2' }, actor('PCE')))
      .rejects.toThrow('already flagged AOG');
    const job = await svc.closePriority('PS-2026-9001', { reason: 'DELIVERED' }, actor('PCE'));
    expect(job.priority).toEqual(expect.objectContaining({ state: 'CLOSED', closeReason: 'DELIVERED' }));
  });
});
