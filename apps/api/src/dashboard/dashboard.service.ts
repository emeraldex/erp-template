import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { SettingsService } from '../settings/settings.service';
import { JobStatus } from '../common/types';
import { computeBreaches, daysSince, SlaBreach } from './sla';

export type { SlaBreach } from './sla';

type Snapshot = Awaited<ReturnType<StoreService['dashboardSnapshot']>>;

/** FR-10 (SLA alerts) + FR-12 (status / ageing / performance dashboards). */
@Injectable()
export class DashboardService {
  constructor(
    private readonly store: StoreService,
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly settings?: SettingsService,
  ) {}

  /** Store places at or below their reorder point (active parts), when stock control is on. */
  private async lowStock(): Promise<number | null> {
    if (!this.prisma || !this.settings?.modules.stock) return null;
    return this.prisma.stockLevel.count({
      where: { reorderPoint: { not: null }, qty: { lte: this.prisma.stockLevel.fields.reorderPoint }, part: { active: true } },
    });
  }

  private daysIn(since: string): number {
    return daysSince(since, Date.now());
  }

  private breachesOf(snap: Snapshot): SlaBreach[] {
    return computeBreaches(this.store.slaRules, snap as never, Date.now());
  }

  async breaches(): Promise<SlaBreach[]> {
    return this.breachesOf(await this.store.dashboardSnapshot());
  }

  async kpis() {
    const [snap, lowStock] = await Promise.all([this.store.dashboardSnapshot(), this.lowStock()]);
    const jobs = snap.jobs;
    // Counts work from status phases, so they hold for any sector's workflow.
    const final = new Set(this.store.finalStatuses('JOB'));
    const inPhase = (...phases: Parameters<StoreService['statusesInPhase']>[1][]) => {
      const keys = new Set(this.store.statusesInPhase('JOB', ...phases));
      return jobs.filter((j) => keys.has(j.status)).length;
    };
    const open = jobs.filter((j) => !final.has(j.status));
    const byStatus = (this.store.statusKeys('JOB') as JobStatus[]).map((s) => ({
      status: s,
      count: jobs.filter((j) => j.status === s).length,
    }));
    const dueReassessment = snap.partners.filter(
      (p) => p.status === 'REGISTERED' && p.nextReassessment && p.nextReassessment <= '2026-12-31',
    );
    const breaches = this.breachesOf(snap);
    const ageing = open.map((j) => ({ id: j.id, days: this.daysIn(j.receivedAt) }));

    // QP.51 invoicing / revenue (5.8) — FR-13 / FR-14
    const invoices = snap.invoices;
    const paidStatuses = new Set(this.store.finalStatuses('INVOICE'));
    const openInvoices = invoices.filter((i) => !paidStatuses.has(i.status));
    const revenueBilledMYR = invoices.reduce((s, i) => s + i.totalMYR, 0);
    const gstCollectedMYR = invoices.reduce((s, i) => s + i.gstMYR, 0);
    const outstandingMYR = invoices.filter((i) => i.outstanding).reduce((s, i) => s + i.totalMYR, 0);

    // QP.56 AOG / ROA / Critical priority (5.9) — FR-15
    const priorityBoard = jobs
      .filter((j) => j.priority?.state === 'OPEN')
      .map((j) => ({
        jobId: j.id, component: j.component, type: j.priority!.type,
        route: j.priority!.route, colRef: j.priority!.colRef, edd: j.priority!.edd,
        daysOpen: this.daysIn(j.priority!.raisedAt),
      }));

    return {
      openJobs: open.length,
      wip: inPhase('active'),
      awaitingCustomer: inPhase('waiting_customer'),
      awaitingParts: inPhase('waiting_parts'),
      atVendor: inPhase('external'),
      slaBreaches: breaches.length,
      breaches: breaches.slice(0, 8),
      partnersDueReassessment: dueReassessment.length,
      openFod: snap.fod.filter((f) => f.status !== 'CLOSED').length,
      toolsUnaccounted: snap.tools.filter((t) => t.status !== 'IN').length,
      openInvoices: openInvoices.length,
      revenueBilledMYR,
      gstCollectedMYR,
      outstandingMYR,
      aogOpen: priorityBoard.length,
      priorityBoard,
      byStatus,
      avgJobAgeDays: ageing.length ? Math.round(ageing.reduce((s, a) => s + a.days, 0) / ageing.length) : 0,
      weeklyClosures: snap.closures,
      lowStock,
    };
  }
}
