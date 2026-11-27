import type { TransitionRule } from '../common/types';
import type { InvoiceStreamDef, SlaRule } from '../common/workflow-config';
import type { Capability, DictKind, Entry, Modules, Pack, RoleMeta, StatusMeta, Terms } from './types';
import { store, UNITS } from './stock-lists';

/**
 * Building blocks shared by the general-purpose sector packs. Every pack built
 * here has the same shape — request → assign → work → (parts / approval /
 * contractor) → complete → sign off — with its own words, roles, lists,
 * mandatory fields and timers. Organisations then adjust it in the workflow
 * editor; nothing here is hard-wired into the services.
 */

type Field = TransitionRule['requires'][number];
export const field = (key: string, label: string, type?: Field['type']): Field => ({ key, label, ...(type ? { type } : {}) });
/** A field shown on the step but not mandatory. */
export const optional = (key: string, label: string, type?: Field['type']): Field => ({ ...field(key, label, type), optional: true });

const st = (key: string, label: string, labelMs: string, tone: StatusMeta['tone'], phase: StatusMeta['phase'], extra: Partial<StatusMeta> = {}): Entry<StatusMeta> =>
  ({ key, label, labelMs, meta: { tone, phase, ...(phase === 'closed' ? { final: true } : {}), ...extra } });

const step = (from: string, to: string, label: string, labelMs: string, roles: string[], requires: Field[] = [], more: Partial<TransitionRule> = {}): TransitionRule =>
  ({ from, to, label, labelMs, roles, requires, ...more });

/** Standard role keys; each pack gives them its own titles. */
export const ROLE = {
  ADMIN: 'ADMIN', HELPDESK: 'HELPDESK', SUPERVISOR: 'SUPERVISOR', TECHNICIAN: 'TECHNICIAN',
  STORES: 'STORES', PURCHASING: 'PURCHASING', FINANCE: 'FINANCE', MANAGER: 'MANAGER',
} as const;

const CAPS: Record<keyof typeof ROLE, Capability[]> = {
  ADMIN: [],
  HELPDESK: ['jobs.register', 'jobs.assign', 'priority.raise', 'requests.manage'],
  SUPERVISOR: ['jobs.register', 'jobs.assign', 'requests.manage', 'labour.log', 'labour.manage', 'stock.manage', 'stock.issue', 'priority.raise', 'priority.close', 'assets.manage', 'meters.record', 'incidents.manage', 'tools.handle', 'reports.audit', 'reports.maintenance', 'alerts.escalation'],
  TECHNICIAN: ['meters.record', 'tools.handle', 'stock.issue', 'labour.log'],
  STORES: ['tools.handle', 'stock.manage', 'stock.issue'],
  PURCHASING: ['procurement.quote', 'registers.propose', 'registers.evaluate'],
  FINANCE: ['invoices.create', 'invoices.documents', 'reports.billing', 'reports.payments', 'accounting.export', 'fx.manage'],
  MANAGER: ['workflow.edit', 'jobs.assign', 'requests.manage', 'labour.manage', 'stock.manage', 'stock.issue', 'priority.raise', 'priority.close', 'registers.evaluate', 'registers.approve', 'assets.manage', 'invoices.documents', 'reports.billing', 'reports.audit', 'reports.maintenance', 'accounting.export', 'fx.manage', 'alerts.escalation'],
};

export function roles(titles: Record<keyof typeof ROLE, [string, string]>): Entry<RoleMeta>[] {
  return (Object.keys(ROLE) as (keyof typeof ROLE)[]).map((k) => ({
    key: ROLE[k], label: titles[k][0], labelMs: titles[k][1], meta: { capabilities: CAPS[k] },
  }));
}

export interface MaintenanceOptions {
  id: string;
  name: string;
  description: string;
  terms: Partial<Terms>;
  modules: Partial<Modules>;
  roleTitles: Record<keyof typeof ROLE, [string, string]>;
  dictionaries: Partial<Record<DictKind, Entry[]>>;
  /** Extra mandatory fields when work starts (e.g. a permit to work). */
  startRequires?: Field[];
  /** Actions when work starts (e.g. record the odometer on the vehicle). */
  startEffects?: TransitionRule['effects'];
  /** Extra mandatory fields when work is completed (e.g. readings taken). */
  completeRequires?: Field[];
  /** A separate inspection / test step before completion, with its mandatory fields. */
  inspection?: { label: string; labelMs: string; requires: Field[] };
  /** Quotations required before a purchase order (bypass with a recorded approval). */
  minQuotations: number;
  sla?: SlaRule[];
  invoiceStreams?: InvoiceStreamDef[];
  defaults: Pack['defaults'];
}

