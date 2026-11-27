import { currencyOf } from '../../src/settings/currency';
import { invoiceToBase, inverse, jump, parseRate, rateInForce, toBase } from '../../src/fx/fx';

const MYR = currencyOf('MYR');
const IDR = currencyOf('IDR');

describe('exchange-rate arithmetic', () => {
  it('converts to the organisation currency and rounds to its decimals', () => {
    expect(toBase(2400, 4.45, MYR)).toBe(10680);
    expect(toBase(19.99, 4.4567, MYR)).toBe(89.09);
    expect(toBase(1, 10_850.5, IDR)).toBe(10_851); // rupiah has no minor unit
    expect(toBase(1250, 0.00028, MYR)).toBe(0.35);
  });

  it('gives the inverse to spot a rate typed the wrong way round', () => {
    expect(inverse(4.45)).toBe(0.2247191);
    expect(inverse(0)).toBe(0);
  });

  it('finds the rate in force on a day', () => {
    const rows = [
      { currency: 'USD', effectiveFrom: '2026-11-01', rate: 4.4 },
      { currency: 'USD', effectiveFrom: '2026-11-15', rate: 4.45 },
      { currency: 'USD', effectiveFrom: '2026-12-01', rate: 4.5 },
      { currency: 'SGD', effectiveFrom: '2026-11-20', rate: 3.3 },
    ];
    expect(rateInForce(rows, 'USD', '2026-10-31')).toBeUndefined();
    expect(rateInForce(rows, 'USD', '2026-11-14')?.rate).toBe(4.4);
    expect(rateInForce(rows, 'USD', '2026-11-15')?.rate).toBe(4.45);
    expect(rateInForce(rows, 'USD', '2026-11-30')?.rate).toBe(4.45); // a future-dated rate waits for its day
    expect(rateInForce(rows, 'SGD', '2026-11-30')?.rate).toBe(3.3);
  });

  it('measures how far a rate moved', () => {
    expect(jump(4.45, 4.5)).toBeCloseTo(0.0112, 4);
    expect(jump(4.45, 0.2247)).toBeGreaterThan(0.9);
    expect(jump(undefined, 4.45)).toBe(0);
  });

  it('accepts only positive rates with at most 8 decimals', () => {
    expect(parseRate('4.45')).toBe(4.45);
    expect(parseRate('1,250.5')).toBe(1250.5);
    expect(() => parseRate(0)).toThrow(/above 0/);
    expect(() => parseRate('abc')).toThrow(/above 0/);
    expect(() => parseRate(0.000000001)).toThrow(/8 decimal places/);
  });

  it('splits an invoice into base net, tax and total that add up', () => {
    expect(invoiceToBase(1000, 80, 4.45, MYR)).toEqual({ net: 4450, tax: 356, total: 4806 });
    const odd = invoiceToBase(333.33, 26.67, 4.4567, MYR);
    expect(odd.total).toBeCloseTo(odd.net + odd.tax, 2);
    expect(invoiceToBase(1000, 110, 10_850.5, IDR)).toEqual({ net: 10_850_500, tax: 1_193_555, total: 12_044_055 });
  });
});
