import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { nextId, text } from '../assets/ids';
import { StockService } from './stock.service';

type Actor = { name: string; role: string };
type Tx = Prisma.TransactionClient;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/**
 * Stock counts (stocktakes). Starting a count snapshots what the system
 * says each part in the store holds. People enter what they found; posting
 * applies each difference (counted − snapshot) to the *current* quantity,
 * so issues and receipts made while the count was under way are kept.
 * Lines nobody counted are left alone. One open count per store.
 */
@Injectable()
export class CountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly stock: StockService,
  ) {}

  /** Serialise count changes for one store, per organisation (schema). */
  private async lockStore(tx: Tx, store: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':stock-count:' || ${store}))`;
  }

  async list(q: { store?: string; status?: string }) {
    const rows = await this.prisma.stockCount.findMany({
      where: { ...(q.store ? { store: q.store } : {}), ...(q.status ? { status: q.status } : {}) },
      include: { _count: { select: { lines: true } } },
      orderBy: { startedAt: 'desc' },
      take: 200,
    });
    return rows.map((c) => ({
      id: c.id, store: c.store, storeLabel: this.stock.storeLabel(c.store), status: c.status, note: c.note,
      startedBy: c.startedBy, startedAt: c.startedAt.toISOString(), postedBy: c.postedBy, postedAt: c.postedAt?.toISOString() ?? null,
      lines: c._count.lines,
    }));
  }

  async get(id: string) {
    const c = await this.prisma.stockCount.findUnique({ where: { id }, include: { lines: { orderBy: { id: 'asc' } } } });
    if (!c) throw new NotFoundException(`Stock count ${id} not found`);
    const partIds = c.lines.map((l) => l.partId);
    const [parts, levels] = await Promise.all([
      this.prisma.part.findMany({ where: { id: { in: partIds } }, select: { id: true, partNo: true, name: true, unit: true, avgCost: true } }),
      this.prisma.stockLevel.findMany({ where: { store: c.store, partId: { in: partIds } }, select: { partId: true, bin: true, qty: true } }),
    ]);
    const part = new Map(parts.map((p) => [p.id, p]));
    const level = new Map(levels.map((l) => [l.partId, l]));
    let counted = 0;
    let value = 0;
    const lines = c.lines.map((l) => {
      const p = part.get(l.partId);
      const systemQty = Number(l.systemQty);
      const countedQty = l.countedQty === null ? null : Number(l.countedQty);
      const difference = countedQty === null ? null : round(countedQty - systemQty, 3);
      const avgCost = Number(p?.avgCost ?? 0);
      const diffValue = difference === null ? null : round(difference * avgCost, 2);
      if (countedQty !== null) counted += 1;
      if (diffValue !== null) value += diffValue;
      return {
        partId: l.partId, partNo: p?.partNo ?? l.partId, name: p?.name ?? '', unit: p?.unit ?? '', bin: level.get(l.partId)?.bin ?? '',
        systemQty, countedQty, onHand: Number(level.get(l.partId)?.qty ?? 0), difference, avgCost, value: diffValue,
      };
    });
    lines.sort((a, b) => a.bin.localeCompare(b.bin) || a.partNo.localeCompare(b.partNo));
    return {
      id: c.id, store: c.store, storeLabel: this.stock.storeLabel(c.store), status: c.status, note: c.note,
      startedBy: c.startedBy, startedAt: c.startedAt.toISOString(), postedBy: c.postedBy, postedAt: c.postedAt?.toISOString() ?? null,
      lines, counted, total: lines.length, differenceValue: round(value, 2),
    };
  }

  /** Start a count for a store (optionally one part group): snapshot every active part held there. */
  async start(body: { store?: string; group?: string; note?: string }, actor: Actor) {
    const s = this.stock.assertStore(body.store);
    const group = body.group ? String(body.group) : '';
    if (group && !this.store.has('partGroup', group)) throw new BadRequestException(`Unknown part group ${group}`);
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockStore(tx, s);
      const open = await tx.stockCount.findFirst({ where: { store: s, status: 'OPEN' }, select: { id: true } });
      if (open) throw new ConflictException(`Count ${open.id} is still open for ${this.stock.storeLabel(s)} — post or cancel it first`);
      const levels = await tx.stockLevel.findMany({
        where: { store: s, part: { active: true, ...(group ? { group } : {}) } },
        select: { partId: true, qty: true },
      });
      if (!levels.length) throw new BadRequestException(`Nothing to count: no parts are held in ${this.stock.storeLabel(s)}${group ? ` for that group` : ''}`);
      const ids = (await tx.stockCount.findMany({ select: { id: true } })).map((r) => r.id);
      const countId = nextId('CNT', ids);
      await tx.stockCount.create({
        data: {
          id: countId, store: s, startedBy: actor.name, note: text(body.note, 200),
          lines: { create: levels.map((l) => ({ partId: l.partId, systemQty: l.qty })) },
        },
      });
      return countId;
    });
    return this.get(id);
  }

  private async openCount(tx: Tx, id: string) {
    const c = await tx.stockCount.findUnique({ where: { id } });
    if (!c) throw new NotFoundException(`Stock count ${id} not found`);
    if (c.status !== 'OPEN') throw new BadRequestException(`Count ${id} is ${c.status.toLowerCase()} — it can no longer be changed`);
    return c;
  }

  /** Enter what was found: `{ lines: [{ partId, countedQty }] }`; `null` clears a line. */
  async enter(id: string, body: { lines?: unknown }, _actor: Actor) {
    if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestException('Give the counted quantities: lines: [{ partId, countedQty }]');
    if (body.lines.length > 5000) throw new BadRequestException('At most 5 000 lines at a time');
    const updates = body.lines.map((raw, i) => {
      const l = (raw ?? {}) as { partId?: unknown; countedQty?: unknown };
      const partId = String(l.partId ?? '');
      if (!partId) throw new BadRequestException(`Line ${i + 1}: choose a part`);
      if (l.countedQty === null || l.countedQty === '') return { partId, countedQty: null };
      const n = Number(l.countedQty);
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`Line ${i + 1}: the counted quantity must be 0 or more`);
      if (round(n, 3) !== n) throw new BadRequestException(`Line ${i + 1}: at most 3 decimal places`);
      if (n > 1e9) throw new BadRequestException(`Line ${i + 1}: the counted quantity is too large`);
      return { partId, countedQty: n };
    });
    await this.prisma.$transaction(async (tx) => {
      const c = await this.openCount(tx, id);
      await this.lockStore(tx, c.store);
      await this.openCount(tx, id); // still open once we hold the lock
      for (const u of updates) {
        const res = await tx.stockCountLine.updateMany({ where: { countId: id, partId: u.partId }, data: { countedQty: u.countedQty } });
        if (!res.count) throw new BadRequestException(`Part ${u.partId} is not on count ${id}`);
      }
    });
    return this.get(id);
  }

  /** Apply the differences as COUNT movements. All or nothing. */
  async post(id: string, actor: Actor) {
    const touched: { partId: string; store: string }[] = [];
    await this.prisma.$transaction(async (tx) => {
      const first = await this.openCount(tx, id);
      await this.lockStore(tx, first.store);
      const c = await this.openCount(tx, id);
      const lines = await tx.stockCountLine.findMany({ where: { countId: id, countedQty: { not: null } } });
      if (!lines.length) throw new BadRequestException('Nothing has been counted yet');
      const now = new Date();
      for (const l of lines) {
        const diff = round(Number(l.countedQty) - Number(l.systemQty), 3);
        const reason = `Count ${id}`;
        try {
          if (diff > 0) await this.stock.putTx(tx, { partId: l.partId, store: c.store, qty: diff, type: 'COUNT', by: actor.name, countId: id, reason });
          else if (diff < 0) await this.stock.takeTx(tx, { partId: l.partId, store: c.store, qty: -diff, type: 'COUNT', by: actor.name, countId: id, reason });
        } catch (e) {
          if (e instanceof BadRequestException) {
            const p = await tx.part.findUnique({ where: { id: l.partId }, select: { partNo: true } });
            throw new BadRequestException(`${p?.partNo ?? l.partId}: the count would take the stock below zero (${(e.getResponse() as { message?: string }).message ?? e.message}). Recount it or clear the line.`);
          }
          throw e;
        }
        await tx.stockLevel.updateMany({ where: { partId: l.partId, store: c.store }, data: { countedAt: now } });
        if (diff !== 0) touched.push({ partId: l.partId, store: c.store });
      }
      await tx.stockCount.update({ where: { id }, data: { status: 'POSTED', postedBy: actor.name, postedAt: now } });
    }, { timeout: 120_000 });
    if (touched.length) await this.stock.checkLow(touched);
    return this.get(id);
  }

  async cancel(id: string, _actor: Actor) {
    await this.prisma.$transaction(async (tx) => {
      const first = await this.openCount(tx, id);
      await this.lockStore(tx, first.store);
      await this.openCount(tx, id);
      await tx.stockCount.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    return this.get(id);
  }
}