const BASE_TERMS: Terms = {
  job: 'Work order', jobs: 'Work orders', jobNo: 'WO no.', jobRegister: 'Work order register', component: 'Item',
  originUnit: 'Requested by', site: 'Site', sites: 'Sites', demand: 'Parts request', demands: 'Parts & Purchasing',
  vendorRepair: 'Vendor repair', vendorRepairs: 'Vendor repairs', priority: 'Priority', incident: 'Safety incident',
  incidents: 'Health & Safety', registers: 'Suppliers & Contractors', asset: 'Asset', assets: 'Assets', pm: 'Preventive maintenance',
};

const BASE_MODULES: Modules = {
  procurement: true, vendorRepair: false, priority: true, incidents: true, tools: false, training: true,
  invoicing: true, registers: true, assets: true, pm: true, stock: true, requests: true, labour: true,
};

const { HELPDESK, SUPERVISOR, TECHNICIAN, STORES, PURCHASING, FINANCE, MANAGER } = ROLE;

function jobWorkflow(o: MaintenanceOptions, modules: Modules) {
  const statuses: Entry<StatusMeta>[] = [
    st('OPEN', 'Open', 'Dibuka', 'neutral', 'new'),
    st('ASSIGNED', 'Assigned', 'Ditugaskan', 'info', 'new'),
    st('IN_PROGRESS', 'In progress', 'Dalam tindakan', 'info', 'active'),
    st('ON_HOLD_PARTS', 'On hold — parts', 'Tunggu alat ganti', 'warn', 'waiting_parts'),
    st('AWAITING_APPROVAL', 'Awaiting approval', 'Menunggu kelulusan', 'warn', 'waiting_customer'),
    st('WITH_CONTRACTOR', modules.vendorRepair ? 'At vendor / contractor' : 'With contractor', 'Di kontraktor', 'warn', 'external', { branch: true }),
    ...(o.inspection ? [st('INSPECTION', o.inspection.label, o.inspection.labelMs, 'info', 'active')] : []),
    st('COMPLETED', 'Completed', 'Selesai', 'good', 'done'),
    st('CLOSED', 'Closed', 'Ditutup', 'good', 'closed'),
    st('CANCELLED', 'Cancelled', 'Dibatalkan', 'neutral', 'closed', { branch: true }),
  ];
  const reason = [field('reason', 'Reason')];
  const transitions: TransitionRule[] = [
    step('OPEN', 'ASSIGNED', 'Assign', 'Tugaskan', [HELPDESK, SUPERVISOR], [field('assignee', 'Assigned to', 'user')],
      { effects: [{ type: 'assignTo', params: { field: 'assignee' } }] }),
    step('OPEN', 'CANCELLED', 'Cancel', 'Batal', [HELPDESK, SUPERVISOR], reason),
    step('ASSIGNED', 'IN_PROGRESS', 'Start work', 'Mula kerja', [TECHNICIAN, SUPERVISOR], o.startRequires ?? [], o.startEffects ? { effects: o.startEffects } : {}),
    step('ASSIGNED', 'CANCELLED', 'Cancel', 'Batal', [SUPERVISOR], reason),
  ];
  if (modules.procurement) {
    transitions.push(
      step('IN_PROGRESS', 'ON_HOLD_PARTS', 'Request parts', 'Mohon alat ganti', [TECHNICIAN, SUPERVISOR],
        // A catalogue part if there is one (stock), otherwise a description.
        [optional('part', 'Part from the catalogue', 'part'), optional('partDescription', 'Or describe the part'), field('qty', 'Quantity', 'number')],
        { effects: [{ type: 'raiseDemand', params: { partField: 'part', descriptionField: 'partDescription', partNoField: 'partNo', qtyField: 'qty' } }] }),
      step('ON_HOLD_PARTS', 'IN_PROGRESS', 'Parts received — resume', 'Alat ganti diterima — sambung', [TECHNICIAN, SUPERVISOR]),
    );
  }
  transitions.push(
    step('IN_PROGRESS', 'AWAITING_APPROVAL', 'Ask for approval', 'Mohon kelulusan', [SUPERVISOR], [field('quoteRef', 'Estimate / quotation ref')]),
    step('AWAITING_APPROVAL', 'IN_PROGRESS', 'Approved — continue', 'Diluluskan — teruskan', [SUPERVISOR, MANAGER],
      [field('approvalRef', 'Approval / customer PO ref')], { effects: [{ type: 'setAttributes', params: { indentRef: 'approvalRef' } }] }),
    step('AWAITING_APPROVAL', 'CANCELLED', 'Declined', 'Ditolak', [SUPERVISOR, MANAGER], reason),
    modules.vendorRepair
      ? step('IN_PROGRESS', 'WITH_CONTRACTOR', 'Send to vendor', 'Hantar ke vendor', [SUPERVISOR], [field('referralRef', 'Fault report / referral ref')],
        { setLocation: 'VENDOR', effects: [{ type: 'openVendorRepair', params: { refField: 'referralRef', workOrderField: 'approvalRef' } }] })
      : step('IN_PROGRESS', 'WITH_CONTRACTOR', 'Hand to contractor', 'Serah kepada kontraktor', [SUPERVISOR], [field('contractor', 'Contractor'), field('contractorRef', 'Contractor job ref')]),
    step('WITH_CONTRACTOR', 'IN_PROGRESS', 'Back from contractor', 'Kembali dari kontraktor', [SUPERVISOR, TECHNICIAN]),
  );
  const workDone = [field('workDone', 'Work done'), ...(o.completeRequires ?? [])];
  if (o.inspection) {
    transitions.push(
      step('IN_PROGRESS', 'INSPECTION', 'Ready for inspection', 'Sedia untuk pemeriksaan', [TECHNICIAN], workDone),
      step('INSPECTION', 'COMPLETED', 'Pass', 'Lulus', [SUPERVISOR], o.inspection.requires),
      step('INSPECTION', 'IN_PROGRESS', 'Fail — rework', 'Gagal — kerja semula', [SUPERVISOR], [field('defects', 'Defects found')]),
    );
  } else {
    transitions.push(step('IN_PROGRESS', 'COMPLETED', 'Complete work', 'Siapkan kerja', [TECHNICIAN, SUPERVISOR], workDone));
  }
  transitions.push(
    step('COMPLETED', 'CLOSED', 'Sign off & close', 'Sahkan & tutup', [SUPERVISOR, MANAGER], [field('signedOffBy', 'Signed off by')]),
    step('COMPLETED', 'IN_PROGRESS', 'Reopen', 'Buka semula', [SUPERVISOR], reason),
  );
  return { statuses, transitions };
}

