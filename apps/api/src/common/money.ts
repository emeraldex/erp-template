/**
 * Tax arithmetic for invoicing (QP.51 / FR-13). Amounts are in the
 * organisation's currency (the field names say MYR for history); results are
 * rounded to its smallest unit — the sen for two decimals, whole units for
 * none. `ratePct` is a percentage (6 means 6%).
 */
export function computeTax(amount: number, ratePct: number, decimals: 0 | 2 = 2): { taxMYR: number; totalMYR: number } {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Invalid amount: ${amount}`);
  if (!Number.isFinite(ratePct) || ratePct < 0) throw new RangeError(`Invalid tax rate: ${ratePct}`);
  const f = 10 ** decimals;
  const taxMYR = Math.round((amount * ratePct * f) / 100) / f;
  return { taxMYR, totalMYR: Math.round((amount + taxMYR) * f) / f };
}
