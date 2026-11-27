/**
 * Reliability measures for one asset over a period, from the facts the
 * system records: corrective work (when it came in and when it was done),
 * downtime spells, and preventive work (when it was due and when done).
 */
export interface AssetFacts {
  commissionedOn: Date | null;
  corrective: { receivedAt: Date; doneAt: Date | null }[];
  downtime: { fromAt: Date; toAt: Date | null }[];
  preventive: { jobId: string; pmDueAt: Date | null; doneAt: Date | null }[];
}

export interface Measures {
  periodHours: number;
  failures: number;
  downtimeHours: number;
  /** 0–1; null when the period has no hours (e.g. commissioned after it). */
  availability: number | null;
  /** Mean time to repair, hours: received → done, corrective work completed in the period. */
  mttrHours: number | null;
  /** Mean time between failures, hours: running hours ÷ failures. */
  mtbfHours: number | null;
  pm: { due: number; onTime: number; late: number; notDone: number; compliance: number | null; meterOnly: number };
}

const H = 3_600_000;
const r1 = (n: number) => Math.round(n * 10) / 10;

export function measure(f: AssetFacts, from: Date, to: Date, now: Date, graceDays: number): Measures {
  const start = Math.max(from.getTime(), f.commissionedOn?.getTime() ?? -Infinity);
  const end = Math.min(to.getTime(), now.getTime());
  const periodHours = Math.max(0, end - start) / H;
  const inPeriod = (d: Date) => d.getTime() >= from.getTime() && d.getTime() < to.getTime();

  const failures = f.corrective.filter((c) => inPeriod(c.receivedAt)).length;
  const down = f.downtime.reduce((s, d) => {
    const a = Math.max(d.fromAt.getTime(), start);
    const b = Math.min((d.toAt ?? now).getTime(), end);
    return s + Math.max(0, b - a);
  }, 0) / H;
  const repaired = f.corrective.filter((c) => c.doneAt && inPeriod(c.doneAt));
  const mttr = repaired.length ? repaired.reduce((s, c) => s + (c.doneAt!.getTime() - c.receivedAt.getTime()), 0) / repaired.length / H : null;

  const scored = f.preventive.filter((p) => p.pmDueAt && inPeriod(p.pmDueAt));
  const grace = graceDays * 86_400_000;
  const onTime = scored.filter((p) => p.doneAt && p.doneAt.getTime() <= p.pmDueAt!.getTime() + grace).length;
  const late = scored.filter((p) => p.doneAt && p.doneAt.getTime() > p.pmDueAt!.getTime() + grace).length;

  return {
    periodHours: r1(periodHours),
    failures,
    downtimeHours: r1(down),
    availability: periodHours > 0 ? Math.round(Math.max(0, 1 - down / periodHours) * 10_000) / 10_000 : null,
    mttrHours: mttr === null ? null : r1(mttr),
    mtbfHours: failures ? r1(Math.max(0, periodHours - down) / failures) : null,
    pm: {
      due: scored.length, onTime, late, notDone: scored.length - onTime - late,
      compliance: scored.length ? Math.round((onTime / scored.length) * 10_000) / 10_000 : null,
      meterOnly: f.preventive.filter((p) => !p.pmDueAt && p.doneAt && inPeriod(p.doneAt)).length,
    },
  };
}