function demandWorkflow(o: MaintenanceOptions) {
  const statuses = [
    st('RAISED', 'Raised', 'Dimohon', 'neutral', 'new'),
    st('APPROVED', 'Approved', 'Diluluskan', 'info', 'active'),
    st('QUOTING', 'Getting quotations', 'Mendapatkan sebut harga', 'warn', 'waiting_parts', { acceptsQuotations: true }),
    st('ORDERED', 'Ordered', 'Dipesan', 'warn', 'waiting_parts'),
    st('RECEIVED', 'Received', 'Diterima', 'info', 'active'),
    st('ISSUED', 'Fulfilled', 'Dipenuhi', 'good', 'closed'),
    st('REJECTED', 'Rejected', 'Ditolak', 'bad', 'closed', { branch: true }),
  ];
  const transitions = [
    step('RAISED', 'APPROVED', 'Approve', 'Lulus', [SUPERVISOR, MANAGER]),
    step('RAISED', 'REJECTED', 'Reject', 'Tolak', [SUPERVISOR, MANAGER], [field('reason', 'Reason')]),
    step('APPROVED', 'ISSUED', 'Issue from stock', 'Keluarkan dari stok', [STORES], [field('store', 'Store', 'store')],
      { effects: [{ type: 'issueFromStock', params: { holdingField: 'store' } }] }),
    step('APPROVED', 'QUOTING', 'Request quotations', 'Minta sebut harga', [PURCHASING], [field('rfqRef', 'RFQ ref')],
      { effects: [{ type: 'setAttributes', params: { rfqRef: 'rfqRef' } }] }),
    step('QUOTING', 'ORDERED', 'Place order', 'Buat pesanan', [PURCHASING],
      [field('poRef', 'Purchase order no.'), field('selectedSupplierId', 'Supplier chosen'), optional('singleSourceRef', 'Single-source approval ref (if fewer quotations)')], {
      effects: [
        { type: 'evaluateQuotations', params: { min: o.minQuotations, selectionField: 'selectedSupplierId', bypassField: 'singleSourceRef' } },
        { type: 'setAttributes', params: { poRef: 'poRef' } },
      ],
    }),
    step('ORDERED', 'RECEIVED', 'Receive goods', 'Terima barang', [STORES], [
      field('grnRef', 'Goods received note'), field('store', 'Received into store', 'store'),
      optional('receivedQty', 'Quantity received (if not as ordered)', 'number'), optional('unitCost', 'Unit cost (if not from the quotation)', 'number'),
      optional('discrepancyRef', 'Discrepancy report ref'), optional('discrepancyNote', 'Discrepancy note'),
    ], {
      effects: [{
        type: 'recordReceipt',
        params: { discrepancyField: 'discrepancyRef', noteField: 'discrepancyNote', storeField: 'store', qtyField: 'receivedQty', costField: 'unitCost' },
      }],
    }),
    step('RECEIVED', 'ISSUED', 'Issue to work order', 'Keluarkan untuk arahan kerja', [STORES], [],
      { effects: [{ type: 'issueFromStock', params: {} }] }),
  ];
  return { statuses, transitions };
}

