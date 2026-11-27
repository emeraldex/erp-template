import type { TransitionRule } from '../common/types';

/** Effects that take an amount from a step field, and the param naming it. */
const MONEY_PARAMS: Record<string, string> = { recordCost: 'costField', recordReceipt: 'costField', raiseTaxInvoice: 'amountField' };

/** The keys of a step's fields that carry money (and so may come with `<key>Currency` and `<key>Rate`). */
export function moneyKeys(rule: Pick<TransitionRule, 'effects'>): string[] {
  const keys: string[] = [];
  for (const e of rule.effects ?? []) {
    const param = MONEY_PARAMS[e.type];
    const key = param ? e.params?.[param] : undefined;
    if (typeof key === 'string' && key) keys.push(key);
  }
  return keys;
}

/**
 * For /config: the same steps, with every field that feeds a money effect
 * typed `money`, so the form shows an amount, a currency and the rate. The
 * stored workflow is not changed.
 */
export function withMoneyFields<T extends TransitionRule>(rules: T[]): T[] {
  return rules.map((r) => {
    const keys = moneyKeys(r);
    if (!keys.length) return r;
    return { ...r, requires: r.requires.map((q) => (keys.includes(q.key) ? { ...q, type: 'money' as never } : q)) };
  });
}
