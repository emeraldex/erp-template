// ─── CO-RFP-IT-001 client types (mirror of apps/api/src/common/types.ts) ───

export type Role =
  | "ADMIN" | "STORES" | "WORKSHOP" | "MIS" | "MM"
  | "PURCHASING" | "PCE" | "QUALITY" | "FINANCE" | "BILLING";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string;
  branch: string;
  mustChangePassword?: boolean;
}

export type Branch = "HQ" | "CENTRAL" | "EAST" | "NORTH" | "NORTHEAST" | "OFFSHORE";
export type Location = "LOGISTIC" | "BAY" | "HQ" | "VENDOR" | "CUSTOMER";

export type JobStatus =
  | "REGISTERED" | "AWAITING_TDI" | "TDI" | "AWAITING_SPARE" | "AWAITING_INDENT"
  | "WIP" | "REC_OV" | "BER" | "SOR" | "SERVICEABLE" | "DELIVERED" | "CLOSED";

export interface AuditEntry {
  at: string;
  by: string;
  role: Role;
  action: string;
  fields?: Record<string, string>;
}

export interface FormRecord {
  formNo: string;
  refNo: string;
  date: string;
  by: string;
  note?: string;
}

export interface Job {
  archivedAt?: string;
  id: string;
  psDate: string;
  component: string;
  partNo: string;
  serialNo: string;
  category: "MILITARY" | "NAS";
  originUnit: string;
  repairUnit: Branch;
  status: JobStatus;
  location: Location;
  receivedAt: string;
  statusSince: string;
  demandIds: string[];
  ovId?: string;
  invoiceIds?: string[];
  priority?: JobPriority;
  indentRef?: string;
  records: FormRecord[];
  audit: AuditEntry[];
}

// QP.56 AOG / ROA / Critical priority overlay (5.9) — FR-15
export type PriorityType = "AOG" | "ROA" | "CRITICAL";
export type RepairRoute = "COE_UNIT" | "OV" | "POOLEX" | "AW_SPARE" | "UNIT_PROCEED";

export interface JobPriority {
  type: PriorityType;
  quantity: number;
  route: RepairRoute;
  suffixK: boolean;
  state: "OPEN" | "CLOSED";
  colRef: string;
  raisedAt: string;
  raisedBy: string;
  edd?: string;
  remark?: string;
  closedAt?: string;
  closeReason?: "DELIVERED" | "DOWNGRADED";
  audit: AuditEntry[];
}

export type DemandStatus =
  | "RAISED" | "APPROVED" | "STOCK_CHECK" | "ISSUED_FROM_STOCK"
  | "RFQ_ISSUED" | "EVALUATED" | "PO_ISSUED" | "RECEIVED" | "ISSUED";

export interface Quotation {
  supplierId: string;
  supplier: string;
  priceMYR: number;
  eddDays: number;
  remarks?: string;
}

export interface Demand {
  id: string;
  jobId: string;
  partDescription: string;
  partNo: string;
  qty: number;
  status: DemandStatus;
  statusSince: string;
  raisedBy: string;
  branch: Branch;
  stockCheck?: { f244Ref: string; available: boolean; holdingUnit?: string };
  rfqRef?: string;
  quotations: Quotation[];
  evaluation?: { f221Ref: string; selectedSupplierId: string; localPurchase?: boolean; f241Ref?: string };
  poRef?: string;
  discrepancy?: { f217Ref: string; note: string };
  records: FormRecord[];
  audit: AuditEntry[];
}

export type OvStatus =
  | "RECEIVED_HQ" | "VENDOR_IDENTIFIED" | "F134_SUBMITTED" | "APPROVED" | "REJECTED"
  | "PO_ISSUED" | "AT_VENDOR" | "COST_ADVISED" | "QUOTE_APPROVED" | "RECEIVED_BACK" | "RETURNED";

export interface OvRepair {
  id: string;
  jobId: string;
  defectReportRef: string;
  am75Ref: string;
  vendorId?: string;
  vendorName?: string;
  f134Ref?: string;
  poRef?: string;
  costMYR?: number;
  eddDays?: number;
  aboveIndent?: boolean;
  f119Ref?: string;
  status: OvStatus;
  statusSince: string;
  records: FormRecord[];
  audit: AuditEntry[];
}

export type PartnerType = "SUPPLIER" | "SUBCONTRACTOR";
export type PartnerStatus = "APPLIED" | "UNDER_EVALUATION" | "JTP_APPROVED" | "REGISTERED" | "DROPPED";
export type Rating = 3 | 2 | 1;

export interface Car {
  ref: string;
  date: string;
  reason: string;
}

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  status: PartnerStatus;
  country: string;
  certifications: string[];
  lists: string[];
  rating?: Rating;
  evaluationRef?: string;
  siteAuditRef?: string;
  lastAssessed?: string;
  nextReassessment?: string;
  nonConformances: number;
  factorsEvaluated: number;
  cars: Car[];
  audit: AuditEntry[];
}

