import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
    if (this.store.isFinal('OV', ov.status)) throw new BadRequestException('Vendor repair is closed');
    const f = fields ?? {};
    const rule = applyTransition(ov, this.store.ovTransitions, to, f, actor);
    await this.store.checkStepFields(rule, f, ov, 'OV', ov.id);
    const job = await this.store.job(ov.jobId);
    // Reflect vendor-repair milestones on the parent job's audit trail.
    job?.audit.push(this.store.audit(actor.name, actor.role, `OV ${ov.id}: ${to}`));

    for (const e of rule.effects ?? []) {
      const p = (e.params ?? {}) as Record<string, string>;
      switch (e.type) {
        case 'setVendor': {
          const vendor = f[p.field] ? await this.store.partner(f[p.field]) : null;
          ov.vendorId = f[p.field];
          ov.vendorName = vendor?.name ?? f[p.field];
          break;
        }
        case 'setAttributes':
          if (p.f134Ref && f[p.f134Ref]) ov.f134Ref = f[p.f134Ref];
          if (p.poRef && f[p.poRef]) ov.poRef = f[p.poRef];
          break;
        case 'recordCost':
          ov.costMYR = Number(f[p.costField]);
          if (p.eddField && f[p.eddField] !== undefined) ov.eddDays = Number(f[p.eddField]);
          ov.aboveIndent = p.aboveIndentField ? f[p.aboveIndentField] === 'true' : false;
          if (p.quoteField && f[p.quoteField]) ov.f119Ref = f[p.quoteField];
          break;
        case 'closeParentJob':
          if (job) {
            job.status = this.store.finalStatuses('JOB')[0] ?? job.status;
            if (p.location) job.location = p.location;
            job.statusSince = new Date().toISOString();
            job.audit.push(this.store.audit(actor.name, actor.role, 'OV not approved — item returned to customer; job closed'));
          }
          break;
        case 'setParentLocation':
          if (job && p.location) job.location = p.location;
          break;
      }
    }

    if (job) {
      await this.store.save(ov, job);
    } else {
      await this.store.save(ov);
    }
    return ov;
  }
}
