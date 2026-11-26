import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { SettingsService } from '../settings/settings.service';
import { ADMIN_ROLE, CAPABILITIES, DICT_KINDS, KINDS, PHASES, TONES, type Kind } from '../packs/types';
import { versionOf } from './version';

type Actor = { name: string; role: string };

/** Every vocabulary an organisation can edit. */
export const EDITABLE_KINDS = [...KINDS.map((k) => `status:${k}`), 'role', ...DICT_KINDS];

const KEY = /^[A-Z][A-Z0-9_]{0,39}$/;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * The organisation's own words for things: statuses, roles (and what each may
 * do), sites, locations, categories, priorities and so on. Entries are never
 * deleted, only deactivated, because existing records keep referring to them.
 */
@Injectable()
export class DictionaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
  ) {}

  snapshot() {
    return Object.fromEntries(EDITABLE_KINDS.map((kind) => {
      const entries = this.store.dict(kind);
      return [kind, { entries, version: versionOf(entries) }];
    }));
  }

  async save(kind: string, body: { version?: string; entries?: unknown }, actor: Actor) {
    if (!EDITABLE_KINDS.includes(kind)) throw new NotFoundException(`No list called ${kind}`);
    await this.store.reloadConfig();
    const before = this.store.dict(kind);
    if (!body.version) throw new BadRequestException('version is required (from the copy you edited)');
    if (body.version !== versionOf(before)) {
      throw new ConflictException('Someone else changed this list since you opened it — reload and apply your change again');
    }
    if (!Array.isArray(body.entries)) throw new BadRequestException('entries must be a list');
    if (body.entries.length > 200) throw new BadRequestException('At most 200 entries');

    const errors: string[] = [];
    const seen = new Set<string>();
    const status = kind.startsWith('status:') ? (kind.slice(7) as Kind) : null;

    const entries = body.entries.map((raw, i) => {
      const r = (raw ?? {}) as Record<string, unknown>;
      const at = `Entry ${i + 1}`;
      const key = text(r.key, 40).toUpperCase();
      const label = text(r.label, 80);
      const labelMs = text(r.labelMs, 80);
      const active = r.active !== false;
      if (!KEY.test(key)) errors.push(`${at}: key must be capital letters, digits or _ and start with a letter`);
      if (seen.has(key)) errors.push(`${at}: ${key} is listed twice`);
      seen.add(key);
      if (!label) errors.push(`${at}: a label is required`);
      const m = (r.meta && typeof r.meta === 'object' ? r.meta : {}) as Record<string, unknown>;
      let meta: Record<string, unknown> = {};

      if (status) {
        if (!TONES.includes(m.tone as never)) errors.push(`${at}: colour must be one of ${TONES.join(', ')}`);
        if (!PHASES.includes(m.phase as never)) errors.push(`${at}: phase must be one of ${PHASES.join(', ')}`);
        meta = { tone: m.tone, phase: m.phase };
        if (m.final === true) meta.final = true;
        if (m.draftDocuments === true) {
          if (status !== 'INVOICE') errors.push(`${at}: only invoice statuses can mark documents as drafts`);
          meta.draftDocuments = true;
        }
        if (m.branch === true) meta.branch = true;
        if (m.acceptsQuotations === true) {
          if (status !== 'DEMAND') errors.push(`${at}: only demand statuses can accept quotations`);
          meta.acceptsQuotations = true;
        }
      } else if (kind === 'role') {
        const caps = Array.isArray(m.capabilities) ? m.capabilities.map(String) : [];
        for (const c of caps) if (!(c in CAPABILITIES)) errors.push(`${at}: unknown permission ${c}`);
        meta = { capabilities: [...new Set(caps)] };
        if (typeof m.description === 'string' && m.description.trim()) meta.description = m.description.trim().slice(0, 200);
      } else {
        // Free-form extras such as a priority's colour or a route's note.
        for (const [k, v] of Object.entries(m)) {
          if (/^[a-zA-Z]{1,30}$/.test(k) && ['string', 'number', 'boolean'].includes(typeof v)) meta[k] = typeof v === 'string' ? v.slice(0, 200) : v;
        }
      }
      return { key, label, labelMs, meta, active };
    });

    for (const b of before) {
      if (!seen.has(b.key)) errors.push(`${b.key} can't be deleted because records may use it — mark it inactive instead`);
    }
    const isActive = (key: string) => entries.some((e) => e.key === key && e.active);

    if (status) {
      if (!entries.length) errors.push('A workflow needs at least one status');
      else if (!entries[0].active) errors.push(`${entries[0].key} is the first status (where records start) and must be active`);
      if (!entries.some((e) => e.active && e.meta.final)) errors.push('At least one active status must be final (closed)');
      const rules = { JOB: this.store.jobTransitions, DEMAND: this.store.demandTransitions, OV: this.store.ovTransitions, INVOICE: this.store.invoiceTransitions }[status];
      const used = new Set(rules.flatMap((r) => [r.from, r.to]));
      for (const e of entries) if (!e.active && used.has(e.key)) errors.push(`${e.key} is used by workflow steps — remove those steps before deactivating it`);
    }
    if (kind === 'role' && !isActive(ADMIN_ROLE)) errors.push(`${ADMIN_ROLE} is required and must stay active`);
    if (kind === 'location') {
      const initial = this.settings.defaults.initialLocation;
      if (!isActive(initial)) errors.push(`${initial} is where new items start (see defaults) and must stay active`);
      for (const r of this.store.jobTransitions) {
        if (r.setLocation && !isActive(r.setLocation)) errors.push(`${r.setLocation} is used by the step ${r.from} → ${r.to} and must stay active`);
      }
    }
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'The list has problems', errors });

    await this.prisma.$transaction(async (tx) => {
      for (const [seq, e] of entries.entries()) {
        await tx.dictionaryEntry.upsert({
          where: { kind_key: { kind, key: e.key } },
          create: { kind, ...e, meta: e.meta as never, seq },
          update: { label: e.label, labelMs: e.labelMs, meta: e.meta as never, active: e.active, seq },
        });
      }
    });
    await this.prisma.configChange.create({
      data: { id: randomUUID(), by: actor.name, role: actor.role, area: `dictionary:${kind}`, summary: `${kind}: ${entries.length} entries`, before: before as never, after: entries as never },
    });
    await this.store.reloadConfig();
    const after = this.store.dict(kind);
    return { entries: after, version: versionOf(after) };
  }
}
