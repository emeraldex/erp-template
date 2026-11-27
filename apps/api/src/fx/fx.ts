/**
 * Exchange-rate arithmetic, kept pure. A rate is how many units of the
 * organisation's (base) currency one unit of the foreign currency buys:
 * with a Ringgit base, USD 4.45 means USD 1 = RM 4.45.
 */
import { BadRequestException } from '@nestjs/common';
import { Currency, roundMoney } from '../settings/currency';

export const RATE_DECIMALS = 8;
/** A new rate further than this from the last one must be confirmed. */
export const RATE_JUMP_LIMIT = 0.2;
/** Older than this, a form warns that the rate may be stale. */
export const RATE_STALE_DAYS = 30;

export interface RateRow { currency: string; effectiveFrom: string; rate: number }

export const roundRate = (n: number) => Math.round(n * 10 ** RATE_DECIMALS) / 10 ** RATE_DECIMALS;

/** Foreign amount → base currency, rounded to the base currency's decimals. */
export function toBase(amount: number, rate: number, base: Currency): number {
  return roundMoney(amount * rate, base);
}

/** RM 1 = USD 0.2247: the inverse, for spotting a rate typed the wrong way round. */
export function inverse(rate: number): number {
  return rate > 0 ? roundRate(1 / rate) : 0;
}

/** The rate in force on `day` (YYYY-MM-DD): the latest row dated on or before it. */
export function rateInForce(rows: RateRow[], currency: string, day: string): RateRow | undefined {
  let best: RateRow | undefined;
  for (const r of rows) {
    if (r.currency !== currency || r.effectiveFrom > day) continue;
    if (!best || r.effectiveFrom > best.effectiveFrom) best = r;
  }
  return best;
}

/** How far a rate is from the previous one, as a fraction (0.25 = 25%). */
export function jump(previous: number | undefined, next: number): number {
  if (!previous || previous <= 0) return 0;
  return Math.abs(next - previous) / previous;
}

/** Refuse a rate that is not a positive number with at most 8 decimals. */
export function parseRate(v: unknown, what = 'Exchange rate'): number {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`${what} must be a number above 0`);
  if (roundRate(n) !== n) throw new BadRequestException(`${what}: at most ${RATE_DECIMALS} decimal places`);
  if (n > 1e9) throw new BadRequestException(`${what} is too large`);
  return n;
}

/** "USD 1 = RM 0.22 is 95% below the last rate (4.45) — send confirm to keep it." */
export function jumpMessage(code: string, base: Currency, previous: number, next: number): string {
  const pct = Math.round(jump(previous, next) * 100);
  return `${code} 1 = ${base.symbol} ${next} is ${pct}% ${next < previous ? 'below' : 'above'} the last rate (${previous}) — check it was not typed the wrong way round, then confirm`;
}

/** Split an invoice in its own currency into base net, tax and total that always add up. */
export function invoiceToBase(net: number, tax: number, rate: number, base: Currency): { net: number; tax: number; total: number } {
  const n = toBase(net, rate, base);
  const t = toBase(tax, rate, base);
  return { net: n, tax: t, total: roundMoney(n + t, base) };
}
