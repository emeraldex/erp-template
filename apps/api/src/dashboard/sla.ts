import type { SlaRule } from '../common/workflow-config';

export interface SlaBreach {
  ref: string;
  entity: 'JOB' | 'DEMAND' | 'OV' | 'INVOICE';
  detail: string;
  rule: string;
  source: string;
  daysOver: number;
}

interface Timed { id: string; status: string; statusSince: string }

export interface SlaPools {
  jobs: (Timed & { component: string })[];
  demands: (Timed & { partDescription: string })[];
  ovs: (Timed & { vendorName?: string })[];
  invoices: (Timed & { stream: string; customer: string })[];
}

const DAY_MS = 86_400_000;

/** Whole days elapsed since `since`, as of `now`. */
export function daysSince(since: string, now: number): number {
  return Math.floor((now - new Date(since).getTime()) / DAY_MS);
}

/**
 * FR-10 — evaluate every configured SLA timer against how long each record has
 * sat in its current status. A record breaches once it is strictly over the
 * rule's day allowance. Worst breaches first.
 */
export function computeBreaches(rules: SlaRule[], pools: SlaPools, now: number): SlaBreach[] {
  const out: SlaBreach[] = [];
  for (const rule of rules) {
    const pool: Timed[] =
      rule.entity === 'JOB' ? pools.jobs :
      rule.entity === 'DEMAND' ? pools.demands :
      rule.entity === 'OV' ? pools.ovs : pools.invoices;
    for (const e of pool) {
      if (e.status !== rule.status) continue;
      const days = daysSince(e.statusSince, now);
      if (days <= rule.days) continue;
      const detail =
        rule.entity === 'JOB' ? (e as SlaPools['jobs'][number]).component :
        rule.entity === 'DEMAND' ? (e as SlaPools['demands'][number]).partDescription :
        rule.entity === 'OV' ? ((e as SlaPools['ovs'][number]).vendorName ?? 'Outside vendor repair') :
        `${(e as SlaPools['invoices'][number]).stream} → ${(e as SlaPools['invoices'][number]).customer}`;
      out.push({ ref: e.id, entity: rule.entity, detail, rule: rule.rule, source: rule.source, daysOver: days - rule.days });
    }
  }
  return out.sort((x, y) => y.daysOver - x.daysOver);
}

export interface SlaAlert {
  ref: string;
  entity: SlaBreach['entity'];
  ruleId: string;
  rule: string;
  source: string;
  status: string;
  statusSince: string;
  detail: string;
  level: 'due-soon' | 'breached';
  /** Days past the allowance (breached) or days left (due soon). */
  days: number;
}

/**
 * FR-10 alerts: a record is "due soon" once it is within `warnDays` of its
 * allowance, and "breached" once strictly over it. Rules shorter than
 * `warnDays` only alert on breach, so a 2-day rule does not warn on day 0.
 */
export function computeAlerts(rules: SlaRule[], pools: SlaPools, now: number, warnDays = 1): SlaAlert[] {
  const out: SlaAlert[] = [];
  for (const rule of rules) {
    const pool: Timed[] =
      rule.entity === 'JOB' ? pools.jobs : rule.entity === 'DEMAND' ? pools.demands : rule.entity === 'OV' ? pools.ovs : pools.invoices;
    for (const e of pool) {
      if (e.status !== rule.status) continue;
      const days = daysSince(e.statusSince, now);
      const base = {
        ref: e.id, entity: rule.entity, ruleId: rule.id, rule: rule.rule, source: rule.source,
        status: e.status, statusSince: e.statusSince, detail: describe(rule.entity, e),
      };
      if (days > rule.days) out.push({ ...base, level: 'breached', days: days - rule.days });
      else if (rule.days > warnDays && rule.days - days <= warnDays) out.push({ ...base, level: 'due-soon', days: rule.days - days });
    }
  }
  return out;
}

function describe(entity: SlaBreach['entity'], e: Timed): string {
  return entity === 'JOB' ? (e as SlaPools['jobs'][number]).component :
    entity === 'DEMAND' ? (e as SlaPools['demands'][number]).partDescription :
    entity === 'OV' ? ((e as SlaPools['ovs'][number]).vendorName ?? 'Outside vendor repair') :
    `${(e as SlaPools['invoices'][number]).stream} → ${(e as SlaPools['invoices'][number]).customer}`;
}
