import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { Branch, Job, JobStatus, PriorityType, RepairRoute, Role } from '../common/types';
import { SettingsService } from '../settings/settings.service';
import type { Effect } from '../workflow/effects';

type Actor = { name: string; role: Role };
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? undefined : String(v));

@Injectable()
export class JobsService {
  constructor(private readonly store: StoreService, private readonly settings: SettingsService) {}

  list(archived: 'exclude' | 'include' | 'only' = 'exclude'): Promise<Job[]> {
    return this.store.jobs(archived);
  }

  async get(id: string): Promise<Job> {
    const job = await this.store.job(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  /** Register a work order at the JOB workflow's first status (QP.44 stage 1 in the aviation pack). */
  async register(dto: {
    component: string; partNo: string; serialNo: string;
    category: string; originUnit: string; repairUnit: Branch;
  }, actor: Actor): Promise<Job> {
    if (!this.store.has('site', dto.repairUnit)) throw new BadRequestException(`Unknown site ${dto.repairUnit}`);
    if (this.store.dict('category', true).length && !this.store.has('category', dto.category)) {
      throw new BadRequestException(`Unknown category ${dto.category}`);
    }
    const now = new Date().toISOString();
    const { jobPrefix, initialLocation } = this.settings.defaults;
    const job: Job = {
      id: await this.store.nextJobId(jobPrefix),
      psDate: now.slice(0, 10),
      ...dto,
      status: this.store.initialStatus('JOB'),
      location: initialLocation,
      receivedAt: now,
      statusSince: now,
      demandIds: [],
      records: [],
      audit: [this.store.audit(actor.name, actor.role, 'Job registered — receiving inspection per QP.20', {
        partNo: dto.partNo, serialNo: dto.serialNo, originUnit: dto.originUnit,
      })],
    };
    this.store.newJob(job);
    await this.store.save(job);
    return job;
  }

  private assertEditable(job: Job): void {
    if (job.archivedAt) throw new BadRequestException('Job is archived — read-only (FR-12)');
    if (this.store.isFinal('JOB', job.status)) throw new BadRequestException('Job is closed — editing locked (QP.44 stage 10)');
  }

  async transition(id: string, to: JobStatus, fields: Record<string, string>, actor: Actor): Promise<Job> {
    const job = await this.get(id);
    this.assertEditable(job);
    const rule = applyTransition(job, this.store.jobTransitions, to, fields ?? {}, actor);
    if (fields?.indentRef) job.indentRef = fields.indentRef;

    // The step's actions — committed together with the job itself.
    const alsoSave: object[] = [];
    for (const effect of rule.effects ?? []) await this.runEffect(effect, job, fields ?? {}, actor, alsoSave);

    await this.store.save(job, ...alsoSave);
    return job;
  }

  private async runEffect(effect: Effect, job: Job, fields: Record<string, string>, actor: Actor, alsoSave: object[]): Promise<void> {
    const p = (effect.params ?? {}) as Record<string, string>;
    switch (effect.type) {
      case 'setAttributes':
        if (p.indentRef && fields[p.indentRef]) job.indentRef = fields[p.indentRef];
        return;
      case 'raiseDemand': {
        const ref = str(fields[p.refField]) || (await this.store.nextDemandId());
        if (!(await this.store.demandExists(ref))) {
          alsoSave.push(this.store.newDemand({
            id: ref, jobId: job.id,
            partDescription: (p.descriptionField && fields[p.descriptionField]) || 'Spare per inspection',
            partNo: (p.partNoField && fields[p.partNoField]) || '-',
            qty: Number((p.qtyField && fields[p.qtyField]) || 1),
            status: this.store.initialStatus('DEMAND'), statusSince: new Date().toISOString(),
            raisedBy: actor.name, branch: job.repairUnit, quotations: [], records: [],
            audit: [this.store.audit(actor.name, actor.role, `Demand raised from ${job.id}`)],
          }));
        }
        if (!job.demandIds.includes(ref)) job.demandIds.push(ref);
        return;
      }
      case 'openVendorRepair': {
        if (job.ovId) return;
        const ov = this.store.newOv({
          id: await this.store.nextOvId(),
          jobId: job.id, defectReportRef: fields[p.refField] ?? '-', am75Ref: (p.workOrderField && fields[p.workOrderField]) || '-',
          status: this.store.initialStatus('OV'), statusSince: new Date().toISOString(),
          records: [], audit: [this.store.audit(actor.name, actor.role, 'Registered in the vendor repair register')],
        });
        job.ovId = ov.id;
        alsoSave.push(ov);
        return;
      }
    }
  }

  // ─── Priority overlay (QP.56 AOG / ROA in the aviation pack) — FR-15 ─────────

  async raisePriority(
    id: string,
    dto: { type: PriorityType; quantity?: number; route: RepairRoute; suffixK?: boolean; colRef: string; edd?: string; remark?: string },
    actor: Actor,
  ): Promise<Job> {
    const job = await this.get(id);
    if (this.store.isFinal('JOB', job.status)) throw new BadRequestException('Job is closed — priority cannot be raised (QP.44 stage 10)');
    if (job.priority?.state === 'OPEN') throw new BadRequestException(`Job already flagged ${job.priority.type} (COL ${job.priority.colRef})`);
    if (!dto.colRef?.trim()) throw new BadRequestException('COL AOG/ROA column reference is required');
    if (!this.store.has('priority', dto.type)) throw new BadRequestException(`Unknown priority ${dto.type}`);
    if (this.store.dict('route', true).length && !this.store.has('route', dto.route)) throw new BadRequestException(`Unknown route ${dto.route}`);

    const now = new Date().toISOString();
    job.priority = {
      type: dto.type,
      quantity: Number(dto.quantity ?? 1),
      route: dto.route,
      suffixK: !!dto.suffixK,
      state: 'OPEN',
      colRef: dto.colRef,
      raisedAt: now,
      raisedBy: actor.name,
      edd: dto.edd,
      remark: dto.remark,
      audit: [this.store.audit(actor.name, actor.role, `${dto.type} raised on COL — expedite ${dto.route} route`, {
        colRef: dto.colRef, type: dto.type, route: dto.route, quantity: String(dto.quantity ?? 1),
        ...(dto.suffixK ? { suffixK: 'K' } : {}),
      })],
    };
    job.audit.push(this.store.audit(actor.name, actor.role, `Priority ${dto.type} raised (COL ${dto.colRef}) — QP.56 expedite ${dto.route}`));
    await this.store.save(job);
    return job;
  }

  async updatePriority(id: string, dto: { route?: RepairRoute; edd?: string; remark?: string }, actor: Actor): Promise<Job> {
    const job = await this.get(id);
    if (!job.priority || job.priority.state !== 'OPEN') throw new BadRequestException('No open priority on this job');
    if (dto.route) job.priority.route = dto.route;
    if (dto.edd !== undefined) job.priority.edd = dto.edd;
    if (dto.remark !== undefined) job.priority.remark = dto.remark;
    job.priority.audit.push(this.store.audit(actor.name, actor.role, 'COL AOG/ROA remark updated', {
      ...(dto.route ? { route: dto.route } : {}), ...(dto.edd ? { edd: dto.edd } : {}), ...(dto.remark ? { remark: dto.remark } : {}),
    }));
    await this.store.save(job);
    return job;
  }

  async closePriority(id: string, dto: { reason: 'DELIVERED' | 'DOWNGRADED'; note?: string }, actor: Actor): Promise<Job> {
    const job = await this.get(id);
    if (!job.priority || job.priority.state !== 'OPEN') throw new BadRequestException('No open priority to close');
    job.priority.state = 'CLOSED';
    job.priority.closedAt = new Date().toISOString();
    job.priority.closeReason = dto.reason;
    const label = dto.reason === 'DELIVERED' ? 'delivered' : 'downgraded to normal by CAO/CPU';
    job.priority.audit.push(this.store.audit(actor.name, actor.role, `COL AOG/ROA column set to 'closed' — ${label}`, dto.note ? { note: dto.note } : undefined));
    job.audit.push(this.store.audit(actor.name, actor.role, `Priority ${job.priority.type} closed (${label})`));
    await this.store.save(job);
    return job;
  }
}
