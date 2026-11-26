import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { AssetsService } from '../assets/assets.service';
import { PmService } from '../assets/pm.service';
import { StoreService } from '../common/store.service';
import { applyTransition } from '../common/transition.engine';
import { Branch, ChecklistItem, Job, JobStatus, PriorityType, RepairRoute, Role } from '../common/types';
import { SettingsService } from '../settings/settings.service';
import type { Effect } from '../workflow/effects';
import { offlineTime } from '../common/client-ops';

type Actor = { name: string; role: Role; sub?: string };
type Person = { id: string; name: string };
const str = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? undefined : String(v));

@Injectable()
export class JobsService {
  constructor(
    private readonly store: StoreService,
    private readonly settings: SettingsService,
    @Optional() private readonly assets?: AssetsService,
    @Optional() private readonly pm?: PmService,
  ) {}

  /** Aviation keeps its COL (AOG/ROA column) wording; other sectors get plain words. */
  private get aviation(): boolean {
    return this.store.packId() === 'aviation';
  }

  list(archived: 'exclude' | 'include' | 'only' = 'exclude'): Promise<Job[]> {
    return this.store.jobs(archived);
  }

  async get(id: string): Promise<Job> {
    const job = await this.store.job(id);
    if (!job) throw new NotFoundException(`Job ${id} not found`);
    return job;
  }

