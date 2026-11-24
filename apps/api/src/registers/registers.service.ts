import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { Partner, Rating, Role } from '../common/types';

/**
 * QP.13 (suppliers) & QP.34 (sub-contractors) — selection, JTP approval,
 * registration, 3-year reassessment, the performance formula and CAR-driven
 * deregistration (FR-07).
 */
@Injectable()
export class RegistersService {
  constructor(private readonly store: StoreService) {}

  async list(): Promise<(Partner & { performancePct: number | null })[]> {
    const partners = await this.store.partners();
    return partners.map((p) => ({ ...p, performancePct: this.performance(p) }));
  }

  /** QP.13 §5.5 — (Total Non-Conformances ÷ Total Factors Evaluated) × 100% */
  performance(p: Partner): number | null {
    if (!p.factorsEvaluated) return null;
    return Math.round((p.nonConformances / p.factorsEvaluated) * 1000) / 10;
  }

  private async find(id: string): Promise<Partner> {
    const p = await this.store.partner(id);
    if (!p) throw new NotFoundException(`Partner ${id} not found`);
    return p;
  }

  async apply(dto: { name: string; type: 'SUPPLIER' | 'SUBCONTRACTOR'; country: string; certifications: string[] }, actor: { name: string; role: Role }): Promise<Partner> {
    const p: Partner = {
      id: await this.store.nextPartnerId(dto.type),
      ...dto, status: 'APPLIED', lists: [], nonConformances: 0, factorsEvaluated: 0, cars: [],
      audit: [this.store.audit(actor.name, actor.role, 'Application / recommendation received')],
    };
    this.store.newPartner(p);
    await this.store.save(p);
    return p;
  }

  async evaluate(id: string, fields: { evaluationRef: string; siteAuditRef?: string }, actor: { name: string; role: Role }): Promise<Partner> {
    const p = await this.find(id);
    if (p.status !== 'APPLIED' && p.status !== 'UNDER_EVALUATION') {
      throw new BadRequestException(`Cannot evaluate a partner in status ${p.status}`);
    }
    p.status = 'UNDER_EVALUATION';
    p.evaluationRef = fields.evaluationRef;
    if (fields.siteAuditRef) p.siteAuditRef = fields.siteAuditRef;
    const form = p.type === 'SUPPLIER' ? 'F225' : 'F228';
    p.audit.push(this.store.audit(actor.name, actor.role, `Capability verified — Evaluation ${form} completed`, fields as Record<string, string>));
    await this.store.save(p);
    return p;
  }

  async jtpApprove(id: string, fields: { minuteRef: string }, actor: { name: string; role: Role }): Promise<Partner> {
    const p = await this.find(id);
    if (p.status !== 'UNDER_EVALUATION') throw new BadRequestException('JTP approves after evaluation (QP.13 §3)');
    p.status = 'JTP_APPROVED';
    p.audit.push(this.store.audit(actor.name, actor.role, 'JTP Committee selection & MD approval minuted', fields));
    await this.store.save(p);
    return p;
  }

  async register(id: string, fields: { lists: string[] }, actor: { name: string; role: Role }): Promise<Partner> {
    const p = await this.find(id);
    if (p.status !== 'JTP_APPROVED') throw new BadRequestException('Registration follows JTP approval');
    p.status = 'REGISTERED';
    p.lists = fields.lists?.length ? fields.lists : [p.type === 'SUPPLIER' ? 'F224' : 'F229'];
    p.rating = p.rating ?? 2;
    const next = new Date();
    next.setFullYear(next.getFullYear() + 3);
    p.lastAssessed = new Date().toISOString().slice(0, 10);
    p.nextReassessment = `${next.getFullYear()}-03-31`; // 1st quarter of the following cycle
    p.audit.push(this.store.audit(actor.name, actor.role, `Registered in ${p.lists.join(' / ')}`));
    await this.store.save(p);
    return p;
  }

  /** 3-year reassessment: Quality / Delivery-TAT / Services-Capabilities / Quantity & Regularity. */
  async reassess(id: string, fields: { rating: Rating; nonConformances: number; factorsEvaluated: number; monitoringRef: string }, actor: { name: string; role: Role }): Promise<Partner> {
    const p = await this.find(id);
    if (p.status !== 'REGISTERED') throw new BadRequestException('Only registered partners are reassessed');
    p.rating = fields.rating;
    p.nonConformances = fields.nonConformances;
    p.factorsEvaluated = fields.factorsEvaluated;
    const next = new Date();
    next.setFullYear(next.getFullYear() + 3);
    p.lastAssessed = new Date().toISOString().slice(0, 10);
    p.nextReassessment = `${next.getFullYear()}-03-31`;
    const form = p.type === 'SUPPLIER' ? 'F226' : 'F230';
    p.audit.push(this.store.audit(actor.name, actor.role, `Reassessment recorded in ${form} — rating ${fields.rating}`, {
      monitoringRef: fields.monitoringRef,
      performancePct: `${this.performance(p)}%`,
    }));
    await this.store.save(p);
    return p;
  }

  /** CAR (F516). A 'Not Suitable' partner is dropped only after the SECOND CAR. */
  async issueCar(id: string, fields: { ref: string; reason: string }, actor: { name: string; role: Role }): Promise<Partner> {
    const p = await this.find(id);
    p.cars.push({ ref: fields.ref, date: new Date().toISOString().slice(0, 10), reason: fields.reason });
    p.audit.push(this.store.audit(actor.name, actor.role, `Corrective Action Request issued (F516)`, fields));
    if (p.cars.length >= 2 && p.rating === 1) {
      p.status = 'DROPPED';
      p.lists = [];
      p.audit.push(this.store.audit(actor.name, actor.role, 'Second CAR on Not-Suitable rating — deregistered from all lists (QP.13 §5.4)'));
    }
    await this.store.save(p);
    return p;
  }
}
