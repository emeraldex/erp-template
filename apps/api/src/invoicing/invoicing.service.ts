import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { Branch, Invoice, InvoiceStatus, InvoiceStream, Role } from '../common/types';
import { computeTax } from '../common/money';
import { SettingsService } from '../settings/settings.service';

/**
 * QP.51 Invoicing & Revenue Billing (5.8) — FR-13 / FR-14.
 * Four parallel streams (PBC, branch-repaired, CoE/MRA, ACD) modelled as
 * configurable variants of ONE billing process: raise → certify + CTC →
 * Tax Invoice + tax (rate from settings) → correctness gate → submit to CPU (Finance) → payment.
 * Tax is computed by the engine; the correctness gate and rejection/correction
 * loop are enforced, and payment is recorded & monitored for outstanding amounts.
 */
@Injectable()
export class InvoicingService {
  constructor(private readonly store: StoreService, private readonly settings: SettingsService) {}

  list(): Promise<Invoice[]> {
    return this.store.invoices();
  }

  streams() {
    return this.store.invoiceStreams;
  }

  async get(id: string): Promise<Invoice> {
    const inv = await this.store.invoice(id);
    if (!inv) throw new NotFoundException(`Invoice ${id} not found`);
    return inv;
  }

  private gst(amount: number, rate: number) {
    const { taxMYR, totalMYR } = computeTax(amount, rate);
    return { gstMYR: taxMYR, totalMYR };
  }

  /** Open a new billing record for a job (or a periodic PBC run). */
  async create(
    dto: { stream: InvoiceStream; jobId?: string; customer?: string; period?: string; branch?: Branch; amountMYR?: number },
    actor: { name: string; role: Role },
  ): Promise<Invoice> {
    const def = this.store.invoiceStreams.find((s) => s.id === dto.stream);
    if (!def) throw new BadRequestException(`Unknown invoicing stream ${dto.stream}`);
    if (def.perJob && !dto.jobId) throw new BadRequestException(`Stream ${def.label} bills against a job — jobId required`);

    const job = dto.jobId ? await this.store.job(dto.jobId) : null;
    if (dto.jobId && !job) throw new NotFoundException(`Job ${dto.jobId} not found`);

    const amount = Number(dto.amountMYR ?? 0);
    // The rate in force when the invoice is drafted stays with it, so a later
    // change of rate never alters invoices already raised.
    const tax = this.settings.tax;
    const { gstMYR, totalMYR } = this.gst(amount, tax.ratePct);
    const now = new Date().toISOString();
    const inv: Invoice = {
      id: await this.store.nextInvoiceId(),
      stream: dto.stream,
      jobId: dto.jobId,
      customer: dto.customer || def.customer,
      period: dto.period,
      amountMYR: amount,
      gstRate: tax.ratePct,
      taxLabel: tax.label,
      gstMYR,
      totalMYR,
      status: this.store.initialStatus('INVOICE'),
      statusSince: now,
      outstanding: true,
      raisedBy: actor.name,
      branch: dto.branch ?? job?.repairUnit ?? 'HQ',
      records: [],
      audit: [this.store.audit(actor.name, actor.role, `Invoice drafted — ${def.label} stream`, { stream: dto.stream })],
    };
    this.store.newInvoice(inv);

    if (job) {
      job.invoiceIds = [...(job.invoiceIds ?? []), inv.id];
      job.audit.push(this.store.audit(actor.name, actor.role, `Invoice ${inv.id} opened (${def.label}${this.store.procedureRef(', QP.51')})`));
      await this.store.save(job, inv);
    } else {
      await this.store.save(inv);
    }
    return inv;
  }

  async transition(id: string, to: InvoiceStatus, fields: Record<string, string>, actor: { name: string; role: Role }): Promise<Invoice> {
    const inv = await this.get(id);
    if (this.store.isFinal('INVOICE', inv.status)) throw new BadRequestException('Invoice is closed');
    const def = this.store.invoiceStreams.find((s) => s.id === inv.stream);
    const f = fields ?? {};

    // Stream-specific requirements, e.g. ACD must be keyed into the Company Sales
    // Performance Report (e-Payment) before submission (QP.51 §E4 / FR-14).
    for (const key of def?.requiredFields?.[to] ?? []) {
      if (!f[key] && !(inv as unknown as Record<string, unknown>)[key]) {
        throw new BadRequestException(
          key === 'salesPerfRef'
            ? `${inv.stream} invoices must be keyed into the Company Sales Performance Report (e-Payment) before submission — provide salesPerfRef.`
            : `${def?.label ?? inv.stream} invoices need ${key} before this step`,
        );
      }
    }

    const rule = applyTransition(inv, this.store.invoiceTransitions, to, f, actor);

    for (const e of rule.effects ?? []) {
      const p = (e.params ?? {}) as Record<string, string>;
      switch (e.type) {
        case 'setAttributes':
          for (const attr of ['customerSignRef', 'ctcRef', 'correctnessBy', 'salesPerfRef'] as const) {
            if (p[attr] && f[p[attr]]) inv[attr] = f[p[attr]];
          }
          break;
        case 'raiseTaxInvoice':
          inv.f311Ref = f[p.numberField];
          if (p.amountField && f[p.amountField]) {
            inv.amountMYR = Number(f[p.amountField]);
            const { gstMYR, totalMYR } = this.gst(inv.amountMYR, inv.gstRate);
            inv.gstMYR = gstMYR;
            inv.totalMYR = totalMYR;
          }
          break;
        case 'markPaid':
          inv.paymentRef = f[p.refField];
          inv.paidAt = new Date().toISOString().slice(0, 10);
          inv.outstanding = false;
          break;
        case 'markOutstanding':
          inv.outstanding = true;
          break;
      }
    }

    // Reflect key billing milestones onto the parent job's audit trail
    const job = inv.jobId ? await this.store.job(inv.jobId) : null;
    if (job) {
      const paid = rule.effects?.some((e) => e.type === 'markPaid');
      const label = paid ? `Invoice ${inv.id} PAID (${def?.label})`
        : this.store.phaseOf('INVOICE', to) === 'waiting_customer' ? `Invoice ${inv.id} submitted to ${inv.customer}`
        : `Invoice ${inv.id}: ${to}`;
      job.audit.push(this.store.audit(actor.name, actor.role, label));
      await this.store.save(job, inv);
    } else {
      await this.store.save(inv);
    }
    return inv;
  }
}
