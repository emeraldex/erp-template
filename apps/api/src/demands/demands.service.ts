import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { SettingsService } from '../settings/settings.service';
import { DEFAULT_CURRENCY, currencyOf, formatMoney, roundMoney } from '../settings/currency';
import { Fx, FxService, today } from '../fx/fx.service';
import { toBase } from '../fx/fx';
import { quantity, StockService } from '../stock/stock.service';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { Demand, DemandStatus, Quotation, Role } from '../common/types';

/** What a quotation request may carry. `priceMYR` is the old form: a price in the organisation's currency. */
export interface QuotationInput {
  supplierId?: unknown; supplier?: unknown; price?: unknown; priceMYR?: unknown; currency?: unknown; rate?: unknown; confirm?: unknown;
  eddDays?: unknown; remarks?: unknown;
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

@Injectable()
export class DemandsService {
  private get currency() {
    return this.settings?.currency ?? DEFAULT_CURRENCY;
  }

  constructor(
    private readonly store: StoreService,
    @Optional() private readonly stock?: StockService,
    @Optional() private readonly settings?: SettingsService,
    @Optional() private readonly fx?: FxService,
  ) {}

  private async settle(args: Parameters<FxService['resolve']>[0]): Promise<Fx | null> {
    if (!this.fx) {
      const code = String(args.currency ?? '').toUpperCase();
      if (code && code !== this.currency.code) throw new BadRequestException(`No exchange rate for ${code} — ask finance to add one`);
      return null;
    }
    return this.fx.resolve(args);
  }

  /** "USD 2,400.00 = RM 10,680.00 at 4.45", or just "RM 10,680.00". */
  private money(amount: number, fx: Fx | null, base: number): string {
    return fx ? `${formatMoney(amount, currencyOf(fx.currency))} = ${formatMoney(base, this.currency)} at ${fx.rate}` : formatMoney(base, this.currency);
  }

  /** Stock moves only for catalogue parts, and only when the stock module is on. */
  private stockFor(dm: Demand): StockService | null {
    return dm.partId && this.stock && this.settings?.modules.stock ? this.stock : null;
  }

  list(): Promise<Demand[]> {
    return this.store.demands();
  }

  async get(id: string): Promise<Demand> {
    const dm = await this.store.demand(id);
    if (!dm) throw new NotFoundException(`Demand ${id} not found`);
    return dm;
  }

  /** Suppliers respond to the RFQ — quotations accumulate before evaluation. */
  async addQuotation(id: string, body: QuotationInput, actor: { name: string; role: Role }): Promise<Demand> {
    const dm = await this.get(id);
    if (!this.store.status('DEMAND', dm.status)?.acceptsQuotations) throw new BadRequestException('Quotations are recorded while the RFQ is open');
    const supplierId = String(body?.supplierId ?? '').trim();
    if (!supplierId) throw new BadRequestException('Say which supplier quoted (supplierId)');
    const partner = await this.store.partner(supplierId).catch(() => null);
    const supplier = String(body?.supplier ?? '').trim() || partner?.name || supplierId;
    const legacy = body?.price === undefined && body?.priceMYR !== undefined;
    const amount = Number(legacy ? body.priceMYR : body?.price);
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Price must be a number of 0 or more');
    const edd = Number(body?.eddDays ?? 0);
    if (!Number.isInteger(edd) || edd < 0 || edd > 3650) throw new BadRequestException('Delivery days: a whole number from 0');
    const remarks = body?.remarks === undefined || body.remarks === null ? undefined : String(body.remarks).slice(0, 500);
    // The supplier's usual currency, unless the request names one (the old priceMYR form is always the organisation's).
    const currency = legacy ? '' : body?.currency !== undefined ? body.currency : partner?.currency;
    const fx = await this.settle({ currency, rate: body?.rate, confirm: body?.confirm, role: actor.role });
    const q: Quotation = fx
      ? { supplierId, supplier, currency: fx.currency, price: roundMoney(amount, currencyOf(fx.currency)), fxRate: fx.rate, priceMYR: toBase(amount, fx.rate, this.currency), eddDays: edd, ...(remarks ? { remarks } : {}) }
      : { supplierId, supplier, priceMYR: roundMoney(amount, this.currency), eddDays: edd, ...(remarks ? { remarks } : {}) };
    dm.quotations.push(q);
    dm.audit.push(this.store.audit(actor.name, actor.role, `Quotation received — ${q.supplier} (${this.money(q.price ?? q.priceMYR, fx, q.priceMYR)})`));
    await this.store.save(dm);
    return dm;
  }

