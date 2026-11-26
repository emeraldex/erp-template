// ─── Domain types ────────────────────────────────────────────────────────────
// Statuses, roles, sites and similar vocabularies are per-organisation data
// (dictionary_entries), so their types are plain strings. The aviation pack
// (CO-RFP-IT-001) uses the keys the comments below mention.

/** Role key from the organisation's dictionary (e.g. "STORES" in the aviation pack). */
export type Role = string;

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  designation: string; // spec abbreviation, e.g. "StS", "Tst", "PcE"
  branch: Branch;
}

/** Site key from the organisation's dictionary ("HQ", "CENTRAL"… in the aviation pack). */
export type Branch = string;

/** Where an item physically is; keys come from the organisation's dictionary. */
export type Location = string;

// QP.44 lifecycle statuses (JTS)
/** Work-order status key from the organisation's JOB workflow. */
export type JobStatus = string;

export interface AuditEntry {
  at: string;          // ISO timestamp — FR-04
  by: string;
  role: Role;
  action: string;
  fields?: Record<string, string>;
}

export interface FormRecord {
  formNo: string;      // e.g. "F116"
  refNo: string;
  date: string;
  by: string;
  note?: string;
}

export interface Job {
  archivedAt?: string;        // FR-12: out of active lists, read-only
  id: string;              // PS / Job number — FR-01
  psDate: string;
  component: string;
  partNo: string;
  serialNo: string;
  category: string;           // category key (MILITARY / NAS in the aviation pack)
  originUnit: string;          // customer unit (Customer)
  repairUnit: Branch;
  status: JobStatus;
  location: Location;
  receivedAt: string;
  statusSince: string;
  demandIds: string[];
  ovId?: string;
  invoiceIds?: string[];   // QP.51 billing linkage (5.8)
  priority?: JobPriority;  // QP.56 AOG/ROA/Critical overlay (5.9) — FR-15
  indentRef?: string;
  /** jobType dictionary key: CORRECTIVE, PREVENTIVE… */
  jobType?: string;
  /** The asset worked on, when it is registered. */
  assetId?: string;
  /** The preventive-maintenance schedule that raised this job. */
  pmScheduleId?: string;
  checklist?: ChecklistItem[];
  /** The person the work is assigned to. */
  assigneeId?: string;
  assigneeName?: string;
  assignedAt?: string;
  records: FormRecord[];   // Section 6 forms attached to the job
  audit: AuditEntry[];
}

/** One check on a job: ticked off by a technician, required ones gate completion. */
export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  by?: string;
  at?: string;
  note?: string;
}

// ─── QP.56 AOG / ROA / Critical priority overlay (5.9) — FR-15 ─────────────────
// A cross-cutting priority that can be raised on any job at any stage, modelled
// on the COL (Company Online) AOG/ROA column: status, quantity and dates.
/** Priority level key (AOG / ROA / CRITICAL in the aviation pack). */
export type PriorityType = string;
/** Expedite route key (dictionary). */
export type RepairRoute = string; // no spares required — unit proceeds & expedites

export interface JobPriority {
  type: PriorityType;
  quantity: number;
  route: RepairRoute;
  suffixK: boolean;           // Critical item with repair suffix 'K'
  state: "OPEN" | "CLOSED";
  colRef: string;             // COL AOG/ROA column record reference
  raisedAt: string;
  raisedBy: string;
  edd?: string;               // estimated delivery date reported to CAO/CPU
  remark?: string;            // COL remark column — latest progress / shipping
  closedAt?: string;
  closeReason?: "DELIVERED" | "DOWNGRADED";
  audit: AuditEntry[];
}

// QP.14 demand / procurement
/** Parts-demand status key from the DEMAND workflow. */
export type DemandStatus = string;

export interface Quotation {
  supplierId: string;
  supplier: string;
  priceMYR: number;
  eddDays: number;
  remarks?: string;
}

export interface Demand {
  id: string;              // F212 ref
  jobId: string;
  partDescription: string;
  partNo: string;
  qty: number;
  status: DemandStatus;
  statusSince: string;
  raisedBy: string;
  branch: Branch;
  stockCheck?: { f244Ref: string; available: boolean; holdingUnit?: string };
  rfqRef?: string;         // F220
  quotations: Quotation[];
  evaluation?: { f221Ref: string; selectedSupplierId: string; localPurchase?: boolean; f241Ref?: string };
  poRef?: string;          // F312
  discrepancy?: { f217Ref: string; note: string };
  records: FormRecord[];
  audit: AuditEntry[];
}

// QP.33 outside-vendor repair
/** Outside-vendor repair status key from the OV workflow. */
export type OvStatus = string;

