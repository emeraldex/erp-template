import { nextAverage, quantity } from '../../src/stock/stock.service';

describe('stock — moving-average cost', () => {
  it('starts at the first receipt cost', () => {
    expect(nextAverage(0, 0, 10, 12.5)).toBe(12.5);
  });

  it('blends what is on hand with what arrives', () => {
    // 10 at 12.50, then 30 at 14.00 → (125 + 420) / 40 = 13.625
    expect(nextAverage(10, 12.5, 30, 14)).toBe(13.625);
  });

  it('is unchanged by issues in between (they leave at the average)', () => {
    const afterFirst = nextAverage(0, 0, 10, 10);
    // 4 issued at 10 → 6 on hand at 10; then 6 more at 16 → 13
    expect(nextAverage(6, afterFirst, 6, 16)).toBe(13);
  });

  it('keeps four decimals', () => {
    expect(nextAverage(3, 1, 1, 2)).toBe(1.25);
    expect(nextAverage(3, 0.3333, 3, 0.6667)).toBe(0.5);
  });
});

describe('stock — quantities', () => {
  it('accepts positive numbers with up to three decimals', () => {
    expect(quantity(2)).toBe(2);
    expect(quantity('0.125')).toBe(0.125);
  });

  it.each([[0], [-1], ['abc'], [undefined], [''], [1.2345]])('refuses %p', (v) => {
    expect(() => quantity(v)).toThrow();
  });
});
