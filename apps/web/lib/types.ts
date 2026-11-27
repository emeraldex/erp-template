// ─── CO-RFP-IT-001 client types (mirror of apps/api/src/common/types.ts) ───

// Statuses, roles, sites, locations, categories and priorities are each
// organisation's own lists (GET /config → dictionary), so they are strings here.
// The aviation pack's keys (STORES, AWAITING_TDI, AOG…) are just one set of values.

/** Role key, e.g. ADMIN, TECHNICIAN — see config.dictionary.role. */
export type Role = string;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  designation: string;
  branch: string;
  mustChangePassword?: boolean;
  /** What this person may do (org.admin, jobs.register…). */
  capabilities?: string[];
}

/** Site key (config.dictionary.site). */
export type Branch = string;
/** Location key (config.dictionary.location). */
export type Location = string;
/** Status keys of each workflow (config.jobStatusMeta etc.). */
export type JobStatus = string;

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
  category: string;
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
  jobType?: string;
  assetId?: string;
  pmScheduleId?: string;
  checklist?: ChecklistItem[];
  assigneeId?: string;
  assigneeName?: string;
  assignedAt?: string;
  records: FormRecord[];
  audit: AuditEntry[];
}

export interface ChecklistItem {
  key: string;
  label: string;
  required: boolean;
  done: boolean;
  by?: string;
  at?: string;
  note?: string;
}

// Priority overlay (AOG / ROA in the aviation pack) AOG / ROA / Critical priority overlay (5.9) — FR-15
export type PriorityType = string;
export type RepairRoute = string;

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

export type DemandStatus = string;

export interface Quotation {
  supplierId: string;
  supplier: string;
  priceMYR: number;
  eddDays: number;
  remarks?: string;
}

export interface Demand {
  id: string;
  /** Absent for purchases for stock. */
  jobId?: string;
  /** Catalogue part, when one was chosen. */
  partId?: string;
  /** The store a purchase for stock is for (or where it was received). */
  forStore?: string;
  /** Cost per unit when received into stock. */
  unitCost?: number;
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

export type OvStatus = string;

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
  area: string;
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
  course: string;
  date: string;
  nextDue: string;
}

// QP.51 Invoicing & Revenue Billing (5.8) — FR-13 / FR-14
export type InvoiceStream = string;
export type InvoiceStatus = string;

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
export type Phase = "new" | "active" | "waiting_parts" | "waiting_customer" | "external" | "done" | "closed";

export interface StatusMeta {
  en: string;
  ms: string;
  tone: "neutral" | "info" | "warn" | "good" | "bad";
  /** What the status means, whatever it is called. */
  phase?: Phase;
  /** Locked: no further changes. */
  final?: boolean;
  draftDocuments?: boolean;
  acceptsQuotations?: boolean;
  /** Shown off the main progress line. */
  branch?: boolean;
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
  requires: StepField[];
  setLocation?: Location;
  effects?: { type: string; params?: Record<string, unknown> }[];
}

export type FieldType = "text" | "number" | "date" | "user" | "photo" | "signature" | "part" | "store";

/** A field on a workflow step: mandatory unless marked optional. Untyped fields are free text. */
export interface StepField { key: string; label: string; formNo?: string; type?: FieldType; optional?: boolean }

/** Someone who works here, for person pickers (GET /users/directory). */
export interface StaffMember { id: string; name: string; role: string; branch: string }

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
  pack?: { id: string; name: string };
  terms?: Terms;
  modules?: Modules;
  /** The organisation's currency. */
  currency?: { code: string; symbol: string; decimals: number; name: string; major: string; minor: string };
  phases?: Phase[];
  capabilities?: Record<string, string>;
  /** Every list the organisation keeps: status:JOB, role, site, location, category, assetType… */
  dictionary?: Record<string, DictEntry[]>;
}

