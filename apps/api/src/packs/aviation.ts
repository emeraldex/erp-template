import {
  DEMAND_STATUS_META, DEMAND_TRANSITIONS, INVOICE_STATUS_META, INVOICE_STREAMS, INVOICE_TRANSITIONS, JOB_STATUS_META,
  JOB_TRANSITIONS, OV_STATUS_META, OV_TRANSITIONS, PRIORITY_META, REPAIR_ROUTE_META, SLA_RULES,
} from '../common/workflow-config';
import type { Entry, Pack, Phase, StatusMeta } from './types';
import { store, UNITS } from './stock-lists';

const statuses = (meta: Record<string, { en: string; ms: string; tone: StatusMeta['tone'] }>, phases: Record<string, Phase | [Phase, Partial<StatusMeta>]>): Entry<StatusMeta>[] =>
  Object.entries(meta).map(([key, m]) => {
    const p = phases[key];
    const [phase, extra] = Array.isArray(p) ? p : [p, {}];
    return { key, label: m.en, labelMs: m.ms, meta: { tone: m.tone, phase, ...(phase === 'closed' ? { final: true } : {}), ...extra } };
  });

/**
 * Aviation MRO — the original CO-RFP-IT-001 configuration (QP.13/14/17/33/44/
 * 46/51/56): an approved maintenance organisation repairing military and
 * non-airborne components. Keys are unchanged from earlier releases.
 */
