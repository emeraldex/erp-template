import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { OvRepair, OvStatus, Role } from '../common/types';
import { FxService, today } from '../fx/fx.service';
import { toBase } from '../fx/fx';
import { currencyOf, formatMoney, roundMoney } from '../settings/currency';

@Injectable()
export class OvService {
  constructor(private readonly store: StoreService, @Optional() private readonly fx?: FxService) {}

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
        case 'recordCost': {
          const amount = Number(f[p.costField]);
          if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Cost must be a number of 0 or more');
          // A cost in another currency is held at today's rate until the repair is closed.
          const fx = this.fx ? await this.fx.resolve({ currency: f[`${p.costField}Currency`], rate: f[`${p.costField}Rate`], confirm: f[`${p.costField}RateConfirm`], role: actor.role }) : null;
          const base = this.fx?.base;
          if (fx && base) {
            Object.assign(ov, { currency: fx.currency, cost: roundMoney(amount, currencyOf(fx.currency)), fxRate: fx.rate, costMYR: toBase(amount, fx.rate, base) });
            job?.audit.push(this.store.audit(actor.name, actor.role, `OV ${ov.id} cost ${formatMoney(ov.cost!, currencyOf(fx.currency))} = ${formatMoney(ov.costMYR!, base)} at ${fx.rate}`));
          } else {
            Object.assign(ov, { currency: undefined, cost: undefined, fxRate: undefined, costMYR: amount });
          }
          if (p.eddField && f[p.eddField] !== undefined) ov.eddDays = Number(f[p.eddField]);
          ov.aboveIndent = p.aboveIndentField ? f[p.aboveIndentField] === 'true' : false;
          if (p.quoteField && f[p.quoteField]) ov.f119Ref = f[p.quoteField];
          break;
        }
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

    // Closed: a cost in another currency is fixed at the rate in force that day.
    if (this.fx && ov.currency && ov.cost !== undefined && !ov.costFixedAt && this.store.isFinal('OV', ov.status)) {
      const fx = await this.fx.resolve({ currency: ov.currency, day: today(), role: actor.role, fallbackRate: ov.fxRate });
      if (fx) {
        ov.fxRate = fx.rate;
        ov.costMYR = toBase(ov.cost, fx.rate, this.fx.base);
        ov.costFixedAt = new Date().toISOString();
        job?.audit.push(this.store.audit(actor.name, actor.role, `OV ${ov.id} cost fixed at ${fx.rate}: ${formatMoney(ov.costMYR, this.fx.base)}`));
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
