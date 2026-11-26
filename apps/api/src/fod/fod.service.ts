import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { FodIncident, Role, Tool, TrainingRecord } from '../common/types';

/** QP.46 — FOD incident reporting, tool accountability, training records (FR-11). */
@Injectable()
export class FodService {
  constructor(private readonly store: StoreService) {}

  incidents(): Promise<FodIncident[]> {
    return this.store.fodIncidents();
  }

  tools(): Promise<Tool[]> {
    return this.store.tools();
  }

  training(): Promise<TrainingRecord[]> {
    return this.store.training();
  }

  /** Build the incident aggregate without persisting — see report() and toolAction(). */
  private async draft(
    dto: Partial<Omit<FodIncident, 'id' | 'status' | 'audit' | 'focalPoint'>>,
    actor: { name: string; role: Role },
  ): Promise<FodIncident> {
    const incident: FodIncident = {
      typeModel: 'N/A',
      serialNo: 'N/A',
      area: 'AWARENESS',
      location: '-',
      discovered: '-',
      ...dto,
      partName: dto.partName ?? 'Unspecified object',
      // QP.46 reports are filed at the moment of discovery by whoever found it;
      // callers routinely omit both, so default rather than store blanks.
      date: dto.date ?? new Date().toISOString().slice(0, 10),
      reporter: dto.reporter ?? actor.name,
      id: await this.store.nextFodId(),
      focalPoint: this.store.focalPoint(),
      status: 'OPEN',
      audit: [this.store.audit(actor.name, actor.role, this.store.packId() === 'aviation' ? 'FOD incident reported — routed to Focal Point' : 'Incident reported — routed to the safety focal point')],
    };
    return this.store.newFod(incident);
  }

  async report(dto: Omit<FodIncident, 'id' | 'status' | 'audit' | 'focalPoint'>, actor: { name: string; role: Role }): Promise<FodIncident> {
    const incident = await this.draft(dto, actor);
    await this.store.save(incident);
    return incident;
  }

  async updateIncident(id: string, fields: { status: 'UNDER_REVIEW' | 'CLOSED'; rootCause?: string; correctiveAction?: string }, actor: { name: string; role: Role }): Promise<FodIncident> {
    const inc = await this.store.fodIncident(id);
    if (!inc) throw new NotFoundException(`Incident ${id} not found`);
    if (fields.status === 'CLOSED' && !(fields.rootCause ?? inc.rootCause)) {
      throw new BadRequestException(`Root cause is mandatory before closing${this.store.procedureRef(' (QP.46 §10)')}`);
    }
    if (fields.rootCause) inc.rootCause = fields.rootCause;
    if (fields.correctiveAction) inc.correctiveAction = fields.correctiveAction;
    inc.status = fields.status;
    inc.audit.push(this.store.audit(actor.name, actor.role, `Incident ${fields.status === 'CLOSED' ? 'closed — trend logged' : 'under review'}`));
    await this.store.save(inc);
    return inc;
  }

  async toolAction(tag: string, action: 'OUT' | 'IN' | 'MISSING', holder: string | undefined, actor: { name: string; role: Role }): Promise<Tool> {
    const tool = await this.store.tool(tag);
    if (!tool) throw new NotFoundException(`Tool ${tag} not found`);
    tool.status = action;
    tool.holder = action === 'OUT' ? (holder ?? actor.name) : undefined;
    tool.since = new Date().toISOString();

    if (action === 'MISSING') {
      // Tool Missing Report escalates to a FOD incident (QP.38 → QP.46) — the
      // tool state and the incident must land together.
      const incident = await this.draft({
        date: new Date().toISOString().slice(0, 10),
        partName: tool.name, typeModel: 'Tool / TPME', serialNo: tool.tag,
        area: 'CONTROL', location: tool.board,
        discovered: `Tool Missing Report by ${actor.name}`,
        reporter: actor.name,
      }, actor);
      await this.store.save(tool, incident);
    } else {
      await this.store.save(tool);
    }
    return tool;
  }
}