export const AVIATION: Pack = {
  id: 'aviation',
  name: 'Aviation MRO',
  description: 'Component repair for an approved maintenance organisation: tear-down inspection, spares, outside vendors, AOG/ROA priority, FOD control and multi-stream invoicing.',
  terms: {
    job: 'Job', jobs: 'Jobs', jobNo: 'PS no.', jobRegister: 'JTS Job Register', component: 'Component',
    originUnit: 'Origin unit', site: 'Branch', sites: 'Branches', demand: 'Spares demand', demands: 'Demands & Procurement',
    vendorRepair: 'Outside vendor repair', vendorRepairs: 'Outside Vendor', priority: 'AOG / ROA Priority',
    incident: 'FOD incident', incidents: 'FOD & Quality', registers: 'Suppliers & Vendors',
    asset: 'Asset', assets: 'Assets', pm: 'Preventive maintenance',
  },
  modules: {
    procurement: true, vendorRepair: true, priority: true, incidents: true, tools: true, training: true,
    invoicing: true, registers: true, assets: false, pm: false, stock: false, requests: false,
  },
  statuses: {
    JOB: statuses(JOB_STATUS_META, {
      REGISTERED: 'new', AWAITING_TDI: 'new', TDI: 'active', AWAITING_SPARE: 'waiting_parts', AWAITING_INDENT: 'waiting_customer',
      WIP: 'active', REC_OV: ['external', { branch: true }], BER: ['waiting_customer', { branch: true }], SOR: ['waiting_customer', { branch: true }], SERVICEABLE: 'done', DELIVERED: 'done', CLOSED: 'closed',
    }),
    DEMAND: statuses(DEMAND_STATUS_META, {
      RAISED: 'new', APPROVED: 'active', STOCK_CHECK: 'active', ISSUED_FROM_STOCK: 'active', RFQ_ISSUED: ['waiting_parts', { acceptsQuotations: true }],
      EVALUATED: 'active', PO_ISSUED: 'waiting_parts', RECEIVED: 'active', ISSUED: 'closed',
    }),
    OV: statuses(OV_STATUS_META, {
      RECEIVED_HQ: 'new', VENDOR_IDENTIFIED: 'active', F134_SUBMITTED: 'waiting_customer', APPROVED: 'active', REJECTED: ['closed', { branch: true }],
      PO_ISSUED: 'active', AT_VENDOR: 'external', COST_ADVISED: 'waiting_customer', QUOTE_APPROVED: 'external', RECEIVED_BACK: 'active', RETURNED: 'closed',
    }),
    INVOICE: statuses(INVOICE_STATUS_META, {
      DRAFTED: ['new', { draftDocuments: true }], CERTIFIED: ['active', { draftDocuments: true }], TAX_RAISED: 'active',
      CORRECTNESS_CHECK: 'active', SUBMITTED: 'waiting_customer', REJECTED: ['active', { branch: true }], PAID: 'closed',
    }),
  },
  transitions: { JOB: JOB_TRANSITIONS, DEMAND: DEMAND_TRANSITIONS, OV: OV_TRANSITIONS, INVOICE: INVOICE_TRANSITIONS },
  roles: [
    { key: 'ADMIN', label: 'Administrator (IT)', labelMs: 'Pentadbir (IT)', meta: { capabilities: [] } },
    { key: 'STORES', label: 'Stores / Logistic (StS)', labelMs: 'Stor / Logistik', meta: { capabilities: ['jobs.register', 'priority.raise', 'tools.handle', 'stock.manage', 'stock.issue'] } },
    { key: 'WORKSHOP', label: 'Workshop technician (Tst)', labelMs: 'Juruteknik bengkel', meta: { capabilities: ['tools.handle'] } },
    { key: 'MIS', label: 'Maintenance inspector (MIS)', labelMs: 'Pemeriksa penyelenggaraan', meta: { capabilities: ['tools.handle'] } },
    { key: 'MM', label: 'Maintenance manager (SMM/HOD)', labelMs: 'Pengurus penyelenggaraan', meta: { capabilities: ['jobs.assign', 'priority.raise', 'priority.close', 'invoices.documents', 'reports.billing', 'reports.audit', 'alerts.escalation'] } },
    { key: 'PURCHASING', label: 'Purchasing (PcE)', labelMs: 'Perolehan', meta: { capabilities: ['procurement.quote', 'registers.propose', 'registers.evaluate'] } },
    { key: 'PCE', label: 'Production control (PCE)', labelMs: 'Kawalan pengeluaran', meta: { capabilities: ['jobs.assign', 'priority.raise', 'priority.close', 'invoices.create', 'invoices.documents', 'registers.propose', 'registers.evaluate', 'reports.billing', 'reports.payments'] } },
    { key: 'QUALITY', label: 'Quality (QAD / JTP)', labelMs: 'Kualiti', meta: { capabilities: ['workflow.edit', 'registers.evaluate', 'registers.approve', 'incidents.manage', 'tools.handle', 'reports.audit'] } },
    { key: 'FINANCE', label: 'Finance', labelMs: 'Kewangan', meta: { capabilities: ['invoices.create', 'invoices.documents', 'reports.billing', 'reports.payments'] } },
    { key: 'BILLING', label: 'Billing', labelMs: 'Bil', meta: { capabilities: ['invoices.create', 'invoices.documents', 'reports.billing', 'reports.payments'] } },
  ],
  dictionaries: {
    site: [
      { key: 'HQ', label: 'Headquarters' }, { key: 'CENTRAL', label: 'Central' }, { key: 'EAST', label: 'East' },
      { key: 'NORTH', label: 'North' }, { key: 'NORTHEAST', label: 'Northeast' }, { key: 'OFFSHORE', label: 'Offshore' },
    ],
    location: [
      { key: 'LOGISTIC', label: 'Logistic store', labelMs: 'Stor logistik' }, { key: 'BAY', label: 'Workshop bay', labelMs: 'Petak bengkel' },
      { key: 'HQ', label: 'Headquarters', labelMs: 'Ibu pejabat' }, { key: 'VENDOR', label: 'At vendor', labelMs: 'Di vendor' },
      { key: 'CUSTOMER', label: 'With customer', labelMs: 'Di pelanggan' },
    ],
    category: [
      { key: 'MILITARY', label: 'Military component (QP.17)', labelMs: 'Komponen ketenteraan' },
      { key: 'NAS', label: 'Non-airborne system (QP.17A)', labelMs: 'Sistem bukan udara' },
    ],
    priority: Object.entries(PRIORITY_META).map(([key, m]) => ({ key, label: m.en, labelMs: m.ms, meta: { tone: m.tone } })),
    route: Object.entries(REPAIR_ROUTE_META).map(([key, m]) => ({ key, label: m.en, labelMs: m.ms, meta: { note: m.note } })),
    incidentArea: [
      { key: 'AWARENESS', label: 'Awareness' }, { key: 'CONTROL', label: 'Control' }, { key: 'CRITICAL', label: 'Critical area' },
    ],
    course: [{ key: 'FOD_INITIAL', label: 'FOD initial' }, { key: 'FOD_RECURRENT', label: 'FOD recurrent' }],
    jobType: [{ key: 'CORRECTIVE', label: 'Repair', labelMs: 'Baik pulih' }, { key: 'PREVENTIVE', label: 'Preventive', labelMs: 'Pencegahan' }],
    assetType: [],
    store: [store('MAIN', 'Main store', 'Stor utama', 'HQ')],
    unit: UNITS,
    partGroup: [],
  },
  slaRules: SLA_RULES,
  invoiceStreams: INVOICE_STREAMS,
  defaults: { jobPrefix: 'PS', initialLocation: 'LOGISTIC', tax: { label: 'GST', ratePct: 6 } },
};
