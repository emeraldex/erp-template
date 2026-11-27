import { duration, resolveRate } from '../../src/labour/labour.service';

describe('labour', () => {
  it('writes durations the way people say them', () => {
    expect(duration(90)).toBe('1 h 30 min');
    expect(duration(45)).toBe('45 min');
    expect(duration(120)).toBe('2 h');
    expect(duration(0)).toBe('0 min');
  });

  it('uses a person\'s own rate, else their role\'s, else the organisation\'s, else none', () => {
    const s = { defaultRate: 30, roleRates: { TECHNICIAN: 40 } };
    expect(resolveRate(55, 'TECHNICIAN', s)).toBe(55);
    expect(resolveRate(0, 'TECHNICIAN', s)).toBe(0); // a rate of zero is a rate
    expect(resolveRate(null, 'TECHNICIAN', s)).toBe(40);
    expect(resolveRate(null, 'HELPDESK', s)).toBe(30);
    expect(resolveRate(null, 'HELPDESK', { defaultRate: null, roleRates: {} })).toBeNull();
  });
});