export interface DictEntry {
  key: string;
  label: string;
  labelMs: string;
  meta: Record<string, unknown>;
  active: boolean;
}

/** Words the interface uses, so each sector sees its own vocabulary. */
export interface Terms {
  job: string; jobs: string; jobNo: string; jobRegister: string;
  component: string; originUnit: string; site: string; sites: string;
  demand: string; demands: string; vendorRepair: string; vendorRepairs: string;
  priority: string; incident: string; incidents: string; registers: string;
  asset: string; assets: string; pm: string;
}

export interface Modules {
  procurement: boolean; vendorRepair: boolean; priority: boolean; incidents: boolean;
  tools: boolean; training: boolean; invoicing: boolean; registers: boolean;
  assets: boolean; pm: boolean; stock: boolean; requests: boolean; labour: boolean;
}

export interface Meter { key: string; label: string; unit: string; value: number; readAt: string | null }

export interface Asset {
  id: string;
  tag: string;
  name: string;
  type: string;
  site: string;
  location: string;
  parentId: string | null;
  make: string;
  model: string;
  serialNo: string;
  status: "IN_SERVICE" | "OUT_OF_SERVICE" | "RETIRED";
  criticality: "HIGH" | "MEDIUM" | "LOW";
  commissionedOn: string | null;
  attributes: Record<string, unknown>;
  createdAt: string;
  meters: Meter[];
  children?: number | { id: string; tag: string; name: string; type: string; status: string }[];
  schedules?: number | PmSchedule[];
  openJobs?: number;
  parent?: { id: string; tag: string; name: string } | null;
  jobs?: { id: string; psDate: string; status: string; jobType: string; category: string; statusSince: string; pmScheduleId: string | null }[];
}

export interface PmSchedule {
  id: string;
  assetId: string;
  title: string;
  active: boolean;
  intervalDays: number | null;
  meterKey: string | null;
  intervalMeter: number | null;
  leadDays: number;
  leadMeter: number;
  jobType: string;
  category: string;
  instructions: string;
  checklist: { key: string; label: string; required: boolean }[];
  lastDoneAt: string | null;
  lastDoneMeter: number | null;
  nextDueAt: string | null;
  nextDueMeter: number | null;
  openJobId: string | null;
  asset?: { tag: string; name: string; site: string };
  meterValue?: number | null;
  meterUnit?: string | null;
  overdue?: boolean;
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
  /** Store places at or below their reorder point; null when stock control is off. */
  lowStock?: number | null;
  /** Portal requests waiting for triage; null when the portal is off. */
  newRequests?: number | null;
  /** Requesters' average rating over 90 days. */
  satisfaction?: { average: number; ratings: number } | null;
  /** Assets out of action now; null when the asset register is off. */
  assetsDown?: number | null;
  /** Preventive work due in the last 90 days and how much was done on time. */
  pmCompliance90?: { due: number; onTime: number; pct: number | null } | null;
}

export interface Attachment {
  id: string;
  kind?: "file" | "photo" | "signature";
  caption?: string;
  signedBy?: string;
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
  pack?: { id: string; name: string };
  terms?: Terms;
  modules?: Modules;
  defaults?: { jobPrefix: string; initialLocation: string };
  portal?: PortalSettings;
  brand?: { accent: string | null; defaultTheme: "dark" | "light" | "system" };
  maintenance?: { pmGraceDays: number };
}

// ─── stock ──────────────────────────────────────────────────────────────────

export interface StockLevel {
  store: string;
  storeLabel: string;
  bin: string;
  qty: number;
  reorderPoint: number | null;
  reorderQty: number | null;
  low: boolean;
  countedAt: string | null;
}

export interface StockMovement {
  id: string;
  partId: string;
  store: string;
  type: "OPENING" | "RECEIPT" | "ISSUE" | "RETURN" | "ADJUST" | "COUNT" | "TRANSFER_OUT" | "TRANSFER_IN";
  qty: number;
  unitCost: number;
  balanceAfter: number;
  jobId: string | null;
  demandId: string | null;
  countId: string | null;
  transferRef: string | null;
  reason: string;
  by: string;
  at: string;
}

