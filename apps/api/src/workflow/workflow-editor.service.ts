import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { Role } from '../common/types';
import { EFFECTS, neededFields } from './effects';
import { Kind, KINDS, validateTransitions, WorkflowContext } from './workflow-rules';

type Actor = { name: string; role: Role };

/** Fingerprint of a config list, for optimistic concurrency between editors. */
export const versionOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

const SLA_ENTITIES = ['JOB', 'DEMAND', 'OV', 'INVOICE'] as const;

/** FR-02 made editable: workflow rules as data, changed by people with change control. */
@Injectable()
export class WorkflowEditorService {
  constructor(private readonly prisma: PrismaService, private readonly store: StoreService) {}

  private transitionsOf(kind: Kind) {
    return kind === 'JOB' ? this.store.jobTransitions : kind === 'DEMAND' ? this.store.demandTransitions
      : kind === 'OV' ? this.store.ovTransitions : this.store.invoiceTransitions;
  }

  /** The organisation's own statuses, roles and locations, which every workflow is checked against. */
  private context(kind: Kind): WorkflowContext {
    return {
      statuses: this.store.statusKeys(kind),
      initial: this.store.initialStatus(kind),
      roles: this.store.dict('role', true).map((r) => r.key),
      locations: this.store.dict('location', true).map((l) => l.key),
    };
  }

  /** Everything the editor screen needs, with a version per list. */
  async snapshot() {
    await this.store.reloadConfig();
    const ctx = this.context('JOB');
    return {
      roles: ctx.roles,
      locations: ctx.locations,
      kinds: KINDS.map((kind) => {
        const transitions = this.transitionsOf(kind);
        const c = this.context(kind);
        return {
          kind, initial: c.initial, statuses: c.statuses, statusMeta: this.store.statusMeta(kind),
          transitions, version: versionOf(transitions),
          // Fields that must stay mandatory because a step's action reads them.
          protected: transitions
            .map((t) => ({ from: t.from, to: t.to, fields: neededFields(kind, t.effects) }))
            .filter((p) => p.fields.length),
          actions: EFFECTS.filter((e) => e.kind === kind),
        };
      }),
      sla: { rules: this.store.slaRules, version: versionOf(this.store.slaRules) },
      streams: this.store.invoiceStreams.map((s) => ({ ...s, version: versionOf(s) })),
    };
  }

  private async record(actor: Actor, area: string, summary: string, before: unknown, after: unknown) {
    await this.prisma.configChange.create({
      data: { id: randomUUID(), by: actor.name, role: actor.role, area, summary, before: before as never, after: after as never },
    });
  }

  private check(version: string | undefined, current: unknown) {
    if (!version) throw new BadRequestException('version is required (from the copy you edited)');
    if (version !== versionOf(current)) {
      throw new ConflictException('Someone else changed these rules since you opened them — reload and apply your change again');
    }
  }

  /** Validate without saving, so the screen can show errors and warnings as you edit. */
  preview(kind: string, transitions: unknown) {
    const k = this.kind(kind);
    const { errors, warnings } = validateTransitions(k, transitions, this.context(k));
    return { ok: !errors.length, errors, warnings };
  }

  private kind(kind: string): Kind {
    const k = kind.toUpperCase() as Kind;
    if (!KINDS.includes(k)) throw new NotFoundException(`No workflow ${kind}`);
    return k;
  }