function vendorWorkflow() {
  const statuses = [
    st('REQUESTED', 'Requested', 'Dimohon', 'neutral', 'new'),
    st('QUOTED', 'Quoted', 'Sebut harga diterima', 'warn', 'waiting_customer'),
    st('APPROVED', 'Approved', 'Diluluskan', 'info', 'active'),
    st('AT_VENDOR', 'At vendor', 'Di vendor', 'warn', 'external'),
    st('RETURNED', 'Returned', 'Dipulangkan', 'good', 'closed'),
    st('DECLINED', 'Declined', 'Ditolak', 'bad', 'closed', { branch: true }),
  ];
  const transitions = [
    step('REQUESTED', 'QUOTED', 'Record vendor quotation', 'Rekod sebut harga vendor', [PURCHASING, SUPERVISOR],
      [field('vendorId', 'Vendor (supplier ID)'), field('cost', 'Repair cost'), field('eddDays', 'Turnaround (days)'), field('quoteRef', 'Quotation ref')],
      { effects: [{ type: 'setVendor', params: { field: 'vendorId' } }, { type: 'recordCost', params: { costField: 'cost', eddField: 'eddDays', quoteField: 'quoteRef' } }] }),
    step('QUOTED', 'APPROVED', 'Approve repair', 'Lulus pembaikan', [MANAGER, SUPERVISOR], [field('poRef', 'Repair order no.')],
      { effects: [{ type: 'setAttributes', params: { poRef: 'poRef' } }] }),
    step('QUOTED', 'DECLINED', 'Decline', 'Tolak', [MANAGER, SUPERVISOR], [field('reason', 'Reason')]),
    step('APPROVED', 'AT_VENDOR', 'Ship to vendor', 'Hantar ke vendor', [STORES], [field('shipRef', 'Delivery / consignment ref')],
      { effects: [{ type: 'setParentLocation', params: { location: 'VENDOR' } }] }),
    step('AT_VENDOR', 'RETURNED', 'Received back', 'Diterima semula', [STORES], [field('returnRef', 'Return delivery ref')],
      { effects: [{ type: 'setParentLocation', params: { location: 'WORKSHOP' } }] }),
  ];
  return { statuses, transitions };
}

