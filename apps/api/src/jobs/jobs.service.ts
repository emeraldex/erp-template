import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { Branch, Job, JobStatus, PriorityType, RepairRoute, Role } from '../common/types';

@Injectable()
export class JobsService {
  constructor(private readonly store: StoreService) {}

  list(archived: 'exclude' | 'include' | 'only' = 'exclude'): Promise<Job[]> {
    return this.store.jobs(archived);
  }

  async get(id: string): Promise<Job> {
    const job = await this.store.job(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  /** Stage 1 (QP.44) — Logistic registers the job; receiving inspection per QP.20. */
  async register(dto: {
    component: string; partNo: string; serialNo: string;
    category: 'MILITARY' | 'NAS'; originUnit: string; repairUnit: Branch;
  }, actor: { name: string; role: Role }): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: await this.store.nextJobId(),
      psDate: now.slice(0, 10),
      ...dto,
      status: 'REGISTERED',
      location: 'LOGISTIC',
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

  async transition(id: string, to: JobStatus, fields: Record<string, string>, actor: { name: string; role: Role }): Promise<Job> {
    const job = await this.get(id);
    if (job.archivedAt) throw new BadRequestException('Job is archived — read-only (FR-12)');
    if (job.status === 'CLOSED') throw new BadRequestException('Job is closed — editing locked (QP.44 stage 10)');
    applyTransition(job, this.store.jobTransitions, to, fields ?? {}, actor);
    if (fields?.indentRef) job.indentRef = fields.indentRef;

    // Side effects mandated by the workflows — committed with the job itself.
    const alsoSave: object[] = [];

    if (to === 'AWAITING_SPARE' && fields?.f212Ref) {
      if (!(await this.store.demandExists(fields.f212Ref))) {
        alsoSave.push(this.store.newDemand({
          id: fields.f212Ref, jobId: job.id,
          partDescription: fields.partDescription ?? 'Spare per TDI', partNo: fields.partNo ?? '-',
          qty: Number(fields.qty ?? 1), status: 'RAISED', statusSince: new Date().toISOString(),
          raisedBy: actor.name, branch: job.repairUnit, quotations: [], records: [],
          audit: [this.store.audit(actor.name, actor.role, 'Demand raised from TDI (F212)')],
        }));
      }
      if (!job.demandIds.includes(fields.f212Ref)) job.demandIds.push(fields.f212Ref);
    }

    if (to === 'REC_OV' && fields?.f135Ref && !job.ovId) {
      const ov = this.store.newOv({
        id: await this.store.nextOvId(),
        jobId: job.id, defectReportRef: fields.f135Ref, am75Ref: fields.am75Ref ?? '-',
        status: 'RECEIVED_HQ', statusSince: new Date().toISOString(),
        records: [], audit: [this.store.audit(actor.name, actor.role, 'Registered in OV Job-in Register (F125)')],
      });
      job.ovId = ov.id;
      alsoSave.push(ov);
    }

    await this.store.save(job, ...alsoSave);
    return job;
  }

  // ─── QP.56 AOG / ROA / Critical priority overlay (5.9) — FR-15 ───────────────

  /** Raise a job to AOG / ROA / Critical priority and route the expedite path. */
  async raisePriority(
    id: string,
    dto: { type: PriorityType; quantity?: number; route: RepairRoute; suffixK?: boolean; colRef: string; edd?: string; remark?: string },
    actor: { name: string; role: Role },
  ): Promise<Job> {
    const job = await this.get(id);
    if (job.status === 'CLOSED') throw new BadRequestException('Job is closed — priority cannot be raised (QP.44 stage 10)');
    if (job.priority?.state === 'OPEN') throw new BadRequestException(`Job already flagged ${job.priority.type} (COL ${job.priority.colRef})`);
    if (!dto.colRef?.trim()) throw new BadRequestException('COL AOG/ROA column reference is required');

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

  /** Update the COL remark / EDD / route while the priority is open. */
  async updatePriority(id: string, dto: { route?: RepairRoute; edd?: string; remark?: string }, actor: { name: string; role: Role }): Promise<Job> {
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

  /** Close the AOG/ROA status — on delivery, or on CAO/CPU downgrade to normal. */
  async closePriority(id: string, dto: { reason: 'DELIVERED' | 'DOWNGRADED'; note?: string }, actor: { name: string; role: Role }): Promise<Job> {
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
