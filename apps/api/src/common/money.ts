/**
 * Tax arithmetic for invoicing (QP.51 / FR-13). Amounts are MYR; results are
 * rounded to the sen. `ratePct` is a percentage (6 means 6%).
 */
export function computeTax(amount: number, ratePct: number): { taxMYR: number; totalMYR: number } {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError(`Invalid amount: ${amount}`);
  if (!Number.isFinite(ratePct) || ratePct < 0) throw new RangeError(`Invalid tax rate: ${ratePct}`);
  const taxMYR = Math.round(amount * ratePct) / 100;
  return { taxMYR, totalMYR: Math.round((amount + taxMYR) * 100) / 100 };
}
