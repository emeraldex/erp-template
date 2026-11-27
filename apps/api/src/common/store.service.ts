import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Prisma } from '../generated/prisma/client';
import { checkTypedFields } from '../workflow/fields';
import { currentTenant } from '../tenancy/tenant';
import { ADMIN_ROLE, CAPABILITIES, type Capability, type Kind as WorkflowKind, type Phase, type StatusMeta } from '../packs/types';
import { AVIATION } from '../packs/aviation';
import { dictionaryRows } from '../seed-db';
import { PrismaService } from './prisma.service';
import {
  fromBranch, mapDemand, mapFod, mapInvoice, mapJob, mapOv, mapPartner, mapSla,
  mapStream, mapTool, mapTraining, mapTransition, mapUser,
} from './mappers';
import {
  AuditEntry, Demand, DemandStatus, FodIncident, Invoice, InvoiceStatus, Job, JobStatus,
  OvRepair, OvStatus, Partner, Role, Tool, TrainingRecord, TransitionRule, User,
} from './types';
import type { InvoiceStreamDef, SlaRule } from './workflow-config';

type Kind = 'job' | 'demand' | 'ov' | 'partner' | 'fod' | 'invoice' | 'tool';

/**
 * Snapshot taken at hydration. `version` drives optimistic concurrency; the
 * counts let save() append only the audit/record/quotation/CAR rows the caller
 * actually added, instead of rewriting whole collections.
 */
interface Snapshot {
  kind: Kind;
  version: number;
  audit: number;
  records: number;
  quotations: number;
  cars: number;
  priorityAudit: number;
  hadPriority: boolean;
  /** Staged by a new*() call and not yet inserted — save() INSERTs instead of UPDATEs. */
  isNew: boolean;
}

const ordered = { orderBy: { seq: 'asc' as const } };
const JOB_INCLUDE = {
  records: ordered,
  audit: ordered,
  demands: { select: { id: true } },
  invoices: { select: { id: true } },
  priority: { include: { audit: ordered } },
};
const DEMAND_INCLUDE = { records: ordered, audit: ordered, quotations: ordered };
const OV_INCLUDE = { records: ordered, audit: ordered };
const PARTNER_INCLUDE = { audit: ordered, cars: ordered };
const FOD_INCLUDE = { audit: ordered };
const INVOICE_INCLUDE = { records: ordered, audit: ordered };

/**
 * PostgreSQL-backed aggregate store.
 *
 * Domain services keep their synchronous business logic: they hydrate an
 * aggregate, mutate it in memory exactly as before, then hand it to save(),
 * which persists the whole aggregate in one transaction. Several aggregates
 * touched by the same workflow step (a job plus the demand it raises) can be
 * passed together so they commit atomically.
 */
interface WorkflowConfig {
  jobTransitions: TransitionRule<JobStatus>[];
  demandTransitions: TransitionRule<DemandStatus>[];
  ovTransitions: TransitionRule<OvStatus>[];
  invoiceTransitions: TransitionRule<InvoiceStatus>[];
  invoiceStreams: InvoiceStreamDef[];
  slaRules: SlaRule[];
  dictionary: Map<string, DictRow[]>;
  /** The sector pack the organisation started from. */
  packId: string;
  /** Active people and their roles, for routing (e.g. the incident focal point). */
  users: { name: string; role: string }[];
  loadedAt: number;
}

/** One vocabulary entry as the API serves it. */
export interface DictRow { key: string; label: string; labelMs: string; meta: Record<string, unknown>; active: boolean }

/** How long a tenant's cached workflow config is trusted before re-reading it. */
const CONFIG_TTL_MS = 30_000;

@Injectable()
export class StoreService {
  private readonly snaps = new WeakMap<object, Snapshot>();

  // Workflow-as-data (FR-02) is small and read on every transition, so each
  // tenant's copy is cached in memory, re-read every 30 s (so a change made on
  // another API replica shows up) and immediately after a change made here.
  private readonly configs = new Map<string, WorkflowConfig>();

  constructor(private readonly prisma: PrismaService) {}

  private cfg(): WorkflowConfig {
    const c = this.configs.get(currentTenant().id);
    if (!c) throw new Error(`Workflow config not loaded for tenant ${currentTenant().id}`);
    return c;
  }

  get jobTransitions() { return this.cfg().jobTransitions; }
  get demandTransitions() { return this.cfg().demandTransitions; }
  get ovTransitions() { return this.cfg().ovTransitions; }
  get invoiceTransitions() { return this.cfg().invoiceTransitions; }
  get invoiceStreams() { return this.cfg().invoiceStreams; }
  get slaRules() { return this.cfg().slaRules; }

  // ─── per-organisation vocabulary ────────────────────────────────────────────

  /** Entries of one dictionary kind (e.g. "site", "status:JOB"), in display order. */
  dict(kind: string, activeOnly = false): DictRow[] {
    const rows = this.cfg().dictionary.get(kind) ?? [];
    return activeOnly ? rows.filter((r) => r.active) : rows;
  }

  dictionaryAll(): Record<string, DictRow[]> {
    return Object.fromEntries(this.cfg().dictionary);
  }

  has(kind: string, key: string): boolean {
    return this.dict(kind, true).some((r) => r.key === key);
  }

  statusKeys(kind: WorkflowKind): string[] {
    return this.dict(`status:${kind}`).map((r) => r.key);
  }

  /** A workflow's starting status: the first in its list. */
  initialStatus(kind: WorkflowKind): string {
    const first = this.dict(`status:${kind}`)[0]?.key;
    if (!first) throw new Error(`The ${kind} workflow has no statuses`);
    return first;
  }

