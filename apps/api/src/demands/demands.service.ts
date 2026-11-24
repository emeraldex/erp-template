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
    if (dm.status !== 'RFQ_ISSUED') throw new BadRequestException('Quotations are recorded while the RFQ is open');
    dm.quotations.push(q);
    dm.audit.push(this.store.audit(actor.name, actor.role, `Quotation received — ${q.supplier} (RM ${q.priceMYR.toLocaleString()})`));
    await this.store.save(dm);
    return dm;
  }

  async transition(id: string, to: DemandStatus, fields: Record<string, string>, actor: { name: string; role: Role }): Promise<Demand> {
    const dm = await this.get(id);

    // QP.14 §5 — minimum three quotations compared, unless local purchase (F241)
    if (to === 'EVALUATED') {
      const local = !!fields?.f241Ref;
      if (!local && dm.quotations.length < 3) {
        throw new BadRequestException(
          `QP.14 requires a minimum of three quotations (${dm.quotations.length} received). ` +
          'Record more quotations, or record a local-purchase approval (Borang Kelulusan Pembelian F241).',
        );
      }
      if (fields?.selectedSupplierId && !dm.quotations.some((q) => q.supplierId === fields.selectedSupplierId) && !local) {
        throw new BadRequestException('Selected supplier has no quotation on file');
      }
    }

    applyTransition(dm, this.store.demandTransitions, to, fields ?? {}, actor);

    if (to === 'STOCK_CHECK') dm.stockCheck = { f244Ref: fields.f244Ref, available: false };
    if (to === 'ISSUED_FROM_STOCK' && dm.stockCheck) {
      dm.stockCheck.available = true;
      dm.stockCheck.holdingUnit = fields.holdingUnit;
    }
    if (to === 'RFQ_ISSUED') dm.rfqRef = fields.f220Ref;
    if (to === 'EVALUATED') {
      dm.evaluation = {
        f221Ref: fields.f221Ref,
        selectedSupplierId: fields.selectedSupplierId,
        ...(fields.f241Ref ? { localPurchase: true, f241Ref: fields.f241Ref } : {}),
      };
    }
    if (to === 'PO_ISSUED') dm.poRef = fields.f312Ref;
    if (to === 'RECEIVED' && fields?.f217Ref) {
      dm.discrepancy = { f217Ref: fields.f217Ref, note: fields.discrepancyNote ?? 'Stores Discrepancy Report raised' };
      dm.records.push({ formNo: 'F217', refNo: fields.f217Ref, date: new Date().toISOString().slice(0, 10), by: actor.name });
    }

    await this.store.save(dm);
    return dm;
  }
}
