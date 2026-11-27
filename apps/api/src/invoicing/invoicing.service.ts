import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { Branch, Invoice, InvoiceStatus, InvoiceStream, Role } from '../common/types';
import { computeTax } from '../common/money';
import { SettingsService } from '../settings/settings.service';
import { currencyOf, formatMoney, roundMoney } from '../settings/currency';
import { Fx, FxService, today } from '../fx/fx.service';
import { RATE_JUMP_LIMIT, invoiceToBase, jump, jumpMessage, roundRate } from '../fx/fx';

export interface InvoiceInput {
  stream: InvoiceStream; jobId?: string; customer?: string; period?: string; branch?: Branch;
  /** The old form: the net amount in the organisation's currency. */
  amountMYR?: number;
  /** Net amount in `currency` (the organisation's when absent). */
  amount?: number; currency?: string; rate?: number; confirm?: boolean;
}

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
  constructor(private readonly store: StoreService, private readonly settings: SettingsService, @Optional() private readonly fx?: FxService) {}

  private get base() { return this.settings.currency ?? currencyOf(undefined); }

  /** Net, tax and total in the invoice currency, and the organisation-currency amounts at `rate` (they always add up). */
  private priced(inv: Invoice, net: number, fx: Pick<Fx, 'currency' | 'rate'>) {
    const cur = currencyOf(fx.currency);
    const amount = roundMoney(net, cur);
    const { taxMYR: tax, totalMYR: total } = computeTax(amount, inv.gstRate, cur.decimals);
    const b = invoiceToBase(amount, tax, fx.rate, this.base);
    Object.assign(inv, { currency: fx.currency, fxRate: fx.rate, amount, tax, total, amountMYR: b.net, gstMYR: b.tax, totalMYR: b.total });
  }

  /** "US$ 1,080.00 (RM 4,806.00 at 4.45)" for a foreign invoice; the plain amount otherwise. */
  private shown(inv: Invoice): string {
    return inv.currency
      ? `${formatMoney(inv.total!, currencyOf(inv.currency))} (${formatMoney(inv.totalMYR, this.base)} at ${inv.fxRate})`
      : formatMoney(inv.totalMYR, this.base);
  }

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
    const { taxMYR, totalMYR } = computeTax(amount, rate, this.settings.currency?.decimals ?? 2);
    return { gstMYR: taxMYR, totalMYR };
  }

  /** Open a new billing record for a job (or a periodic PBC run). */
  async create(dto: InvoiceInput, actor: { name: string; role: Role }): Promise<Invoice> {
    const def = this.store.invoiceStreams.find((s) => s.id === dto.stream);
    if (!def) throw new BadRequestException(`Unknown invoicing stream ${dto.stream}`);
    if (def.perJob && !dto.jobId) throw new BadRequestException(`Stream ${def.label} bills against a job — jobId required`);

    const job = dto.jobId ? await this.store.job(dto.jobId) : null;
    if (dto.jobId && !job) throw new NotFoundException(`Job ${dto.jobId} not found`);

    const legacy = dto.amount === undefined;
    const amount = Number((legacy ? dto.amountMYR : dto.amount) ?? 0);
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Amount must be a number of 0 or more');
    // In another currency: priced at today's rate until the tax invoice is raised.
    const fx = !legacy && this.fx ? await this.fx.resolve({ currency: dto.currency, rate: dto.rate, confirm: dto.confirm, role: actor.role }) : null;
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
    if (fx) {
      this.priced(inv, amount, fx);
      inv.audit.push(this.store.audit(actor.name, actor.role, `In ${fx.currency}: ${this.shown(inv)} — the rate is fixed when the tax invoice is raised`));
    }
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

  /**
   * The rate a foreign invoice was paid at: from what the bank credited in the
   * organisation's currency (`amountReceived`), else a rate typed by someone
   * with fx.manage (`paymentRate`), else the rate in force today. A rate far
   * from the invoice's must be confirmed (`paymentRateConfirm`).
   */
  private async paymentRate(inv: Invoice, f: Record<string, string>, actor: { name: string; role: Role }): Promise<{ rate: number; received?: number }> {
    const confirmed = f.paymentRateConfirm === 'true';
    if (f.amountReceived !== undefined && f.amountReceived !== '') {
      const received = Number(String(f.amountReceived).replace(/,/g, ''));
      if (!Number.isFinite(received) || received <= 0) throw new BadRequestException('Amount received must be a number above 0');
      const rate = roundRate(received / (inv.total || 1));
      if (!confirmed && inv.fxRate && jump(inv.fxRate, rate) > RATE_JUMP_LIMIT) {
        throw new BadRequestException({ statusCode: 400, code: 'RATE_JUMP', message: jumpMessage(inv.currency!, this.base, inv.fxRate, rate), previous: inv.fxRate });
      }
      return { rate, received: roundMoney(received, this.base) };
    }
    if (!this.fx) return { rate: inv.fxRate! };
    const fx = await this.fx.resolve({ currency: inv.currency, rate: f.paymentRate, confirm: confirmed, day: today(), role: actor.role, fallbackRate: inv.fxRate });
    return { rate: fx!.rate };
  }

  private recordFxPayment(inv: Invoice, paid: { rate: number; received?: number }, actor: { name: string; role: Role }) {
    const rate = paid.rate;
    const received = paid.received ?? roundMoney(inv.total! * rate, this.base);
    inv.paidRate = rate;
    inv.paidBase = received;
    inv.fxGain = roundMoney(received - inv.totalMYR, this.base);
    const word = inv.fxGain > 0 ? 'gain' : inv.fxGain < 0 ? 'loss' : 'difference';
    inv.audit.push(this.store.audit(actor.name, actor.role,
      `Paid ${formatMoney(inv.total!, currencyOf(inv.currency))} at ${rate} = ${formatMoney(received, this.base)}; exchange ${word} ${formatMoney(Math.abs(inv.fxGain), this.base)}`));
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

    // A foreign invoice's payment: settle the rate before the step is taken (so a refusal changes nothing).
    const paying = this.store.invoiceTransitions.find((r) => r.from === inv.status && r.to === to)?.effects?.some((e) => e.type === 'markPaid');
    const paid = inv.currency && paying ? await this.paymentRate(inv, f, actor) : undefined;

    const rule = applyTransition(inv, this.store.invoiceTransitions, to, f, actor);
    await this.store.checkStepFields(rule, f, inv, 'INVOICE', inv.id);

    for (const e of rule.effects ?? []) {
      const p = (e.params ?? {}) as Record<string, string>;
      switch (e.type) {
        case 'setAttributes':
          for (const attr of ['customerSignRef', 'ctcRef', 'correctnessBy', 'salesPerfRef'] as const) {
            if (p[attr] && f[p[attr]]) inv[attr] = f[p[attr]];
          }
          break;
        case 'raiseTaxInvoice': {
          inv.f311Ref = f[p.numberField];
          const typed = p.amountField && f[p.amountField] ? Number(f[p.amountField]) : undefined;
          if (typed !== undefined && (!Number.isFinite(typed) || typed < 0)) throw new BadRequestException('Amount must be a number of 0 or more');
          const named = p.amountField ? f[`${p.amountField}Currency`] : undefined;
          if (named && named.toUpperCase() !== (inv.currency ?? this.base.code)) {
            throw new BadRequestException(`The amount must be in the invoice's currency (${inv.currency ?? this.base.code})`);
          }
          if (inv.currency && this.fx) {
            // The rate in force today becomes the invoice's rate; from now on nothing changes.
            const fx = await this.fx.resolve({
              currency: inv.currency, rate: p.amountField ? f[`${p.amountField}Rate`] : undefined, confirm: p.amountField ? f[`${p.amountField}RateConfirm`] : undefined,
              day: today(), role: actor.role, fallbackRate: inv.fxRate,
            });
            this.priced(inv, typed ?? inv.amount ?? 0, fx!);
            inv.audit.push(this.store.audit(actor.name, actor.role, `Exchange rate fixed: ${inv.currency} 1 = ${this.base.code} ${inv.fxRate} — ${this.shown(inv)}`));
          } else if (typed !== undefined) {
            inv.amountMYR = typed;
            const { gstMYR, totalMYR } = this.gst(inv.amountMYR, inv.gstRate);
            inv.gstMYR = gstMYR;
            inv.totalMYR = totalMYR;
          }
          break;
        }
        case 'markPaid':
          inv.paymentRef = f[p.refField];
          inv.paidAt = new Date().toISOString().slice(0, 10);
          inv.outstanding = false;
          if (inv.currency && paid) this.recordFxPayment(inv, paid, actor);
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
