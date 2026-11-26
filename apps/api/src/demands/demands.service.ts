import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { Demand, DemandStatus, Quotation, Role } from '../common/types';

@Injectable()
export class DemandsService {
  constructor(private readonly store: StoreService) {}

  list(): Promise<Demand[]> {
    return this.store.demands();
  }

  async get(id: string): Promise<Demand> {
    const dm = await this.store.demand(id);
    if (!dm) throw new NotFoundException(`Demand ${id} not found`);
    return dm;
  }

  /** Suppliers respond to the RFQ — quotations accumulate before evaluation. */
  async addQuotation(id: string, q: Quotation, actor: { name: string; role: Role }): Promise<Demand> {
    const dm = await this.get(id);
    if (!this.store.status('DEMAND', dm.status)?.acceptsQuotations) throw new BadRequestException('Quotations are recorded while the RFQ is open');
    dm.quotations.push(q);
    dm.audit.push(this.store.audit(actor.name, actor.role, `Quotation received — ${q.supplier} (RM ${q.priceMYR.toLocaleString()})`));
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

    for (const e of rule?.effects ?? []) {
      const p = (e.params ?? {}) as Record<string, string>;
      switch (e.type) {
        case 'recordStockCheck':
          dm.stockCheck = { f244Ref: f[p.refField], available: false };
          break;
        case 'issueFromStock':
          dm.stockCheck = { ...(dm.stockCheck ?? { f244Ref: '-' }), available: true, holdingUnit: p.holdingField ? f[p.holdingField] : undefined };
          break;
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
          break;
      }
    }

    await this.store.save(dm);
    return dm;
  }
}