export interface Part {
  id: string;
  partNo: string;
  name: string;
  description: string;
  unit: string;
  group: string;
  manufacturer: string;
  mfrPartNo: string;
  preferredSupplierId: string | null;
  avgCost: number;
  lastCost: number | null;
  active: boolean;
  levels: StockLevel[];
  onHand: number;
  value: number;
  low: boolean;
  movements?: StockMovement[];
  requests?: { id: string; jobId: string | null; forStore: string | null; qty: number; status: string }[];
}

export interface ReorderLine {
  partId: string;
  partNo: string;
  name: string;
  unit: string;
  store: string;
  storeLabel: string;
  bin: string;
  qty: number;
  reorderPoint: number;
  suggested: number;
  avgCost: number;
  openRequest: string | null;
}

export interface JobParts {
  lines: { partId: string; partNo: string; name: string; unit: string; qty: number; cost: number }[];
  total: number;
}

export interface StockCountLine {
  partId: string;
  partNo: string;
  name: string;
  unit: string;
  bin: string;
  systemQty: number;
  countedQty: number | null;
  onHand: number;
  difference: number | null;
  avgCost: number;
  value: number | null;
}

export interface StockCount {
  id: string;
  store: string;
  storeLabel: string;
  status: "OPEN" | "POSTED" | "CANCELLED";
  note: string;
  startedBy: string;
  startedAt: string;
  postedBy: string | null;
  postedAt: string | null;
  lines: StockCountLine[] | number;
  counted?: number;
  total?: number;
  differenceValue?: number;
}

export interface ImportResult {
  dryRun: boolean;
  rows: number;
  created: string[];
  updated: string[];
  levels: number;
  openings: number;
  errors: { row: number; message: string }[];
}

// ─── request portal ─────────────────────────────────────────────────────────

export type RequestStatus = "NEW" | "ACCEPTED" | "DECLINED" | "CANCELLED";

export interface RequestMessage { from: "TEAM" | "REQUESTER"; by: string; body: string; at: string }

export interface ServiceRequestSummary {
  id: string;
  status: RequestStatus;
  createdAt: string;
  description: string;
  place: string;
  site: string;
  siteLabel: string;
  category: string;
  categoryLabel: string;
  urgent: boolean;
  requesterName: string;
  source: "PORTAL" | "POSTER" | "STAFF";
  jobId: string | null;
  merged: boolean;
  photos: number;
  rating: number | null;
  awaitingReply: boolean;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface ServiceRequest extends ServiceRequestSummary {
  requesterEmail: string;
  requesterPhone: string;
  lang: "en" | "ms";
  pointCode: string | null;
  asset: { id: string; tag: string; name: string } | null;
  declineReason: string;
  spam: boolean;
  ratingComment: string;
  messages: RequestMessage[];
  photoIds: string[];
  duplicates: { jobs: { id: string; component: string; status: string; receivedAt: string }[]; requests: { id: string; description: string; createdAt: string }[] };
  trackLink: string | null;
}

export interface JobRequester {
  id: string;
  createdAt: string;
  merged: boolean;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  urgent: boolean;
  description: string;
  rating: number | null;
  ratingComment: string;
  ratedAt: string | null;
  doneNotified: boolean;
  messages: RequestMessage[];
}

export interface RequestPoint {
  code: string;
  label: string;
  site: string;
  siteLabel: string;
  assetId: string | null;
  assetTag: string | null;
  active: boolean;
  createdBy: string;
  createdAt: string;
  requests: number;
}

export interface PortalSettings {
  open: boolean;
  accessCode: string;
  intro: string;
  introMs: string;
  askCategory: boolean;
  triageHours: number;
}
