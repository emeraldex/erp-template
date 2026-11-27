import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { CURRENCIES, Currency, currencyOf } from '../settings/currency';
import { SettingsService } from '../settings/settings.service';
import { RATE_JUMP_LIMIT, RATE_STALE_DAYS, RateRow, inverse, jump, jumpMessage, parseRate, rateInForce } from './fx';

type Actor = { name: string; role: string };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const today = () => new Date().toISOString().slice(0, 10);

/** A currency and rate settled for one transaction. `null` means the organisation's own currency. */
export interface Fx { currency: string; rate: number; asOf: string; overridden: boolean }

/**
 * The organisation's exchange-rate table and the rule for which rate a
 * transaction uses: the rate in force on its date, or (with fx.manage) a rate
 * typed on the transaction. Recorded transactions keep their own copy, so
 * changing or deleting a rate never alters them.
 */
@Injectable()
export class FxService {
  constructor(private readonly prisma: PrismaService, private readonly settings: SettingsService, private readonly store: StoreService) {}

  get base(): Currency { return this.settings.currency; }

  canOverride(role: string): boolean {
    return this.store.capabilitiesOf(role).includes('fx.manage');
  }

  async rows(): Promise<(RateRow & { id: number; enteredBy: string; enteredAt: string })[]> {
    const rs = await this.prisma.exchangeRate.findMany({ orderBy: [{ currency: 'asc' }, { effectiveFrom: 'desc' }] });
    return rs.map((r) => ({ id: r.id, currency: r.currency, effectiveFrom: r.effectiveFrom.toISOString().slice(0, 10), rate: Number(r.rate), enteredBy: r.enteredBy, enteredAt: r.enteredAt.toISOString() }));
  }

  /** Each currency with its rate in force today, the rate's age, and its history. */
  async list() {
    const rows = await this.rows();
    const day = today();
    const codes = [...new Set(rows.map((r) => r.currency))];
    const currencies = codes.map((code) => {
      const c = currencyOf(code);
      const now = rateInForce(rows, code, day);
      const ageDays = now ? Math.round((Date.parse(day) - Date.parse(now.effectiveFrom)) / 86_400_000) : null;
      return {
        code, name: c.name, symbol: c.symbol, decimals: c.decimals,
        rate: now?.rate ?? null, effectiveFrom: now?.effectiveFrom ?? null, inverse: now ? inverse(now.rate) : null,
        stale: ageDays !== null && ageDays > RATE_STALE_DAYS, ageDays,
        history: rows.filter((r) => r.currency === code),
      };
    });
    return {
      base: this.base.code, staleDays: RATE_STALE_DAYS, jumpLimitPct: RATE_JUMP_LIMIT * 100, currencies,
      available: CURRENCIES.filter((c) => c.code !== this.base.code).map((c) => ({ code: c.code, name: c.name, symbol: c.symbol, decimals: c.decimals })),
    };
  }

  /** Currencies a form may offer: the organisation's plus every one with a rate in force today. */
  async offered(): Promise<string[]> {
    const rows = await this.rows();
    const day = today();
    return [this.base.code, ...[...new Set(rows.map((r) => r.currency))].filter((c) => rateInForce(rows, c, day))];
  }

  async set(body: { currency?: unknown; effectiveFrom?: unknown; rate?: unknown; confirm?: unknown }, actor: Actor) {
    const code = String(body.currency ?? '').toUpperCase();
    if (!CURRENCIES.some((c) => c.code === code)) throw new BadRequestException(`Unknown currency ${code || '(none)'}`);
    if (code === this.base.code) throw new BadRequestException(`${code} is the organisation's own currency — it needs no rate`);
    const day = String(body.effectiveFrom ?? today());
    if (!DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) {
      throw new BadRequestException('Effective from: YYYY-MM-DD');
    }
    const rate = parseRate(body.rate);
    const rows = await this.rows();
    // Compare with the rate in force on that day (including one being replaced), else the nearest later one.
    const before = rateInForce(rows, code, day) ?? rows.filter((r) => r.currency === code).at(-1);
    if (before && body.confirm !== true && jump(before.rate, rate) > RATE_JUMP_LIMIT) {
      throw new BadRequestException({ statusCode: 400, code: 'RATE_JUMP', message: jumpMessage(code, this.base, before.rate, rate), previous: before.rate });
    }
    await this.prisma.exchangeRate.upsert({
      where: { currency_effectiveFrom: { currency: code, effectiveFrom: new Date(`${day}T00:00:00Z`) } },
      create: { currency: code, effectiveFrom: new Date(`${day}T00:00:00Z`), rate, enteredBy: actor.name },
      update: { rate, enteredBy: actor.name, enteredAt: new Date() },
    });
    return this.list();
  }

  async remove(id: number) {
    const r = await this.prisma.exchangeRate.findUnique({ where: { id } });
    if (!r) throw new NotFoundException(`Rate ${id} not found`);
    await this.prisma.exchangeRate.delete({ where: { id } });
    return this.list();
  }

  /**
   * Settle the currency and rate for a transaction dated `day`. An empty or
   * base currency gives `null`. A typed rate is used only for people with
   * fx.manage (anyone else's is ignored) and is checked against the rate in
   * force; otherwise the rate in force is required.
   */
  async resolve(args: { currency?: unknown; rate?: unknown; confirm?: unknown; day?: string; role: string; fallbackRate?: number }): Promise<Fx | null> {
    const code = String(args.currency ?? '').trim().toUpperCase();
    if (!code || code === this.base.code) return null;
    if (!CURRENCIES.some((c) => c.code === code)) throw new BadRequestException(`Unknown currency ${code}`);
    const day = args.day ?? today();
    const inForce = rateInForce(await this.rows(), code, day);
    const typed = args.rate !== undefined && args.rate !== null && args.rate !== '' && this.canOverride(args.role);
    if (typed) {
      const rate = parseRate(args.rate);
      const ref = inForce?.rate ?? args.fallbackRate;
      if (ref && args.confirm !== true && args.confirm !== 'true' && jump(ref, rate) > RATE_JUMP_LIMIT) {
        throw new BadRequestException({ statusCode: 400, code: 'RATE_JUMP', message: jumpMessage(code, this.base, ref, rate), previous: ref });
      }
      return { currency: code, rate, asOf: day, overridden: true };
    }
    if (inForce) return { currency: code, rate: inForce.rate, asOf: inForce.effectiveFrom, overridden: false };
    if (args.fallbackRate) return { currency: code, rate: args.fallbackRate, asOf: day, overridden: false };
    throw new BadRequestException({ statusCode: 400, code: 'NO_RATE', message: `No exchange rate for ${code} — ask finance to add one` });
  }

  /** Whether any transaction is recorded in a foreign currency (the base currency then cannot be relabelled). */
  async anyForeign(): Promise<boolean> {
    const counts = await Promise.all([
      this.prisma.quotation.count({ where: { currency: { not: null } } }),
      this.prisma.invoice.count({ where: { currency: { not: null } } }),
      this.prisma.ovRepair.count({ where: { currency: { not: null } } }),
      this.prisma.demand.count({ where: { purchaseCurrency: { not: null } } }),
      this.prisma.stockMovement.count({ where: { currency: { not: null } } }),
    ]);
    return counts.some((n) => n > 0);
  }
}
