import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { Invoice } from '../common/types';
import { Report, Row, Sheet } from './tabular';

export interface Period { from: string; to: string }

const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n: number) => Math.round(n * 100) / 100;

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
export const taxInvoiceDate = (i: Invoice) => i.records.find((r) => r.formNo === 'F311')?.date;

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
  constructor(private readonly store: StoreService, private readonly prisma: PrismaService) {}

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
        { key: 'amount', header: 'Amount (MYR)', type: 'money', width: 15 }, { key: 'taxLabel', header: 'Tax' },
        { key: 'taxRate', header: 'Tax rate', type: 'pct' }, { key: 'tax', header: 'Tax (MYR)', type: 'money', width: 13 },
        { key: 'total', header: 'Total (MYR)', type: 'money', width: 15 }, { key: 'status', header: 'Status', width: 18 },
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
        { key: 'billed', header: 'Billed (MYR)', type: 'money', width: 15 }, { key: 'tax', header: 'Tax (MYR)', type: 'money', width: 13 },
        { key: 'paid', header: 'Paid (MYR)', type: 'money', width: 15 }, { key: 'outstanding', header: 'Outstanding (MYR)', type: 'money', width: 17 },
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
          { key: 'bucket', header: 'Ageing' }, { key: 'total', header: 'Total (MYR)', type: 'money', width: 15 },
        ],
        rows,
        totals: { invoiceNo: `TOTAL (${rows.length})`, total: round2(open.reduce((s, i) => s + i.totalMYR, 0)) },
      }],
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
