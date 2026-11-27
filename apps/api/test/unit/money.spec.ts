import { computeTax } from '../../src/common/money';

describe('computeTax', () => {
  it('applies 6% GST to a round amount', () => {
    expect(computeTax(23400, 6)).toEqual({ taxMYR: 1404, totalMYR: 24804 });
  });

  it('rounds tax to the sen', () => {
    // 1234.567 × 6% = 74.07402 → 74.07
    expect(computeTax(1234.567, 6)).toEqual({ taxMYR: 74.07, totalMYR: 1308.64 });
  });

  it('rounds half a sen up', () => {
    // 0.25 × 6% = 0.015 → 0.02
    expect(computeTax(0.25, 6).taxMYR).toBe(0.02);
  });

  it('handles a zero rate and a zero amount', () => {
    expect(computeTax(500, 0)).toEqual({ taxMYR: 0, totalMYR: 500 });
    expect(computeTax(0, 6)).toEqual({ taxMYR: 0, totalMYR: 0 });
  });

  it('rejects negative or non-numeric input', () => {
    expect(() => computeTax(-1, 6)).toThrow(RangeError);
    expect(() => computeTax(NaN, 6)).toThrow(RangeError);
    expect(() => computeTax(100, -6)).toThrow(RangeError);
  });
});

describe('currencies', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { currencyOf, formatMoney, roundMoney } = require('../../src/settings/currency');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { amountInWords, ringgitInWords } = require('../../src/documents/words');

  it('formats and rounds to the currency\'s smallest unit', () => {
    expect(formatMoney(18400.5, currencyOf('MYR'))).toBe('RM 18,400.50');
    expect(formatMoney(1250000, currencyOf('IDR'))).toBe('Rp 1,250,000');
    expect(formatMoney(-12.3, currencyOf('SGD'))).toBe('-S$ 12.30');
    expect(roundMoney(10.555, currencyOf('USD'))).toBe(10.56);
    expect(roundMoney(1250000.6, currencyOf('VND'))).toBe(1250001);
    expect(currencyOf('NOPE').code).toBe('MYR');
  });

  it('spells amounts out in the currency\'s own words', () => {
    expect(ringgitInWords(1080.5)).toBe('Ringgit Malaysia One Thousand Eighty and Sen Fifty Only');
    expect(amountInWords(10.05, currencyOf('SGD'))).toBe('Singapore Dollars Ten and Cents Five Only');
    expect(amountInWords(1000000, currencyOf('IDR'))).toBe('Rupiah One Million Only');
    expect(amountInWords(3.75, currencyOf('GBP'))).toBe('Pounds Sterling Three and Pence Seventy-Five Only');
  });

  it('works out tax in whole units for currencies without cents', () => {
    expect(computeTax(1250, 11, 0)).toEqual({ taxMYR: 138, totalMYR: 1388 });
    expect(computeTax(1250, 11)).toEqual({ taxMYR: 137.5, totalMYR: 1387.5 });
  });
});
