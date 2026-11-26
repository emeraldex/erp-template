import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { nextId, text } from '../assets/ids';
import { SettingsService } from '../settings/settings.service';

type Actor = { name: string; role: string };
type Tx = Prisma.TransactionClient;

/** Ledger movement types. Positive quantities go into a store, negative ones out. */
export const MOVEMENT_TYPES = ['OPENING', 'RECEIPT', 'ISSUE', 'RETURN', 'ADJUST', 'COUNT', 'TRANSFER_OUT', 'TRANSFER_IN'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface PartInput {
  partNo?: string; name?: string; description?: string; unit?: string; group?: string;
  manufacturer?: string; mfrPartNo?: string; preferredSupplierId?: string | null; active?: boolean;
  attributes?: Record<string, unknown>;
}

const PART_NO = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/;
const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d));
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Moving-average cost after a receipt: what is on hand at the old average,
 * plus what arrives at its cost. With nothing on hand, the new cost.
 */
export function nextAverage(onHand: number, avg: number, qty: number, cost: number): number {
  const total = onHand + qty;
  return total > 0 ? round((Math.max(onHand, 0) * avg + qty * cost) / total, 4) : round(cost, 4);
}

/** A quantity: more than zero, up to 3 decimals. */
export function quantity(v: unknown, label = 'Quantity'): number {
  const n = Number(v);
  if (v === undefined || v === null || v === '' || !Number.isFinite(n) || n <= 0) throw new BadRequestException(`${label} must be a number above 0`);
  if (round(n, 3) !== n) throw new BadRequestException(`${label}: at most 3 decimal places`);
  if (n > 1e9) throw new BadRequestException(`${label} is too large`);
  return n;
}