  async transition(id: string, to: DemandStatus, fields: Record<string, string>, actor: { name: string; role: Role }): Promise<Demand> {
    const dm = await this.get(id);
    if (this.store.isFinal('DEMAND', dm.status)) throw new BadRequestException('Demand is closed');
    const f = fields ?? {};
    const rule = this.store.demandTransitions.find((r) => r.from === dm.status && r.to === to);

    // Checks that must pass before the step is taken.
    for (const e of rule?.effects ?? []) {
      const p = (e.params ?? {}) as Record<string, string | number>;
      if (e.type === 'evaluateQuotations') {
        const bypass = !!(p.bypassField && f[p.bypassField as string]);
        const min = Number(p.min ?? 3);
        if (!bypass && dm.quotations.length < min) {
          const word = ['zero', 'one', 'two', 'three', 'four', 'five'][min] ?? String(min);
          const bypassLabel = rule?.requires.find((r) => r.key === p.bypassField)?.label;
          throw new BadRequestException(this.store.packId() === 'aviation'
            ? `QP.14 requires a minimum of ${word} quotations (${dm.quotations.length} received). ` +
              'Record more quotations, or record a local-purchase approval (Borang Kelulusan Pembelian F241).'
            : `This purchase needs a minimum of ${word} quotations (${dm.quotations.length} received). Record more quotations` +
              (p.bypassField ? `, or record a single-source approval${bypassLabel ? ` (${bypassLabel})` : ''}.` : '.'));
        }
        const selected = p.selectionField ? f[p.selectionField as string] : undefined;
        if (selected && !bypass && !dm.quotations.some((q) => q.supplierId === selected)) {
          throw new BadRequestException('Selected supplier has no quotation on file');
        }
      }
    }

    const step = applyTransition(dm, this.store.demandTransitions, to, f, actor);
    await this.store.checkStepFields(step, f, dm, 'DEMAND', dm.id);

    // Stock movements this step makes, committed together with the request.
    const stock = this.stockFor(dm);
    const moves: ((tx: Prisma.TransactionClient) => Promise<unknown>)[] = [];
    const touched: { partId: string; store: string }[] = [];

    for (const e of rule?.effects ?? []) {
      const p = (e.params ?? {}) as Record<string, string>;
      switch (e.type) {
        case 'recordStockCheck':
          dm.stockCheck = { f244Ref: f[p.refField], available: false };
          if (stock) {
            const levels = await stock.onHand(dm.partId!);
            const total = levels.reduce((n, l) => n + l.qty, 0);
            dm.audit.push(this.store.audit(actor.name, actor.role, total
              ? `On hand: ${total} (${levels.map((l) => `${l.storeLabel} ${l.qty}`).join(', ')})`
              : 'On hand: none'));
          }
          break;
        case 'issueFromStock': {
          const chosen = p.holdingField ? f[p.holdingField] : undefined;
          if (stock) {
            const from = stock.defaultStore(chosen || dm.forStore);
            dm.stockCheck = { ...(dm.stockCheck ?? { f244Ref: '-' }), available: true, holdingUnit: stock.storeName(from) };
            if (dm.jobId) {
              const jobId = dm.jobId;
              moves.push((tx) => stock.issueToJobTx(tx, { partId: dm.partId!, store: from, qty: dm.qty, jobId, demandId: dm.id }, actor));
              touched.push({ partId: dm.partId!, store: from });
            }
          } else {
            dm.stockCheck = { ...(dm.stockCheck ?? { f244Ref: '-' }), available: true, holdingUnit: chosen };
          }
          break;
        }
        case 'setAttributes':
          if (p.rfqRef && f[p.rfqRef]) dm.rfqRef = f[p.rfqRef];
          if (p.poRef && f[p.poRef]) dm.poRef = f[p.poRef];
          break;
        case 'evaluateQuotations': {
          const bypass = p.bypassField ? f[p.bypassField] : undefined;
          dm.evaluation = {
            f221Ref: (p.refField && f[p.refField]) || '-',
            selectedSupplierId: (p.selectionField && f[p.selectionField]) || '',
            ...(bypass ? { localPurchase: true, f241Ref: bypass } : {}),
          };
          break;
        }
        case 'recordReceipt':
          if (p.discrepancyField && f[p.discrepancyField]) {
            dm.discrepancy = { f217Ref: f[p.discrepancyField], note: (p.noteField && f[p.noteField]) || 'Stores Discrepancy Report raised' };
            dm.records.push({ formNo: 'F217', refNo: f[p.discrepancyField], date: new Date().toISOString().slice(0, 10), by: actor.name });
          }
          {
            const bought = await this.purchaseAtReceipt(dm, p, f, actor);
            if (stock) this.receiveIntoStock(stock, dm, p, f, actor, moves, touched, bought);
          }
          break;
      }
    }

    await this.store.saveWith(moves.length ? async (tx) => { for (const m of moves) await m(tx); } : undefined, dm);
    if (stock && touched.length) await stock.checkLow(touched);
    return dm;
  }

