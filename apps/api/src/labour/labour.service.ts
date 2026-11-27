import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { Role } from '../common/types';
import { SettingsService } from '../settings/settings.service';
import { roundMoney } from '../settings/currency';
import { StockService } from '../stock/stock.service';

export type Actor = { sub: string; name: string; role: Role };

const MAX_MINUTES = 24 * 60;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "1 h 30 min", "45 min", "2 h". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
}

/** The rate that applies to a person: their own, else their role's, else the organisation's, else none. */
export function resolveRate(own: number | null, role: string, settings: { defaultRate: number | null; roleRates: Record<string, number> }): number | null {
  if (own !== null && own !== undefined) return own;
  if (settings.roleRates[role] !== undefined) return settings.roleRates[role];
  return settings.defaultRate;
}

/**
 * Time on work orders and what work costs. Each entry keeps the rate in
 * force when it was logged. Everyone on a work order may see hours; rates and
 * labour cost need labour.manage.
 */
@Injectable()
export class LabourService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
    @Optional() private readonly stock?: StockService,
  ) {}

  canManage(actor: { role: string }): boolean {
    return this.store.capabilitiesOf(actor.role).includes('labour.manage');
  }

  private async openJob(jobId: string) {
    const job = await this.store.job(jobId);
    if (!job) throw new NotFoundException(`Work order ${jobId} not found`);
    if (job.archivedAt || this.store.isFinal('JOB', job.status)) throw new BadRequestException(`${jobId} is closed — time can no longer be logged or changed on it`);
    return job;
  }

  private minutes(v: unknown): number {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > MAX_MINUTES) throw new BadRequestException('Time: whole minutes, from 1 minute to 24 hours');
    return n;
  }

  private workDate(v: unknown): Date {
    const today = new Date();
    if (v === undefined || v === null || v === '') return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const s = String(v);
    const d = new Date(`${s}T00:00:00Z`);
    if (!ISO_DATE.test(s) || Number.isNaN(d.getTime()) || !d.toISOString().startsWith(s)) throw new BadRequestException('Work date: YYYY-MM-DD');
    // A day ahead is allowed for time zones east of UTC.
    if (d.getTime() > today.getTime() + 86_400_000) throw new BadRequestException('Work date cannot be in the future');
    if (d.getTime() < today.getTime() - 366 * 86_400_000) throw new BadRequestException('Work date is more than a year ago');
    return d;
  }

  private async rateFor(userId: string, role: string): Promise<number | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { hourlyRate: true } });
    return resolveRate(u?.hourlyRate === null || u?.hourlyRate === undefined ? null : Number(u.hourlyRate), role, this.settings.labour);
  }

  private cost(minutes: number, rate: number | null): number {
    return rate === null ? 0 : roundMoney((minutes / 60) * rate, this.settings.currency);
  }

  /** No one logs more than a day's worth of time for one date. */
  private async checkDay(tx: Prisma.TransactionClient, userId: string, workDate: Date, minutes: number, except?: string) {
    const sum = await tx.timeEntry.aggregate({ where: { userId, workDate, ...(except ? { id: { not: except } } : {}) }, _sum: { minutes: true } });
    const total = (sum._sum.minutes ?? 0) + minutes;
    if (total > MAX_MINUTES) throw new BadRequestException(`That would make ${duration(total)} on ${workDate.toISOString().slice(0, 10)} — more than 24 hours in a day`);
  }

  private view(e: Prisma.TimeEntryGetPayload<object>, manage: boolean) {
    return {
      id: e.id, jobId: e.jobId, userId: e.userId, userName: e.userName, workDate: e.workDate.toISOString().slice(0, 10),
      minutes: e.minutes, note: e.note, createdBy: e.createdBy, createdAt: e.createdAt.toISOString(),
      ...(manage ? { rate: e.rate === null ? null : Number(e.rate), cost: Number(e.cost) } : {}),
    };
  }

  async list(jobId: string, actor: Actor) {
    const rows = await this.prisma.timeEntry.findMany({ where: { jobId }, orderBy: [{ workDate: 'asc' }, { createdAt: 'asc' }] });
    const manage = this.canManage(actor);
    return {
      entries: rows.map((e) => ({ ...this.view(e, manage), mine: e.userId === actor.sub })),
      minutes: rows.reduce((s, e) => s + e.minutes, 0),
      ...(manage ? { cost: roundMoney(rows.reduce((s, e) => s + Number(e.cost), 0), this.settings.currency) } : {}),
    };
  }

  /** Log time: your own, or (labour.manage) anyone's. */
  async log(jobId: string, body: { minutes?: unknown; workDate?: unknown; note?: unknown; userId?: string }, actor: Actor) {
    const job = await this.openJob(jobId);
    const minutes = this.minutes(body.minutes);
    const workDate = this.workDate(body.workDate);
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : '';
    let person = { id: actor.sub, name: actor.name, role: actor.role as string };
    if (body.userId && body.userId !== actor.sub) {
      if (!this.canManage(actor)) throw new ForbiddenException('Only people who manage labour may log time for someone else');
      const u = await this.store.activeUser(body.userId);
      if (!u) throw new BadRequestException(`No active person ${body.userId}`);
      person = { id: u.id, name: u.name, role: u.role };
    }
    const rate = await this.rateFor(person.id, person.role);
    const entry = await this.prisma.$transaction(async (tx) => {
      await this.checkDay(tx, person.id, workDate, minutes);
      return tx.timeEntry.create({
        data: { id: randomUUID(), jobId, userId: person.id, userName: person.name, workDate, minutes, note, rate, cost: this.cost(minutes, rate), createdBy: actor.name },
      });
    });
    job.audit.push(this.store.audit(actor.name, actor.role, `Time logged: ${duration(minutes)} by ${person.name} on ${workDate.toISOString().slice(0, 10)}${note ? ` — ${note}` : ''}`));
    await this.store.save(job);
    return this.view(entry, this.canManage(actor));
  }

  private async own(id: string, actor: Actor) {
    const e = await this.prisma.timeEntry.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Time entry not found');
    if (e.userId !== actor.sub && !this.canManage(actor)) throw new ForbiddenException('You can change only your own time');
    return e;
  }

  async update(id: string, body: { minutes?: unknown; workDate?: unknown; note?: unknown }, actor: Actor) {
    const e = await this.own(id, actor);
    const job = await this.openJob(e.jobId);
    const minutes = body.minutes !== undefined ? this.minutes(body.minutes) : e.minutes;
    const workDate = body.workDate !== undefined ? this.workDate(body.workDate) : e.workDate;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : e.note;
    const rate = e.rate === null ? null : Number(e.rate);
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.checkDay(tx, e.userId, workDate, minutes, e.id);
      return tx.timeEntry.update({ where: { id }, data: { minutes, workDate, note, cost: this.cost(minutes, rate) } });
    });
    if (minutes !== e.minutes || workDate.getTime() !== e.workDate.getTime()) {
      job.audit.push(this.store.audit(actor.name, actor.role, `Time corrected: ${e.userName} ${duration(e.minutes)} → ${duration(minutes)} on ${workDate.toISOString().slice(0, 10)}`));
      await this.store.save(job);
    }
    return this.view(updated, this.canManage(actor));
  }

  async remove(id: string, actor: Actor) {
    const e = await this.own(id, actor);
    const job = await this.openJob(e.jobId);
    await this.prisma.timeEntry.delete({ where: { id } });
    job.audit.push(this.store.audit(actor.name, actor.role, `Time removed: ${duration(e.minutes)} by ${e.userName} on ${e.workDate.toISOString().slice(0, 10)}`));
    await this.store.save(job);
  }

  // ─── what a work order costs ───────────────────────────────────────────────

  /**
   * Parts from stock (the ledger) + direct purchases (ordered requests for
   * parts not in the catalogue, at the chosen quotation's price) + vendor
   * repairs + labour. Catalogue parts bought for the job count once, when
   * issued from stock.
   */
  async jobCost(jobId: string, actor: Actor) {
    if (!(await this.prisma.job.findUnique({ where: { id: jobId }, select: { id: true } }))) throw new NotFoundException(`Work order ${jobId} not found`);
    const cur = this.settings.currency;
    const parts = this.stock && this.settings.modules.stock ? (await this.stock.jobParts(jobId)).total : 0;
    const demands = await this.prisma.demand.findMany({ where: { jobId, partId: null, poRef: { not: null } }, include: { quotations: true } });
    const purchases = demands.map((d) => {
      const q = d.quotations.find((x) => x.supplierId === d.evalSupplierId) ?? (d.quotations.length === 1 ? d.quotations[0] : undefined);
      return { id: d.id, description: d.partDescription, amount: q ? Number(q.priceMYR) : 0 };
    });
    const vendors = (await this.prisma.ovRepair.findMany({ where: { jobId, costMYR: { not: null } }, select: { id: true, vendorName: true, costMYR: true } }))
      .map((o) => ({ id: o.id, vendor: o.vendorName ?? '', amount: Number(o.costMYR) }));
    const time = await this.prisma.timeEntry.aggregate({ where: { jobId }, _sum: { minutes: true, cost: true } });
    const manage = this.canManage(actor);
    const labourCost = Number(time._sum.cost ?? 0);
    const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
    const withoutLabour = roundMoney(parts + sum(purchases) + sum(vendors), cur);
    return {
      currency: cur.code,
      parts: roundMoney(parts, cur),
      purchases: { total: roundMoney(sum(purchases), cur), lines: purchases },
      vendorRepairs: { total: roundMoney(sum(vendors), cur), lines: vendors },
      labour: { minutes: time._sum.minutes ?? 0, cost: manage ? roundMoney(labourCost, cur) : null },
      total: manage ? roundMoney(withoutLabour + labourCost, cur) : null,
      totalWithoutLabour: withoutLabour,
    };
  }

  // ─── rates ─────────────────────────────────────────────────────────────────

  async rates() {
    const people = await this.prisma.user.findMany({ where: { deactivatedAt: null }, select: { id: true, name: true, role: true, hourlyRate: true }, orderBy: { name: 'asc' } });
    const s = this.settings.labour;
    return {
      currency: this.settings.currency.code, ...s,
      roles: this.store.dict('role', true).map((r) => ({ key: r.key, label: r.label, rate: s.roleRates[r.key] ?? null })),
      people: people.map((p) => {
        const own = p.hourlyRate === null ? null : Number(p.hourlyRate);
        return { id: p.id, name: p.name, role: p.role, hourlyRate: own, effective: resolveRate(own, p.role, s) };
      }),
    };
  }

  async setRates(body: { defaultRate?: unknown; roleRates?: unknown }, actor: Actor) {
    await this.settings.updateLabour(body as never, this.store.dict('role', true).map((r) => r.key), actor.name);
    return this.rates();
  }

  async setPersonRate(userId: string, value: unknown) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!u) throw new NotFoundException(`No person ${userId}`);
    let rate: number | null = null;
    if (value !== null && value !== '' && value !== undefined) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new BadRequestException('Hourly rate: from 0 to 1,000,000, or empty to use the role\'s');
      rate = Math.round(n * 10_000) / 10_000;
    }
    await this.prisma.user.update({ where: { id: userId }, data: { hourlyRate: rate } });
    return this.rates();
  }
}