/**
 * Stock control. Every change is a row in an append-only ledger, written in
 * the same transaction as the store's quantity. Stock never goes below zero:
 * the decrement only happens if there is enough. The part's row is locked
 * for the transaction (an UPDATE takes the lock), so a part's movements —
 * and its moving-average cost — are applied one at a time.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
  ) {}

  // ─── catalogue ───────────────────────────────────────────────────────────────

  private storeLabel(key: string) {
    return this.store.label('store', key);
  }

  private assertStore(key: unknown): string {
    const k = String(key ?? '');
    if (!this.store.has('store', k)) throw new BadRequestException(`Unknown store ${k || '(none)'}`);
    return k;
  }

  private levelView(l: { store: string; bin: string; qty: Prisma.Decimal; reorderPoint: Prisma.Decimal | null; reorderQty: Prisma.Decimal | null; lowSince: Date | null; countedAt: Date | null }) {
    const qty = Number(l.qty);
    const reorderPoint = num(l.reorderPoint);
    return {
      store: l.store, storeLabel: this.storeLabel(l.store), bin: l.bin, qty,
      reorderPoint, reorderQty: num(l.reorderQty), low: reorderPoint !== null && qty <= reorderPoint,
      countedAt: l.countedAt?.toISOString() ?? null,
    };
  }

  private partView(p: Prisma.PartGetPayload<{ include: { levels: true } }>) {
    const levels = p.levels.map((l) => this.levelView(l)).sort((a, b) => a.store.localeCompare(b.store));
    const onHand = round(levels.reduce((s, l) => s + l.qty, 0), 3);
    const avgCost = Number(p.avgCost);
    return {
      id: p.id, partNo: p.partNo, name: p.name, description: p.description, unit: p.unit, group: p.group,
      manufacturer: p.manufacturer, mfrPartNo: p.mfrPartNo, preferredSupplierId: p.preferredSupplierId,
      avgCost, lastCost: num(p.lastCost), active: p.active, attributes: p.attributes,
      levels, onHand, value: round(onHand * avgCost, 2), low: levels.some((l) => l.low),
    };
  }

  async list(q: { q?: string; group?: string; store?: string; low?: boolean; includeInactive?: boolean }) {
    const search = q.q?.trim();
    const rows = await this.prisma.part.findMany({
      where: {
        ...(q.includeInactive ? {} : { active: true }),
        ...(q.group ? { group: q.group } : {}),
        ...(search ? { OR: ['partNo', 'name', 'manufacturer', 'mfrPartNo', 'description'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' as const } })) } : {}),
      },
      include: { levels: true },
      orderBy: { partNo: 'asc' },
      take: 2000,
    });
    let out = rows.map((r) => this.partView(r));
    if (q.store) out = out.filter((p) => p.levels.some((l) => l.store === q.store));
    if (q.low) out = out.filter((p) => p.levels.some((l) => l.low && (!q.store || l.store === q.store)));
    return out;
  }

  /** The few facts a work order or request needs about a part. */
  async brief(id: string) {
    return this.prisma.part.findUnique({ where: { id }, select: { id: true, partNo: true, name: true, unit: true, active: true } });
  }

  /** What is on hand of a part, per store. */
  async onHand(partId: string) {
    const levels = await this.prisma.stockLevel.findMany({ where: { partId, qty: { gt: 0 } }, orderBy: { store: 'asc' } });
    return levels.map((l) => ({ store: l.store, storeLabel: this.storeLabel(l.store), qty: Number(l.qty) }));
  }

  async get(id: string) {
    const p = await this.prisma.part.findUnique({ where: { id }, include: { levels: true } });
    if (!p) throw new NotFoundException(`Part ${id} not found`);
    const [movements, requests] = await Promise.all([
      this.prisma.stockMovement.findMany({ where: { partId: id }, orderBy: { id: 'desc' }, take: 50 }),
      this.prisma.demand.findMany({ where: { partId: id }, select: { id: true, jobId: true, forStore: true, qty: true, status: true }, orderBy: { ordinal: 'desc' }, take: 50 }),
    ]);
    return {
      ...this.partView(p),
      movements: movements.map((m) => this.movementView(m)),
      requests: requests.filter((r) => !this.store.isFinal('DEMAND', r.status)).map((r) => ({ ...r, qty: Number(r.qty) })),
    };
  }

  movementView(m: Prisma.StockMovementGetPayload<object>) {
    return {
      id: String(m.id), partId: m.partId, store: m.store, type: m.type, qty: Number(m.qty), unitCost: Number(m.unitCost),
      balanceAfter: Number(m.balanceAfter), jobId: m.jobId, demandId: m.demandId, countId: m.countId, transferRef: m.transferRef,
      reason: m.reason, by: m.by, at: m.at.toISOString(),
    };
  }

  private validatePart(input: PartInput, creating: boolean): string[] {
    const errors: string[] = [];
    if (creating && !text(input.partNo, 40)) errors.push('Part number is required');
    if (input.partNo !== undefined && !PART_NO.test(String(input.partNo).trim())) errors.push('Part number: up to 40 letters, digits, spaces or . _ / -');
    if (creating && !text(input.name, 120)) errors.push('Name is required');
    const units = this.store.dict('unit', true);
    if (input.unit !== undefined && units.length && !this.store.has('unit', input.unit)) errors.push(`Unknown unit ${input.unit}`);
    if (input.group && this.store.dict('partGroup', true).length && !this.store.has('partGroup', input.group)) errors.push(`Unknown part group ${input.group}`);
    if (input.attributes !== undefined && (typeof input.attributes !== 'object' || Array.isArray(input.attributes) || JSON.stringify(input.attributes).length > 4000)) {
      errors.push('Attributes must be an object (up to 4 000 characters)');
    }
    return errors;
  }

  async create(input: PartInput, actor: Actor) {
    const errors = this.validatePart(input, true);
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: errors.length === 1 ? errors[0] : 'The part has problems', errors });
    const partNo = text(input.partNo, 40);
    if (await this.prisma.part.findUnique({ where: { partNo } })) throw new ConflictException(`Part number ${partNo} is already in the catalogue`);
    const ids = (await this.prisma.part.findMany({ select: { id: true } })).map((r) => r.id);
    const id = nextId('PRT', ids);
    await this.prisma.part.create({
      data: {
        id, partNo, name: text(input.name, 120), description: text(input.description, 500),
        unit: input.unit || this.store.dict('unit', true)[0]?.key || 'EA', group: input.group ?? '',
        manufacturer: text(input.manufacturer, 80), mfrPartNo: text(input.mfrPartNo, 60),
        preferredSupplierId: input.preferredSupplierId || null, attributes: (input.attributes ?? {}) as never, createdBy: actor.name,
      },
    });
    return this.get(id);
  }

  async update(id: string, input: PartInput) {
    const existing = await this.prisma.part.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Part ${id} not found`);
    const errors = this.validatePart(input, false);
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: errors.length === 1 ? errors[0] : 'The part has problems', errors });
    const partNo = input.partNo !== undefined ? text(input.partNo, 40) : undefined;
    if (partNo && partNo !== existing.partNo && (await this.prisma.part.findUnique({ where: { partNo } }))) {
      throw new ConflictException(`Part number ${partNo} is already in the catalogue`);
    }
    const data: Prisma.PartUpdateInput = { version: { increment: 1 } };
    if (partNo) data.partNo = partNo;
    if (input.name !== undefined) data.name = text(input.name, 120) || existing.name;
    if (input.description !== undefined) data.description = text(input.description, 500);
    if (input.unit !== undefined) data.unit = input.unit;
    if (input.group !== undefined) data.group = input.group;
    if (input.manufacturer !== undefined) data.manufacturer = text(input.manufacturer, 80);
    if (input.mfrPartNo !== undefined) data.mfrPartNo = text(input.mfrPartNo, 60);
    if (input.preferredSupplierId !== undefined) data.preferredSupplierId = input.preferredSupplierId || null;
    if (input.active !== undefined) data.active = !!input.active;
    if (input.attributes !== undefined) data.attributes = input.attributes as never;
    await this.prisma.part.update({ where: { id }, data });
    return this.get(id);
  }

  /** Bin and reorder settings for one part in one store. */
  async setLevel(partId: string, storeKey: string, body: { bin?: string; reorderPoint?: number | null; reorderQty?: number | null }) {
    const s = this.assertStore(storeKey);
    if (!(await this.prisma.part.findUnique({ where: { id: partId }, select: { id: true } }))) throw new NotFoundException(`Part ${partId} not found`);
    const opt = (v: unknown, label: string) => {
      if (v === undefined) return undefined;
      if (v === null || v === '') return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${label} must be a number ≥ 0`);
      return round(n, 3);
    };
    const data = {
      ...(body.bin !== undefined ? { bin: text(body.bin, 40) } : {}),
      ...(body.reorderPoint !== undefined ? { reorderPoint: opt(body.reorderPoint, 'Reorder point') } : {}),
      ...(body.reorderQty !== undefined ? { reorderQty: opt(body.reorderQty, 'Reorder quantity') } : {}),
    };
    await this.prisma.stockLevel.upsert({ where: { partId_store: { partId, store: s } }, create: { partId, store: s, ...data }, update: data });
    await this.checkLow([{ partId, store: s }]);
    return this.get(partId);
  }

  // ─── the ledger ──────────────────────────────────────────────────────────────

  /** Lock the part for this transaction and return its current average cost. */
  private async lockPart(tx: Tx, partId: string) {
    try {
      return await tx.part.update({ where: { id: partId }, data: { version: { increment: 1 } }, select: { id: true, partNo: true, name: true, unit: true, avgCost: true, active: true } });
    } catch {
      throw new NotFoundException(`Part ${partId} not found`);
    }
  }

  /**
   * One ledger movement, inside a transaction that already locked the part.
   * Refuses to take out more than the store holds.
   */
  private async move(tx: Tx, m: {
    part: { id: string; partNo: string; unit: string }; store: string; type: MovementType; qty: number; unitCost: number;
    by: string; jobId?: string; demandId?: string; countId?: string; transferRef?: string; reason?: string;
  }) {
    await tx.stockLevel.createMany({ data: [{ partId: m.part.id, store: m.store }], skipDuplicates: true });
    if (m.qty < 0) {
      const need = -m.qty;
      const res = await tx.stockLevel.updateMany({ where: { partId: m.part.id, store: m.store, qty: { gte: need } }, data: { qty: { decrement: need } } });
      if (!res.count) {
        const have = await tx.stockLevel.findUnique({ where: { partId_store: { partId: m.part.id, store: m.store } } });
        throw new BadRequestException(`Only ${Number(have?.qty ?? 0)} ${m.part.unit} of ${m.part.partNo} in ${this.storeLabel(m.store)} (${need} needed)`);
      }
    } else if (m.qty > 0) {
      await tx.stockLevel.update({ where: { partId_store: { partId: m.part.id, store: m.store } }, data: { qty: { increment: m.qty } } });
    }
    const level = await tx.stockLevel.findUniqueOrThrow({ where: { partId_store: { partId: m.part.id, store: m.store } } });
    const row = await tx.stockMovement.create({
      data: {
        partId: m.part.id, store: m.store, type: m.type, qty: m.qty, unitCost: round(m.unitCost, 4), balanceAfter: level.qty,
        jobId: m.jobId ?? null, demandId: m.demandId ?? null, countId: m.countId ?? null, transferRef: m.transferRef ?? null,
        reason: m.reason ?? '', by: m.by,
      },
    });
    return { balance: Number(level.qty), movement: row };
  }

  /** Put stock into a store at a cost, updating the part's moving-average cost. */
  async receiveTx(tx: Tx, args: { partId: string; store: string; qty: number; unitCost: number; by: string; type?: 'RECEIPT' | 'OPENING'; demandId?: string; reason?: string }) {
    const part = await this.lockPart(tx, args.partId);
    const levels = await tx.stockLevel.findMany({ where: { partId: args.partId }, select: { qty: true } });
    const onHand = levels.reduce((s, l) => s + Number(l.qty), 0);
    const avg = Number(part.avgCost);
    const cost = Number.isFinite(args.unitCost) && args.unitCost >= 0 ? args.unitCost : avg;
    await tx.part.update({ where: { id: args.partId }, data: { avgCost: nextAverage(onHand, avg, args.qty, cost), lastCost: round(cost, 4) } });
    return this.move(tx, { part, store: args.store, type: args.type ?? 'RECEIPT', qty: args.qty, unitCost: cost, by: args.by, demandId: args.demandId, reason: args.reason });
  }

  /** Stock received without a purchase request (opening stock, free issue). */
  async receiveDirect(args: { partId: string; store: string; qty: number; unitCost: number; reason: string }, actor: Actor) {
    const s = this.assertStore(args.store);
    const r = await this.prisma.$transaction((tx) => this.receiveTx(tx, { partId: args.partId, store: s, qty: args.qty, unitCost: args.unitCost, by: actor.name, reason: args.reason }));
    await this.checkLow([{ partId: args.partId, store: s }]);
    return { movement: this.movementView(r.movement), balance: r.balance };
  }

  /** Take stock out (issue, adjust down…) at the current average cost. */
  async takeTx(tx: Tx, args: { partId: string; store: string; qty: number; type: MovementType; by: string; jobId?: string; demandId?: string; countId?: string; transferRef?: string; reason?: string }) {
    const part = await this.lockPart(tx, args.partId);
    return this.move(tx, { part, store: args.store, type: args.type, qty: -args.qty, unitCost: Number(part.avgCost), by: args.by, jobId: args.jobId, demandId: args.demandId, countId: args.countId, transferRef: args.transferRef, reason: args.reason });
  }

  /** Put stock back in without changing its cost (returns, adjustments up, counts, transfers in). */
  async putTx(tx: Tx, args: { partId: string; store: string; qty: number; type: MovementType; by: string; jobId?: string; countId?: string; transferRef?: string; reason?: string; unitCost?: number }) {
    const part = await this.lockPart(tx, args.partId);
    return this.move(tx, { part, store: args.store, type: args.type, qty: args.qty, unitCost: args.unitCost ?? Number(part.avgCost), by: args.by, jobId: args.jobId, countId: args.countId, transferRef: args.transferRef, reason: args.reason });
  }

  private async jobFor(jobId: string) {
    const job = await this.store.job(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} not found`);
    if (job.archivedAt || this.store.isFinal('JOB', job.status)) throw new BadRequestException(`Job ${jobId} is closed — no more parts can be issued or returned`);
    return job;
  }

  /** Add an entry to a job's audit trail inside a stock transaction. */
  private async jobAudit(tx: Tx, jobId: string, actor: Actor, action: string, fields: Record<string, string>) {
    const seq = await tx.auditEntry.count({ where: { jobId } });
    await tx.auditEntry.create({ data: { jobId, at: new Date(), by: actor.name, role: actor.role, action, fields, seq } });
  }

  async issue(body: { partId?: string; store?: string; qty?: unknown; jobId?: string }, actor: Actor) {
    const qty = quantity(body.qty);
    const s = this.assertStore(body.store);
    if (!body.partId) throw new BadRequestException('Choose a part');
    if (!body.jobId) throw new BadRequestException('Choose the work order the part is for');
    await this.jobFor(body.jobId);
    const r = await this.prisma.$transaction(async (tx) => {
      const out = await this.takeTx(tx, { partId: body.partId!, store: s, qty, type: 'ISSUE', by: actor.name, jobId: body.jobId });
      const part = await tx.part.findUniqueOrThrow({ where: { id: body.partId! }, select: { partNo: true, name: true, unit: true } });
      await this.jobAudit(tx, body.jobId!, actor, `Part issued: ${qty} ${part.unit} ${part.partNo} — ${part.name} from ${this.storeLabel(s)}`, { partId: body.partId!, store: s, qty: String(qty) });
      return out;
    });
    await this.checkLow([{ partId: body.partId, store: s }]);
    return { movement: this.movementView(r.movement), balance: r.balance };
  }

  /** Issue inside another record's transaction (a purchase request's step), with the job's audit entry. */
  async issueToJobTx(tx: Tx, args: { partId: string; store: string; qty: number; jobId: string; demandId?: string }, actor: Actor) {
    const out = await this.takeTx(tx, { partId: args.partId, store: args.store, qty: args.qty, type: 'ISSUE', by: actor.name, jobId: args.jobId, demandId: args.demandId });
    const part = await tx.part.findUniqueOrThrow({ where: { id: args.partId }, select: { partNo: true, name: true, unit: true } });
    await this.jobAudit(tx, args.jobId, actor, `Part issued: ${args.qty} ${part.unit} ${part.partNo} — ${part.name} from ${this.storeLabel(args.store)}${args.demandId ? ` (request ${args.demandId})` : ''}`,
      { partId: args.partId, store: args.store, qty: String(args.qty) });
    return out;
  }

  /** The store a request's goods go to or come from when none is given. */
  defaultStore(preferred?: string): string {
    if (preferred && this.store.has('store', preferred)) return preferred;
    return this.store.dict('store', true)[0]?.key ?? 'MAIN';
  }

  storeName(key: string): string {
    return this.storeLabel(key);
  }

  /** Net quantity of a part issued to a job (issues minus returns). */
  private async netIssued(tx: Tx | PrismaService, partId: string, jobId: string): Promise<number> {
    const rows = await tx.stockMovement.findMany({ where: { partId, jobId, type: { in: ['ISSUE', 'RETURN'] } }, select: { qty: true } });
    return round(-rows.reduce((s, r) => s + Number(r.qty), 0), 3);
  }

  async returnToStock(body: { partId?: string; store?: string; qty?: unknown; jobId?: string }, actor: Actor) {
    const qty = quantity(body.qty);
    const s = this.assertStore(body.store);
    if (!body.partId || !body.jobId) throw new BadRequestException('Choose the part and the work order it came from');
    await this.jobFor(body.jobId);
    const r = await this.prisma.$transaction(async (tx) => {
      const part = await this.lockPart(tx, body.partId!);
      const net = await this.netIssued(tx, body.partId!, body.jobId!);
      if (qty > net) throw new BadRequestException(`Only ${net} ${part.unit} of ${part.partNo} was issued to ${body.jobId} — it cannot take back ${qty}`);
      const out = await this.move(tx, { part, store: s, type: 'RETURN', qty, unitCost: Number(part.avgCost), by: actor.name, jobId: body.jobId });
      await this.jobAudit(tx, body.jobId!, actor, `Part returned: ${qty} ${part.unit} ${part.partNo} — ${part.name} to ${this.storeLabel(s)}`, { partId: body.partId!, store: s, qty: String(qty) });
      return out;
    });
    await this.checkLow([{ partId: body.partId, store: s }]);
    return { movement: this.movementView(r.movement), balance: r.balance };
  }

  async adjust(body: { partId?: string; store?: string; qty?: unknown; reason?: string }, actor: Actor) {
    const signed = Number(body.qty);
    if (!Number.isFinite(signed) || signed === 0) throw new BadRequestException('Give the change: a positive number to add, negative to take away');
    quantity(Math.abs(signed));
    const reason = text(body.reason, 200);
    if (!reason) throw new BadRequestException('Say why the stock is adjusted');
    const s = this.assertStore(body.store);
    if (!body.partId) throw new BadRequestException('Choose a part');
    const r = await this.prisma.$transaction((tx) => signed > 0
      ? this.putTx(tx, { partId: body.partId!, store: s, qty: signed, type: 'ADJUST', by: actor.name, reason })
      : this.takeTx(tx, { partId: body.partId!, store: s, qty: -signed, type: 'ADJUST', by: actor.name, reason }));
    await this.checkLow([{ partId: body.partId, store: s }]);
    return { movement: this.movementView(r.movement), balance: r.balance };
  }

  async transfer(body: { partId?: string; from?: string; to?: string; qty?: unknown }, actor: Actor) {
    const qty = quantity(body.qty);
    const from = this.assertStore(body.from);
    const to = this.assertStore(body.to);
    if (from === to) throw new BadRequestException('Choose two different stores');
    if (!body.partId) throw new BadRequestException('Choose a part');
    const ref = `TRF-${Date.now().toString(36).toUpperCase()}`;
    await this.prisma.$transaction(async (tx) => {
      const part = await this.lockPart(tx, body.partId!);
      const cost = Number(part.avgCost);
      await this.move(tx, { part, store: from, type: 'TRANSFER_OUT', qty: -qty, unitCost: cost, by: actor.name, transferRef: ref, reason: `To ${this.storeLabel(to)}` });
      await this.move(tx, { part, store: to, type: 'TRANSFER_IN', qty, unitCost: cost, by: actor.name, transferRef: ref, reason: `From ${this.storeLabel(from)}` });
    });
    await this.checkLow([{ partId: body.partId, store: from }, { partId: body.partId, store: to }]);
    return this.get(body.partId);
  }

  async movements(q: { partId?: string; store?: string; jobId?: string; from?: string; to?: string; limit?: number }) {
    const rows = await this.prisma.stockMovement.findMany({
      where: {
        ...(q.partId ? { partId: q.partId } : {}), ...(q.store ? { store: q.store } : {}), ...(q.jobId ? { jobId: q.jobId } : {}),
        ...(q.from || q.to ? { at: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00Z`) } : {}), ...(q.to ? { lt: new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000) } : {}) } } : {}),
      },
      orderBy: { id: 'desc' }, take: Math.min(Math.max(q.limit ?? 200, 1), 2000),
    });
    return rows.map((m) => this.movementView(m));
  }

  /** Parts used on a job: net quantity and cost per part, and the total. */
  async jobParts(jobId: string) {
    const rows = await this.prisma.stockMovement.findMany({ where: { jobId, type: { in: ['ISSUE', 'RETURN'] } }, include: { part: { select: { partNo: true, name: true, unit: true } } }, orderBy: { id: 'asc' } });
    const by = new Map<string, { partId: string; partNo: string; name: string; unit: string; qty: number; cost: number }>();
    for (const r of rows) {
      const line = by.get(r.partId) ?? { partId: r.partId, partNo: r.part.partNo, name: r.part.name, unit: r.part.unit, qty: 0, cost: 0 };
      line.qty -= Number(r.qty);
      line.cost -= Number(r.qty) * Number(r.unitCost);
      by.set(r.partId, line);
    }
    const lines = [...by.values()].map((l) => ({ ...l, qty: round(l.qty, 3), cost: round(l.cost, 2) })).filter((l) => l.qty !== 0 || l.cost !== 0);
    return { lines, total: round(lines.reduce((s, l) => s + l.cost, 0), 2) };
  }

  // ─── reordering ──────────────────────────────────────────────────────────────

  /** Open purchase requests for stock, by part and store. */
  private async openStockRequests(): Promise<Map<string, string>> {
    const rows = await this.prisma.demand.findMany({ where: { partId: { not: null }, forStore: { not: null }, jobId: null }, select: { id: true, partId: true, forStore: true, status: true } });
    return new Map(rows.filter((r) => !this.store.isFinal('DEMAND', r.status)).map((r) => [`${r.partId}|${r.forStore}`, r.id]));
  }

  /** What is at or below its reorder point, with a suggested quantity and any request already open. */
  async reorderList() {
    const levels = await this.prisma.stockLevel.findMany({
      where: { reorderPoint: { not: null }, part: { active: true } },
      include: { part: { select: { id: true, partNo: true, name: true, unit: true, avgCost: true, preferredSupplierId: true } } },
      orderBy: [{ store: 'asc' }, { partId: 'asc' }],
    });
    const open = await this.openStockRequests();
    return levels.filter((l) => Number(l.qty) <= Number(l.reorderPoint)).map((l) => {
      const qty = Number(l.qty);
      const point = Number(l.reorderPoint);
      const suggested = l.reorderQty !== null && Number(l.reorderQty) > 0 ? Number(l.reorderQty) : Math.max(1, round(point * 2 - qty, 3));
      return {
        partId: l.partId, partNo: l.part.partNo, name: l.part.name, unit: l.part.unit, store: l.store, storeLabel: this.storeLabel(l.store),
        bin: l.bin, qty, reorderPoint: point, suggested, avgCost: Number(l.part.avgCost), preferredSupplierId: l.part.preferredSupplierId,
        openRequest: open.get(`${l.partId}|${l.store}`) ?? null, lowSince: l.lowSince?.toISOString() ?? null,
      };
    });
  }

  /** Raise purchase requests for stock: one per part and store, through the normal purchasing steps. */
  async raiseReorder(items: unknown, actor: Actor) {
    if (!Array.isArray(items) || !items.length) throw new BadRequestException('Choose what to reorder');
    if (items.length > 100) throw new BadRequestException('At most 100 items at once');
    const open = await this.openStockRequests();
    const raised: string[] = [];
    for (const [i, raw] of items.entries()) {
      const it = (raw ?? {}) as { partId?: string; store?: string; qty?: unknown };
      const at = `Item ${i + 1}`;
      const part = it.partId ? await this.brief(it.partId) : null;
      if (!part || !part.active) throw new BadRequestException(`${at}: choose an active part`);
      const s = this.assertStore(it.store);
      const qty = quantity(it.qty, `${at}: quantity`);
      const existing = open.get(`${part.id}|${s}`);
      if (existing) throw new ConflictException(`${part.partNo} for ${this.storeLabel(s)} already has an open request (${existing})`);
      const level = await this.prisma.stockLevel.findUnique({ where: { partId_store: { partId: part.id, store: s } } });
      const id = await this.store.nextDemandId();
      const now = new Date().toISOString();
      const site = String((this.store.dict('store', false).find((x) => x.key === s)?.meta as { site?: string } | undefined)?.site ?? '');
      const dm = this.store.newDemand({
        id, partId: part.id, forStore: s, partDescription: part.name, partNo: part.partNo, qty,
        status: this.store.initialStatus('DEMAND'), statusSince: now, raisedBy: actor.name, branch: site,
        quotations: [], records: [],
        audit: [this.store.audit(actor.name, actor.role, `Purchase request for stock: ${qty} ${part.unit} for ${this.storeLabel(s)}`,
          { onHand: String(Number(level?.qty ?? 0)), reorderPoint: level?.reorderPoint == null ? '-' : String(Number(level.reorderPoint)) })],
      });
      await this.store.save(dm);
      open.set(`${part.id}|${s}`, id);
      raised.push(id);
    }
    return { raised };
  }

  // ─── low stock ───────────────────────────────────────────────────────────────

  /**
   * After stock moves: when a store's quantity falls to its reorder point, tell
   * the people who manage stock — once per crossing; it re-arms when stock rises.
   */
  async checkLow(keys: { partId: string; store: string }[]) {
    for (const k of keys) {
      const l = await this.prisma.stockLevel.findUnique({ where: { partId_store: k }, include: { part: { select: { id: true, partNo: true, name: true, unit: true } } } });
      if (!l || l.reorderPoint === null) {
        if (l?.lowSince) await this.prisma.stockLevel.update({ where: { id: l.id }, data: { lowSince: null } });
        continue;
      }
      const low = Number(l.qty) <= Number(l.reorderPoint);
      if (low && !l.lowSince) {
        const claimed = await this.prisma.stockLevel.updateMany({ where: { id: l.id, lowSince: null }, data: { lowSince: new Date() } });
        if (claimed.count) await this.alertLow(l.part, k.store, Number(l.qty));
      } else if (!low && l.lowSince) {
        await this.prisma.stockLevel.update({ where: { id: l.id }, data: { lowSince: null } });
      }
    }
  }

  private async alertLow(part: { id: string; partNo: string; name: string; unit: string }, storeKey: string, qty: number) {
    const roles = this.store.rolesWith('stock.manage');
    const people = await this.prisma.user.findMany({ where: { role: { in: roles }, deactivatedAt: null }, select: { id: true } });
    for (const p of people) {
      await this.store.notify(p.id, {
        kind: 'stock.low', title: `Low stock: ${part.name}`, body: `${qty} ${part.unit} of ${part.partNo} left in ${this.storeLabel(storeKey)}`, ref: `STOCK:${part.id}`,
      });
    }
  }

  get enabled(): boolean {
    return !!this.settings.modules.stock;
  }
}
