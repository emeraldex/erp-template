// Row → domain mapping. The domain types in ./types are the API contract the
// web client and the Section 8 script consume, so these mappers reproduce them
// exactly: ISO-string timestamps, optional keys omitted (not null), and
// Decimal columns narrowed back to JS numbers.

import {
  AuditEntry, Branch, Demand, FodIncident, FormRecord, Invoice, Job, JobPriority,
  OvRepair, Partner, Quotation, Rating, Role, Tool, TrainingRecord, User,
} from './types';
import type { InvoiceStreamDef, SlaRule } from './workflow-config';

/** Prisma enum identifiers cannot contain '-', so NORTHEAST round-trips here. */
export const toBranch = (b: string): Branch => (b === 'NORTHEAST' ? 'NORTHEAST' : b) as Branch;
export const fromBranch = (b: Branch): string => (b === 'NORTHEAST' ? 'NORTHEAST' : b);

const iso = (d: Date): string => d.toISOString();
const num = (d: { toString(): string } | null | undefined): number =>
  d === null || d === undefined ? 0 : Number(d.toString());

/** Drop keys whose value is null/undefined so responses omit them, as before. */
function compact<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) {
    if (o[k] === null || o[k] === undefined) delete o[k];
  }
  return o;
}

export const mapAudit = (rows: { at: Date; by: string; role: string; action: string; fields: unknown }[]): AuditEntry[] =>
  rows.map((r) =>
    compact({
      at: iso(r.at),
      by: r.by,
      role: r.role as Role,
      action: r.action,
      fields: (r.fields ?? undefined) as Record<string, string> | undefined,
    }) as AuditEntry,
  );

export const mapRecords = (rows: { formNo: string; refNo: string; date: string; by: string; note: string | null }[]): FormRecord[] =>
  rows.map((r) => compact({ formNo: r.formNo, refNo: r.refNo, date: r.date, by: r.by, note: r.note ?? undefined }) as FormRecord);

export function mapUser(r: any): User & { passwordHash: string } {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    password: '',
    passwordHash: r.passwordHash,
    role: r.role as Role,
    designation: r.designation,
    branch: toBranch(r.branch),
  };
}

export function mapPriority(r: any): JobPriority {
  return compact({
    type: r.type,
    quantity: r.quantity,
    route: r.route,
    suffixK: r.suffixK,
    state: r.state,
    colRef: r.colRef,
    raisedAt: iso(r.raisedAt),
    raisedBy: r.raisedBy,
    edd: r.edd ?? undefined,
    remark: r.remark ?? undefined,
    closedAt: r.closedAt ? iso(r.closedAt) : undefined,
    closeReason: r.closeReason ?? undefined,
    audit: mapAudit(r.audit ?? []),
  }) as JobPriority;
}

export function mapJob(r: any): Job {
  const demandIds: string[] = (r.demands ?? []).map((d: { id: string }) => d.id);
  const invoiceIds: string[] = (r.invoices ?? []).map((i: { id: string }) => i.id);
  return compact({
    id: r.id,
    psDate: r.psDate,
    component: r.component,
    partNo: r.partNo,
    serialNo: r.serialNo,
    category: r.category,
    originUnit: r.originUnit,
    repairUnit: toBranch(r.repairUnit),
    status: r.status,
    location: r.location,
    receivedAt: iso(r.receivedAt),
    statusSince: iso(r.statusSince),
    demandIds,
    ovId: r.ovId ?? undefined,
    invoiceIds: invoiceIds.length ? invoiceIds : undefined,
    priority: r.priority ? mapPriority(r.priority) : undefined,
    indentRef: r.indentRef ?? undefined,
    records: mapRecords(r.records ?? []),
    audit: mapAudit(r.audit ?? []),
  }) as Job;
}

export const mapQuotation = (r: any): Quotation =>
  compact({
    supplierId: r.supplierId,
    supplier: r.supplier,
    priceMYR: num(r.priceMYR),
    eddDays: r.eddDays,
    remarks: r.remarks ?? undefined,
  }) as Quotation;

export function mapDemand(r: any): Demand {
  return compact({
    id: r.id,
    jobId: r.jobId,
    partDescription: r.partDescription,
    partNo: r.partNo,
    qty: r.qty,
    status: r.status,
    statusSince: iso(r.statusSince),
    raisedBy: r.raisedBy,
    branch: toBranch(r.branch),
    stockCheck: r.stockF244Ref
      ? compact({ f244Ref: r.stockF244Ref, available: !!r.stockAvailable, holdingUnit: r.stockHoldingUnit ?? undefined })
      : undefined,
    rfqRef: r.rfqRef ?? undefined,
    quotations: (r.quotations ?? []).map(mapQuotation),
    evaluation: r.evalF221Ref
      ? compact({
          f221Ref: r.evalF221Ref,
          selectedSupplierId: r.evalSupplierId,
          localPurchase: r.evalLocalPurchase ?? undefined,
          f241Ref: r.evalF241Ref ?? undefined,
        })
      : undefined,
    poRef: r.poRef ?? undefined,
    discrepancy: r.discF217Ref ? { f217Ref: r.discF217Ref, note: r.discNote ?? '' } : undefined,
    records: mapRecords(r.records ?? []),
    audit: mapAudit(r.audit ?? []),
  }) as Demand;
}

