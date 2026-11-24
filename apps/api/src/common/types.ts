// ─── CO-RFP-IT-001 domain types ─────────────────────────────────────────────
// Modelled on Section 4 (actors), Section 5 (workflows) and Section 6 (forms
// register) of the Business Workflow & System Requirements Specification.

export type Role =
  | "ADMIN"        // Software / IT Management
  | "STORES"       // StS / StP — Logistic
  | "WORKSHOP"     // Tst / ATP / WoS
  | "MIS"          // Maintenance Inspector / Supervisor
  | "MM"           // (Senior) Maintenance Manager / HOD
  | "PURCHASING"   // PcE / PcMgr
  | "PCE"          // Production Control Executive (OV)
  | "QUALITY"      // QM / QAD / JTP secretariat
  | "FINANCE"
  | "BILLING";

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  role: Role;
  designation: string; // spec abbreviation, e.g. "StS", "Tst", "PcE"
  branch: Branch;
}

export type Branch =
  | "HQ"
  | "CENTRAL"
  | "EAST"
  | "NORTH"
  | "NORTHEAST"
  | "OFFSHORE";

export type Location = "LOGISTIC" | "BAY" | "HQ" | "VENDOR" | "CUSTOMER";

// QP.44 lifecycle statuses (JTS)
export type JobStatus =
  | "REGISTERED"
  | "AWAITING_TDI"
  | "TDI"
  | "AWAITING_SPARE"
  | "AWAITING_INDENT"
  | "WIP"
  | "REC_OV"
  | "BER"
  | "SOR"
  | "SERVICEABLE"
  | "DELIVERED"
  | "CLOSED";

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
  id: string;              // PS / Job number — FR-01
  psDate: string;
  component: string;
  partNo: string;
  serialNo: string;
  category: "MILITARY" | "NAS"; // QP.17 vs QP.17A item category parameter
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
  records: FormRecord[];   // Section 6 forms attached to the job
  audit: AuditEntry[];
}

// ─── QP.56 AOG / ROA / Critical priority overlay (5.9) — FR-15 ─────────────────
// A cross-cutting priority that can be raised on any job at any stage, modelled
// on the COL (Company Online) AOG/ROA column: status, quantity and dates.
export type PriorityType = "AOG" | "ROA" | "CRITICAL";
export type RepairRoute =
  | "COE_UNIT"     // CoE / Unit repair — upgrade to priority repair
  | "OV"            // Outside Vendor repair — hasten repair centre
  | "POOLEX"        // Pool Exchange — source & respond within 14 days
  | "AW_SPARE"      // Airworthy spares — hasten Purchasing
  | "UNIT_PROCEED"; // no spares required — unit proceeds & expedites

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
export type DemandStatus =
  | "RAISED"
  | "APPROVED"
  | "STOCK_CHECK"
  | "ISSUED_FROM_STOCK"
  | "RFQ_ISSUED"
  | "EVALUATED"
  | "PO_ISSUED"
  | "RECEIVED"
  | "ISSUED";

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
export type OvStatus =
  | "RECEIVED_HQ"
  | "VENDOR_IDENTIFIED"
  | "F134_SUBMITTED"
  | "APPROVED"
  | "REJECTED"
  | "PO_ISSUED"
  | "AT_VENDOR"
  | "COST_ADVISED"
  | "QUOTE_APPROVED"
  | "RECEIVED_BACK"
  | "RETURNED";

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
  area: "AWARENESS" | "CONTROL" | "CRITICAL";
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
  course: "FOD_INITIAL" | "FOD_RECURRENT";
  date: string;
  nextDue: string;
}

// ─── QP.51 Invoicing & Revenue Billing (5.8) — FR-13 / FR-14 ───────────────────
// Four parallel invoicing streams modelled as configurable variants of a single
// billing process: each adds tax (rate from settings), produces a Certified True Copy (CTC), passes
// a correctness gate and routes the tax invoice to CPU (Finance) for payment.
export type InvoiceStream = "PBC" | "BRANCH_REPAIR" | "COE_MRA" | "ACD";

export type InvoiceStatus =
  | "DRAFTED"           // stream document set assembled
  | "CERTIFIED"         // Customer/CAO signatures obtained + CTC made
  | "TAX_RAISED"        // Tax Invoice (F311) raised with tax
  | "CORRECTNESS_CHECK" // HQ / CoE Invoicing correctness & completeness gate
  | "SUBMITTED"         // forwarded to CPU (Finance) / MRA
  | "REJECTED"          // incomplete / rejected — correct promptly
  | "PAID";             // Finance received & recorded payment

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
}

export interface StatusMeta {
  en: string;
  ms: string;
  tone: "neutral" | "info" | "warn" | "good" | "bad";
}
