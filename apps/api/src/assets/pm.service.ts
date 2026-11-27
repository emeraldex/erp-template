import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { ChecklistItem, Job } from '../common/types';
import { SettingsService } from '../settings/settings.service';
import { DAY_MS, nextId, text } from './ids';

type Actor = { name: string; role: string };
type Row = Awaited<ReturnType<PrismaService['pmSchedule']['findFirstOrThrow']>>;

export interface ScheduleInput {
  assetId?: string; title?: string; active?: boolean;
  intervalDays?: number | null; meterKey?: string | null; intervalMeter?: number | null;
  leadDays?: number; leadMeter?: number;
  jobType?: string; category?: string; instructions?: string;
  checklist?: { key?: string; label: string; required?: boolean }[];
  /** First due date (YYYY-MM-DD); defaults to one interval from today. */
  firstDue?: string;
}

const PM_ACTOR = { name: 'PM scheduler', role: 'SYSTEM' };

/**
 * Preventive maintenance. A schedule raises a job when it falls due — by the
 * calendar, by a meter, or whichever comes first — and rolls forward when that
 * job is done. One open job per schedule at a time; overdue work is never
 * duplicated.
 */
@Injectable()
export class PmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
  ) {}

  view(s: Row) {
    return {
      ...s,
      createdAt: s.createdAt.toISOString(),
      lastDoneAt: s.lastDoneAt?.toISOString() ?? null,
      nextDueAt: s.nextDueAt?.toISOString() ?? null,
    };
  }

  async list(q: { assetId?: string; due?: boolean }) {
    const rows = await this.prisma.pmSchedule.findMany({
      where: { ...(q.assetId ? { assetId: q.assetId } : {}) },
      include: { asset: { select: { tag: true, name: true, site: true, meters: true } } },
      orderBy: [{ nextDueAt: 'asc' }, { id: 'asc' }],
    });
    const now = Date.now();
    const out = rows.map(({ asset, ...s }) => {
      const meter = s.meterKey ? asset.meters.find((m) => m.key === s.meterKey) : undefined;
      const overdue = (s.nextDueAt && s.nextDueAt.getTime() < now) || (meter && s.nextDueMeter != null && meter.value >= s.nextDueMeter);
      return {
        ...this.view(s), asset: { tag: asset.tag, name: asset.name, site: asset.site },
        meterValue: meter?.value ?? null, meterUnit: meter?.unit ?? null, overdue: !!overdue && s.active,
      };
    });
    return q.due ? out.filter((s) => s.active && (s.overdue || this.dueSoon(s, now))) : out;
  }

  private dueSoon(s: { nextDueAt: string | null; leadDays: number; nextDueMeter: number | null; leadMeter: number; meterValue: number | null }, now: number) {
    if (s.nextDueAt && new Date(s.nextDueAt).getTime() - s.leadDays * DAY_MS <= now) return true;
    return s.nextDueMeter != null && s.meterValue != null && s.meterValue >= s.nextDueMeter - s.leadMeter;
  }

  async get(id: string) {
    const s = await this.prisma.pmSchedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException(`Schedule ${id} not found`);
    return this.view(s);
  }

  private checklist(items: ScheduleInput['checklist'], errors: string[]) {
    if (items === undefined) return undefined;
    if (!Array.isArray(items) || items.length > 50) {
      errors.push('Checklist: a list of up to 50 items');
      return [];
    }
    const seen = new Set<string>();
    return items.map((it, i) => {
      const label = text(it?.label, 160);
      if (!label) errors.push(`Checklist item ${i + 1}: describe the check`);
      let key = text(it?.key, 30) || `c${i + 1}`;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,29}$/.test(key)) errors.push(`Checklist item ${i + 1}: key must be letters, digits or _`);
      if (seen.has(key)) key = `${key}_${i + 1}`;
      seen.add(key);
      return { key, label, required: it?.required !== false };
    });
  }

  private async validate(input: ScheduleInput, existing?: Row) {
    const errors: string[] = [];
    const assetId = input.assetId ?? existing?.assetId;
    const asset = assetId ? await this.prisma.asset.findUnique({ where: { id: assetId }, include: { meters: true } }) : null;
    if (!asset) errors.push(assetId ? `Asset ${assetId} not found` : 'Asset is required');
    if (!existing && !text(input.title, 120)) errors.push('Title is required');
    const intervalDays = input.intervalDays !== undefined ? input.intervalDays : existing?.intervalDays ?? null;
    const meterKey = input.meterKey !== undefined ? input.meterKey : existing?.meterKey ?? null;
    const intervalMeter = input.intervalMeter !== undefined ? input.intervalMeter : existing?.intervalMeter ?? null;
    if (intervalDays != null && (!Number.isInteger(Number(intervalDays)) || Number(intervalDays) < 1 || Number(intervalDays) > 3650)) errors.push('Every … days: a whole number from 1 to 3650');
    if (meterKey) {
      if (asset && !asset.meters.some((m) => m.key === meterKey)) errors.push(`The asset has no ${meterKey} meter`);
      if (intervalMeter == null || !(Number(intervalMeter) > 0)) errors.push('Every … meter units: a number above 0');
    } else if (intervalMeter != null) errors.push('Choose the meter the interval counts on');
    if (intervalDays == null && !meterKey) errors.push('Give a calendar interval, a meter interval, or both');
    if (input.leadDays !== undefined && (!Number.isInteger(Number(input.leadDays)) || input.leadDays < 0 || input.leadDays > 365)) errors.push('Lead days: 0 to 365');
    if (input.leadMeter !== undefined && (!Number.isFinite(Number(input.leadMeter)) || input.leadMeter < 0)) errors.push('Lead meter units: a number ≥ 0');
    if (input.jobType !== undefined && this.store.dict('jobType', true).length && !this.store.has('jobType', input.jobType)) errors.push(`Unknown job type ${input.jobType}`);
    if (input.category && this.store.dict('category', true).length && !this.store.has('category', input.category)) errors.push(`Unknown category ${input.category}`);
    if (input.firstDue && !/^\d{4}-\d{2}-\d{2}$/.test(input.firstDue)) errors.push('First due: a date (YYYY-MM-DD)');
    const checklist = this.checklist(input.checklist, errors);
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: 'The schedule has problems', errors });
    return { asset: asset!, intervalDays: intervalDays == null ? null : Number(intervalDays), meterKey: meterKey || null, intervalMeter: intervalMeter == null ? null : Number(intervalMeter), checklist };
  }

  async create(input: ScheduleInput, actor: Actor) {
    const v = await this.validate(input);
    const meter = v.meterKey ? v.asset.meters.find((m) => m.key === v.meterKey) : undefined;
    const ids = (await this.prisma.pmSchedule.findMany({ select: { id: true } })).map((r) => r.id);
    const id = nextId('PM', ids);
    await this.prisma.pmSchedule.create({
      data: {
        id, assetId: v.asset.id, title: text(input.title, 120), active: input.active !== false,
        intervalDays: v.intervalDays, meterKey: v.meterKey, intervalMeter: v.intervalMeter,
        leadDays: input.leadDays ?? 7, leadMeter: input.leadMeter ?? 0,
        jobType: input.jobType ?? 'PREVENTIVE', category: input.category ?? '', instructions: text(input.instructions, 2000),
        checklist: (v.checklist ?? []) as never,
        nextDueAt: input.firstDue ? new Date(`${input.firstDue}T00:00:00Z`) : v.intervalDays ? new Date(Date.now() + v.intervalDays * DAY_MS) : null,
        nextDueMeter: meter && v.intervalMeter ? meter.value + v.intervalMeter : null,
        createdBy: actor.name,
      },
    });
    await this.generateDue({ scheduleId: id });
    return this.get(id);
  }

  async update(id: string, input: ScheduleInput) {
    const existing = await this.prisma.pmSchedule.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Schedule ${id} not found`);
    if (input.assetId && input.assetId !== existing.assetId) throw new BadRequestException('A schedule stays with its asset — create a new one instead');
    const v = await this.validate(input, existing);
    const data: Record<string, unknown> = {
      intervalDays: v.intervalDays, meterKey: v.meterKey, intervalMeter: v.intervalMeter,
    };
    if (input.title !== undefined) data.title = text(input.title, 120) || existing.title;
    if (input.active !== undefined) data.active = !!input.active;
    if (input.leadDays !== undefined) data.leadDays = input.leadDays;
    if (input.leadMeter !== undefined) data.leadMeter = input.leadMeter;
    if (input.jobType !== undefined) data.jobType = input.jobType;
    if (input.category !== undefined) data.category = input.category;
    if (input.instructions !== undefined) data.instructions = text(input.instructions, 2000);
    if (v.checklist) data.checklist = v.checklist;
    if (input.firstDue) data.nextDueAt = new Date(`${input.firstDue}T00:00:00Z`);
    // A changed meter interval counts from the last service (or now).
    if (input.intervalMeter !== undefined || input.meterKey !== undefined) {
      const meter = v.meterKey ? v.asset.meters.find((m) => m.key === v.meterKey) : undefined;
      data.nextDueMeter = meter && v.intervalMeter ? (existing.lastDoneMeter ?? meter.value) + v.intervalMeter : null;
    }
    if (input.intervalDays !== undefined && !input.firstDue) {
      data.nextDueAt = v.intervalDays ? new Date((existing.lastDoneAt?.getTime() ?? Date.now()) + v.intervalDays * DAY_MS) : null;
    }
    await this.prisma.pmSchedule.update({ where: { id }, data });
    return this.get(id);
  }

  /** Skip this cycle (e.g. the asset was out of service): move the due date / meter on by one interval. */
  async skip(id: string, actor: Actor, reason?: string) {
    const s = await this.prisma.pmSchedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException(`Schedule ${id} not found`);
    if (s.openJobId) throw new BadRequestException(`Job ${s.openJobId} is already open for this cycle — finish or cancel it instead`);
    if (!text(reason, 200)) throw new BadRequestException('Say why the cycle is skipped');
    await this.prisma.pmSchedule.update({
      where: { id },
      data: {
        nextDueAt: s.intervalDays ? new Date(Math.max(s.nextDueAt?.getTime() ?? 0, Date.now()) + s.intervalDays * DAY_MS) : s.nextDueAt,
        nextDueMeter: s.nextDueMeter != null && s.intervalMeter ? s.nextDueMeter + s.intervalMeter : s.nextDueMeter,
      },
    });
    await this.prisma.configChange.create({
      data: { id: randomUUID(), by: actor.name, role: actor.role, area: `pm:${id}`, summary: `Skipped a cycle of ${id}: ${text(reason, 200)}`, before: this.view(s) as never, after: {} as never },
    });
    return this.get(id);
  }

  /**
   * Raise jobs for every schedule that has fallen due (within its lead time)
   * and has no job open. Runs on a timer, after meter readings and on demand.
   */
  async generateDue(scope: { assetId?: string; scheduleId?: string } = {}, now = new Date()): Promise<string[]> {
    if (!this.settings.modules.pm) return [];
    const schedules = await this.prisma.pmSchedule.findMany({
      where: { active: true, openJobId: null, ...(scope.assetId ? { assetId: scope.assetId } : {}), ...(scope.scheduleId ? { id: scope.scheduleId } : {}) },
      include: { asset: { include: { meters: true } } },
    });
    const raised: string[] = [];
    for (const s of schedules) {
      if (s.asset.status === 'RETIRED') continue;
      const meter = s.meterKey ? s.asset.meters.find((m) => m.key === s.meterKey) : undefined;
      const byDate = !!s.nextDueAt && s.nextDueAt.getTime() - s.leadDays * DAY_MS <= now.getTime();
      const byMeter = !!meter && s.nextDueMeter != null && meter.value >= s.nextDueMeter - s.leadMeter;
      if (!byDate && !byMeter) continue;

      const due = [
        s.nextDueAt ? `due ${s.nextDueAt.toISOString().slice(0, 10)}` : '',
        meter && s.nextDueMeter != null ? `due at ${s.nextDueMeter} ${meter.unit}` : '',
      ].filter(Boolean).join(' / ');
      const job = await this.raiseJob(s, due);
      // Claim the cycle only if nobody else did (several API replicas may run this).
      const claimed = await this.prisma.pmSchedule.updateMany({ where: { id: s.id, openJobId: null }, data: { openJobId: job.id } });
      if (!claimed.count) continue;
      this.store.newJob(job);
      try {
        await this.store.save(job);
      } catch (err) {
        await this.prisma.pmSchedule.update({ where: { id: s.id }, data: { openJobId: null } });
        throw err;
      }
      raised.push(job.id);
    }
    return raised;
  }

  private async raiseJob(s: Row & { asset: { id: string; name: string; model: string; tag: string; site: string } }, due: string): Promise<Job> {
    const now = new Date().toISOString();
    const { jobPrefix, initialLocation } = this.settings.defaults;
    const categories = this.store.dict('category', true);
    const checklist: ChecklistItem[] = ((s.checklist ?? []) as { key: string; label: string; required: boolean }[])
      .map((c) => ({ key: c.key, label: c.label, required: c.required !== false, done: false }));
    return {
      id: await this.store.nextJobId(jobPrefix),
      psDate: now.slice(0, 10),
      component: s.asset.name, partNo: s.asset.model || '-', serialNo: s.asset.tag,
      category: s.category || categories[0]?.key || 'GENERAL',
      originUnit: this.settings.terms.pm, repairUnit: s.asset.site,
      status: this.store.initialStatus('JOB'), location: initialLocation,
      receivedAt: now, statusSince: now, demandIds: [], records: [],
      jobType: s.jobType, assetId: s.asset.id, pmScheduleId: s.id, checklist,
      ...(s.nextDueAt ? { pmDueAt: s.nextDueAt.toISOString() } : {}),
      audit: [this.store.audit(PM_ACTOR.name, PM_ACTOR.role, `Raised by ${s.id} — ${s.title} (${due})`, s.instructions ? { instructions: s.instructions } : undefined)],
    };
  }

  /** The job for a cycle is done: count the service and set the next due date and meter. */
  async completed(job: Job): Promise<void> {
    if (!job.pmScheduleId) return;
    const s = await this.prisma.pmSchedule.findUnique({ where: { id: job.pmScheduleId }, include: { asset: { include: { meters: true } } } });
    if (!s || s.openJobId !== job.id) return;
    const meter = s.meterKey ? s.asset.meters.find((m) => m.key === s.meterKey) : undefined;
    const now = new Date();
    await this.prisma.pmSchedule.update({
      where: { id: s.id },
      data: {
        openJobId: null, lastDoneAt: now, lastDoneMeter: meter?.value ?? null,
        nextDueAt: s.intervalDays ? new Date(now.getTime() + s.intervalDays * DAY_MS) : null,
        nextDueMeter: meter && s.intervalMeter ? meter.value + s.intervalMeter : null,
      },
    });
  }

  /** The job was cancelled without the work being done: the cycle is still due. */
  async cancelled(job: Job): Promise<void> {
    if (!job.pmScheduleId) return;
    await this.prisma.pmSchedule.updateMany({ where: { id: job.pmScheduleId, openJobId: job.id }, data: { openJobId: null } });
  }

  /** What falls due in the next `days` days, for planning. */
  async forecast(days = 30) {
    const horizon = Date.now() + Math.min(Math.max(days, 1), 366) * DAY_MS;
    return (await this.list({})).filter((s) => s.active && ((s.nextDueAt && new Date(s.nextDueAt).getTime() <= horizon) || s.overdue));
  }
}