export function mapOv(r: any): OvRepair {
  return compact({
    id: r.id,
    jobId: r.jobId,
    defectReportRef: r.defectReportRef,
    am75Ref: r.am75Ref,
    vendorId: r.vendorId ?? undefined,
    vendorName: r.vendorName ?? undefined,
    f134Ref: r.f134Ref ?? undefined,
    poRef: r.poRef ?? undefined,
    costMYR: r.costMYR === null || r.costMYR === undefined ? undefined : num(r.costMYR),
    eddDays: r.eddDays ?? undefined,
    aboveIndent: r.aboveIndent ?? undefined,
    f119Ref: r.f119Ref ?? undefined,
    status: r.status,
    statusSince: iso(r.statusSince),
    records: mapRecords(r.records ?? []),
    audit: mapAudit(r.audit ?? []),
  }) as OvRepair;
}

export function mapPartner(r: any): Partner {
  return compact({
    id: r.id,
    name: r.name,
    type: r.type,
    status: r.status,
    country: r.country,
    certifications: r.certifications ?? [],
    lists: r.lists ?? [],
    rating: (r.rating ?? undefined) as Rating | undefined,
    evaluationRef: r.evaluationRef ?? undefined,
    siteAuditRef: r.siteAuditRef ?? undefined,
    lastAssessed: r.lastAssessed ?? undefined,
    nextReassessment: r.nextReassessment ?? undefined,
    nonConformances: r.nonConformances,
    factorsEvaluated: r.factorsEvaluated,
    cars: (r.cars ?? []).map((c: any) => ({ ref: c.ref, date: c.date, reason: c.reason })),
    audit: mapAudit(r.audit ?? []),
  }) as Partner;
}

export function mapFod(r: any): FodIncident {
  return compact({
    id: r.id,
    date: r.date,
    partName: r.partName,
    typeModel: r.typeModel,
    serialNo: r.serialNo,
    area: r.area,
    location: r.location,
    discovered: r.discovered,
    rootCause: r.rootCause ?? undefined,
    correctiveAction: r.correctiveAction ?? undefined,
    reporter: r.reporter,
    focalPoint: r.focalPoint,
    status: r.status,
    audit: mapAudit(r.audit ?? []),
  }) as FodIncident;
}

export const mapTool = (r: any): Tool =>
  compact({ tag: r.tag, name: r.name, board: r.board, holder: r.holder ?? undefined, status: r.status, since: iso(r.since) }) as Tool;

export const mapTraining = (r: any): TrainingRecord => ({
  person: r.person,
  course: r.course,
  date: r.date,
  nextDue: r.nextDue,
});

export function mapInvoice(r: any): Invoice {
  return compact({
    id: r.id,
    stream: r.stream,
    jobId: r.jobId ?? undefined,
    customer: r.customer,
    period: r.period ?? undefined,
    amountMYR: num(r.amountMYR),
    gstRate: num(r.gstRate),
    taxLabel: r.taxLabel ?? 'GST',
    gstMYR: num(r.gstMYR),
    totalMYR: num(r.totalMYR),
    status: r.status,
    statusSince: iso(r.statusSince),
    f311Ref: r.f311Ref ?? undefined,
    ctcRef: r.ctcRef ?? undefined,
    customerSignRef: r.customerSignRef ?? undefined,
    correctnessBy: r.correctnessBy ?? undefined,
    salesPerfRef: r.salesPerfRef ?? undefined,
    paymentRef: r.paymentRef ?? undefined,
    paidAt: r.paidAt ?? undefined,
    outstanding: r.outstanding,
    raisedBy: r.raisedBy,
    branch: toBranch(r.branch),
    records: mapRecords(r.records ?? []),
    audit: mapAudit(r.audit ?? []),
  }) as Invoice;
}

export const mapSla = (r: any): SlaRule => ({
  id: r.id,
  entity: r.entity,
  status: r.status,
  days: r.days,
  rule: r.rule,
  source: r.source,
});

export const mapStream = (r: any): InvoiceStreamDef => ({
  id: r.id,
  label: r.label,
  labelMs: r.labelMs,
  customer: r.customer,
  perJob: r.perJob,
  docSet: r.docSet ?? [],
  deadlines: (r.deadlines ?? []) as { label: string; note: string }[],
});

export const mapTransition = (r: any) =>
  compact({
    from: r.from,
    to: r.to,
    label: r.label,
    labelMs: r.labelMs,
    roles: r.roles as Role[],
    requires: (r.requires ?? []) as { key: string; label: string; formNo?: string }[],
    setLocation: r.setLocation ?? undefined,
  });
