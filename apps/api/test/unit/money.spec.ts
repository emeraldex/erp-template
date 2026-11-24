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
