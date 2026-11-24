import { computeBreaches, daysSince } from '../../src/dashboard/sla';
import { SLA_RULES } from '../../src/common/workflow-config';

const NOW = Date.parse('2026-07-20T12:00:00Z');
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const empty = { jobs: [], demands: [], ovs: [], invoices: [] };

describe('daysSince', () => {
  it('counts whole elapsed days', () => {
    expect(daysSince(ago(0), NOW)).toBe(0);
    expect(daysSince(ago(5.9), NOW)).toBe(5);
    expect(daysSince(ago(6), NOW)).toBe(6);
  });
});

describe('computeBreaches', () => {
  const tdi = SLA_RULES.find((r) => r.id === 'SLA-TDI')!; // AWAITING_TDI, 5 days

  it('does not flag a record exactly at its allowance', () => {
    const jobs = [{ id: 'J1', status: 'AWAITING_TDI', statusSince: ago(5), component: 'Gyro' }];
    expect(computeBreaches([tdi], { ...empty, jobs }, NOW)).toEqual([]);
  });

  it('flags a record one day over, citing the rule and its source', () => {
    const jobs = [{ id: 'J1', status: 'AWAITING_TDI', statusSince: ago(6), component: 'Gyro' }];
    expect(computeBreaches([tdi], { ...empty, jobs }, NOW)).toEqual([
      { ref: 'J1', entity: 'JOB', detail: 'Gyro', rule: tdi.rule, source: tdi.source, daysOver: 1 },
    ]);
  });

  it('ignores records in other statuses', () => {
    const jobs = [{ id: 'J1', status: 'WIP', statusSince: ago(90), component: 'Gyro' }];
    expect(computeBreaches([tdi], { ...empty, jobs }, NOW)).toEqual([]);
  });

  it('sorts worst breach first across entity types', () => {
    const pools = {
      jobs: [{ id: 'J1', status: 'AWAITING_TDI', statusSince: ago(8), component: 'Gyro' }],
      demands: [{ id: 'D1', status: 'STOCK_CHECK', statusSince: ago(12), partDescription: 'Capacitor' }],
      ovs: [{ id: 'O1', status: 'RECEIVED_HQ', statusSince: ago(20) }],
      invoices: [{ id: 'I1', status: 'DRAFTED', statusSince: ago(4), stream: 'PBC', customer: 'CPU' }],
    };
    const out = computeBreaches(SLA_RULES, pools, NOW);
    expect(out.map((b) => [b.ref, b.daysOver])).toEqual([['D1', 10], ['O1', 5], ['J1', 3], ['I1', 1]]);
    expect(out.find((b) => b.ref === 'O1')!.detail).toBe('Outside vendor repair');
    expect(out.find((b) => b.ref === 'I1')!.detail).toBe('PBC → CPU');
  });

  it('follows a runtime change to the allowance (FR-02 configurability)', () => {
    const jobs = [{ id: 'J1', status: 'AWAITING_TDI', statusSince: ago(4), component: 'Gyro' }];
    expect(computeBreaches([{ ...tdi, days: 3 }], { ...empty, jobs }, NOW)).toHaveLength(1);
  });
});