  async saveTransitions(kind: string, body: { version?: string; transitions?: unknown }, actor: Actor) {
    const k = this.kind(kind);
    await this.store.reloadConfig();
    const before = this.transitionsOf(k);
    this.check(body.version, before);
    const { rules, errors, warnings } = validateTransitions(k, body.transitions, this.context(k));
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'The workflow has problems', errors, warnings });

    await this.prisma.$transaction(async (tx) => {
      await tx.transitionRuleRow.deleteMany({ where: { kind: k } });
      await tx.transitionRuleRow.createMany({
        data: rules.map((r, seq) => ({
          kind: k, from: r.from, to: r.to, label: r.label, labelMs: r.labelMs, roles: r.roles as never,
          requires: r.requires as never, setLocation: (r.setLocation ?? null) as never, effects: (r.effects ?? []) as never, seq,
        })),
      });
    });
    const added = rules.filter((r) => !before.some((b) => b.from === r.from && b.to === r.to)).length;
    const removed = before.filter((b) => !rules.some((r) => r.from === b.from && r.to === b.to)).length;
    await this.record(actor, `transitions:${k}`, `${k} workflow: ${rules.length} transitions (+${added} / −${removed})`, before, rules);
    await this.store.reloadConfig();
    return { transitions: this.transitionsOf(k), version: versionOf(this.transitionsOf(k)), warnings };
  }

  async saveSla(body: { version?: string; rules?: unknown }, actor: Actor) {
    await this.store.reloadConfig();
    const before = this.store.slaRules;
    this.check(body.version, before);
    if (!Array.isArray(body.rules)) throw new BadRequestException('rules must be a list');
    const errors: string[] = [];
    const ids = new Set<string>();
    const rules = body.rules.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const at = `Rule ${i + 1}`;
      const id = String(r.id ?? '').trim().toUpperCase();
      const entity = String(r.entity ?? '') as (typeof SLA_ENTITIES)[number];
      const status = String(r.status ?? '');
      const days = Number(r.days);
      if (!/^[A-Z0-9-]{3,40}$/.test(id)) errors.push(`${at}: id must be 3–40 letters, digits or hyphens`);
      if (ids.has(id)) errors.push(`${at}: id ${id} is used twice`);
      ids.add(id);
      if (!SLA_ENTITIES.includes(entity)) errors.push(`${at}: unknown record type ${entity}`);
      else if (!this.store.statusKeys(entity).includes(status)) errors.push(`${at}: ${entity} has no status ${status}`);
      if (!Number.isInteger(days) || days < 1 || days > 3650) errors.push(`${at}: days must be a whole number from 1 to 3650`);
      const rule = String(r.rule ?? '').trim().slice(0, 160);
      const source = String(r.source ?? '').trim().slice(0, 60);
      if (!rule) errors.push(`${at}: describe the rule`);
      return { id, entity, status, days, rule, source };
    });
    if (rules.length > 100) errors.push('At most 100 SLA rules');
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'The SLA rules have problems', errors });

    await this.prisma.$transaction(async (tx) => {
      await tx.slaRule.deleteMany({});
      await tx.slaRule.createMany({ data: rules.map((r, seq) => ({ ...r, entity: r.entity as never, seq })) });
    });
    await this.record(actor, 'sla', `SLA rules: ${rules.length}`, before, rules);
    await this.store.reloadConfig();
    return { rules: this.store.slaRules, version: versionOf(this.store.slaRules) };
  }

  async saveStream(id: string, body: Record<string, unknown>, actor: Actor) {
    await this.store.reloadConfig();
    const before = this.store.invoiceStreams.find((s) => s.id === id);
    if (!before) throw new NotFoundException(`No invoicing stream ${id}`);
    this.check(body.version as string | undefined, before);
    const text = (v: unknown, max: number, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fallback);
    const docSet = Array.isArray(body.docSet) ? (body.docSet as unknown[]).map((d) => String(d).trim().slice(0, 120)).filter(Boolean) : before.docSet;
    const deadlines = Array.isArray(body.deadlines)
      ? (body.deadlines as Record<string, unknown>[]).map((d) => ({ label: String(d?.label ?? '').trim().slice(0, 80), note: String(d?.note ?? '').trim().slice(0, 160) })).filter((d) => d.label)
      : before.deadlines;
    if (!docSet.length) throw new BadRequestException('A stream needs at least one document in its set');
    if (docSet.length > 30 || deadlines.length > 20) throw new BadRequestException('At most 30 documents and 20 deadlines');
    const after = {
      label: text(body.label, 80, before.label), labelMs: text(body.labelMs, 80, before.labelMs),
      customer: text(body.customer, 120, before.customer), docSet, deadlines,
    };
    await this.prisma.invoiceStreamDef.update({ where: { id: id as never }, data: { ...after, deadlines: after.deadlines as never } });
    await this.record(actor, `stream:${id}`, `Invoicing stream ${id} updated`, before, { ...before, ...after });
    await this.store.reloadConfig();
    const s = this.store.invoiceStreams.find((x) => x.id === id)!;
    return { ...s, version: versionOf(s) };
  }

  async history(limit = 50) {
    const rows = await this.prisma.configChange.findMany({ orderBy: { at: 'desc' }, take: Math.min(Math.max(limit, 1), 200) });
    return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), by: r.by, role: r.role, area: r.area, summary: r.summary, before: r.before, after: r.after }));
  }
}