  /**
   * Goods for a catalogue part arrive: into a store, at a unit cost (entered,
   * else the chosen quotation's price for the whole request divided by the
   * quantity requested, else the part's average). A request for stock — one
   * with no work order — is then done, so it is closed.
   */
  /**
   * What the goods cost, settled on the day they arrive. The unit cost is the
   * one typed at receipt (in the chosen quotation's currency unless another is
   * given), else the chosen quotation's price divided by the quantity
   * requested. Bought in another currency, it is converted at that day's rate
   * (the quotation's own rate if the table has none) and the purchase is fixed
   * on the request.
   */
  private async purchaseAtReceipt(dm: Demand, p: Record<string, string>, f: Record<string, string>, actor: { name: string; role: Role }) {
    const qty = p.qtyField && f[p.qtyField] ? quantity(f[p.qtyField], 'Quantity received') : dm.qty;
    const chosen = dm.quotations.find((q) => q.supplierId === dm.evaluation?.selectedSupplierId) ?? (dm.quotations.length === 1 ? dm.quotations[0] : undefined);
    const key = p.costField;
    let unit = NaN;
    let currency = '';
    if (key && f[key] !== undefined && f[key] !== '') {
      unit = Number(f[key]);
      if (!Number.isFinite(unit) || unit < 0) throw new BadRequestException('Unit cost must be a number ≥ 0');
      currency = f[`${key}Currency`] !== undefined ? f[`${key}Currency`] : chosen?.currency ?? '';
    } else if (chosen && dm.qty > 0) {
      unit = Number(chosen.price ?? chosen.priceMYR) / dm.qty;
      currency = chosen.currency ?? '';
    }
    if (!Number.isFinite(unit)) return { qty, unitBase: NaN, fx: null as Fx | null };
    const fx = await this.settle({
      currency, rate: key ? f[`${key}Rate`] : undefined, confirm: key ? f[`${key}RateConfirm`] : undefined, day: today(), role: actor.role,
      fallbackRate: chosen?.currency && chosen.currency === String(currency).toUpperCase() ? chosen.fxRate : undefined,
    });
    if (!fx) return { qty, unitBase: unit, fx: null };
    const unitBase = round4(unit * fx.rate);
    const amount = roundMoney(unit * qty, currencyOf(fx.currency));
    dm.purchase = { currency: fx.currency, rate: fx.rate, amount, amountBase: toBase(unit * qty, fx.rate, this.currency) };
    dm.audit.push(this.store.audit(actor.name, actor.role, `Purchase fixed at receipt: ${this.money(amount, fx, dm.purchase.amountBase)}`));
    return { qty, unitBase, fx, unitFx: unit };
  }

  private receiveIntoStock(
    stock: StockService, dm: Demand, p: Record<string, string>, f: Record<string, string>, actor: { name: string; role: Role },
    moves: ((tx: Prisma.TransactionClient) => Promise<unknown>)[], touched: { partId: string; store: string }[],
    bought: { qty: number; unitBase: number; fx: Fx | null; unitFx?: number },
  ) {
    const into = stock.defaultStore((p.storeField && f[p.storeField]) || dm.forStore);
    const qty = bought.qty;
    const cost = bought.unitBase;
    const fx = bought.fx ? { currency: bought.fx.currency, rate: bought.fx.rate, unitCostFx: bought.unitFx! } : undefined;
    const partId = dm.partId!;
    moves.push((tx) => stock.receiveTx(tx, { partId, store: into, qty, unitCost: cost, by: actor.name, demandId: dm.id, reason: `Request ${dm.id}`, fx }));
    touched.push({ partId, store: into });
    dm.forStore = into;
    if (Number.isFinite(cost)) dm.unitCost = Math.round(cost * 10_000) / 10_000;
    dm.audit.push(this.store.audit(actor.name, actor.role,
      `Received into stock: ${qty} into ${stock.storeName(into)}${Number.isFinite(cost) ? ` at ${formatMoney(cost, this.currency)} each` : ''}`));
    if (!dm.jobId) {
      const done = this.store.finalStatuses('DEMAND').find((k) => !this.store.status('DEMAND', k)?.branch);
      if (done) {
        dm.status = done;
        dm.statusSince = new Date().toISOString();
        dm.audit.push(this.store.audit(actor.name, actor.role, 'Request closed — received into stock'));
      }
    }
  }
}
