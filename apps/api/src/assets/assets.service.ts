import { Optional, BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { SettingsService } from '../settings/settings.service';
import { nextId, text } from './ids';
import { offlineTime } from '../common/client-ops';
import { MAX_LABELS } from './labels';
import { PmService } from './pm.service';
import { DowntimeService } from './downtime.service';

type Actor = { name: string; role: string };

export const ASSET_STATUSES = ['IN_SERVICE', 'OUT_OF_SERVICE', 'RETIRED'] as const;
export const CRITICALITY = ['HIGH', 'MEDIUM', 'LOW'] as const;
const KEY = /^[A-Z][A-Z0-9_]{0,29}$/;

export interface AssetInput {
  tag?: string; name?: string; type?: string; site?: string; location?: string; parentId?: string | null;
  make?: string; model?: string; serialNo?: string; status?: string; criticality?: string;
  commissionedOn?: string | null; attributes?: Record<string, unknown>;
  meters?: { key: string; label: string; unit: string; value?: number }[];
}

/**
 * The asset register: what the organisation maintains, where it is, how it is
 * built up (a building → its plant rooms → a chiller), and its meters.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly pm: PmService,
    private readonly settings: SettingsService,
    @Optional() private readonly downtime?: DowntimeService,
  ) {}

  /** Assets to print labels for, in the order asked, with site names. */
  async forLabels(ids: string[]) {
    const unique = [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
    if (unique.length > MAX_LABELS) throw new BadRequestException(`At most ${MAX_LABELS} labels per print run`);
    const rows = await this.prisma.asset.findMany({ where: { id: { in: unique } }, select: { id: true, tag: true, name: true, site: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const missing = unique.filter((id) => !byId.has(id));
    if (missing.length) throw new NotFoundException(`Asset ${missing[0]} not found`);
    return unique.map((id) => { const r = byId.get(id)!; return { ...r, site: this.store.label('site', r.site) }; });
  }

  /** Tags of several assets at once, for lists. */
  async tags(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.asset.findMany({ where: { id: { in: ids } }, select: { id: true, tag: true } });
    return new Map(rows.map((r) => [r.id, r.tag]));
  }

  /** What a technician needs to see about a job's asset. */
  async forJob(id: string) {
    const a = await this.prisma.asset.findUnique({ where: { id }, include: { meters: { orderBy: { key: 'asc' } } } });
    if (!a) return null;
    return {
      id: a.id, tag: a.tag, name: a.name, type: a.type, site: a.site, location: a.location, make: a.make, model: a.model,
      serialNo: a.serialNo, status: a.status, criticality: a.criticality,
      meters: a.meters.map((m) => ({ key: m.key, label: m.label, unit: m.unit, value: m.value, readAt: m.readAt?.toISOString() ?? null })),
    };
  }

  /** The few facts a job needs about its asset. */
  async brief(id: string) {
    return this.prisma.asset.findUnique({ where: { id }, select: { id: true, tag: true, name: true, model: true, site: true, status: true } });
  }

  async list(q: { site?: string; type?: string; status?: string; parentId?: string; search?: string }) {
    const search = q.search?.trim();
    const rows = await this.prisma.asset.findMany({
      where: {
        ...(q.site ? { site: q.site } : {}), ...(q.type ? { type: q.type } : {}), ...(q.status ? { status: q.status } : {}),
        ...(q.parentId ? { parentId: q.parentId } : {}),
        ...(search ? { OR: ['tag', 'name', 'make', 'model', 'serialNo', 'location'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' as const } })) } : {}),
      },
      include: { meters: { orderBy: { key: 'asc' } }, _count: { select: { children: true, schedules: true } } },
      orderBy: [{ site: 'asc' }, { tag: 'asc' }],
      take: 1000,
    });
    const open = await this.openJobCounts(rows.map((r) => r.id));
    return rows.map((r) => ({ ...this.view(r), children: r._count.children, schedules: r._count.schedules, openJobs: open.get(r.id) ?? 0 }));
  }

  async get(id: string) {
    const r = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        meters: { orderBy: { key: 'asc' } },
        children: { select: { id: true, tag: true, name: true, type: true, status: true }, orderBy: { tag: 'asc' } },
        parent: { select: { id: true, tag: true, name: true } },
        schedules: { orderBy: { title: 'asc' } },
      },
    });
    if (!r) throw new NotFoundException(`Asset ${id} not found`);
    const jobs = await this.prisma.job.findMany({
      where: { assetId: id },
      select: { id: true, psDate: true, status: true, jobType: true, category: true, statusSince: true, pmScheduleId: true },
      orderBy: { receivedAt: 'desc' }, take: 100,
    });
    return {
      ...this.view(r),
      parent: r.parent, children: r.children,
      schedules: r.schedules.map((s) => this.pm.view(s)),
      jobs: jobs.map((j) => ({ ...j, statusSince: j.statusSince.toISOString() })),
    };
  }

  private view(r: { meters?: { key: string; label: string; unit: string; value: number; readAt: Date | null }[] } & Record<string, unknown>) {
    const { ordinal: _o, version: _v, ...rest } = r as Record<string, unknown>;
    return {
      ...rest,
      createdAt: (r.createdAt as Date).toISOString(),
      meters: (r.meters ?? []).map((m) => ({ key: m.key, label: m.label, unit: m.unit, value: m.value, readAt: m.readAt?.toISOString() ?? null })),
    };
  }

  private async openJobCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const final = this.store.finalStatuses('JOB');
    const rows = await this.prisma.job.groupBy({ by: ['assetId'], where: { assetId: { in: ids }, status: { notIn: final } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.assetId as string, r._count._all]));
  }

  /** Check an asset's fields against the organisation's lists. */
  private validate(input: AssetInput, creating: boolean): string[] {
    const errors: string[] = [];
    const need = (k: keyof AssetInput, label: string) => { if (creating && !text(input[k], 200)) errors.push(`${label} is required`); };
    need('tag', 'Tag'); need('name', 'Name'); need('type', 'Type'); need('site', this.settingsWord('site'));
    if (input.tag !== undefined && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/.test(String(input.tag).trim())) errors.push('Tag: up to 40 letters, digits, spaces or . _ / -');
    if (input.type !== undefined && !this.store.has('assetType', String(input.type))) errors.push(`Unknown asset type ${input.type}`);
    if (input.site !== undefined && !this.store.has('site', String(input.site))) errors.push(`Unknown ${this.settingsWord('site').toLowerCase()} ${input.site}`);
    if (input.status !== undefined && !ASSET_STATUSES.includes(input.status as never)) errors.push(`Status must be one of ${ASSET_STATUSES.join(', ')}`);
    if (input.criticality !== undefined && !CRITICALITY.includes(input.criticality as never)) errors.push(`Criticality must be one of ${CRITICALITY.join(', ')}`);
    if (input.commissionedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.commissionedOn)) errors.push('Commissioned on must be a date (YYYY-MM-DD)');
    if (input.attributes !== undefined && (typeof input.attributes !== 'object' || Array.isArray(input.attributes) || JSON.stringify(input.attributes).length > 4000)) {
      errors.push('Attributes must be an object (up to 4 000 characters)');
    }
    for (const [i, m] of (input.meters ?? []).entries()) errors.push(...this.meterErrors(m, `Meter ${i + 1}`));
    return errors;
  }

  private settingsWord(k: 'site') {
    return this.settings.terms[k];
  }

  private meterErrors(m: { key?: unknown; label?: unknown; unit?: unknown; value?: unknown }, at: string): string[] {
    const errors: string[] = [];
    if (!KEY.test(String(m?.key ?? ''))) errors.push(`${at}: key must be capital letters, digits or _ (e.g. ODOMETER)`);
    if (!text(m?.label, 60)) errors.push(`${at}: a label is required`);
    if (!text(m?.unit, 12)) errors.push(`${at}: a unit is required (e.g. km, h)`);
    if (m?.value !== undefined && (!Number.isFinite(Number(m.value)) || Number(m.value) < 0)) errors.push(`${at}: the starting value must be a number ≥ 0`);
    return errors;
  }

  private async checkParent(id: string | null | undefined, self?: string): Promise<void> {
    if (!id) return;
    if (id === self) throw new BadRequestException('An asset cannot be its own parent');
    // Walk up to refuse loops (A inside B inside A).
    let cursor: string | null = id;
    for (let depth = 0; cursor && depth < 20; depth++) {
      const p: { parentId: string | null } | null = await this.prisma.asset.findUnique({ where: { id: cursor }, select: { parentId: true } });
      if (!p) throw new BadRequestException(depth === 0 ? `Parent asset ${id} not found` : 'Broken asset hierarchy');
      if (p.parentId === self && self) throw new BadRequestException('That would put the asset inside itself');
      cursor = p.parentId;
    }
  }

  async create(input: AssetInput, actor: Actor) {
    const errors = this.validate(input, true);
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'The asset has problems', errors });
    await this.checkParent(input.parentId);
    const tag = text(input.tag, 40);
    if (await this.prisma.asset.findUnique({ where: { tag } })) throw new ConflictException(`Tag ${tag} is already in the register`);
    const ids = (await this.prisma.asset.findMany({ select: { id: true } })).map((r) => r.id);
    const id = nextId('AST', ids);
    await this.prisma.asset.create({
      data: {
        id, tag, name: text(input.name, 120), type: String(input.type), site: String(input.site),
        location: text(input.location, 120), parentId: input.parentId || null,
        make: text(input.make, 60), model: text(input.model, 60), serialNo: text(input.serialNo, 60),
        status: input.status ?? 'IN_SERVICE', criticality: input.criticality ?? 'MEDIUM',
        commissionedOn: input.commissionedOn || null, attributes: (input.attributes ?? {}) as never,
        createdBy: actor.name, ordinal: ids.length + 1,
        meters: { create: (input.meters ?? []).map((m) => ({ key: m.key, label: text(m.label, 60), unit: text(m.unit, 12), value: Number(m.value ?? 0), readAt: m.value !== undefined ? new Date() : null })) },
      },
    });
    return this.get(id);
  }

  async update(id: string, input: AssetInput, _actor: Actor) {
    const existing = await this.prisma.asset.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Asset ${id} not found`);
    const errors = this.validate({ ...input, meters: undefined }, false);
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'The asset has problems', errors });
    if (input.parentId !== undefined) await this.checkParent(input.parentId, id);
    if (input.tag !== undefined && text(input.tag, 40) !== existing.tag && (await this.prisma.asset.findUnique({ where: { tag: text(input.tag, 40) } }))) {
      throw new ConflictException(`Tag ${input.tag} is already in the register`);
    }
    const data: Record<string, unknown> = {};
    for (const [k, max] of [['tag', 40], ['name', 120], ['location', 120], ['make', 60], ['model', 60], ['serialNo', 60]] as const) {
      if (input[k] !== undefined) data[k] = text(input[k], max);
    }
    for (const k of ['type', 'site', 'status', 'criticality'] as const) if (input[k] !== undefined) data[k] = input[k];
    if (input.parentId !== undefined) data.parentId = input.parentId || null;
    if (input.commissionedOn !== undefined) data.commissionedOn = input.commissionedOn || null;
    if (input.attributes !== undefined) data.attributes = input.attributes;
    await this.prisma.asset.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
    // Out of service by hand starts a downtime spell; back in service ends it.
    if (this.downtime && input.status && input.status !== existing.status) {
      if (input.status === 'OUT_OF_SERVICE') await this.downtime.open(id, { reason: 'Put out of service', by: _actor.name });
      else if (existing.status === 'OUT_OF_SERVICE') await this.downtime.closeForAsset(id, _actor.name);
    }
    return this.get(id);
  }

  async addMeter(id: string, m: { key: string; label: string; unit: string; value?: number }) {
    if (!(await this.prisma.asset.findUnique({ where: { id }, select: { id: true } }))) throw new NotFoundException(`Asset ${id} not found`);
    const errors = this.meterErrors(m, 'Meter');
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'The meter has problems', errors });
    if (await this.prisma.meter.findUnique({ where: { assetId_key: { assetId: id, key: m.key } } })) throw new ConflictException(`This asset already has a ${m.key} meter`);
    await this.prisma.meter.create({
      data: { assetId: id, key: m.key, label: text(m.label, 60), unit: text(m.unit, 12), value: Number(m.value ?? 0), readAt: m.value !== undefined ? new Date() : null },
    });
    return this.get(id);
  }

  /**
   * Record a meter reading. Meters only go up; a lower value is refused unless
   * it is flagged as a reset (a replaced instrument or rolled-over counter).
   * Meter-based maintenance that has fallen due is raised straight away.
   */
  async recordReading(id: string, key: string, body: { value?: unknown; reset?: boolean; at?: unknown }, actor: Actor, source = 'manual') {
    const at = offlineTime(body.at);
    const meter = await this.prisma.meter.findUnique({ where: { assetId_key: { assetId: id, key } } });
    if (!meter) throw new NotFoundException(`Asset ${id} has no ${key} meter`);
    const value = Number(body.value);
    if (body.value === undefined || body.value === '' || !Number.isFinite(value) || value < 0) throw new BadRequestException('Reading must be a number ≥ 0');
    if (value < meter.value && !body.reset) {
      throw new BadRequestException(`Reading ${value} is below the last one (${meter.value} ${meter.unit}) — record it as a reset if the meter was replaced`);
    }
    await this.prisma.$transaction([
      this.prisma.meterReading.create({ data: { meterId: meter.id, value, by: actor.name, source: body.reset ? 'reset' : source, ...(at ? { at } : {}) } }),
      this.prisma.meter.update({ where: { id: meter.id }, data: { value, readAt: at ?? new Date() } }),
    ]);
    const raised = await this.pm.generateDue({ assetId: id });
    return { key, value, unit: meter.unit, raised };
  }

  async readings(id: string, key: string, limit = 100) {
    const meter = await this.prisma.meter.findUnique({ where: { assetId_key: { assetId: id, key } } });
    if (!meter) throw new NotFoundException(`Asset ${id} has no ${key} meter`);
    const rows = await this.prisma.meterReading.findMany({ where: { meterId: meter.id }, orderBy: { at: 'desc' }, take: Math.min(Math.max(limit, 1), 1000) });
    return rows.map((r) => ({ value: r.value, at: r.at.toISOString(), by: r.by, source: r.source }));
  }
}