export interface FodIncident {
  id: string;
  date: string;
  partName: string;
  typeModel: string;
  serialNo: string;
  area: "AWARENESS" | "CONTROL" | "CRITICAL";
  location: string;
  discovered: string;
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
  board: string;
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

// QP.51 Invoicing & Revenue Billing (5.8) — FR-13 / FR-14
export type InvoiceStream = "PBC" | "BRANCH_REPAIR" | "COE_MRA" | "ACD";
export type InvoiceStatus =
  | "DRAFTED" | "CERTIFIED" | "TAX_RAISED" | "CORRECTNESS_CHECK"
  | "SUBMITTED" | "REJECTED" | "PAID";

export interface Invoice {
  id: string;
  taxLabel?: string;
  stream: InvoiceStream;
  jobId?: string;
  customer: string;
  period?: string;
  amountMYR: number;
  gstRate: number;
  gstMYR: number;
  totalMYR: number;
  status: InvoiceStatus;
  statusSince: string;
  f311Ref?: string;
  ctcRef?: string;
  customerSignRef?: string;
  correctnessBy?: string;
  salesPerfRef?: string;
  paymentRef?: string;
  paidAt?: string;
  outstanding: boolean;
  raisedBy: string;
  branch: Branch;
  records: FormRecord[];
  audit: AuditEntry[];
}

export interface InvoiceStreamDef {
  id: InvoiceStream;
  label: string;
  labelMs: string;
  customer: string;
  perJob: boolean;
  docSet: string[];
  deadlines: { label: string; note: string }[];
}

// ─── /config — the workflow served as data (FR-02) ───────────────────────────
export interface StatusMeta {
  en: string;
  ms: string;
  tone: "neutral" | "info" | "warn" | "good" | "bad";
}

export interface RepairRouteMeta {
  en: string;
  ms: string;
  note: string;
}

export interface TransitionRule<S extends string = string> {
  from: S;
  to: S;
  label: string;
  labelMs: string;
  roles: Role[];
  requires: { key: string; label: string; formNo?: string }[];
  setLocation?: Location;
}

export interface SlaRule {
  id: string;
  entity: "JOB" | "DEMAND" | "OV" | "INVOICE";
  status: string;
  days: number;
  rule: string;
  source: string;
}

export interface WorkflowConfig {
  jobStatusMeta: Record<JobStatus, StatusMeta>;
  demandStatusMeta: Record<DemandStatus, StatusMeta>;
  ovStatusMeta: Record<OvStatus, StatusMeta>;
  invoiceStatusMeta: Record<InvoiceStatus, StatusMeta>;
  priorityMeta: Record<PriorityType, StatusMeta>;
  repairRouteMeta: Record<RepairRoute, RepairRouteMeta>;
  jobTransitions: TransitionRule<JobStatus>[];
  demandTransitions: TransitionRule<DemandStatus>[];
  ovTransitions: TransitionRule<OvStatus>[];
  invoiceTransitions: TransitionRule<InvoiceStatus>[];
  invoiceStreams: InvoiceStreamDef[];
  slaRules: SlaRule[];
}

export interface SlaBreach {
  ref: string;
  entity: "JOB" | "DEMAND" | "OV" | "INVOICE";
  detail: string;
  rule: string;
  source: string;
  daysOver: number;
}

export interface PriorityBoardItem {
  jobId: string;
  component: string;
  type: PriorityType;
  route: RepairRoute;
  colRef: string;
  edd?: string;
  daysOpen: number;
}

export interface Kpis {
  openJobs: number;
  wip: number;
  awaitingCustomer: number;
  atVendor: number;
  slaBreaches: number;
  breaches: SlaBreach[];
  partnersDueReassessment: number;
  openFod: number;
  toolsUnaccounted: number;
  openInvoices: number;
  revenueBilledMYR: number;
  gstCollectedMYR: number;
  outstandingMYR: number;
  aogOpen: number;
  priorityBoard: PriorityBoardItem[];
  byStatus: { status: JobStatus; count: number }[];
  avgJobAgeDays: number;
  weeklyClosures: number[];
}

export interface Attachment {
  id: string;
  entity: "JOB" | "DEMAND" | "OV" | "INVOICE" | "PARTNER" | "FOD";
  entityId: string;
  formNo?: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  ref?: string;
  link?: string;
  createdAt: string;
  read: boolean;
}

export interface CompanyProfile {
  name: string;
  registrationNo: string;
  taxRegistrationNo: string;
  address: string[];
  phone: string;
  email: string;
  signatoryName: string;
  signatoryTitle: string;
}

export interface Settings {
  company: CompanyProfile;
  tax: { label: string; ratePct: number };
}
