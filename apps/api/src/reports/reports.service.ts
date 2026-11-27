import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { Invoice } from '../common/types';
import { Report, Row, Sheet } from './tabular';

export interface Period { from: string; to: string }

const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Validate ?from&to (inclusive dates); default to the current calendar month. */
export function parsePeriod(from?: string, to?: string, now = new Date()): Period {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const p = { from: from || first.toISOString().slice(0, 10), to: to || last.toISOString().slice(0, 10) };
  // Date.parse rolls 2026-02-30 over to 2 March, so require a round trip.
  const real = (d: string) => ISO_DATE.test(d) && !Number.isNaN(Date.parse(d)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
  if (!real(p.from) || !real(p.to)) {
    throw new BadRequestException('from and to must be dates in YYYY-MM-DD form');
  }
  if (p.from > p.to) throw new BadRequestException('from must not be after to');
  if (Date.parse(p.to) - Date.parse(p.from) > 3 * 366 * DAY) throw new BadRequestException('Period is limited to three years');
  return p;
}

/** When the invoice was drafted (its first audit entry). */
export const draftedOn = (i: Invoice) => (i.audit[0]?.at ?? i.statusSince).slice(0, 10);
/** Date on the tax invoice (F311 record), if raised. */
/** When the tax invoice was raised: the record carrying its number, else the step that entered it. */
export const taxInvoiceDate = (i: Invoice): string | undefined => {
  if (!i.f311Ref) return i.records.find((r) => r.formNo === 'F311')?.date;
  const rec = i.records.find((r) => r.refNo === i.f311Ref) ?? i.records.find((r) => r.formNo === 'F311');
  if (rec) return rec.date;
  const step = i.audit.find((a) => a.fields && Object.values(a.fields).includes(i.f311Ref!));
  return step?.at.slice(0, 10);
};

/** Days an unpaid invoice has been outstanding, counted from the tax invoice date (or drafting). */
export function daysOutstanding(i: Invoice, now: number): number | null {
  if (!i.outstanding) return null;
  return Math.max(0, Math.floor((now - Date.parse(taxInvoiceDate(i) ?? draftedOn(i))) / DAY));
}

export function ageingBucket(days: number): '0–30' | '31–60' | '61–90' | '90+' {
  return days <= 30 ? '0–30' : days <= 60 ? '31–60' : days <= 90 ? '61–90' : '90+';
}

const AUDIT_ENTITIES = {
  JOB: 'jobId', DEMAND: 'demandId', OV: 'ovId', PARTNER: 'partnerId', FOD: 'fodId', INVOICE: 'invoiceId', PRIORITY: 'jobPriorityId',
} as const;
export type AuditEntity = keyof typeof AUDIT_ENTITIES;

/** FR-14 revenue reporting and FR-12 audit reporting, as data ready for CSV/XLSX. */
@Injectable()
export class ReportsService {
  constructor(private readonly store: StoreService, private readonly prisma: PrismaService, @Optional() private readonly settings?: SettingsService) {}

  /** The organisation's currency code, for column headings. */
  private get cur(): string {
    return this.settings?.currency.code ?? 'MYR';
  }

  private streamLabel(id: string): string {
    return this.store.invoiceStreams.find((s) => s.id === id)?.label ?? id;
  }

  /** Company Sales Performance Report: every invoice drafted in the period. */
  async salesPerformance(period: Period, now = Date.now()): Promise<Report> {
    const invoices = (await this.store.invoices())
      .filter((i) => draftedOn(i) >= period.from && draftedOn(i) <= period.to)
      .sort((a, b) => draftedOn(a).localeCompare(draftedOn(b)) || a.id.localeCompare(b.id));

    const rows: Row[] = invoices.map((i) => ({
      invoiceNo: i.f311Ref ?? '', id: i.id, drafted: draftedOn(i), taxDate: taxInvoiceDate(i) ?? '',
      stream: this.streamLabel(i.stream), customer: i.customer, branch: i.branch, job: i.jobId ?? '', period: i.period ?? '',
      amount: i.amountMYR, taxLabel: i.taxLabel ?? 'GST', taxRate: i.gstRate, tax: i.gstMYR, total: i.totalMYR,
      status: i.status, sprRef: i.salesPerfRef ?? '', paymentRef: i.paymentRef ?? '', paidAt: i.paidAt ?? '',
      outstanding: i.outstanding ? 'Yes' : 'No', days: daysOutstanding(i, now),
    }));
    const sum = (k: 'amountMYR' | 'gstMYR' | 'totalMYR', list = invoices) => round2(list.reduce((s, i) => s + i[k], 0));

    const detail: Sheet = {
      name: 'Invoices',
      columns: [
        { key: 'invoiceNo', header: 'Tax invoice no.', width: 18 }, { key: 'id', header: 'Internal ref', width: 15 },
        { key: 'drafted', header: 'Drafted', type: 'date', width: 12 }, { key: 'taxDate', header: 'Tax invoice date', type: 'date', width: 15 },
        { key: 'stream', header: 'Stream', width: 30 }, { key: 'customer', header: 'Customer', width: 30 },
        { key: 'branch', header: 'Branch' }, { key: 'job', header: 'Job (PS no.)', width: 15 }, { key: 'period', header: 'Period' },
        { key: 'amount', header: `Amount (${this.cur})`, type: 'money', width: 15 }, { key: 'taxLabel', header: 'Tax' },
        { key: 'taxRate', header: 'Tax rate', type: 'pct' }, { key: 'tax', header: `Tax (${this.cur})`, type: 'money', width: 13 },
        { key: 'total', header: `Total (${this.cur})`, type: 'money', width: 15 }, { key: 'status', header: 'Status', width: 18 },
        { key: 'sprRef', header: 'SPR / e-Payment ref', width: 18 }, { key: 'paymentRef', header: 'Payment ref', width: 15 },
        { key: 'paidAt', header: 'Paid on', type: 'date', width: 12 }, { key: 'outstanding', header: 'Outstanding' },
        { key: 'days', header: 'Days outstanding', type: 'int' },
      ],
      rows,
      totals: { invoiceNo: `TOTAL (${invoices.length})`, amount: sum('amountMYR'), tax: sum('gstMYR'), total: sum('totalMYR') },
    };

    const byStream: Row[] = [...new Set(invoices.map((i) => i.stream))].map((s) => {
      const list = invoices.filter((i) => i.stream === s);
      const paid = list.filter((i) => !i.outstanding);
      return {
        stream: this.streamLabel(s), count: list.length, billed: sum('totalMYR', list), tax: sum('gstMYR', list),
        paid: sum('totalMYR', paid), outstanding: round2(sum('totalMYR', list) - sum('totalMYR', paid)),
      };
    });
    const summary: Sheet = {
      name: 'Summary',
      columns: [
        { key: 'stream', header: 'Stream', width: 32 }, { key: 'count', header: 'Invoices', type: 'int' },
        { key: 'billed', header: `Billed (${this.cur})`, type: 'money', width: 15 }, { key: 'tax', header: `Tax (${this.cur})`, type: 'money', width: 13 },
        { key: 'paid', header: `Paid (${this.cur})`, type: 'money', width: 15 }, { key: 'outstanding', header: `Outstanding (${this.cur})`, type: 'money', width: 17 },
      ],
      rows: byStream,
      totals: {
        stream: 'TOTAL', count: invoices.length, billed: sum('totalMYR'), tax: sum('gstMYR'),
        paid: sum('totalMYR', invoices.filter((i) => !i.outstanding)),
        outstanding: sum('totalMYR', invoices.filter((i) => i.outstanding)),
      },
    };
    return { title: 'Sales Performance Report', subtitle: `Invoices drafted ${period.from} to ${period.to}`, sheets: [detail, summary] };
  }

  /** e-Payment submission file for the ACD stream: the fields the customer's system takes. */
  async ePayment(period: Period): Promise<Report> {
    const invoices = (await this.store.invoices())
      .filter((i) => i.stream === 'ACD' && draftedOn(i) >= period.from && draftedOn(i) <= period.to)
      .sort((a, b) => a.id.localeCompare(b.id));
    return {
      title: 'e-Payment submission — ACD stream',
      subtitle: `Invoices drafted ${period.from} to ${period.to}`,
      sheets: [{
        name: 'e-Payment',
        columns: [
          { key: 'invoiceNo', header: 'InvoiceNo' }, { key: 'invoiceDate', header: 'InvoiceDate', type: 'date' },
          { key: 'job', header: 'JobRef' }, { key: 'customer', header: 'Payer' }, { key: 'amount', header: 'NetAmount', type: 'money' },
          { key: 'taxLabel', header: 'TaxType' }, { key: 'tax', header: 'TaxAmount', type: 'money' }, { key: 'total', header: 'GrossAmount', type: 'money' },
          { key: 'spr', header: 'SPRRef' }, { key: 'ready', header: 'ReadyToSubmit' },
        ],
        rows: invoices.map((i) => ({
          invoiceNo: i.f311Ref ?? i.id, invoiceDate: taxInvoiceDate(i) ?? '', job: i.jobId ?? '', customer: i.customer,
          amount: i.amountMYR, taxLabel: i.taxLabel ?? 'GST', tax: i.gstMYR, total: i.totalMYR, spr: i.salesPerfRef ?? '',
          ready: i.f311Ref && i.salesPerfRef ? 'Y' : 'N',
        })),
      }],
    };
  }

  /** Unpaid invoices by age, for payment follow-up. */
  async outstanding(now = Date.now()): Promise<Report> {
    const open = (await this.store.invoices()).filter((i) => i.outstanding);
    const rows: Row[] = open
      .map((i) => ({ i, days: daysOutstanding(i, now) ?? 0 }))
      .sort((a, b) => b.days - a.days)
      .map(({ i, days }) => ({
        invoiceNo: i.f311Ref ?? i.id, stream: this.streamLabel(i.stream), customer: i.customer, status: i.status,
        since: taxInvoiceDate(i) ?? draftedOn(i), days, bucket: ageingBucket(days), total: i.totalMYR,
      }));
    return {
      title: 'Outstanding payments',
      subtitle: `As at ${new Date(now).toISOString().slice(0, 10)}`,
      sheets: [{
        name: 'Outstanding',
        columns: [
          { key: 'invoiceNo', header: 'Invoice', width: 18 }, { key: 'stream', header: 'Stream', width: 30 },
          { key: 'customer', header: 'Customer', width: 30 }, { key: 'status', header: 'Status', width: 18 },
          { key: 'since', header: 'Since', type: 'date', width: 12 }, { key: 'days', header: 'Days', type: 'int' },
          { key: 'bucket', header: 'Ageing' }, { key: 'total', header: `Total (${this.cur})`, type: 'money', width: 15 },
        ],
        rows,
        totals: { invoiceNo: `TOTAL (${rows.length})`, total: round2(open.reduce((s, i) => s + i.totalMYR, 0)) },
      }],
    };
  }

  /** Stock valuation: every part held, per store, at its moving-average cost. */
  async stockValuation(now = Date.now()): Promise<Report> {
    const levels = await this.prisma.stockLevel.findMany({
      where: { qty: { gt: 0 } },
      include: { part: { select: { partNo: true, name: true, unit: true, group: true, avgCost: true } } },
    });
    const byStore = new Map<string, Row[]>();
    for (const l of levels) {
      const qty = Number(l.qty);
      const avg = Number(l.part.avgCost);
      const rows = byStore.get(l.store) ?? [];
      rows.push({
        partNo: l.part.partNo, name: l.part.name, group: l.part.group ? this.store.label('partGroup', l.part.group) : '',
        bin: l.bin, qty, unit: this.store.label('unit', l.part.unit), avgCost: avg, value: round2(qty * avg),
      });
      byStore.set(l.store, rows);
    }
    const columns: Sheet['columns'] = [
      { key: 'store', header: 'Store', width: 22 },
      { key: 'partNo', header: 'Part no.', width: 16 }, { key: 'name', header: 'Name', width: 34 },
      { key: 'group', header: 'Group', width: 16 }, { key: 'bin', header: 'Bin', width: 10 },
      { key: 'qty', header: 'On hand', type: 'qty' }, { key: 'unit', header: 'Unit', width: 8 },
      { key: 'avgCost', header: 'Average cost', type: 'money', width: 14 }, { key: 'value', header: `Value (${this.cur})`, type: 'money', width: 15 },
    ];
    const stores = [...byStore.keys()].sort();
    const all: Row[] = [];
    for (const k of stores) {
      for (const r of byStore.get(k)!.sort((a, b) => String(a.partNo).localeCompare(String(b.partNo)))) all.push({ store: this.store.label('store', k), ...r });
    }
    const total = (rows: Row[]) => round2(rows.reduce((s, r) => s + Number(r.value), 0));
    const summary: Row[] = stores.map((k) => ({ store: this.store.label('store', k), lines: byStore.get(k)!.length, value: total(byStore.get(k)!) }));
    return {
      title: 'Stock valuation',
      subtitle: `As at ${new Date(now).toISOString().slice(0, 10)} — moving-average cost`,
      sheets: [
        { name: 'Stock', columns, rows: all, totals: { store: `TOTAL (${all.length})`, value: total(all) } },
        {
          name: 'By store',
          columns: [{ key: 'store', header: 'Store', width: 26 }, { key: 'lines', header: 'Parts held', type: 'int', width: 12 }, { key: 'value', header: `Value (${this.cur})`, type: 'money', width: 15 }],
          rows: summary,
          totals: { store: 'TOTAL', lines: all.length, value: total(all) },
        },
      ],
    };
  }

  /** Parts used: issues to work orders net of returns, in a period, with cost. */
  async partsUsage(period: Period): Promise<Report> {
    const moves = await this.prisma.stockMovement.findMany({
      where: {
        type: { in: ['ISSUE', 'RETURN'] }, jobId: { not: null },
        at: { gte: new Date(`${period.from}T00:00:00Z`), lt: new Date(Date.parse(`${period.to}T00:00:00Z`) + DAY) },
      },
      select: { partId: true, jobId: true, qty: true, unitCost: true },
    });
    const partIds = [...new Set(moves.map((m) => m.partId))];
    const jobIds = [...new Set(moves.map((m) => m.jobId!))];
    const [parts, jobs] = await Promise.all([
      this.prisma.part.findMany({ where: { id: { in: partIds } }, select: { id: true, partNo: true, name: true, unit: true } }),
      this.prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, component: true, asset: { select: { tag: true } } } }),
    ]);
    const part = new Map(parts.map((p) => [p.id, p]));
    const job = new Map(jobs.map((j) => [j.id, j]));
    const lines = new Map<string, { partId: string; jobId: string; qty: number; cost: number }>();
    for (const m of moves) {
      const key = `${m.partId}\u0000${m.jobId}`;
      const l = lines.get(key) ?? { partId: m.partId, jobId: m.jobId!, qty: 0, cost: 0 };
      l.qty -= Number(m.qty); // issues are negative in the ledger
      l.cost -= Number(m.qty) * Number(m.unitCost);
      lines.set(key, l);
    }
    const detail: Row[] = [...lines.values()]
      .filter((l) => round3(l.qty) !== 0 || round2(l.cost) !== 0)
      .map((l) => {
        const p = part.get(l.partId);
        const j = job.get(l.jobId);
        return {
          partNo: p?.partNo ?? l.partId, name: p?.name ?? '', jobId: l.jobId, asset: j?.asset?.tag ?? '', item: j?.component ?? '',
          qty: round3(l.qty), unit: p ? this.store.label('unit', p.unit) : '', cost: round2(l.cost),
        };
      })
      .sort((a, b) => String(a.partNo).localeCompare(String(b.partNo)) || String(a.jobId).localeCompare(String(b.jobId)));
    const byPart = new Map<string, Row>();
    for (const r of detail) {
      const t = byPart.get(String(r.partNo)) ?? { partNo: r.partNo, name: r.name, qty: 0, unit: r.unit, jobs: 0, cost: 0 };
      t.qty = round3(Number(t.qty) + Number(r.qty));
      t.cost = round2(Number(t.cost) + Number(r.cost));
      t.jobs = Number(t.jobs) + 1;
      byPart.set(String(r.partNo), t);
    }
    const summary = [...byPart.values()].sort((a, b) => Number(b.cost) - Number(a.cost));
    const total = round2(detail.reduce((s, r) => s + Number(r.cost), 0));
    return {
      title: 'Parts usage',
      subtitle: `${period.from} to ${period.to} — issues to work orders, net of returns`,
      sheets: [
        {
          name: 'By part',
          columns: [
            { key: 'partNo', header: 'Part no.', width: 16 }, { key: 'name', header: 'Name', width: 34 },
            { key: 'qty', header: 'Used', type: 'qty' }, { key: 'unit', header: 'Unit', width: 8 },
            { key: 'jobs', header: 'Work orders', type: 'int', width: 12 }, { key: 'cost', header: `Cost (${this.cur})`, type: 'money', width: 15 },
          ],
          rows: summary,
          totals: { partNo: `TOTAL (${summary.length})`, cost: total },
        },
        {
          name: 'By work order',
          columns: [
            { key: 'partNo', header: 'Part no.', width: 16 }, { key: 'name', header: 'Name', width: 30 },
            { key: 'jobId', header: 'Work order', width: 16 }, { key: 'asset', header: 'Asset', width: 14 }, { key: 'item', header: 'Item', width: 26 },
            { key: 'qty', header: 'Used', type: 'qty' }, { key: 'unit', header: 'Unit', width: 8 }, { key: 'cost', header: `Cost (${this.cur})`, type: 'money', width: 15 },
          ],
          rows: detail,
          totals: { partNo: `TOTAL (${detail.length})`, cost: total },
        },
      ],
    };
  }

  /** Portal requests in a period: outcome, work order, time to accept and complete, rating. */
  async requestsReport(period: Period): Promise<Report> {
    const rows = await this.prisma.serviceRequest.findMany({
      where: { createdAt: { gte: new Date(`${period.from}T00:00:00Z`), lt: new Date(Date.parse(`${period.to}T00:00:00Z`) + DAY) } },
      orderBy: { createdAt: 'asc' },
    });
    const jobIds = [...new Set(rows.map((r) => r.jobId).filter((j): j is string => !!j))];
    const jobs = new Map((await this.prisma.job.findMany({ where: { id: { in: jobIds } }, select: { id: true, status: true, audit: true } })).map((j) => [j.id, j]));
    // When the work order first reached a done phase, from its audit trail.
    const doneKeys = new Set(this.store.statusesInPhase('JOB', 'done', 'closed'));
    const doneAt = (jobId: string | null) => {
      const job = jobId ? jobs.get(jobId) : undefined;
      const entry = (job?.audit as { action: string; at: string }[] | undefined)?.find((a) => [...doneKeys].some((k) => a.action.startsWith(`Status → ${k}`)));
      return entry ? new Date(entry.at) : null;
    };
    const hours = (a: Date | null, b: Date | null) => (a && b ? Math.round(((b.getTime() - a.getTime()) / 3_600_000) * 10) / 10 : null);
    const outcome: Record<string, string> = { NEW: 'Waiting', ACCEPTED: 'Accepted', DECLINED: 'Declined', CANCELLED: 'Cancelled by requester' };
    const detail: Row[] = rows.map((r) => {
      const done = doneAt(r.jobId);
      return {
        id: r.id, date: r.createdAt.toISOString().slice(0, 10), source: r.source === 'POSTER' ? 'QR poster' : r.source === 'STAFF' ? 'Logged by staff' : 'Portal',
        site: r.site ? this.store.label('site', r.site) : '', category: r.category ? this.store.label('category', r.category) : '',
        place: r.place, urgent: r.urgent ? 'Yes' : '', outcome: r.merged ? 'Added to a work order' : r.spam ? 'Spam' : outcome[r.status] ?? r.status,
        jobId: r.jobId ?? '', hoursToDecide: hours(r.createdAt, r.decidedAt), daysToComplete: done ? Math.round(((hours(r.createdAt, done) ?? 0) / 24) * 10) / 10 : null,
        rating: r.rating, comment: r.ratingComment,
      };
    });
    // Summary by site and type.
    const groups = new Map<string, { site: string; category: string; requests: number; accepted: number; declined: number; ratings: number[]; decide: number[] }>();
    for (const [i, r] of rows.entries()) {
      const key = `${detail[i].site}\u0000${detail[i].category}`;
      const g = groups.get(key) ?? { site: String(detail[i].site), category: String(detail[i].category), requests: 0, accepted: 0, declined: 0, ratings: [], decide: [] };
      g.requests += 1;
      if (r.status === 'ACCEPTED') g.accepted += 1;
      if (r.status === 'DECLINED') g.declined += 1;
      if (r.rating) g.ratings.push(r.rating);
      if (detail[i].hoursToDecide !== null) g.decide.push(Number(detail[i].hoursToDecide));
      groups.set(key, g);
    }
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);
    const summary: Row[] = [...groups.values()].sort((a, b) => b.requests - a.requests).map((g) => ({
      site: g.site, category: g.category, requests: g.requests, accepted: g.accepted, declined: g.declined, avgHoursToDecide: avg(g.decide), avgRating: avg(g.ratings), ratings: g.ratings.length,
    }));
    const allRatings = rows.map((r) => r.rating).filter((x): x is number => !!x);
    return {
      title: 'Requests and satisfaction',
      subtitle: `${period.from} to ${period.to} — requests from the portal, QR posters and callers`,
      sheets: [
        {
          name: 'Requests',
          columns: [
            { key: 'id', header: 'Request', width: 16 }, { key: 'date', header: 'Date', type: 'date', width: 12 }, { key: 'source', header: 'From', width: 14 },
            { key: 'site', header: 'Site', width: 20 }, { key: 'category', header: 'Type', width: 22 }, { key: 'place', header: 'Where', width: 26 },
            { key: 'urgent', header: 'Urgent', width: 8 }, { key: 'outcome', header: 'Outcome', width: 22 }, { key: 'jobId', header: 'Work order', width: 16 },
            { key: 'hoursToDecide', header: 'Hours to decide', type: 'qty', width: 14 }, { key: 'daysToComplete', header: 'Days to complete', type: 'qty', width: 15 },
            { key: 'rating', header: 'Rating', type: 'int', width: 8 }, { key: 'comment', header: 'Comment', width: 40 },
          ],
          rows: detail,
          totals: { id: `TOTAL (${detail.length})`, rating: avg(allRatings) },
        },
        {
          name: 'By site and type',
          columns: [
            { key: 'site', header: 'Site', width: 22 }, { key: 'category', header: 'Type', width: 24 }, { key: 'requests', header: 'Requests', type: 'int' },
            { key: 'accepted', header: 'Accepted', type: 'int' }, { key: 'declined', header: 'Declined', type: 'int' },
            { key: 'avgHoursToDecide', header: 'Avg hours to decide', type: 'qty', width: 18 }, { key: 'avgRating', header: 'Avg rating', type: 'qty', width: 11 }, { key: 'ratings', header: 'Ratings', type: 'int' },
          ],
          rows: summary,
          totals: { site: 'TOTAL', requests: rows.length, avgRating: avg(allRatings), ratings: allRatings.length },
        },
      ],
    };
  }

  /** Time logged on work orders in a period: by person, by work order, and every entry. */
  async labourReport(period: Period): Promise<Report> {
    const rows = await this.prisma.timeEntry.findMany({
      where: { workDate: { gte: new Date(`${period.from}T00:00:00Z`), lte: new Date(`${period.to}T00:00:00Z`) } },
      orderBy: [{ workDate: 'asc' }, { userName: 'asc' }],
    });
    const jobs = new Map((await this.prisma.job.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.jobId))] } }, select: { id: true, component: true, status: true } })).map((j) => [j.id, j]));
    const hours = (m: number) => Math.round((m / 60) * 100) / 100;
    const group = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
      const out = new Map<K, { minutes: number; cost: number; entries: number; jobs: Set<string>; people: Set<string> }>();
      for (const r of rows) {
        const g = out.get(key(r)) ?? { minutes: 0, cost: 0, entries: 0, jobs: new Set<string>(), people: new Set<string>() };
        g.minutes += r.minutes; g.cost += Number(r.cost); g.entries += 1; g.jobs.add(r.jobId); g.people.add(r.userId);
        out.set(key(r), g);
      }
      return out;
    };
    const byPerson = group((r) => `${r.userId}\u0000${r.userName}`);
    const byJob = group((r) => r.jobId);
    const totalMin = rows.reduce((s, r) => s + r.minutes, 0);
    const totalCost = round2(rows.reduce((s, r) => s + Number(r.cost), 0));
    return {
      title: 'Labour',
      subtitle: `${period.from} to ${period.to} — time logged on work orders, at the rates in force when it was logged`,
      sheets: [
        {
          name: 'By person',
          columns: [
            { key: 'person', header: 'Person', width: 26 }, { key: 'hours', header: 'Hours', type: 'qty' }, { key: 'entries', header: 'Entries', type: 'int' },
            { key: 'jobs', header: 'Work orders', type: 'int', width: 12 }, { key: 'cost', header: `Cost (${this.cur})`, type: 'money', width: 15 },
          ],
          rows: [...byPerson.entries()].map(([k, g]) => ({ person: k.split('\u0000')[1], hours: hours(g.minutes), entries: g.entries, jobs: g.jobs.size, cost: round2(g.cost) }))
            .sort((a, b) => Number(b.hours) - Number(a.hours)),
          totals: { person: 'TOTAL', hours: hours(totalMin), entries: rows.length, cost: totalCost },
        },
        {
          name: 'By work order',
          columns: [
            { key: 'jobId', header: 'Work order', width: 16 }, { key: 'item', header: 'Item', width: 30 }, { key: 'status', header: 'Status', width: 18 },
            { key: 'hours', header: 'Hours', type: 'qty' }, { key: 'people', header: 'People', type: 'int' }, { key: 'cost', header: `Cost (${this.cur})`, type: 'money', width: 15 },
          ],
          rows: [...byJob.entries()].map(([id, g]) => ({
            jobId: id, item: jobs.get(id)?.component ?? '', status: jobs.get(id) ? this.store.label('status:JOB', jobs.get(id)!.status) : '',
            hours: hours(g.minutes), people: g.people.size, cost: round2(g.cost),
          })).sort((a, b) => Number(b.cost) - Number(a.cost)),
          totals: { jobId: `TOTAL (${byJob.size})`, hours: hours(totalMin), cost: totalCost },
        },
        {
          name: 'Entries',
          columns: [
            { key: 'date', header: 'Date', type: 'date', width: 12 }, { key: 'person', header: 'Person', width: 24 }, { key: 'jobId', header: 'Work order', width: 16 },
            { key: 'minutes', header: 'Minutes', type: 'int' }, { key: 'rate', header: 'Rate', type: 'money' }, { key: 'cost', header: `Cost (${this.cur})`, type: 'money' },
            { key: 'note', header: 'Note', width: 40 },
          ],
          rows: rows.map((r) => ({ date: r.workDate.toISOString().slice(0, 10), person: r.userName, jobId: r.jobId, minutes: r.minutes, rate: r.rate === null ? null : Number(r.rate), cost: Number(r.cost), note: r.note })),
        },
      ],
    };
  }

  /** FR-04 / FR-12 — the audit trail for a period, optionally for one kind of record. */
  async auditTrail(period: Period, entity?: string): Promise<Report> {
    if (entity && !(entity in AUDIT_ENTITIES)) {
      throw new BadRequestException(`entity must be one of ${Object.keys(AUDIT_ENTITIES).join(', ')}`);
    }
    const where = {
      at: { gte: new Date(`${period.from}T00:00:00.000Z`), lte: new Date(`${period.to}T23:59:59.999Z`) },
      ...(entity ? { [AUDIT_ENTITIES[entity as AuditEntity]]: { not: null } } : {}),
    };
    const MAX = 50_000;
    const entries = await this.prisma.auditEntry.findMany({ where, orderBy: [{ at: 'asc' }, { id: 'asc' }], take: MAX + 1 });
    if (entries.length > MAX) throw new BadRequestException(`More than ${MAX} entries — narrow the period or choose an entity`);
    const kindOf = (e: (typeof entries)[number]): [string, string] => {
      for (const [k, col] of Object.entries(AUDIT_ENTITIES)) {
        const v = (e as unknown as Record<string, string | null>)[col];
        if (v) return [k, v];
      }
      return ['-', '-'];
    };
    return {
      title: 'Audit trail',
      subtitle: `${entity ?? 'All records'} · ${period.from} to ${period.to}`,
      sheets: [{
        name: 'Audit trail',
        columns: [
          { key: 'at', header: 'When (UTC)', width: 20 }, { key: 'entity', header: 'Record type' }, { key: 'ref', header: 'Record', width: 18 },
          { key: 'by', header: 'By', width: 20 }, { key: 'role', header: 'Role', width: 12 }, { key: 'action', header: 'Action', width: 50 },
          { key: 'fields', header: 'Fields entered', width: 60 },
        ],
        rows: entries.map((e) => {
          const [kind, ref] = kindOf(e);
          return {
            at: e.at.toISOString().replace('T', ' ').slice(0, 19), entity: kind, ref, by: e.by, role: e.role, action: e.action,
            fields: e.fields ? Object.entries(e.fields as Record<string, string>).map(([k, v]) => `${k}=${v}`).join('; ') : '',
          };
        }),
      }],
    };
  }
}