function invoiceWorkflow() {
  const statuses = [
    st('DRAFTED', 'Draft', 'Draf', 'neutral', 'new', { draftDocuments: true }),
    st('ISSUED', 'Issued', 'Dikeluarkan', 'info', 'active'),
    st('SENT', 'Sent to customer', 'Dihantar kepada pelanggan', 'warn', 'waiting_customer'),
    st('DISPUTED', 'Disputed', 'Dipertikai', 'bad', 'active', { branch: true }),
    st('PAID', 'Paid', 'Dibayar', 'good', 'closed'),
    st('VOID', 'Void', 'Dibatalkan', 'neutral', 'closed', { branch: true }),
  ];
  const transitions = [
    step('DRAFTED', 'ISSUED', 'Issue tax invoice', 'Keluarkan invois cukai', [FINANCE], [field('invoiceNo', 'Tax invoice no.')],
      { effects: [{ type: 'raiseTaxInvoice', params: { numberField: 'invoiceNo', amountField: 'amount' } }] }),
    step('DRAFTED', 'VOID', 'Void', 'Batal', [FINANCE], [field('reason', 'Reason')]),
    step('ISSUED', 'SENT', 'Send to customer', 'Hantar kepada pelanggan', [FINANCE], [field('sentTo', 'Sent to (person / e-mail)')]),
    step('SENT', 'PAID', 'Record payment', 'Rekod bayaran', [FINANCE], [field('paymentRef', 'Payment ref')],
      { effects: [{ type: 'markPaid', params: { refField: 'paymentRef' } }] }),
    step('SENT', 'DISPUTED', 'Customer disputes', 'Pelanggan mempertikai', [FINANCE], [field('reason', 'Reason')],
      { effects: [{ type: 'markOutstanding' }] }),
    step('DISPUTED', 'SENT', 'Re-send corrected invoice', 'Hantar semula invois dibetulkan', [FINANCE], [field('correctionRef', 'Correction / credit note ref')]),
  ];
  return { statuses, transitions };
}

const BASE_SLA: SlaRule[] = [
  { id: 'SLA-ASSIGN', entity: 'JOB', status: 'OPEN', days: 1, rule: 'Assign within 1 day of the request', source: 'Service standard' },
  { id: 'SLA-START', entity: 'JOB', status: 'ASSIGNED', days: 2, rule: 'Start work within 2 days of assignment', source: 'Service standard' },
  { id: 'SLA-WORK', entity: 'JOB', status: 'IN_PROGRESS', days: 10, rule: 'Complete work within 10 days', source: 'Service standard' },
  { id: 'SLA-PARTS', entity: 'JOB', status: 'ON_HOLD_PARTS', days: 14, rule: 'Parts within 14 days', source: 'Service standard' },
  { id: 'SLA-APPROVAL', entity: 'JOB', status: 'AWAITING_APPROVAL', days: 5, rule: 'Approval decision within 5 days', source: 'Service standard' },
  { id: 'SLA-SIGNOFF', entity: 'JOB', status: 'COMPLETED', days: 3, rule: 'Sign off within 3 days of completion', source: 'Service standard' },
  { id: 'SLA-QUOTES', entity: 'DEMAND', status: 'QUOTING', days: 5, rule: 'Quotations within 5 working days', source: 'Purchasing policy' },
  { id: 'SLA-DELIVERY', entity: 'DEMAND', status: 'ORDERED', days: 21, rule: 'Supplier delivery within 21 days', source: 'Purchasing policy' },
  { id: 'SLA-PAYMENT', entity: 'INVOICE', status: 'SENT', days: 30, rule: 'Payment within 30 days', source: 'Payment terms' },
];

const BASE_STREAMS: InvoiceStreamDef[] = [
  {
    id: 'SERVICE', label: 'Service / repair', labelMs: 'Servis / pembaikan', customer: 'Customer', perJob: true,
    docSet: ['Tax invoice', 'Completed work order', 'Customer sign-off'],
    deadlines: [{ label: 'Invoice within 7 days', note: 'Raise the invoice within 7 days of sign-off' }],
  },
  {
    id: 'CONTRACT', label: 'Maintenance contract (monthly)', labelMs: 'Kontrak penyelenggaraan (bulanan)', customer: 'Contract customer', perJob: false,
    docSet: ['Tax invoice', 'Monthly service report', 'SLA performance summary'],
    deadlines: [{ label: 'By the 5th', note: 'Bill the previous month by the 5th' }],
  },
];