export interface OvRepair {
  id: string;
  jobId: string;
  defectReportRef: string;   // F135
  am75Ref: string;           // customer work order
  vendorId?: string;
  vendorName?: string;
  f134Ref?: string;
  poRef?: string;            // F312
  costMYR?: number;
  eddDays?: number;
  aboveIndent?: boolean;
  f119Ref?: string;
  status: OvStatus;
  statusSince: string;
  records: FormRecord[];
  audit: AuditEntry[];
}

// QP.13 / QP.34 supplier & sub-contractor registers
export type PartnerType = "SUPPLIER" | "SUBCONTRACTOR";
export type PartnerStatus = "APPLIED" | "UNDER_EVALUATION" | "JTP_APPROVED" | "REGISTERED" | "DROPPED";
export type Rating = 3 | 2 | 1; // Good / Suitable-Capable / Not Suitable

export interface Car {
  ref: string; // F516
  date: string;
  reason: string;
}

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  country: string;
  certifications: string[];       // FAA/CAA/EASA/SIRIM/DGTA/DSM/CPU
  lists: string[];                // F224 | F229 | AVL | MSN
  rating?: Rating;
  evaluationRef?: string;         // F225 / F228
  siteAuditRef?: string;          // F225A
  lastAssessed?: string;
  nextReassessment?: string;      // +3 years
  nonConformances: number;
  factorsEvaluated: number;
  cars: Car[];
  audit: AuditEntry[];
}

// QP.46 FOD & quality compliance
export interface FodIncident {
  id: string;
  date: string;
  partName: string;
  typeModel: string;
  serialNo: string;
  area: string;               // incident area key (dictionary)
  location: string;
  discovered: string;   // who/when/how
  rootCause?: string;
  correctiveAction?: string;
  reporter: string;
  focalPoint: string;
  status: "OPEN" | "UNDER_REVIEW" | "CLOSED";
  audit: AuditEntry[];
}

export interface Tool {
  tag: string;
  name: string;
  board: string;   // shadow board
  holder?: string;
  status: "IN" | "OUT" | "MISSING";
  since: string;
}

export interface TrainingRecord {
  person: string;
  course: string;             // training course key (dictionary)
  date: string;
  nextDue: string;
}

// ─── QP.51 Invoicing & Revenue Billing (5.8) — FR-13 / FR-14 ───────────────────
// Four parallel invoicing streams modelled as configurable variants of a single
// billing process: each adds tax (rate from settings), produces a Certified True Copy (CTC), passes
// a correctness gate and routes the tax invoice to CPU (Finance) for payment.
/** Invoicing stream id (configurable). */
export type InvoiceStream = string;

/** Invoice status key from the INVOICE workflow. */
export type InvoiceStatus = string;             // Finance received & recorded payment

export interface Invoice {
  id: string;
  stream: InvoiceStream;
  jobId?: string;             // linked job (absent for monthly PBC)
  customer: string;           // CPU (Finance) / MRA / ACD
  period?: string;            // PBC billing month, e.g. "2026-07"
  amountMYR: number;
  gstRate: number;            // tax %, fixed at drafting from settings (FR-13)
  taxLabel?: string;          // GST / SST … printed on documents
  gstMYR: number;             // computed
  totalMYR: number;           // amount + GST
  status: InvoiceStatus;
  statusSince: string;
  f311Ref?: string;           // Tax Invoice no
  ctcRef?: string;            // Certified True Copy
  customerSignRef?: string;   // Customer / CAO signature
  correctnessBy?: string;     // HQ / CoE officer who cleared the correctness gate
  salesPerfRef?: string;      // Company Sales Performance Report / e-Payment (ACD)
  paymentRef?: string;
  paidAt?: string;
  outstanding: boolean;
  raisedBy: string;
  branch: Branch;
  records: FormRecord[];
  audit: AuditEntry[];
}

// ─── Configurable workflow (FR-02) ────────────────────────────────────────────
export interface TransitionRule<S extends string = string> {
  from: S;
  to: S;
  label: string;
  labelMs: string;               // bilingual — Section 7.2
  roles: Role[];                 // process-owner gating — FR-03
  requires: { key: string; label: string; formNo?: string }[]; // mandatory fields — FR-05
  setLocation?: Location;
  /** Actions taken with the step (raise a demand, mark paid…) — see workflow/effects.ts. */
  effects?: { type: string; params?: Record<string, unknown> }[];
}

export interface StatusMeta {
  en: string;
  ms: string;
  tone: "neutral" | "info" | "warn" | "good" | "bad";
}
