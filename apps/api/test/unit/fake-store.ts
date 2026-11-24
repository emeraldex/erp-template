import {
  DEMAND_TRANSITIONS, INVOICE_STREAMS, INVOICE_TRANSITIONS, JOB_TRANSITIONS, OV_TRANSITIONS, SLA_RULES,
} from '../../src/common/workflow-config';
import type { AuditEntry, Demand, FodIncident, Invoice, Job, OvRepair, Partner, Role, Tool } from '../../src/common/types';
import type { StoreService } from '../../src/common/store.service';

/**
 * In-memory stand-in for StoreService, loaded with the shipped workflow config.
 * Lets the domain services run their real rules without a database.
 */
export class FakeStore {
  jobTransitions = structuredClone(JOB_TRANSITIONS);
  demandTransitions = structuredClone(DEMAND_TRANSITIONS);
  ovTransitions = structuredClone(OV_TRANSITIONS);
  invoiceTransitions = structuredClone(INVOICE_TRANSITIONS);
  invoiceStreams = structuredClone(INVOICE_STREAMS);
  slaRules = structuredClone(SLA_RULES);

  jobsById = new Map<string, Job>();
  demandsById = new Map<string, Demand>();
  ovsById = new Map<string, OvRepair>();
  partnersById = new Map<string, Partner>();
  invoicesById = new Map<string, Invoice>();
  fodById = new Map<string, FodIncident>();
  toolsByTag = new Map<string, Tool>();
  saves = 0;
  private seq = 0;

  audit(by: string, role: Role, action: string, fields?: Record<string, string>): AuditEntry {
    return { at: new Date().toISOString(), by, role, action, ...(fields && Object.keys(fields).length ? { fields } : {}) };
  }

  async job(id: string) { return this.jobsById.get(id) ?? null; }
  async demand(id: string) { return this.demandsById.get(id) ?? null; }
  async demandExists(id: string) { return this.demandsById.has(id); }
  async partner(id: string) { return this.partnersById.get(id) ?? null; }
  async partners() { return [...this.partnersById.values()]; }
  async invoice(id: string) { return this.invoicesById.get(id) ?? null; }
  async invoices() { return [...this.invoicesById.values()]; }
  async ovRepair(id: string) { return this.ovsById.get(id) ?? null; }
  async fodIncident(id: string) { return this.fodById.get(id) ?? null; }
  async tool(tag: string) { return this.toolsByTag.get(tag) ?? null; }

  async nextJobId() { return `PS-TEST-${++this.seq}`; }
  async nextOvId() { return `OV-TEST-${++this.seq}`; }
  async nextInvoiceId() { return `INV-TEST-${++this.seq}`; }
  async nextFodId() { return `FOD-TEST-${++this.seq}`; }
  async nextPartnerId(type: string) { return `${type === 'SUPPLIER' ? 'SUP' : 'SUB'}-TEST-${++this.seq}`; }

  newJob(j: Job) { this.jobsById.set(j.id, j); return j; }
  newDemand(d: Demand) { this.demandsById.set(d.id, d); return d; }
  newOv(o: OvRepair) { this.ovsById.set(o.id, o); return o; }
  newPartner(p: Partner) { this.partnersById.set(p.id, p); return p; }
  newInvoice(i: Invoice) { this.invoicesById.set(i.id, i); return i; }
  newFod(f: FodIncident) { this.fodById.set(f.id, f); return f; }

  async save() { this.saves++; }

  asStore(): StoreService { return this as unknown as StoreService; }
}

export const actor = (role: Role, name = `Test ${role}`) => ({ name, role });

export function makeJob(over: Partial<Job> = {}): Job {
  const now = new Date().toISOString();
  return {
    id: 'PS-2026-9001', psDate: now.slice(0, 10), component: 'Radar Receiver', partNo: 'RX-1', serialNo: 'SN-1',
    category: 'MILITARY', originUnit: 'CPU Central', repairUnit: 'CENTRAL', status: 'REGISTERED', location: 'LOGISTIC',
    receivedAt: now, statusSince: now, demandIds: [], records: [], audit: [], ...over,
  } as Job;
}

export function makeDemand(over: Partial<Demand> = {}): Demand {
  return {
    id: 'F212-2026-9001', jobId: 'PS-2026-9001', partDescription: 'RF amplifier', partNo: 'PA-1', qty: 1,
    status: 'RFQ_ISSUED', statusSince: new Date().toISOString(), raisedBy: 'Test', branch: 'CENTRAL',
    quotations: [], records: [], audit: [], ...over,
  } as Demand;
}

export function makePartner(over: Partial<Partner> = {}): Partner {
  return {
    id: 'SUP-2026-9001', name: 'Test Supplier', type: 'SUPPLIER', country: 'MY', certifications: [],
    status: 'REGISTERED', lists: ['F224'], rating: 2, nonConformances: 0, factorsEvaluated: 0, cars: [], audit: [], ...over,
  } as Partner;
}