const BASE_LOCATIONS: Entry[] = [
  { key: 'ON_SITE', label: 'On site', labelMs: 'Di tapak' }, { key: 'WORKSHOP', label: 'Workshop', labelMs: 'Bengkel' },
  { key: 'STORE', label: 'Store', labelMs: 'Stor' }, { key: 'VENDOR', label: 'At vendor', labelMs: 'Di vendor' },
  { key: 'CUSTOMER', label: 'With customer', labelMs: 'Di pelanggan' },
];

const BASE_JOB_TYPES: Entry[] = [
  { key: 'CORRECTIVE', label: 'Corrective (breakdown)', labelMs: 'Pembetulan' },
  { key: 'PREVENTIVE', label: 'Preventive', labelMs: 'Pencegahan' },
  { key: 'INSPECTION', label: 'Inspection', labelMs: 'Pemeriksaan' },
  { key: 'INSTALLATION', label: 'Installation', labelMs: 'Pemasangan' },
];

export function maintenancePack(o: MaintenanceOptions): Pack {
  const modules = { ...BASE_MODULES, ...o.modules };
  const job = jobWorkflow(o, modules);
  const demand = demandWorkflow(o);
  const ov = vendorWorkflow();
  const invoice = invoiceWorkflow();
  const d = o.dictionaries;
  return {
    id: o.id,
    name: o.name,
    description: o.description,
    terms: { ...BASE_TERMS, ...o.terms },
    modules,
    statuses: { JOB: job.statuses, DEMAND: demand.statuses, OV: ov.statuses, INVOICE: invoice.statuses },
    transitions: { JOB: job.transitions, DEMAND: demand.transitions, OV: ov.transitions, INVOICE: invoice.transitions },
    roles: roles(o.roleTitles),
    dictionaries: {
      site: d.site ?? [{ key: 'HQ', label: 'Head office', labelMs: 'Ibu pejabat' }],
      location: d.location ?? BASE_LOCATIONS,
      category: d.category ?? [],
      priority: d.priority ?? [
        { key: 'EMERGENCY', label: 'Emergency', labelMs: 'Kecemasan', meta: { tone: 'bad' } },
        { key: 'URGENT', label: 'Urgent', labelMs: 'Segera', meta: { tone: 'warn' } },
      ],
      route: d.route ?? [
        { key: 'IN_HOUSE', label: 'In-house crew', labelMs: 'Pasukan dalaman', meta: { note: 'Re-assign the nearest qualified technician' } },
        { key: 'CONTRACTOR', label: 'Call-out contractor', labelMs: 'Kontraktor panggilan', meta: { note: 'Call the term contractor under the emergency rate' } },
        { key: 'STANDBY', label: 'Standby / loan unit', labelMs: 'Unit simpanan / pinjaman', meta: { note: 'Deploy a standby unit while the repair continues' } },
        { key: 'EXPEDITE_PARTS', label: 'Expedite parts', labelMs: 'Percepat alat ganti', meta: { note: 'Purchasing expedites the parts order' } },
      ],
      incidentArea: d.incidentArea ?? [
        { key: 'AWARENESS', label: 'Near miss', labelMs: 'Nyaris kemalangan' },
        { key: 'CONTROL', label: 'Equipment / tool control', labelMs: 'Kawalan peralatan' },
        { key: 'CRITICAL', label: 'Injury or damage', labelMs: 'Kecederaan atau kerosakan' },
      ],
      course: d.course ?? [],
      jobType: d.jobType ?? BASE_JOB_TYPES,
      assetType: d.assetType ?? [],
      store: d.store ?? [store('MAIN', 'Main store', 'Stor utama', 'HQ'), store('VAN1', 'Service van 1', 'Van servis 1', 'HQ')],
      unit: d.unit ?? UNITS,
      partGroup: d.partGroup ?? [],
    },
    slaRules: o.sla ?? BASE_SLA,
    invoiceStreams: o.invoiceStreams ?? BASE_STREAMS,
    defaults: o.defaults,
  };
}