  finalStatuses(kind: WorkflowKind): string[] {
    return this.dict(`status:${kind}`).filter((r) => (r.meta as { final?: boolean }).final).map((r) => r.key);
  }

  statusesInPhase(kind: WorkflowKind, ...phases: Phase[]): string[] {
    return this.dict(`status:${kind}`).filter((r) => phases.includes((r.meta as { phase?: Phase }).phase as Phase)).map((r) => r.key);
  }

  status(kind: WorkflowKind, key: string): (StatusMeta & { label: string; labelMs: string }) | undefined {
    const r = this.dict(`status:${kind}`).find((s) => s.key === key);
    return r ? { ...(r.meta as unknown as StatusMeta), label: r.label, labelMs: r.labelMs } : undefined;
  }

  phaseOf(kind: WorkflowKind, key: string): Phase | undefined {
    return this.status(kind, key)?.phase;
  }

  isFinal(kind: WorkflowKind, key: string): boolean {
    return !!this.status(kind, key)?.final;
  }

  /** The {key: {en, ms, tone, phase…}} shape the web client renders status pills from. */
  statusMeta(kind: WorkflowKind): Record<string, StatusMeta & { en: string; ms: string }> {
    return this.dictMeta(`status:${kind}`) as unknown as Record<string, StatusMeta & { en: string; ms: string }>;
  }

  /** A dictionary as `{ KEY: { en, ms, ...meta } }`, the shape the web client renders from. */
  dictMeta(kind: string): Record<string, Record<string, unknown> & { en: string; ms: string }> {
    return Object.fromEntries(this.dict(kind).map((r) => [r.key, { ...r.meta, en: r.label, ms: r.labelMs || r.label }]));
  }

  label(kind: string, key: string): string {
    return this.dict(kind).find((r) => r.key === key)?.label ?? key;
  }

  /** The sector pack the organisation started from (aviation for older ones). */
  packId(): string {
    return this.cfg().packId;
  }

  /**
   * A citation of the aviation procedures (e.g. " (QP.44 stage 10)"). Other
   * sectors have their own procedures, so messages leave it out for them.
   */
  procedureRef(text: string): string {
    return this.cfg().packId === 'aviation' ? text : '';
  }

  /** Who incidents are routed to: the first active person (not IT) allowed to manage them. */
  focalPoint(): string {
    const roles = this.rolesWith('incidents.manage').filter((r) => r !== ADMIN_ROLE);
    return this.cfg().users.find((u) => roles.includes(u.role))?.name ?? 'Safety focal point';
  }

  /** An active person in this organisation, or null. */
  async activeUser(id: string): Promise<{ id: string; name: string; role: string; branch: string } | null> {
    if (!id) return null;
    return this.prisma.user.findFirst({ where: { id, deactivatedAt: null }, select: { id: true, name: true, role: true, branch: true } });
  }

  /** An attachment's facts, for checking photo and signature fields. */
  async attachmentBrief(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    return this.prisma.attachment.findUnique({
      where: { id }, select: { entity: true, entityId: true, kind: true, contentType: true, filename: true, signedBy: true },
    });
  }

  /**
   * Check a step's typed fields (numbers, dates, people, photos, signatures) and
   * show readable values in the audit entry the step just added.
   */
  async checkStepFields(rule: TransitionRule, fields: Record<string, string>, record: { audit: AuditEntry[] }, entity: string, entityId: string): Promise<void> {
    if (!rule.requires.some((f) => f.type && f.type !== 'text')) return;
    const shown = await checkTypedFields(rule.requires, fields, {
      entity, entityId, user: (id) => this.activeUser(id), attachment: (id) => this.attachmentBrief(id),
      part: (id) => this.prisma.part.findUnique({ where: { id }, select: { partNo: true, name: true, active: true } }),
      store: (key) => (this.has('store', key) ? this.label('store', key) : null),
    });
    const entry = record.audit.at(-1);
    if (entry?.fields && Object.keys(shown).length) entry.fields = { ...entry.fields, ...shown };
  }

  /** Attachment metadata for one record (no file contents). */
  async attachmentsOf(entity: string, entityId: string) {
    const rows = await this.prisma.attachment.findMany({ where: { entity, entityId }, orderBy: { uploadedAt: 'asc' } });
    return rows.map((a) => ({
      id: a.id, filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes, kind: a.kind,
      ...(a.caption ? { caption: a.caption } : {}), ...(a.signedBy ? { signedBy: a.signedBy } : {}), ...(a.formNo ? { formNo: a.formNo } : {}),
      uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt.toISOString(),
    }));
  }

  /** An in-app notification for one person. */
  async notify(userId: string, n: { kind: string; title: string; body: string; ref?: string }): Promise<void> {
    await this.prisma.notification.create({ data: { id: randomUUID(), userId, kind: n.kind, title: n.title, body: n.body, ref: n.ref ?? null } });
  }

  /** What a role may do; ADMIN may do everything. */
  capabilitiesOf(role: string): Capability[] {
    if (role === ADMIN_ROLE) return Object.keys(CAPABILITIES) as Capability[];
    const meta = this.dict('role').find((r) => r.key === role)?.meta as { capabilities?: Capability[] } | undefined;
    return meta?.capabilities ?? [];
  }

  rolesWith(capability: Capability): string[] {
    return this.dict('role', true).map((r) => r.key).filter((k) => this.capabilitiesOf(k).includes(capability));
  }

  /** Load the current tenant's config if missing or stale. */
  async ensureConfig(): Promise<void> {
    const c = this.configs.get(currentTenant().id);
    if (!c || Date.now() - c.loadedAt > CONFIG_TTL_MS) await this.reloadConfig();
  }

