import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { Invoice } from '../common/types';
import { taxInvoiceDate } from '../reports/reports.service';
import type { Report, Row } from '../reports/tabular';
import { SettingsService } from '../settings/settings.service';
import { roundMoney } from '../settings/currency';

type Kind = 'SALE' | 'RECEIPT' | 'PURCHASE';
type Line = { kind: Kind; ref: string; date: string; data: Row };
type Actor = { name: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const inRange = (d: string | undefined, from: string, to: string) => !!d && d >= from && d <= to;

/**
 * Figures for the accounting system: tax invoices raised (sales), payments
 * recorded (receipts), and goods received or vendor repairs closed
 * (purchases), with the organisation's account codes. Each batch records
 * what it held, so nothing is exported twice unless asked.
 */
@Injectable()
export class AccountingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
  ) {}

  private period(from: unknown, to: unknown) {
    const f = String(from ?? ''); const t = String(to ?? '');
    const real = (d: string) => ISO.test(d) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d);
    if (!real(f) || !real(t)) throw new BadRequestException('from and to: dates as YYYY-MM-DD');
    if (f > t) throw new BadRequestException('from must not be after to');
    if (Date.parse(t) - Date.parse(f) > 366 * 86_400_000) throw new BadRequestException('At most a year per export');
    return { from: f, to: t };
  }

  /** Everything in the period, exported before or not. */
  private async gather(from: string, to: string): Promise<Line[]> {
    const acc = this.settings.accounting;
    const cur = this.settings.currency;
    const lines: Line[] = [];
    const invoices: Invoice[] = await this.store.invoices();
    for (const inv of invoices) {
      const date = taxInvoiceDate(inv);
      if (inv.f311Ref && inRange(date, from, to)) {
        lines.push({
          kind: 'SALE', ref: inv.id, date: date!, data: {
            invoiceNo: inv.f311Ref, date, customer: inv.customer, description: inv.period ? `${inv.stream} ${inv.period}` : inv.jobId ? `Work order ${inv.jobId}` : inv.stream,
            stream: inv.stream, jobId: inv.jobId ?? '', currency: cur.code, net: roundMoney(inv.amountMYR, cur), taxCode: acc.taxCode, taxRate: inv.gstRate,
            tax: roundMoney(inv.gstMYR, cur), total: roundMoney(inv.totalMYR, cur), revenueAccount: acc.revenueByStream[inv.stream] ?? acc.revenueDefault,
            receivableAccount: acc.receivables, taxAccount: acc.outputTax,
          },
        });
      }
      if (inv.paidAt && inRange(inv.paidAt.slice(0, 10), from, to)) {
        lines.push({
          kind: 'RECEIPT', ref: inv.id, date: inv.paidAt.slice(0, 10), data: {
            date: inv.paidAt.slice(0, 10), invoiceNo: inv.f311Ref ?? inv.id, customer: inv.customer, currency: cur.code, amount: roundMoney(inv.totalMYR, cur),
            reference: inv.paymentRef ?? '', bankAccount: acc.bank, receivableAccount: acc.receivables,
          },
        });
      }
    }
    // Goods received: the step that records the receipt, from the request's audit trail.
    const receivedAt = [...new Set(this.store.demandTransitions.filter((r) => (r.effects ?? []).some((e) => e.type === 'recordReceipt')).map((r) => r.to))];
    if (receivedAt.length) {
      const demands = await this.prisma.demand.findMany({
        where: { poRef: { not: null } },
        include: { quotations: true, audit: { where: { action: { startsWith: 'Status → ' } }, orderBy: { at: 'asc' } } },
      });
      for (const d of demands) {
        const step = d.audit.find((a) => receivedAt.includes(a.action.slice('Status → '.length).split(':')[0]));
        const date = step?.at.toISOString().slice(0, 10);
        if (!inRange(date, from, to)) continue;
        const q = d.quotations.find((x) => x.supplierId === d.evalSupplierId) ?? (d.quotations.length === 1 ? d.quotations[0] : undefined);
        const amount = q ? Number(q.priceMYR) : d.unitCost !== null ? Number(d.unitCost) * Number(d.qty) : 0;
        lines.push({
          kind: 'PURCHASE', ref: d.id, date: date!, data: {
            reference: d.poRef ?? d.id, date, supplier: q?.supplier ?? '', description: d.partDescription, quantity: Number(d.qty), currency: cur.code,
            amount: roundMoney(amount, cur), account: d.partId ? acc.stock : acc.purchases, jobId: d.jobId ?? '', source: `Request ${d.id}`,
          },
        });
      }
    }
    // Vendor repairs closed with a cost.
    const finalOv = this.store.statusKeys('OV').filter((s) => this.store.isFinal('OV', s));
    const ovs = await this.prisma.ovRepair.findMany({ where: { costMYR: { not: null }, status: { in: finalOv } }, select: { id: true, jobId: true, vendorName: true, poRef: true, costMYR: true, statusSince: true } });
    for (const o of ovs) {
      const date = o.statusSince.toISOString().slice(0, 10);
      if (!inRange(date, from, to)) continue;
      lines.push({
        kind: 'PURCHASE', ref: o.id, date, data: {
          reference: o.poRef ?? o.id, date, supplier: o.vendorName ?? '', description: `Vendor repair for ${o.jobId}`, quantity: 1, currency: cur.code,
          amount: roundMoney(Number(o.costMYR), cur), account: acc.purchases, jobId: o.jobId, source: `Vendor repair ${o.id}`,
        },
      });
    }
    return lines.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
  }

  private async exportedKeys(): Promise<Set<string>> {
    const rows = await this.prisma.accountingExportItem.findMany({ select: { kind: true, ref: true } });
    return new Set(rows.map((r) => `${r.kind}:${r.ref}`));
  }

  /** What a batch for the period would hold, and what was exported before. */
  async preview(from: unknown, to: unknown) {
    const p = this.period(from, to);
    const lines = await this.gather(p.from, p.to);
    const done = await this.exportedKeys();
    const count = (k: Kind, exported: boolean) => lines.filter((l) => l.kind === k && done.has(`${l.kind}:${l.ref}`) === exported).length;
    return {
      ...p, currency: this.settings.currency.code,
      sales: { new: count('SALE', false), exported: count('SALE', true) },
      receipts: { new: count('RECEIPT', false), exported: count('RECEIPT', true) },
      purchases: { new: count('PURCHASE', false), exported: count('PURCHASE', true) },
    };
  }

  /** Record a batch; it holds only what was not exported before, unless asked to repeat. */
  async create(body: { from?: unknown; to?: unknown; includeExported?: unknown }, actor: Actor) {
    const p = this.period(body.from, body.to);
    const repeat = body.includeExported === true;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(current_schema() || ':accounting-export'))`;
      const done = new Set((await tx.accountingExportItem.findMany({ select: { kind: true, ref: true } })).map((r) => `${r.kind}:${r.ref}`));
      const lines = (await this.gather(p.from, p.to)).filter((l) => repeat || !done.has(`${l.kind}:${l.ref}`));
      if (!lines.length) throw new BadRequestException('Nothing new to export for that period');
      const year = new Date().getFullYear();
      const last = await tx.accountingExport.findFirst({ where: { id: { startsWith: `EXP-${year}-` } }, orderBy: { id: 'desc' }, select: { id: true } });
      const id = `EXP-${year}-${String(last ? Number(last.id.slice(-4)) + 1 : 1).padStart(4, '0')}`;
      await tx.accountingExport.create({
        data: {
          id, fromDate: new Date(`${p.from}T00:00:00Z`), toDate: new Date(`${p.to}T00:00:00Z`), includeExported: repeat, createdBy: actor.name,
          items: { create: lines.map((l) => ({ kind: l.kind, ref: l.ref, data: l.data as never })) },
        },
      });
      return this.summary(tx, id);
    }, { timeout: 60_000 });
  }

  private async summary(tx: Pick<PrismaService, 'accountingExport'>, id: string) {
    const e = await tx.accountingExport.findUnique({ where: { id }, include: { items: { select: { kind: true } } } });
    if (!e) throw new NotFoundException(`Export ${id} not found`);
    const n = (k: Kind) => e.items.filter((i) => i.kind === k).length;
    return {
      id: e.id, from: e.fromDate.toISOString().slice(0, 10), to: e.toDate.toISOString().slice(0, 10), includeExported: e.includeExported,
      createdBy: e.createdBy, createdAt: e.createdAt.toISOString(), sales: n('SALE'), receipts: n('RECEIPT'), purchases: n('PURCHASE'),
    };
  }

  async list() {
    const rows = await this.prisma.accountingExport.findMany({ orderBy: { createdAt: 'desc' }, take: 100, select: { id: true } });
    return Promise.all(rows.map((r) => this.summary(this.prisma, r.id)));
  }

  /** The batch as a workbook: Sales, Receipts and Purchases. */
  async report(id: string): Promise<Report> {
    const e = await this.prisma.accountingExport.findUnique({ where: { id }, include: { items: { orderBy: { id: 'asc' } } } });
    if (!e) throw new NotFoundException(`Export ${id} not found`);
    const rows = (k: Kind) => e.items.filter((i) => i.kind === k).map((i) => i.data as Row);
    const c = this.settings.currency.code;
    const sum = (rs: Row[], key: string) => roundMoney(rs.reduce((s, r) => s + Number(r[key] ?? 0), 0), this.settings.currency);
    const sales = rows('SALE'); const receipts = rows('RECEIPT'); const purchases = rows('PURCHASE');
    return {
      title: `Accounting export ${e.id}`,
      subtitle: `${e.fromDate.toISOString().slice(0, 10)} to ${e.toDate.toISOString().slice(0, 10)} — amounts in ${c}; exported by ${e.createdBy} on ${e.createdAt.toISOString().slice(0, 10)}`,
      sheets: [
        {
          name: 'Sales',
          columns: [
            { key: 'invoiceNo', header: 'Invoice no.', width: 18 }, { key: 'date', header: 'Date', type: 'date', width: 12 }, { key: 'customer', header: 'Customer', width: 28 },
            { key: 'description', header: 'Description', width: 30 }, { key: 'stream', header: 'Stream', width: 12 }, { key: 'jobId', header: 'Work order', width: 16 },
            { key: 'currency', header: 'Currency', width: 9 }, { key: 'net', header: 'Net', type: 'money' }, { key: 'taxCode', header: 'Tax code', width: 9 },
            { key: 'taxRate', header: 'Tax rate', type: 'pct' }, { key: 'tax', header: 'Tax', type: 'money' }, { key: 'total', header: 'Total', type: 'money' },
            { key: 'revenueAccount', header: 'Revenue account', width: 15 }, { key: 'receivableAccount', header: 'Receivable account', width: 17 }, { key: 'taxAccount', header: 'Tax account', width: 12 },
          ],
          rows: sales, totals: { invoiceNo: `TOTAL (${sales.length})`, net: sum(sales, 'net'), tax: sum(sales, 'tax'), total: sum(sales, 'total') },
        },
        {
          name: 'Receipts',
          columns: [
            { key: 'date', header: 'Date', type: 'date', width: 12 }, { key: 'invoiceNo', header: 'Invoice no.', width: 18 }, { key: 'customer', header: 'Customer', width: 28 },
            { key: 'currency', header: 'Currency', width: 9 }, { key: 'amount', header: 'Amount', type: 'money' }, { key: 'reference', header: 'Payment reference', width: 20 },
            { key: 'bankAccount', header: 'Bank account', width: 13 }, { key: 'receivableAccount', header: 'Receivable account', width: 17 },
          ],
          rows: receipts, totals: { date: `TOTAL (${receipts.length})`, amount: sum(receipts, 'amount') },
        },
        {
          name: 'Purchases',
          columns: [
            { key: 'reference', header: 'Reference', width: 16 }, { key: 'date', header: 'Date', type: 'date', width: 12 }, { key: 'supplier', header: 'Supplier', width: 26 },
            { key: 'description', header: 'Description', width: 30 }, { key: 'quantity', header: 'Quantity', type: 'qty' }, { key: 'currency', header: 'Currency', width: 9 },
            { key: 'amount', header: 'Amount', type: 'money' }, { key: 'account', header: 'Account', width: 10 }, { key: 'jobId', header: 'Work order', width: 16 }, { key: 'source', header: 'Source', width: 22 },
          ],
          rows: purchases, totals: { reference: `TOTAL (${purchases.length})`, amount: sum(purchases, 'amount') },
        },
      ],
    };
  }

  accountSettings() {
    return { ...this.settings.accounting, streams: this.store.invoiceStreams.map((s) => ({ id: s.id, label: s.label })) };
  }

  async setAccountSettings(body: Record<string, unknown>, actor: Actor) {
    await this.settings.updateAccounting(body as never, this.store.invoiceStreams.map((s) => s.id), actor.name);
    return this.accountSettings();
  }
}
