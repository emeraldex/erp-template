import { retainUntil } from '../../src/retention/retention.service';

describe('retention', () => {
  it('keeps records for the minimum number of years from closure', () => {
    expect(retainUntil(new Date('2026-07-05T08:00:00Z'), 5).toISOString()).toBe('2031-07-05T08:00:00.000Z');
  });
  it('handles a leap-day closure', () => {
    expect(retainUntil(new Date('2028-02-29T00:00:00Z'), 5).toISOString().slice(0, 10)).toBe('2033-03-01');
  });
});