  async reloadConfig(): Promise<void> {
    // Organisations created before dictionaries existed all ran the aviation
    // configuration: give them its vocabulary once, so nothing changes for them.
    if ((await this.prisma.dictionaryEntry.count()) === 0) {
      await this.prisma.dictionaryEntry.createMany({ data: dictionaryRows(AVIATION).map((r) => ({ ...r, meta: r.meta as never })), skipDuplicates: true });
    }
    await this.backfillAviationActions();
    const [rules, streams, sla, entries, pack, focal] = await Promise.all([
      this.prisma.transitionRuleRow.findMany({ orderBy: { seq: 'asc' } }),
      this.prisma.invoiceStreamDef.findMany({ orderBy: { seq: 'asc' } }),
      this.prisma.slaRule.findMany({ orderBy: { seq: 'asc' } }),
      this.prisma.dictionaryEntry.findMany({ orderBy: [{ kind: 'asc' }, { seq: 'asc' }, { id: 'asc' }] }),
      this.prisma.setting.findUnique({ where: { key: 'pack' } }),
      this.prisma.user.findMany({ where: { deactivatedAt: null }, select: { name: true, role: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const dictionary = new Map<string, DictRow[]>();
    for (const e of entries) {
      const list = dictionary.get(e.kind) ?? [];
      list.push({ key: e.key, label: e.label, labelMs: e.labelMs, meta: (e.meta ?? {}) as Record<string, unknown>, active: e.active });
      dictionary.set(e.kind, list);
    }
    const of = (kind: string) => rules.filter((r) => r.kind === kind).map(mapTransition);
    this.configs.set(currentTenant().id, {
      jobTransitions: of('JOB') as TransitionRule<JobStatus>[],
      demandTransitions: of('DEMAND') as TransitionRule<DemandStatus>[],
      ovTransitions: of('OV') as TransitionRule<OvStatus>[],
      invoiceTransitions: of('INVOICE') as TransitionRule<InvoiceStatus>[],
      invoiceStreams: streams.map(mapStream),
      slaRules: sla.map(mapSla),
      dictionary,
      // Organisations from before packs existed ran the aviation configuration.
      packId: ((pack?.value ?? {}) as { id?: string }).id ?? 'aviation',
      users: focal,
      loadedAt: Date.now(),
    });
  }

  /**
   * Before step actions existed, the aviation behaviour was built into the
   * services. Give such organisations the equivalent actions once: only when
   * no step has any action yet, and only on steps matching the aviation ones.
   */
  private async backfillAviationActions(): Promise<void> {
    if (await this.prisma.setting.count({ where: { key: 'pack' } })) return; // set up from a pack: nothing to infer
    const withActions = await this.prisma.transitionRuleRow.count({ where: { NOT: { effects: { equals: [] } } } });
    if (withActions > 0) return;
    for (const kind of ['JOB', 'DEMAND', 'OV', 'INVOICE'] as const) {
      for (const r of AVIATION.transitions[kind].filter((t) => t.effects?.length)) {
        await this.prisma.transitionRuleRow.updateMany({ where: { kind, from: r.from, to: r.to }, data: { effects: r.effects as never } });
      }
    }
    for (const s of AVIATION.invoiceStreams.filter((x) => x.requiredFields)) {
      await this.prisma.invoiceStreamDef.updateMany({ where: { id: s.id, requiredFields: { equals: {} } }, data: { requiredFields: s.requiredFields as never } });
    }
  }

  // ─── helpers carried over from the in-memory store ──────────────────────────

  audit(by: string, role: Role, action: string, fields?: Record<string, string>): AuditEntry {
    return {
      at: new Date().toISOString(),
      by,
      role,
      action,
      ...(fields && Object.keys(fields).length ? { fields } : {}),
    };
  }

  private idFrom(prefix: string, ids: string[]): string {
    const year = new Date().getFullYear();
    const max = ids
      .map((x) => Number(x.split('-').pop()))
      .filter((n) => !Number.isNaN(n))
      .reduce((a, b) => Math.max(a, b), 0);
    return `${prefix}-${year}-${String(max + 1).padStart(4, '0')}`;
  }

  async nextJobId(prefix = 'PS'): Promise<string> {
    const ids = (await this.prisma.job.findMany({ where: { id: { startsWith: `${prefix}-` } }, select: { id: true } })).map((r) => r.id);
    return this.idFrom(prefix, ids);
  }

  async nextDemandId(): Promise<string> {
    return this.idFrom('DM', (await this.prisma.demand.findMany({ where: { id: { startsWith: 'DM-' } }, select: { id: true } })).map((r) => r.id));
  }
  async nextOvId(): Promise<string> {
    return this.idFrom('OV', (await this.prisma.ovRepair.findMany({ select: { id: true } })).map((r) => r.id));
  }
  async nextFodId(): Promise<string> {
    return this.idFrom('FOD', (await this.prisma.fodIncident.findMany({ select: { id: true } })).map((r) => r.id));
  }
  async nextInvoiceId(): Promise<string> {
    return this.idFrom('INV', (await this.prisma.invoice.findMany({ select: { id: true } })).map((r) => r.id));
  }
  async nextPartnerId(type: 'SUPPLIER' | 'SUBCONTRACTOR'): Promise<string> {
    const ids = (await this.prisma.partner.findMany({ where: { type }, select: { id: true } })).map((r) => r.id);
    return this.idFrom(type === 'SUPPLIER' ? 'SUP' : 'SUB', ids);
  }

  private stamp(e: object, kind: Kind, version: number, counts: Partial<Snapshot> = {}): void {
    this.snaps.set(e, {
      kind,
      version,
      audit: counts.audit ?? 0,
      records: counts.records ?? 0,
      quotations: counts.quotations ?? 0,
      cars: counts.cars ?? 0,
      priorityAudit: counts.priorityAudit ?? 0,
      hadPriority: counts.hadPriority ?? false,
      isNew: counts.isNew ?? false,
    });
  }

  private snapOf(e: object): Snapshot {
    const s = this.snaps.get(e);
    if (!s) throw new Error('Entity was not hydrated by StoreService — cannot persist it safely.');
    return s;
  }

  private track<T extends { audit: unknown[]; records?: unknown[] }>(e: T, kind: Kind, version: number, extra: Partial<Snapshot> = {}): T {
    this.stamp(e, kind, version, {
      audit: e.audit.length,
      records: e.records?.length ?? 0,
      ...extra,
    });
    return e;
  }

  /** Partners carry audit + CARs but no Section 6 records collection. */
  private trackPartner(p: Partner, version: number): Partner {
    this.stamp(p, 'partner', version, { audit: p.audit.length, cars: p.cars.length });
    return p;
  }

  /** FOD incidents carry an audit trail but no records collection. */
  private trackFod(f: FodIncident, version: number): FodIncident {
    this.stamp(f, 'fod', version, { audit: f.audit.length });
    return f;
  }

  // ─── reads ──────────────────────────────────────────────────────────────────

  async userByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
    const r = await this.prisma.user.findUnique({ where: { email } });
    return r ? mapUser(r) : null;
  }

  /** Active jobs by default; archived ones (FR-12) only when asked for. */
  async jobs(archived: 'exclude' | 'include' | 'only' = 'exclude'): Promise<Job[]> {
    const where = archived === 'include' ? {} : archived === 'only' ? { archivedAt: { not: null } } : { archivedAt: null };
    const rows = await this.prisma.job.findMany({ where, include: JOB_INCLUDE, orderBy: { ordinal: 'desc' } });
    return rows.map((r) => this.track(mapJob(r), 'job', r.version, {
      priorityAudit: r.priority?.audit.length ?? 0,
      hadPriority: !!r.priority,
    }));
  }

  async job(id: string): Promise<Job | null> {
    const r = await this.prisma.job.findUnique({ where: { id }, include: JOB_INCLUDE });
    if (!r) return null;
    return this.track(mapJob(r), 'job', r.version, {
      priorityAudit: r.priority?.audit.length ?? 0,
      hadPriority: !!r.priority,
    });
  }

  async demands(): Promise<Demand[]> {
    const rows = await this.prisma.demand.findMany({ include: DEMAND_INCLUDE, orderBy: { ordinal: 'desc' } });
    return rows.map((r) => this.track(mapDemand(r), 'demand', r.version, { quotations: r.quotations.length }));
  }

  async demand(id: string): Promise<Demand | null> {
    const r = await this.prisma.demand.findUnique({ where: { id }, include: DEMAND_INCLUDE });
    return r ? this.track(mapDemand(r), 'demand', r.version, { quotations: r.quotations.length }) : null;
  }

  async demandExists(id: string): Promise<boolean> {
    return (await this.prisma.demand.count({ where: { id } })) > 0;
  }

  async ovRepairs(): Promise<OvRepair[]> {
    const rows = await this.prisma.ovRepair.findMany({ include: OV_INCLUDE, orderBy: { ordinal: 'desc' } });
    return rows.map((r) => this.track(mapOv(r), 'ov', r.version));
  }

  async ovRepair(id: string): Promise<OvRepair | null> {
    const r = await this.prisma.ovRepair.findUnique({ where: { id }, include: OV_INCLUDE });
    return r ? this.track(mapOv(r), 'ov', r.version) : null;
  }

  async partners(): Promise<Partner[]> {
    const rows = await this.prisma.partner.findMany({ include: PARTNER_INCLUDE, orderBy: { ordinal: 'desc' } });
    return rows.map((r) => this.trackPartner(mapPartner(r), r.version));
  }

  async partner(id: string): Promise<Partner | null> {
    const r = await this.prisma.partner.findUnique({ where: { id }, include: PARTNER_INCLUDE });
    return r ? this.trackPartner(mapPartner(r), r.version) : null;
  }

  async fodIncidents(): Promise<FodIncident[]> {
    const rows = await this.prisma.fodIncident.findMany({ include: FOD_INCLUDE, orderBy: { ordinal: 'desc' } });
    return rows.map((r) => this.trackFod(mapFod(r), r.version));
  }

  async fodIncident(id: string): Promise<FodIncident | null> {
    const r = await this.prisma.fodIncident.findUnique({ where: { id }, include: FOD_INCLUDE });
    return r ? this.trackFod(mapFod(r), r.version) : null;
  }

  async tools(): Promise<Tool[]> {
    const rows = await this.prisma.tool.findMany({ orderBy: { ordinal: 'asc' } });
    return rows.map((r) => {
      const t = mapTool(r);
      this.stamp(t, 'tool', 0);
      return t;
    });
  }

  async tool(tag: string): Promise<Tool | null> {
    const r = await this.prisma.tool.findUnique({ where: { tag } });
    if (!r) return null;
    const t = mapTool(r);
    this.stamp(t, 'tool', 0);
    return t;
  }

  async training(): Promise<TrainingRecord[]> {
    return (await this.prisma.trainingRecord.findMany({ orderBy: { ordinal: 'asc' } })).map(mapTraining);
  }

  async invoices(): Promise<Invoice[]> {
    const rows = await this.prisma.invoice.findMany({ include: INVOICE_INCLUDE, orderBy: { ordinal: 'desc' } });
    return rows.map((r) => this.track(mapInvoice(r), 'invoice', r.version));
  }

  async invoice(id: string): Promise<Invoice | null> {
    const r = await this.prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    return r ? this.track(mapInvoice(r), 'invoice', r.version) : null;
  }

  async weeklyClosures(): Promise<number[]> {
    return (await this.prisma.weeklyClosure.findMany({ orderBy: { week: 'asc' } })).map((r) => r.count);
  }

  /**
   * Narrow projections for the dashboard. Hydrating full aggregates here would
   * drag every audit entry and form record across the wire on each KPI refresh.
   */
  async dashboardSnapshot() {
    const [jobs, demands, ovs, invoices, partners, fod, tools, closures] = await Promise.all([
      this.prisma.job.findMany({
        select: {
          id: true, status: true, statusSince: true, receivedAt: true, component: true,
          priority: {
            select: { state: true, type: true, route: true, colRef: true, edd: true, raisedAt: true },
          },
        },
      }),
      this.prisma.demand.findMany({ select: { id: true, status: true, statusSince: true, partDescription: true } }),
      this.prisma.ovRepair.findMany({ select: { id: true, status: true, statusSince: true, vendorName: true } }),
      this.prisma.invoice.findMany({
        select: {
          id: true, status: true, statusSince: true, stream: true, customer: true,
          totalMYR: true, gstMYR: true, outstanding: true,
        },
      }),
      this.prisma.partner.findMany({ select: { status: true, nextReassessment: true } }),
      this.prisma.fodIncident.findMany({ select: { status: true } }),
      this.prisma.tool.findMany({ select: { status: true } }),
      this.weeklyClosures(),
    ]);
    const n = (d: { toString(): string }) => Number(d.toString());
    return {
      jobs: jobs.map((j) => ({
        id: j.id, status: j.status, statusSince: j.statusSince.toISOString(),
        receivedAt: j.receivedAt.toISOString(), component: j.component,
        priority: j.priority
          ? { ...j.priority, raisedAt: j.priority.raisedAt.toISOString(), edd: j.priority.edd ?? undefined }
          : undefined,
      })),
      demands: demands.map((d) => ({ ...d, statusSince: d.statusSince.toISOString() })),
      ovs: ovs.map((o) => ({ ...o, statusSince: o.statusSince.toISOString(), vendorName: o.vendorName ?? undefined })),
      invoices: invoices.map((i) => ({
        ...i, statusSince: i.statusSince.toISOString(), totalMYR: n(i.totalMYR), gstMYR: n(i.gstMYR),
      })),
      partners,
      fod,
      tools,
      closures,
    };
  }

  // ─── staged creates ─────────────────────────────────────────────────────────
  // new*() only marks the aggregate; the INSERT happens inside save()'s
  // transaction so a job transition that also raises a demand commits atomically.

  newJob(job: Job): Job {
    this.stamp(job, 'job', 0, { isNew: true });
    return job;
  }
  newDemand(dm: Demand): Demand {
    this.stamp(dm, 'demand', 0, { isNew: true });
    return dm;
  }
  newOv(ov: OvRepair): OvRepair {
    this.stamp(ov, 'ov', 0, { isNew: true });
    return ov;
  }
  newPartner(p: Partner): Partner {
    this.stamp(p, 'partner', 0, { isNew: true });
    return p;
  }
  newFod(f: FodIncident): FodIncident {
    this.stamp(f, 'fod', 0, { isNew: true });
    return f;
  }
  newInvoice(inv: Invoice): Invoice {
    this.stamp(inv, 'invoice', 0, { isNew: true });
    return inv;
  }

  private async ordinalIn(model: any): Promise<number> {
    const agg = await model.aggregate({ _max: { ordinal: true } });
    return (agg._max.ordinal ?? 0) + 1;
  }

  private auditCreate(items: { at: string; by: string; role: Role; action: string; fields?: Record<string, string> }[]) {
    return items.map((a, i) => ({
      at: new Date(a.at), by: a.by, role: a.role as never, action: a.action,
      fields: a.fields ?? undefined, seq: i,
    }));
  }

  private recordCreate(items: { formNo: string; refNo: string; date: string; by: string; note?: string }[]) {
    return items.map((r, i) => ({
      formNo: r.formNo, refNo: r.refNo, date: r.date, by: r.by, note: r.note ?? null, seq: i,
    }));
  }

  private async insertJob(tx: any, job: Job): Promise<void> {
    await tx.job.create({
      data: {
        id: job.id, psDate: job.psDate, component: job.component, partNo: job.partNo,
        serialNo: job.serialNo, category: job.category, originUnit: job.originUnit,
        repairUnit: fromBranch(job.repairUnit), status: job.status, location: job.location,
        receivedAt: new Date(job.receivedAt), statusSince: new Date(job.statusSince),
        indentRef: job.indentRef ?? null, ovId: job.ovId ?? null,
        jobType: job.jobType ?? 'CORRECTIVE', assetId: job.assetId ?? null, pmScheduleId: job.pmScheduleId ?? null,
        pmDueAt: job.pmDueAt ? new Date(job.pmDueAt) : null, doneAt: job.doneAt ? new Date(job.doneAt) : null, assetDown: !!job.assetDown,
        checklist: (job.checklist ?? []) as never,
        assigneeId: job.assigneeId ?? null, assigneeName: job.assigneeName ?? null,
        assignedAt: job.assignedAt ? new Date(job.assignedAt) : null,
        ordinal: await this.ordinalIn(tx.job),
        records: { create: this.recordCreate(job.records) },
        audit: { create: this.auditCreate(job.audit) },
      },
    });
  }

  private async insertDemand(tx: any, dm: Demand): Promise<void> {
    await tx.demand.create({
      data: {
        id: dm.id, jobId: dm.jobId ?? null, partDescription: dm.partDescription, partNo: dm.partNo,
        qty: dm.qty, status: dm.status, statusSince: new Date(dm.statusSince),
        partId: dm.partId ?? null, forStore: dm.forStore ?? null, unitCost: dm.unitCost ?? null,
        raisedBy: dm.raisedBy, branch: fromBranch(dm.branch),
        ordinal: await this.ordinalIn(tx.demand),
        records: { create: this.recordCreate(dm.records) },
        audit: { create: this.auditCreate(dm.audit) },
        quotations: { create: dm.quotations.map((q, i) => ({ ...q, remarks: q.remarks ?? null, seq: i })) },
      },
    });
  }

  private async insertOv(tx: any, ov: OvRepair): Promise<void> {
    await tx.ovRepair.create({
      data: {
        id: ov.id, jobId: ov.jobId, defectReportRef: ov.defectReportRef, am75Ref: ov.am75Ref,
        status: ov.status, statusSince: new Date(ov.statusSince),
        ordinal: await this.ordinalIn(tx.ovRepair),
        records: { create: this.recordCreate(ov.records) },
        audit: { create: this.auditCreate(ov.audit) },
      },
    });
  }

  private async insertPartner(tx: any, p: Partner): Promise<void> {
    await tx.partner.create({
      data: {
        id: p.id, name: p.name, type: p.type, status: p.status, country: p.country,
        certifications: p.certifications, lists: p.lists, rating: p.rating ?? null,
        nonConformances: p.nonConformances, factorsEvaluated: p.factorsEvaluated, currency: p.currency ?? null,
        ordinal: await this.ordinalIn(tx.partner),
        audit: { create: this.auditCreate(p.audit) },
        cars: { create: p.cars.map((c, i) => ({ ...c, seq: i })) },
      },
    });
  }

  private async insertFod(tx: any, f: FodIncident): Promise<void> {
    await tx.fodIncident.create({
      data: {
        id: f.id, date: f.date, partName: f.partName, typeModel: f.typeModel,
        serialNo: f.serialNo, area: f.area, location: f.location, discovered: f.discovered,
        rootCause: f.rootCause ?? null, correctiveAction: f.correctiveAction ?? null,
        reporter: f.reporter, focalPoint: f.focalPoint, status: f.status,
        ordinal: await this.ordinalIn(tx.fodIncident),
        audit: { create: this.auditCreate(f.audit) },
      },
    });
  }

  private async insertInvoice(tx: any, inv: Invoice): Promise<void> {
    await tx.invoice.create({
      data: {
        id: inv.id, stream: inv.stream, jobId: inv.jobId ?? null, customer: inv.customer,
        period: inv.period ?? null, amountMYR: inv.amountMYR, gstRate: inv.gstRate,
        taxLabel: inv.taxLabel ?? 'GST',
        gstMYR: inv.gstMYR, totalMYR: inv.totalMYR, status: inv.status,
        statusSince: new Date(inv.statusSince), outstanding: inv.outstanding,
        currency: inv.currency ?? null, fxRate: inv.fxRate ?? null, amount: inv.amount ?? null, tax: inv.tax ?? null, total: inv.total ?? null, paidRate: inv.paidRate ?? null, paidBase: inv.paidBase ?? null, fxGain: inv.fxGain ?? null,
        raisedBy: inv.raisedBy, branch: fromBranch(inv.branch),
        ordinal: await this.ordinalIn(tx.invoice),
        records: { create: this.recordCreate(inv.records) },
        audit: { create: this.auditCreate(inv.audit) },
      },
    });
  }

  // ─── save ───────────────────────────────────────────────────────────────────

  /**
   * Persist aggregates atomically. Staged (new*) aggregates are INSERTed,
   * hydrated ones UPDATEd under their version guard. Parents are inserted
   * before children so foreign keys resolve within the transaction.
   */
  async save(...entities: object[]): Promise<void> {
    return this.saveWith(undefined, ...entities);
  }

  /**
   * Save records and run `also` in the same transaction (e.g. a stock movement
   * a workflow step makes), so either everything is committed or nothing is.
   */
  async saveWith(also: ((tx: Prisma.TransactionClient) => Promise<void>) | undefined, ...entities: object[]): Promise<void> {
    const order: Kind[] = ['job', 'demand', 'ov', 'partner', 'fod', 'invoice', 'tool'];
    const sorted = [...entities].sort(
      (a, b) => order.indexOf(this.snapOf(a).kind) - order.indexOf(this.snapOf(b).kind),
    );

    await this.prisma.$transaction(async (tx) => {
      for (const e of sorted) {
        const snap = this.snapOf(e);
        if (snap.isNew) {
          switch (snap.kind) {
            case 'job': await this.insertJob(tx, e as Job); break;
            case 'demand': await this.insertDemand(tx, e as Demand); break;
            case 'ov': await this.insertOv(tx, e as OvRepair); break;
            case 'partner': await this.insertPartner(tx, e as Partner); break;
            case 'fod': await this.insertFod(tx, e as FodIncident); break;
            case 'invoice': await this.insertInvoice(tx, e as Invoice); break;
          }
          // A brand-new job may already carry a QP.56 priority overlay.
          if (snap.kind === 'job' && (e as Job).priority) {
            await this.savePriority(tx, e as Job, { ...snap, hadPriority: false, priorityAudit: 0 });
          }
        } else {
          switch (snap.kind) {
            case 'job': await this.saveJob(tx, e as Job, snap); break;
            case 'demand': await this.saveDemand(tx, e as Demand, snap); break;
            case 'ov': await this.saveOv(tx, e as OvRepair, snap); break;
            case 'partner': await this.savePartner(tx, e as Partner, snap); break;
            case 'fod': await this.saveFod(tx, e as FodIncident, snap); break;
            case 'invoice': await this.saveInvoice(tx, e as Invoice, snap); break;
            case 'tool': await this.saveTool(tx, e as Tool); break;
          }
        }
      }
      if (also) await also(tx);
    });

    // Re-baseline so the same object can be mutated and saved again later.
    for (const e of entities) {
      const s = this.snapOf(e);
      const any = e as any;
      this.snaps.set(e, {
        ...s,
        isNew: false,
        version: s.isNew ? 0 : s.version + 1,
        audit: any.audit?.length ?? s.audit,
        records: any.records?.length ?? s.records,
        quotations: any.quotations?.length ?? s.quotations,
        cars: any.cars?.length ?? s.cars,
        priorityAudit: any.priority?.audit?.length ?? s.priorityAudit,
        hadPriority: !!any.priority,
      });
    }
  }

  private guard(count: number, id: string): void {
    if (count === 0) {
      throw new ConflictException(
        `${id} was modified by another user while you were editing — reload and retry.`,
      );
    }
  }

  private childRows<T extends object>(items: T[], from: number, extra: object) {
    return items.slice(from).map((item, i) => ({ ...item, ...extra, seq: from + i }));
  }

  private auditRows(items: { at: string; by: string; role: Role; action: string; fields?: Record<string, string> }[], from: number, extra: object) {
    return items.slice(from).map((a, i) => ({
      at: new Date(a.at),
      by: a.by,
      role: a.role as never,
      action: a.action,
      fields: a.fields ?? undefined,
      seq: from + i,
      ...extra,
    }));
  }

  private recordRows(items: { formNo: string; refNo: string; date: string; by: string; note?: string }[], from: number, extra: object) {
    return items.slice(from).map((r, i) => ({
      formNo: r.formNo, refNo: r.refNo, date: r.date, by: r.by, note: r.note ?? null, seq: from + i, ...extra,
    }));
  }

  private async saveJob(tx: any, job: Job, snap: Snapshot): Promise<void> {
    const res = await tx.job.updateMany({
      where: { id: job.id, version: snap.version },
      data: {
        status: job.status,
        location: job.location,
        statusSince: new Date(job.statusSince),
        indentRef: job.indentRef ?? null,
        ovId: job.ovId ?? null,
        checklist: (job.checklist ?? []) as never,
        assigneeId: job.assigneeId ?? null,
        assigneeName: job.assigneeName ?? null,
        assignedAt: job.assignedAt ? new Date(job.assignedAt) : null,
        doneAt: job.doneAt ? new Date(job.doneAt) : null,
        version: { increment: 1 },
      },
    });
    this.guard(res.count, `Job ${job.id}`);

    const newRecords = this.recordRows(job.records, snap.records, { jobId: job.id });
    if (newRecords.length) await tx.formRecord.createMany({ data: newRecords });
    const newAudit = this.auditRows(job.audit, snap.audit, { jobId: job.id });
    if (newAudit.length) await tx.auditEntry.createMany({ data: newAudit });

    await this.savePriority(tx, job, snap);
  }

  /** QP.56 priority overlay: 1-1 child with its own append-only audit trail. */
  private async savePriority(tx: any, job: Job, snap: Snapshot): Promise<void> {
    if (!job.priority) return;
    const p = job.priority;
    const data = {
      type: p.type, quantity: p.quantity, route: p.route, suffixK: p.suffixK,
      state: p.state, colRef: p.colRef, raisedAt: new Date(p.raisedAt), raisedBy: p.raisedBy,
      edd: p.edd ?? null, remark: p.remark ?? null,
      closedAt: p.closedAt ? new Date(p.closedAt) : null,
      closeReason: p.closeReason ?? null,
    };
    const row = await tx.jobPriority.upsert({
      where: { jobId: job.id },
      create: { jobId: job.id, ...data },
      update: data,
    });
    const from = snap.hadPriority ? snap.priorityAudit : 0;
    const rows = this.auditRows(p.audit, from, { jobPriorityId: row.id });
    if (rows.length) await tx.auditEntry.createMany({ data: rows });
  }

  private async saveDemand(tx: any, dm: Demand, snap: Snapshot): Promise<void> {
    const res = await tx.demand.updateMany({
      where: { id: dm.id, version: snap.version },
      data: {
        status: dm.status,
        statusSince: new Date(dm.statusSince),
        stockF244Ref: dm.stockCheck?.f244Ref ?? null,
        stockAvailable: dm.stockCheck?.available ?? null,
        stockHoldingUnit: dm.stockCheck?.holdingUnit ?? null,
        rfqRef: dm.rfqRef ?? null,
        evalF221Ref: dm.evaluation?.f221Ref ?? null,
        evalSupplierId: dm.evaluation?.selectedSupplierId ?? null,
        evalLocalPurchase: dm.evaluation?.localPurchase ?? null,
        evalF241Ref: dm.evaluation?.f241Ref ?? null,
        poRef: dm.poRef ?? null,
        discF217Ref: dm.discrepancy?.f217Ref ?? null,
        discNote: dm.discrepancy?.note ?? null,
        forStore: dm.forStore ?? null,
        unitCost: dm.unitCost ?? null,
        purchaseCurrency: dm.purchase?.currency ?? null,
        purchaseRate: dm.purchase?.rate ?? null,
        purchaseAmount: dm.purchase?.amount ?? null,
        purchaseAmountBase: dm.purchase?.amountBase ?? null,
        version: { increment: 1 },
      },
    });
    this.guard(res.count, `Demand ${dm.id}`);

    const q = this.childRows(dm.quotations, snap.quotations, { demandId: dm.id });
    if (q.length) await tx.quotation.createMany({ data: q.map((x: any) => ({ ...x, remarks: x.remarks ?? null })) });
    const rec = this.recordRows(dm.records, snap.records, { demandId: dm.id });
    if (rec.length) await tx.formRecord.createMany({ data: rec });
    const aud = this.auditRows(dm.audit, snap.audit, { demandId: dm.id });
    if (aud.length) await tx.auditEntry.createMany({ data: aud });
  }

  private async saveOv(tx: any, ov: OvRepair, snap: Snapshot): Promise<void> {
    const res = await tx.ovRepair.updateMany({
      where: { id: ov.id, version: snap.version },
      data: {
        status: ov.status,
        statusSince: new Date(ov.statusSince),
        vendorId: ov.vendorId ?? null,
        vendorName: ov.vendorName ?? null,
        f134Ref: ov.f134Ref ?? null,
        poRef: ov.poRef ?? null,
        costMYR: ov.costMYR ?? null,
        currency: ov.currency ?? null,
        cost: ov.cost ?? null,
        fxRate: ov.fxRate ?? null,
        costFixedAt: ov.costFixedAt ? new Date(ov.costFixedAt) : null,
        eddDays: ov.eddDays ?? null,
        aboveIndent: ov.aboveIndent ?? null,
        f119Ref: ov.f119Ref ?? null,
        version: { increment: 1 },
      },
    });
    this.guard(res.count, `OV repair ${ov.id}`);

    const rec = this.recordRows(ov.records, snap.records, { ovId: ov.id });
    if (rec.length) await tx.formRecord.createMany({ data: rec });
    const aud = this.auditRows(ov.audit, snap.audit, { ovId: ov.id });
    if (aud.length) await tx.auditEntry.createMany({ data: aud });
  }

  private async savePartner(tx: any, p: Partner, snap: Snapshot): Promise<void> {
    const res = await tx.partner.updateMany({
      where: { id: p.id, version: snap.version },
      data: {
        status: p.status,
        lists: p.lists,
        rating: p.rating ?? null,
        evaluationRef: p.evaluationRef ?? null,
        siteAuditRef: p.siteAuditRef ?? null,
        lastAssessed: p.lastAssessed ?? null,
        nextReassessment: p.nextReassessment ?? null,
        nonConformances: p.nonConformances,
        factorsEvaluated: p.factorsEvaluated,
        currency: p.currency ?? null,
        version: { increment: 1 },
      },
    });
    this.guard(res.count, `Partner ${p.id}`);

    const cars = this.childRows(p.cars, snap.cars, { partnerId: p.id });
    if (cars.length) await tx.car.createMany({ data: cars });
    const aud = this.auditRows(p.audit, snap.audit, { partnerId: p.id });
    if (aud.length) await tx.auditEntry.createMany({ data: aud });
  }

  private async saveFod(tx: any, f: FodIncident, snap: Snapshot): Promise<void> {
    const res = await tx.fodIncident.updateMany({
      where: { id: f.id, version: snap.version },
      data: {
        status: f.status,
        rootCause: f.rootCause ?? null,
        correctiveAction: f.correctiveAction ?? null,
        version: { increment: 1 },
      },
    });
    this.guard(res.count, `Incident ${f.id}`);
    const aud = this.auditRows(f.audit, snap.audit, { fodId: f.id });
    if (aud.length) await tx.auditEntry.createMany({ data: aud });
  }

  private async saveInvoice(tx: any, inv: Invoice, snap: Snapshot): Promise<void> {
    const res = await tx.invoice.updateMany({
      where: { id: inv.id, version: snap.version },
      data: {
        status: inv.status,
        statusSince: new Date(inv.statusSince),
        amountMYR: inv.amountMYR,
        gstMYR: inv.gstMYR,
        totalMYR: inv.totalMYR,
        f311Ref: inv.f311Ref ?? null,
        ctcRef: inv.ctcRef ?? null,
        customerSignRef: inv.customerSignRef ?? null,
        correctnessBy: inv.correctnessBy ?? null,
        salesPerfRef: inv.salesPerfRef ?? null,
        paymentRef: inv.paymentRef ?? null,
        paidAt: inv.paidAt ?? null,
        currency: inv.currency ?? null, fxRate: inv.fxRate ?? null, amount: inv.amount ?? null, tax: inv.tax ?? null, total: inv.total ?? null, paidRate: inv.paidRate ?? null, paidBase: inv.paidBase ?? null, fxGain: inv.fxGain ?? null,
        outstanding: inv.outstanding,
        version: { increment: 1 },
      },
    });
    this.guard(res.count, `Invoice ${inv.id}`);

    const rec = this.recordRows(inv.records, snap.records, { invoiceId: inv.id });
    if (rec.length) await tx.formRecord.createMany({ data: rec });
    const aud = this.auditRows(inv.audit, snap.audit, { invoiceId: inv.id });
    if (aud.length) await tx.auditEntry.createMany({ data: aud });
  }

  private async saveTool(tx: any, t: Tool): Promise<void> {
    await tx.tool.update({
      where: { tag: t.tag },
      data: { status: t.status, holder: t.holder ?? null, since: new Date(t.since) },
    });
  }

  // ─── config mutation (FR-02) ────────────────────────────────────────────────

  async patchSla(id: string, days: number): Promise<SlaRule | undefined> {
    const rule = this.slaRules.find((r) => r.id === id);
    if (!rule || !(days > 0)) return rule;
    await this.prisma.slaRule.update({ where: { id }, data: { days } });
    rule.days = days;
    return rule;
  }
}
