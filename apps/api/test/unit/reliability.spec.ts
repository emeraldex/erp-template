import { measure } from '../../src/assets/reliability';

const d = (s: string) => new Date(`${s}Z`);
const from = d('2026-01-01T00:00:00');
const to = d('2026-02-01T00:00:00'); // 744 hours
const now = d('2026-06-01T00:00:00');

describe('reliability measures', () => {
  it('counts failures, downtime, availability, repair time and time between failures', () => {
    const m = measure({
      commissionedOn: null,
      corrective: [
        { receivedAt: d('2026-01-05T08:00:00'), doneAt: d('2026-01-05T14:00:00') }, // 6 h to repair
        { receivedAt: d('2026-01-20T10:00:00'), doneAt: d('2026-01-21T10:00:00') }, // 24 h
        { receivedAt: d('2025-12-30T10:00:00'), doneAt: d('2026-01-02T10:00:00') }, // came in last year: repaired in the period, not a failure in it
      ],
      downtime: [
        { fromAt: d('2026-01-05T08:00:00'), toAt: d('2026-01-05T14:00:00') }, // 6 h
        { fromAt: d('2025-12-31T22:00:00'), toAt: d('2026-01-01T02:00:00') }, // 2 h inside the period
        { fromAt: d('2026-01-31T20:00:00'), toAt: null }, // still down: 4 h to the end of the period
      ],
      preventive: [],
    }, from, to, now, 7);
    expect(m.periodHours).toBe(744);
    expect(m.failures).toBe(2);
    expect(m.downtimeHours).toBe(12);
    expect(m.availability).toBeCloseTo(1 - 12 / 744, 4);
    expect(m.mttrHours).toBe(34); // (6 + 24 + 72) / 3
    expect(m.mtbfHours).toBe(366); // (744 − 12) / 2
  });

  it('scores preventive work done by its due date plus grace', () => {
    const m = measure({
      commissionedOn: null, corrective: [], downtime: [],
      preventive: [
        { jobId: 'a', pmDueAt: d('2026-01-10T00:00:00'), doneAt: d('2026-01-09T00:00:00') }, // on time
        { jobId: 'b', pmDueAt: d('2026-01-10T00:00:00'), doneAt: d('2026-01-16T00:00:00') }, // within 7 days' grace
        { jobId: 'c', pmDueAt: d('2026-01-10T00:00:00'), doneAt: d('2026-01-20T00:00:00') }, // late
        { jobId: 'e', pmDueAt: d('2026-01-25T00:00:00'), doneAt: null }, // not done
        { jobId: 'f', pmDueAt: d('2026-03-01T00:00:00'), doneAt: null }, // due after the period
        { jobId: 'g', pmDueAt: null, doneAt: d('2026-01-12T00:00:00') }, // meter-only: listed, not scored
      ],
    }, from, to, now, 7);
    expect(m.pm).toEqual({ due: 4, onTime: 2, late: 1, notDone: 1, compliance: 0.5, meterOnly: 1 });
    expect(m.failures).toBe(0);
    expect(m.mtbfHours).toBeNull();
    expect(m.mttrHours).toBeNull();
  });

  it('counts only the hours since commissioning, and none before it', () => {
    const half = measure({ commissionedOn: d('2026-01-16T12:00:00'), corrective: [], downtime: [], preventive: [] }, from, to, now, 7);
    expect(half.periodHours).toBe(372);
    expect(measure({ commissionedOn: d('2026-03-01T00:00:00'), corrective: [], downtime: [], preventive: [] }, from, to, now, 7).availability).toBeNull();
  });

  it('does not count the future', () => {
    const m = measure({ commissionedOn: null, corrective: [], downtime: [{ fromAt: d('2026-01-31T00:00:00'), toAt: null }], preventive: [] }, from, to, d('2026-01-31T12:00:00'), 7);
    expect(m.periodHours).toBe(732);
    expect(m.downtimeHours).toBe(12);
  });
});
