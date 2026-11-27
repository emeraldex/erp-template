import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { SettingsService } from '../settings/settings.service';
import { roundMoney } from '../settings/currency';
import type { Report, Row } from '../reports/tabular';
import { AssetFacts, measure, Measures } from './reliability';
import { DowntimeService } from './downtime.service';

type JobRow = { id: string; assetId: string | null; jobType: string; pmScheduleId: string | null; pmDueAt: Date | null; doneAt: Date | null; receivedAt: Date; status: string; component: string };

const pct = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 10);

/**
 * Downtime, repair time, time between failures, preventive compliance and
 * cost, per asset, from what the system records. See reliability.ts for the
 * definitions.
 */
@Injectable()
export class ReliabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
    private readonly downtime: DowntimeService,
  ) {}

  /** What a job type means, so organisations can rename them: corrective, preventive or other. */
  private meaning(key: string): 'corrective' | 'preventive' | 'other' {
    const meta = this.store.dict('jobType').find((t) => t.key === key)?.meta as { meaning?: string } | undefined;
    const m = meta?.meaning;
    if (m === 'corrective' || m === 'preventive' || m === 'other') return m;
    return key === 'CORRECTIVE' ? 'corrective' : key === 'PREVENTIVE' ? 'preventive' : 'other';
  }

  /** Jobs on these assets, with when they were done (from the audit trail for work done before doneAt was recorded). */
  private async jobs(assetIds: string[] | null): Promise<JobRow[]> {
    const rows = await this.prisma.job.findMany({
      where: { assetId: assetIds ? { in: assetIds } : { not: null } },
      select: { id: true, assetId: true, jobType: true, pmScheduleId: true, pmDueAt: true, doneAt: true, receivedAt: true, status: true, component: true },
    });
    const doneKeys = this.store.statusesInPhase('JOB', 'done', 'closed');
    const missing = rows.filter((r) => !r.doneAt && doneKeys.includes(r.status)).map((r) => r.id);
    if (missing.length) {
      const doneOnly = this.store.statusesInPhase('JOB', 'done');
      const entries = await this.prisma.auditEntry.findMany({
        where: { jobId: { in: missing }, action: { startsWith: 'Status → ' } }, select: { jobId: true, action: true, at: true }, orderBy: { at: 'asc' },
      });
      const first = new Map<string, Date>();
      for (const e of entries) {
        const key = e.action.slice('Status → '.length).split(':')[0];
        if (e.jobId && !first.has(e.jobId) && (doneOnly.includes(key) || doneKeys.includes(key))) first.set(e.jobId, new Date(e.at));
      }
      for (const r of rows) if (!r.doneAt && first.has(r.id)) r.doneAt = first.get(r.id)!;
    }
    return rows;
  }

  /** Parts + direct purchases + vendor repairs + labour, per job, in one go. */
  async costs(jobIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!jobIds.length) return out;
    const add = (id: string, n: number) => out.set(id, (out.get(id) ?? 0) + n);
    const moves = await this.prisma.stockMovement.findMany({ where: { jobId: { in: jobIds }, type: { in: ['ISSUE', 'RETURN'] } }, select: { jobId: true, qty: true, unitCost: true } });
    for (const m of moves) add(m.jobId!, -Number(m.qty) * Number(m.unitCost));
    const demands = await this.prisma.demand.findMany({ where: { jobId: { in: jobIds }, partId: null, poRef: { not: null } }, include: { quotations: true } });
    for (const d of demands) {
      const q = d.quotations.find((x) => x.supplierId === d.evalSupplierId) ?? (d.quotations.length === 1 ? d.quotations[0] : undefined);
      if (q) add(d.jobId!, Number(q.priceMYR));
    }
    for (const o of await this.prisma.ovRepair.findMany({ where: { jobId: { in: jobIds }, costMYR: { not: null } }, select: { jobId: true, costMYR: true } })) add(o.jobId, Number(o.costMYR));
    for (const t of await this.prisma.timeEntry.groupBy({ by: ['jobId'], where: { jobId: { in: jobIds } }, _sum: { cost: true } })) add(t.jobId, Number(t._sum.cost ?? 0));
    return out;
  }

  private facts(assetJobs: JobRow[], spells: { fromAt: Date; toAt: Date | null }[], commissionedOn: string | null): AssetFacts {
    return {
      commissionedOn: commissionedOn ? new Date(`${commissionedOn.slice(0, 10)}T00:00:00Z`) : null,
      corrective: assetJobs.filter((j) => this.meaning(j.jobType) === 'corrective').map((j) => ({ receivedAt: j.receivedAt, doneAt: j.doneAt })),
      downtime: spells,
      preventive: assetJobs.filter((j) => j.pmScheduleId || this.meaning(j.jobType) === 'preventive').map((j) => ({ jobId: j.id, pmDueAt: j.pmDueAt, doneAt: j.doneAt })),
    };
  }

  /** Asset cost includes labour cost, which only people who manage labour or read maintenance reports see. */
  maySeeCost(role: string): boolean {
    const caps = this.store.capabilitiesOf(role);
    return caps.includes('labour.manage') || caps.includes('reports.maintenance');
  }

  /** An asset's last twelve months (or `months`), its downtime history and cost. */
  async forAsset(assetId: string, months = 12, now = new Date()) {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, commissionedOn: true, status: true } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const from = new Date(now.getTime() - months * 30.44 * 86_400_000);
    const jobs = await this.jobs([assetId]);
    const spells = await this.prisma.assetDowntime.findMany({ where: { assetId }, select: { fromAt: true, toAt: true } });
    const m = measure(this.facts(jobs, spells, asset.commissionedOn), from, now, now, this.settings.maintenance.pmGraceDays);
    const done = jobs.filter((j) => j.doneAt && j.doneAt >= from);
    const costs = await this.costs(done.map((j) => j.id));
    const cost = roundMoney([...costs.values()].reduce((s, n) => s + n, 0), this.settings.currency);
    return {
      from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), months, currency: this.settings.currency.code,
      ...m, availabilityPct: pct(m.availability), pmCompliancePct: pct(m.pm.compliance), cost,
      down: asset.status === 'OUT_OF_SERVICE', downtime: await this.downtime.list(assetId, 20),
    };
  }

  /** Assets out of action now, and preventive compliance over the last 90 days. */
  async dashboard(now = new Date()) {
    const from = new Date(now.getTime() - 90 * 86_400_000);
    const [down, prev] = await Promise.all([
      this.prisma.asset.count({ where: { status: 'OUT_OF_SERVICE' } }),
      this.prisma.job.findMany({ where: { pmDueAt: { gte: from, lt: now } }, select: { id: true, pmDueAt: true, doneAt: true, status: true } }),
    ]);
    const grace = this.settings.maintenance.pmGraceDays * 86_400_000;
    const onTime = prev.filter((j) => j.doneAt && j.doneAt.getTime() <= j.pmDueAt!.getTime() + grace).length;
    return { assetsDown: down, pmCompliance90: prev.length ? { due: prev.length, onTime, pct: pct(onTime / prev.length) } : { due: 0, onTime: 0, pct: null } };
  }

  /** The reliability report for a period: by asset, by type and site, and preventive work. */
  async report(period: { from: string; to: string }, now = new Date()): Promise<Report> {
    const from = new Date(`${period.from}T00:00:00Z`);
    const to = new Date(Date.parse(`${period.to}T00:00:00Z`) + 86_400_000);
    const assets = await this.prisma.asset.findMany({ where: { status: { not: 'RETIRED' } }, orderBy: { tag: 'asc' }, select: { id: true, tag: true, name: true, type: true, site: true, criticality: true, commissionedOn: true } });
    const jobs = await this.jobs(assets.map((a) => a.id));
    const spells = await this.prisma.assetDowntime.findMany({ where: { assetId: { in: assets.map((a) => a.id) } }, select: { assetId: true, fromAt: true, toAt: true } });
    const doneInPeriod = jobs.filter((j) => j.doneAt && j.doneAt >= from && j.doneAt < to);
    const costs = await this.costs(doneInPeriod.map((j) => j.id));
    const grace = this.settings.maintenance.pmGraceDays;
    const cur = this.settings.currency;

    const per = assets.map((a) => {
      const own = jobs.filter((j) => j.assetId === a.id);
      const m = measure(this.facts(own, spells.filter((s) => s.assetId === a.id), a.commissionedOn), from, to, now, grace);
      const cost = roundMoney(doneInPeriod.filter((j) => j.assetId === a.id).reduce((s, j) => s + (costs.get(j.id) ?? 0), 0), cur);
      return { a, m, cost };
    });
    const rows: Row[] = per.map(({ a, m, cost }) => ({
      tag: a.tag, name: a.name, type: this.store.label('assetType', a.type), site: this.store.label('site', a.site), criticality: a.criticality,
      failures: m.failures, downtime: m.downtimeHours, availability: pct(m.availability), mttr: m.mttrHours, mtbf: m.mtbfHours,
      pmDue: m.pm.due, pmOnTime: m.pm.onTime, pmCompliance: pct(m.pm.compliance), cost,
    }));

    // Summary by type and site.
    const groups = new Map<string, { type: string; site: string; assets: number; failures: number; down: number; hours: number; due: number; onTime: number; cost: number; repair: number[] }>();
    for (const { a, m, cost } of per) {
      const key = `${a.type}\u0000${a.site}`;
      const g = groups.get(key) ?? { type: this.store.label('assetType', a.type), site: this.store.label('site', a.site), assets: 0, failures: 0, down: 0, hours: 0, due: 0, onTime: 0, cost: 0, repair: [] };
      g.assets += 1; g.failures += m.failures; g.down += m.downtimeHours; g.hours += m.periodHours; g.due += m.pm.due; g.onTime += m.pm.onTime; g.cost += cost;
      if (m.mttrHours !== null) g.repair.push(m.mttrHours);
      groups.set(key, g);
    }
    const summary: Row[] = [...groups.values()].map((g) => ({
      type: g.type, site: g.site, assets: g.assets, failures: g.failures, downtime: Math.round(g.down * 10) / 10,
      availability: g.hours ? pct(Math.max(0, 1 - g.down / g.hours)) : null,
      mttr: g.repair.length ? Math.round((g.repair.reduce((s, x) => s + x, 0) / g.repair.length) * 10) / 10 : null,
      pmCompliance: g.due ? pct(g.onTime / g.due) : null, cost: roundMoney(g.cost, cur),
    }));

    const tags = new Map(assets.map((a) => [a.id, a.tag]));
    const graceMs = grace * 86_400_000;
    const pm: Row[] = jobs.filter((j) => j.pmDueAt && j.pmDueAt >= from && j.pmDueAt < to).sort((x, y) => x.pmDueAt!.getTime() - y.pmDueAt!.getTime()).map((j) => ({
      jobId: j.id, asset: tags.get(j.assetId ?? '') ?? '', item: j.component, due: j.pmDueAt!.toISOString().slice(0, 10), done: j.doneAt?.toISOString().slice(0, 10) ?? '',
      result: !j.doneAt ? 'Not done' : j.doneAt.getTime() <= j.pmDueAt!.getTime() + graceMs ? 'On time' : 'Late',
    }));

    const total = (k: string) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    return {
      title: 'Reliability',
      subtitle: `${period.from} to ${period.to} — failures are corrective work received; downtime is time out of action; preventive work counts as on time within ${grace} days of its due date`,
      sheets: [
        {
          name: 'By asset',
          columns: [
            { key: 'tag', header: 'Tag', width: 14 }, { key: 'name', header: 'Name', width: 28 }, { key: 'type', header: 'Type', width: 18 }, { key: 'site', header: 'Site', width: 18 },
            { key: 'criticality', header: 'Criticality', width: 11 }, { key: 'failures', header: 'Failures', type: 'int' }, { key: 'downtime', header: 'Downtime (h)', type: 'qty', width: 12 },
            { key: 'availability', header: 'Availability %', type: 'qty', width: 13 }, { key: 'mttr', header: 'MTTR (h)', type: 'qty' }, { key: 'mtbf', header: 'MTBF (h)', type: 'qty' },
            { key: 'pmDue', header: 'PM due', type: 'int' }, { key: 'pmOnTime', header: 'PM on time', type: 'int', width: 11 }, { key: 'pmCompliance', header: 'PM compliance %', type: 'qty', width: 15 },
            { key: 'cost', header: `Cost (${cur.code})`, type: 'money', width: 14 },
          ],
          rows,
          totals: { tag: `TOTAL (${rows.length})`, failures: total('failures'), downtime: Math.round(total('downtime') * 10) / 10, pmDue: total('pmDue'), pmOnTime: total('pmOnTime'), cost: roundMoney(total('cost'), cur) },
        },
        {
          name: 'By type and site',
          columns: [
            { key: 'type', header: 'Type', width: 20 }, { key: 'site', header: 'Site', width: 20 }, { key: 'assets', header: 'Assets', type: 'int' }, { key: 'failures', header: 'Failures', type: 'int' },
            { key: 'downtime', header: 'Downtime (h)', type: 'qty', width: 12 }, { key: 'availability', header: 'Availability %', type: 'qty', width: 13 }, { key: 'mttr', header: 'MTTR (h)', type: 'qty' },
            { key: 'pmCompliance', header: 'PM compliance %', type: 'qty', width: 15 }, { key: 'cost', header: `Cost (${cur.code})`, type: 'money', width: 14 },
          ],
          rows: summary,
        },
        {
          name: 'Preventive work',
          columns: [
            { key: 'jobId', header: 'Work order', width: 16 }, { key: 'asset', header: 'Asset', width: 14 }, { key: 'item', header: 'Item', width: 28 },
            { key: 'due', header: 'Due', type: 'date', width: 12 }, { key: 'done', header: 'Done', type: 'date', width: 12 }, { key: 'result', header: 'Result', width: 10 },
          ],
          rows: pm,
        },
      ],
    };
  }
}
