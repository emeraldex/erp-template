import { Injectable } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { JOB_STATUS_META } from '../common/workflow-config';
import { JobStatus } from '../common/types';

export interface SlaBreach {
  ref: string;
  entity: 'JOB' | 'DEMAND' | 'OV' | 'INVOICE';
  detail: string;
  rule: string;
  source: string;
  daysOver: number;
}

type Snapshot = Awaited<ReturnType<StoreService['dashboardSnapshot']>>;

/** FR-10 (SLA alerts) + FR-12 (status / ageing / performance dashboards). */
@Injectable()
export class DashboardService {
  constructor(private readonly store: StoreService) {}

  private daysIn(since: string): number {
    return Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);
  }

  /** Evaluate every configured SLA timer against the current status ages. */
  private breachesOf(snap: Snapshot): SlaBreach[] {
    const out: SlaBreach[] = [];
    for (const rule of this.store.slaRules) {
      const pool =
        rule.entity === 'JOB' ? snap.jobs :
        rule.entity === 'DEMAND' ? snap.demands :
        rule.entity === 'OV' ? snap.ovs : snap.invoices;
      for (const e of pool as { id: string; status: string; statusSince: string }[]) {
        if (e.status !== rule.status) continue;
        const days = this.daysIn(e.statusSince);
        if (days > rule.days) {
          const detail =
            rule.entity === 'JOB' ? (e as never as { component: string }).component :
            rule.entity === 'DEMAND' ? (e as never as { partDescription: string }).partDescription :
            rule.entity === 'OV' ? ((e as never as { vendorName?: string }).vendorName ?? 'Outside vendor repair') :
            `${(e as never as { stream: string }).stream} → ${(e as never as { customer: string }).customer}`;
          out.push({ ref: e.id, entity: rule.entity, detail, rule: rule.rule, source: rule.source, daysOver: days - rule.days });
        }
      }
    }
    return out.sort((x, y) => y.daysOver - x.daysOver);
  }

  async breaches(): Promise<SlaBreach[]> {
    return this.breachesOf(await this.store.dashboardSnapshot());
  }

  async kpis() {
    const snap = await this.store.dashboardSnapshot();
    const jobs = snap.jobs;
    const open = jobs.filter((j) => j.status !== 'CLOSED');
    const byStatus = (Object.keys(JOB_STATUS_META) as JobStatus[]).map((s) => ({
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
    const openInvoices = invoices.filter((i) => i.status !== 'PAID');
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
      wip: jobs.filter((j) => j.status === 'WIP').length,
      awaitingCustomer: jobs.filter((j) => j.status === 'AWAITING_INDENT' || j.status === 'BER' || j.status === 'SOR').length,
      atVendor: jobs.filter((j) => j.status === 'REC_OV').length,
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
    };
  }
}