  /** Register a work order at the JOB workflow's first status (QP.44 stage 1 in the aviation pack). */
  async register(input: {
    component?: string; partNo?: string; serialNo?: string;
    category: string; originUnit: string; repairUnit?: Branch;
    assetId?: string; jobType?: string;
  }, actor: Actor): Promise<Job> {
    const { assetId, jobType: requestedType, ...rest } = input;
    // A registered asset fills in what the job is about and where.
    const asset = assetId ? await this.assets?.brief(assetId) : undefined;
    if (assetId && !asset) throw new BadRequestException(`Asset ${assetId} not found`);
    if (asset?.status === 'RETIRED') throw new BadRequestException(`Asset ${asset.tag} is retired`);
    const dto = {
      ...rest,
      component: rest.component?.trim() || asset?.name || '',
      partNo: rest.partNo?.trim() || asset?.model || '-',
      serialNo: rest.serialNo?.trim() || asset?.tag || '',
      repairUnit: (rest.repairUnit || asset?.site || '') as Branch,
    };
    if (!dto.component || !dto.serialNo) throw new BadRequestException('Say what is to be worked on (component and serial / tag), or pick an asset');
    const types = this.store.dict('jobType', true);
    if (requestedType && types.length && !this.store.has('jobType', requestedType)) throw new BadRequestException(`Unknown job type ${requestedType}`);
    const jobType = requestedType || (types.some((t) => t.key === 'CORRECTIVE') ? 'CORRECTIVE' : types[0]?.key ?? 'CORRECTIVE');
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
      jobType,
      ...(asset ? { assetId: asset.id } : {}),
      status: this.store.initialStatus('JOB'),
      location: initialLocation,
      receivedAt: now,
      statusSince: now,
      demandIds: [],
      records: [],
      audit: [this.store.audit(actor.name, actor.role, `Job registered${this.store.procedureRef(' — receiving inspection per QP.20')}`, {
        partNo: dto.partNo, serialNo: dto.serialNo, originUnit: dto.originUnit,
      })],
    };
    this.store.newJob(job);
    await this.store.save(job);
    return job;
  }

  private assertEditable(job: Job): void {
    if (job.archivedAt) throw new BadRequestException('Job is archived — read-only (FR-12)');
    if (this.store.isFinal('JOB', job.status)) throw new BadRequestException(`Job is closed — editing locked${this.store.procedureRef(' (QP.44 stage 10)')}`);
  }

  async transition(id: string, to: JobStatus, fields: Record<string, string>, actor: Actor): Promise<Job> {
    const job = await this.get(id);
    this.assertEditable(job);
    const fromPhase = this.store.phaseOf('JOB', job.status);
    const toPhase = this.store.phaseOf('JOB', to);
    if (toPhase === 'done' && fromPhase !== 'done') {
      const open = (job.checklist ?? []).filter((c) => c.required && !c.done);
      if (open.length) throw new BadRequestException(`Checklist incomplete: ${open.map((c) => c.label).join('; ')}`);
    }
    const rule = applyTransition(job, this.store.jobTransitions, to, fields ?? {}, actor);
    await this.store.checkStepFields(rule, fields ?? {}, job, 'JOB', job.id);
    if (fields?.indentRef) job.indentRef = fields.indentRef;

    // The step's actions — committed together with the job itself.
    const alsoSave: object[] = [];
    const assignedBefore = job.assigneeId;
    for (const effect of rule.effects ?? []) await this.runEffect(effect, job, fields ?? {}, actor, alsoSave);

    await this.store.save(job, ...alsoSave);
    if (job.assigneeId && job.assigneeId !== assignedBefore) await this.tellAssignee(job, actor);

    // Preventive maintenance rolls forward when its job is done; a job cancelled
    // before the work was done leaves the cycle due.
    if (this.pm && job.pmScheduleId) {
      if (toPhase === 'done' && fromPhase !== 'done') await this.pm.completed(job);
      else if (this.store.isFinal('JOB', to) && fromPhase !== 'done') await this.pm.cancelled(job);
    }
    return job;
  }

  // ─── Assignment to a named person ────────────────────────────────────────────

  private setAssignee(job: Job, person: Person | null, actor: Actor): void {
    if ((person?.id ?? undefined) === job.assigneeId) return;
    if (person) {
      job.assigneeId = person.id;
      job.assigneeName = person.name;
      job.assignedAt = new Date().toISOString();
      job.audit.push(this.store.audit(actor.name, actor.role, `Assigned to ${person.name}`));
    } else {
      job.audit.push(this.store.audit(actor.name, actor.role, `Unassigned from ${job.assigneeName ?? 'nobody'}`));
      delete job.assigneeId;
      delete job.assigneeName;
      delete job.assignedAt;
    }
  }

  private async person(userId: string): Promise<Person> {
    const u = await this.store.activeUser(userId);
    if (!u) throw new BadRequestException('Choose an active member of staff');
    return { id: u.id, name: u.name };
  }

  /** Tell the person a job was given to them (not when they took it themselves). */
  private async tellAssignee(job: Job, actor: Actor): Promise<void> {
    if (!job.assigneeId || job.assigneeId === actor.sub) return;
    const word = this.settings.terms?.job ?? 'Job';
    await this.store.notify(job.assigneeId, {
      kind: 'job.assigned', title: `${word} ${job.id} assigned to you`, body: `${job.component} — assigned by ${actor.name}`, ref: `JOB:${job.id}`,
    });
  }

  /** Assign (or, with null, unassign) a job — for people who hold jobs.assign. */
  async assign(id: string, userId: string | null, actor: Actor): Promise<Job> {
    const job = await this.get(id);
    this.assertEditable(job);
    const before = job.assigneeId;
    this.setAssignee(job, userId ? await this.person(userId) : null, actor);
    if (job.assigneeId === before) return job;
    await this.store.save(job);
    await this.tellAssignee(job, actor);
    return job;
  }

  /** Take an unassigned job whose next step your role owns. */
  async claim(id: string, actor: Actor & { sub: string }): Promise<Job> {
    const job = await this.get(id);
    this.assertEditable(job);
    if (job.assigneeId === actor.sub) return job;
    if (job.assigneeId) throw new ConflictException(`Already assigned to ${job.assigneeName}`);
    const owns = this.store.jobTransitions.some((r) => r.from === job.status && r.roles.includes(actor.role));
    if (!owns && !this.store.capabilitiesOf(actor.role).includes('jobs.assign')) {
      throw new ForbiddenException('Your role has no step to take on this job at its current status');
    }
    this.setAssignee(job, await this.person(actor.sub), actor);
    await this.store.save(job);
    return job;
  }

  // ─── Field work (the phone app) ──────────────────────────────────────────────

  private card(job: Job, tags: Map<string, string>) {
    const meta = this.store.status('JOB', job.status);
    const daysIn = Math.floor((Date.now() - new Date(job.statusSince).getTime()) / 86_400_000);
    const sla = this.store.slaRules.find((r) => r.entity === 'JOB' && r.status === job.status);
    const checks = job.checklist ?? [];
    return {
      id: job.id, component: job.component, serialNo: job.serialNo, status: job.status, statusLabel: meta?.label ?? job.status,
      statusSince: job.statusSince, site: job.repairUnit, location: job.location, jobType: job.jobType,
      assignee: job.assigneeId ? { id: job.assigneeId, name: job.assigneeName } : null,
      priority: job.priority?.state === 'OPEN' ? job.priority.type : null,
      asset: job.assetId ? { id: job.assetId, tag: tags.get(job.assetId) ?? job.assetId } : null,
      checklist: { done: checks.filter((c) => c.done).length, total: checks.length },
      sla: sla ? { days: sla.days, overdueBy: Math.max(0, daysIn - sla.days) } : null,
    };
  }

  /** Can this role take any step from the job's current status? */
  private canAct(job: Job, role: string): boolean {
    return this.store.jobTransitions.some((r) => r.from === job.status && (role === 'ADMIN' || r.roles.includes(role)));
  }

  /**
   * My work: what is assigned to me, and unassigned work at my site that my
   * role can take. Open priorities first, then the most overdue, then oldest.
   */
  async mine(actor: Actor & { sub: string; branch: string }) {
    const open = (await this.store.jobs('exclude')).filter((j) => !this.store.isFinal('JOB', j.status));
    const mine = open.filter((j) => j.assigneeId === actor.sub);
    const available = open.filter((j) => !j.assigneeId && j.repairUnit === actor.branch && this.canAct(j, actor.role));
    const tags = await (this.assets?.tags([...new Set([...mine, ...available].map((j) => j.assetId).filter((x): x is string => !!x))]) ?? new Map());
    // Work waiting for sign-off (done, not yet closed) goes last.
    const done = (s: string) => this.store.phaseOf('JOB', s) === 'done';
    const order = (list: Job[]) => list.map((j) => this.card(j, tags)).sort((a, b) =>
      Number(done(a.status)) - Number(done(b.status)) || Number(!!b.priority) - Number(!!a.priority)
      || (b.sla?.overdueBy ?? 0) - (a.sla?.overdueBy ?? 0) || a.statusSince.localeCompare(b.statusSince));
    return { mine: order(mine), available: order(available) };
  }

  /** Everything the phone needs to work on one job, in one call (and to keep offline). */
  async pack(id: string, actor: Actor) {
    const job = await this.get(id);
    const [asset, attachments, pm] = await Promise.all([
      job.assetId ? this.assets?.forJob(job.assetId) ?? null : null,
      this.store.attachmentsOf('JOB', job.id),
      job.pmScheduleId ? this.pm?.get(job.pmScheduleId).catch(() => null) ?? null : null,
    ]);
    const steps = this.store.jobTransitions
      .filter((r) => r.from === job.status && (actor.role === 'ADMIN' || r.roles.includes(actor.role)))
      .map((r) => ({ to: r.to, toLabel: this.store.status('JOB', r.to)?.label ?? r.to, label: r.label, labelMs: r.labelMs, requires: r.requires }));
    return {
      job,
      asset,
      pm: pm ? { id: pm.id, title: pm.title, instructions: pm.instructions } : null,
      attachments,
      steps,
      locked: !!job.archivedAt || this.store.isFinal('JOB', job.status),
      fetchedAt: new Date().toISOString(),
    };
  }

  /** A note on the job's timeline. */
  async addNote(id: string, text: unknown, actor: Actor): Promise<Job> {
    const note = typeof text === 'string' ? text.trim() : '';
    if (!note || note.length > 1000) throw new BadRequestException('A note is 1–1000 characters');
    const job = await this.get(id);
    this.assertEditable(job);
    job.audit.push(this.store.audit(actor.name, actor.role, `Note: ${note}`));
    await this.store.save(job);
    return job;
  }

  /** Tick checklist items off (or add a check found on the job). Locked once the job is closed. */
  async updateChecklist(id: string, body: { items?: { key: string; done?: boolean; note?: string }[]; add?: { label: string; required?: boolean }[]; at?: unknown }, actor: Actor): Promise<Job> {
    const job = await this.get(id);
    this.assertEditable(job);
    const list: ChecklistItem[] = [...(job.checklist ?? [])];
    // Ticked off offline: keep when it was done; the audit entry says when it arrived.
    const offline = offlineTime(body.at);
    const now = (offline ?? new Date()).toISOString();
    for (const u of body.items ?? []) {
      const item = list.find((c) => c.key === u?.key);
      if (!item) throw new BadRequestException(`No checklist item ${u?.key}`);
      if (u.done !== undefined) {
        item.done = !!u.done;
        if (item.done) Object.assign(item, { by: actor.name, at: now });
        else { delete item.by; delete item.at; }
      }
      if (u.note !== undefined) item.note = String(u.note).trim().slice(0, 300) || undefined;
    }
    for (const a of body.add ?? []) {
      const label = String(a?.label ?? '').trim().slice(0, 160);
      if (!label) throw new BadRequestException('Describe the check to add');
      if (list.length >= 60) throw new BadRequestException('At most 60 checklist items');
      let n = list.length + 1;
      while (list.some((c) => c.key === `c${n}`)) n++;
      list.push({ key: `c${n}`, label, required: a.required !== false, done: false });
    }
    const done = list.filter((c) => c.done).length;
    job.checklist = list;
    job.audit.push(this.store.audit(actor.name, actor.role,
      `Checklist updated — ${done}/${list.length} done${offline ? ` (recorded offline at ${offline.toISOString().slice(0, 16).replace('T', ' ')} UTC)` : ''}`));
    await this.store.save(job);
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
      case 'assignTo': {
        const userId = fields[p.field];
        if (userId) this.setAssignee(job, await this.person(userId), actor);
        return;
      }
      case 'recordMeter': {
        // Jobs on registered assets with that meter only; a lower reading stops the step.
        if (!job.assetId || !this.assets || !fields[p.field]) return;
        try {
          await this.assets.recordReading(job.assetId, p.meterKey, { value: fields[p.field] }, actor, `job:${job.id}`);
        } catch (err) {
          if (err instanceof NotFoundException) return;
          throw err;
        }
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
    if (this.store.isFinal('JOB', job.status)) throw new BadRequestException(`Job is closed — priority cannot be raised${this.store.procedureRef(' (QP.44 stage 10)')}`);
    if (job.priority?.state === 'OPEN') throw new BadRequestException(`Job already flagged ${job.priority.type} (${this.aviation ? 'COL ' : 'ref '}${job.priority.colRef})`);
    if (!dto.colRef?.trim()) throw new BadRequestException(this.aviation ? 'COL AOG/ROA column reference is required' : 'A priority reference (call log / ticket no.) is required');
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
      audit: [this.store.audit(actor.name, actor.role, `${dto.type} raised${this.aviation ? ' on COL' : ''} — expedite ${dto.route} route`, {
        colRef: dto.colRef, type: dto.type, route: dto.route, quantity: String(dto.quantity ?? 1),
        ...(dto.suffixK ? { suffixK: 'K' } : {}),
      })],
    };
    job.audit.push(this.store.audit(actor.name, actor.role, this.aviation ? `Priority ${dto.type} raised (COL ${dto.colRef}) — QP.56 expedite ${dto.route}` : `Priority ${dto.type} raised (ref ${dto.colRef}) — expedite ${dto.route}`));
    await this.store.save(job);
    return job;
  }

  async updatePriority(id: string, dto: { route?: RepairRoute; edd?: string; remark?: string }, actor: Actor): Promise<Job> {
    const job = await this.get(id);
    if (!job.priority || job.priority.state !== 'OPEN') throw new BadRequestException('No open priority on this job');
    if (dto.route) job.priority.route = dto.route;
    if (dto.edd !== undefined) job.priority.edd = dto.edd;
    if (dto.remark !== undefined) job.priority.remark = dto.remark;
    job.priority.audit.push(this.store.audit(actor.name, actor.role, this.aviation ? 'COL AOG/ROA remark updated' : 'Priority updated', {
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
    const label = dto.reason === 'DELIVERED' ? 'delivered' : `downgraded to normal${this.aviation ? ' by CAO/CPU' : ''}`;
    job.priority.audit.push(this.store.audit(actor.name, actor.role, this.aviation ? `COL AOG/ROA column set to 'closed' — ${label}` : `Priority closed — ${label}`, dto.note ? { note: dto.note } : undefined));
    job.audit.push(this.store.audit(actor.name, actor.role, `Priority ${job.priority.type} closed (${label})`));
    await this.store.save(job);
    return job;
  }
}
