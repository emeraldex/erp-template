import { Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { OvRepair, OvStatus, Role } from '../common/types';

@Injectable()
export class OvService {
  constructor(private readonly store: StoreService) {}

  list(): Promise<OvRepair[]> {
    return this.store.ovRepairs();
  }

  async get(id: string): Promise<OvRepair> {
    const ov = await this.store.ovRepair(id);
    if (!ov) throw new NotFoundException(`OV repair ${id} not found`);
    return ov;
  }

  async transition(id: string, to: OvStatus, fields: Record<string, string>, actor: { name: string; role: Role }): Promise<OvRepair> {
    const ov = await this.get(id);
    applyTransition(ov, this.store.ovTransitions, to, fields ?? {}, actor);

    if (to === 'VENDOR_IDENTIFIED') {
      const vendor = fields.vendorId ? await this.store.partner(fields.vendorId) : null;
      ov.vendorId = fields.vendorId;
      ov.vendorName = vendor?.name ?? fields.vendorId;
    }
    if (to === 'F134_SUBMITTED') ov.f134Ref = fields.f134Ref;
    if (to === 'PO_ISSUED') ov.poRef = fields.f312Ref;
    if (to === 'COST_ADVISED') {
      ov.costMYR = Number(fields.costMYR);
      ov.eddDays = Number(fields.eddDays);
      ov.aboveIndent = fields.aboveIndent === 'true';
      if (fields.f119Ref) ov.f119Ref = fields.f119Ref;
    }

    // Reflect key OV milestones onto the parent job's audit trail
    const job = await this.store.job(ov.jobId);
    if (job) {
      job.audit.push(this.store.audit(actor.name, actor.role, `OV ${ov.id}: ${to}`));
      if (to === 'REJECTED') {
        job.status = 'CLOSED';
        job.location = 'CUSTOMER';
        job.statusSince = new Date().toISOString();
        job.audit.push(this.store.audit(actor.name, actor.role, 'OV not approved — item returned to customer; job closed'));
      }
      if (to === 'AT_VENDOR') job.location = 'VENDOR';
      if (to === 'RECEIVED_BACK') job.location = 'HQ';
      await this.store.save(ov, job);
    } else {
      await this.store.save(ov);
    }
    return ov;
  }
}
