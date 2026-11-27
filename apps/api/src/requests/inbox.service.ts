import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'crypto';
import { MAX_LABELS } from '../assets/labels';
import { SettingsService } from '../settings/settings.service';
import { currentTenant } from '../tenancy/tenant';
import { posterPdf, stickerPdf } from './posters';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { Role } from '../common/types';
import { AttachmentsService } from '../attachments/attachments.service';
import { JobsService } from '../jobs/jobs.service';
import { cleanInput, newSalt } from './logic';
import { RequestRow, RequestsService } from './requests.service';

type Actor = { name: string; role: Role };
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Triage: the help desk looks at what came in through the portal and accepts
 * it into a new work order, adds it to one already open, or declines it.
 */
@Injectable()
export class RequestsInboxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    private readonly requests: RequestsService,
    private readonly jobs: JobsService,
    private readonly attachments: AttachmentsService,
    private readonly settings: SettingsService,
  ) {}

  private async row(id: string): Promise<RequestRow> {
    const r = await this.prisma.serviceRequest.findUnique({ where: { id }, include: { messages: { orderBy: { id: 'asc' } } } });
    if (!r) throw new NotFoundException(`Request ${id} not found`);
    return r;
  }

  private summary(r: RequestRow | (Omit<RequestRow, 'messages'> & { messages?: RequestRow['messages'] }), photos = 0) {
    const last = r.messages?.[r.messages.length - 1];
    return {
      id: r.id, status: r.status, createdAt: r.createdAt.toISOString(), description: r.description, place: r.place,
      site: r.site, siteLabel: r.site ? this.store.label('site', r.site) : '', category: r.category,
      categoryLabel: r.category ? this.store.label('category', r.category) : '', urgent: r.urgent,
      requesterName: r.requesterName, source: r.source, jobId: r.jobId, merged: r.merged, photos,
      rating: r.rating, awaitingReply: last?.from === 'REQUESTER', decidedBy: r.decidedBy, decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  }

  async list(q: { status?: string; q?: string }) {
    const search = q.q?.trim();
    const rows = await this.prisma.serviceRequest.findMany({
      where: {
        ...(q.status && q.status !== 'ALL' ? { status: q.status } : {}),
        ...(search ? { OR: ['id', 'description', 'place', 'requesterName', 'requesterEmail', 'requesterPhone', 'jobId'].map((f) => ({ [f]: { contains: search, mode: 'insensitive' as const } })) } : {}),
      },
      include: { messages: { orderBy: { id: 'asc' } } },
      // Urgent new requests first, then the oldest waiting.
      orderBy: q.status === 'NEW' ? [{ urgent: 'desc' }, { createdAt: 'asc' }] : [{ createdAt: 'desc' }],
      take: 300,
    });
    const counts = await this.prisma.attachment.groupBy({ by: ['entityId'], where: { entity: 'REQUEST', entityId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    const photos = new Map(counts.map((c) => [c.entityId, c._count._all]));
    return rows.map((r) => this.summary(r, photos.get(r.id) ?? 0));
  }

  /** Everything triage needs: contact details, photos, messages and possible duplicates. */
  async get(id: string) {
    const r = await this.row(id);
    const photos = await this.prisma.attachment.findMany({
      where: { OR: [{ entity: 'REQUEST', entityId: r.id }, ...(r.jobId ? [{ entity: 'JOB', entityId: r.jobId, caption: 'Photo from the requester', filename: { startsWith: `${r.id}-` } }] : [])] },
      select: { id: true, filename: true, contentType: true }, orderBy: { uploadedAt: 'asc' },
    });
    const asset = r.assetId ? await this.prisma.asset.findUnique({ where: { id: r.assetId }, select: { id: true, tag: true, name: true } }) : null;
    return {
      ...this.summary(r, photos.length),
      requesterEmail: r.requesterEmail, requesterPhone: r.requesterPhone, lang: r.lang, pointCode: r.pointCode,
      asset, declineReason: r.declineReason, spam: r.spam, ratingComment: r.ratingComment,
      messages: r.messages.map((m) => ({ from: m.from, by: m.by, body: m.body, at: m.at.toISOString() })),
      photoIds: photos.map((p) => p.id),
      duplicates: r.status === 'NEW' ? await this.duplicates(r) : { jobs: [], requests: [] },
      // Staff can read it to a caller, or send it themselves.
      trackLink: r.status === 'DECLINED' && r.spam ? null : this.requests.trackLink(r),
    };
  }

  /** Open work orders on the same asset or from the same poster, and other new requests from there. */
  private async duplicates(r: RequestRow) {
    const sameSource = [...(r.assetId ? [{ assetId: r.assetId }] : []), ...(r.pointCode ? [{ pointCode: r.pointCode }] : [])];
    if (!sameSource.length) return { jobs: [], requests: [] };
    const others = await this.prisma.serviceRequest.findMany({ where: { id: { not: r.id }, OR: sameSource, status: { in: ['NEW', 'ACCEPTED'] } }, select: { id: true, status: true, jobId: true, description: true, createdAt: true } });
    const jobIds = [...new Set(others.map((o) => o.jobId).filter((j): j is string => !!j))];
    const open = this.store.statusKeys('JOB').filter((s) => !this.store.isFinal('JOB', s));
    const jobs = await this.prisma.job.findMany({
      where: { status: { in: open }, archivedAt: null, OR: [...(r.assetId ? [{ assetId: r.assetId }] : []), ...(jobIds.length ? [{ id: { in: jobIds } }] : [])] },
      select: { id: true, component: true, status: true, receivedAt: true }, orderBy: { receivedAt: 'desc' }, take: 10,
    });
    return {
      jobs: jobs.map((j) => ({ id: j.id, component: j.component, status: j.status, receivedAt: j.receivedAt.toISOString() })),
      requests: others.filter((o) => o.status === 'NEW').map((o) => ({ id: o.id, description: o.description.slice(0, 120), createdAt: o.createdAt.toISOString() })),
    };
  }

  /** Mark a NEW request decided, or say who got there first. */
  private async claim(id: string, data: Record<string, unknown>, actor: Actor): Promise<RequestRow> {
    const r = await this.row(id);
    const done = await this.prisma.serviceRequest.updateMany({ where: { id, status: 'NEW' }, data: { ...data, decidedBy: actor.name, decidedAt: new Date(), version: { increment: 1 } } });
    if (!done.count) throw new ConflictException(`Request ${id} has already been ${r.status === 'CANCELLED' ? 'cancelled by the requester' : `dealt with${r.decidedBy ? ` by ${r.decidedBy}` : ''}`}`);
    return r;
  }

  /** Copy the request onto the work order: what was reported, by whom, and the photos. */
  private async carryOver(r: RequestRow, jobId: string, actor: Actor, merged: boolean) {
    const contact = [r.requesterEmail, r.requesterPhone].filter(Boolean).join(', ');
    await this.jobs.addNote(jobId, `${merged ? 'Also reported' : 'Reported'} through the request portal (${r.id}) by ${r.requesterName}${contact ? ` (${contact})` : ''}${r.urgent ? ' — marked URGENT' : ''}: ${r.description}`.slice(0, 1000), actor);
    const moved = await this.attachments.moveRequestPhotos(r.id, jobId);
    if (moved) await this.jobs.addNote(jobId, `${moved} photo${moved === 1 ? '' : 's'} from the requester attached`, actor);
  }

  /** Accept: register a work order for it. */
  async accept(id: string, body: { assetId?: string; category?: string; site?: string; jobType?: string; component?: string }, actor: Actor) {
    const r = await this.claim(id, { status: 'ACCEPTED' }, actor);
    let jobId: string;
    try {
      const asset = body.assetId ?? r.assetId ?? undefined;
      const job = await this.jobs.register({
        ...(asset ? { assetId: asset } : {}),
        component: text(body.component, 120) || (asset ? '' : (r.place || r.description).slice(0, 120)),
        serialNo: asset ? '' : r.id,
        category: body.category || r.category || this.store.dict('category', true)[0]?.key || '',
        originUnit: `${r.requesterName} (request ${r.id})`.slice(0, 120),
        repairUnit: body.site || r.site || undefined,
        ...(body.jobType ? { jobType: body.jobType } : {}),
      } as Parameters<JobsService['register']>[0], actor);
      jobId = job.id;
    } catch (e) {
      // Leave it in the inbox for another try.
      await this.prisma.serviceRequest.update({ where: { id }, data: { status: 'NEW', decidedBy: null, decidedAt: null } });
      throw e;
    }
    await this.prisma.serviceRequest.update({ where: { id }, data: { jobId } });
    await this.carryOver(r, jobId, actor, false);
    await this.requests.email(r, 'accepted');
    return this.get(id);
  }

  /** The problem is already being dealt with: add this request to that work order. */
  async merge(id: string, body: { jobId?: string }, actor: Actor) {
    const job = body.jobId ? await this.store.job(body.jobId) : null;
    if (!job) throw new BadRequestException(`Choose an open work order${body.jobId ? ` (${body.jobId} not found)` : ''}`);
    if (job.archivedAt || this.store.isFinal('JOB', job.status)) throw new BadRequestException(`${job.id} is closed — accept the request as a new work order instead`);
    const r = await this.claim(id, { status: 'ACCEPTED', jobId: job.id, merged: true }, actor);
    await this.carryOver(r, job.id, actor, true);
    await this.requests.email(r, 'merged');
    // If that work is already done, the requester hears so straight away.
    await this.requests.jobChanged(job.id, job.status);
    return this.get(id);
  }

  /** Decline with a reason the requester sees; spam loses its photos and contact details. */
  async decline(id: string, body: { reason?: string; spam?: boolean }, actor: Actor) {
    const spam = body.spam === true;
    const reason = text(body.reason, 500) || (spam ? 'Spam' : '');
    if (!reason) throw new BadRequestException('Say why it is declined — the requester will see this');
    const r = await this.claim(id, { status: 'DECLINED', declineReason: reason, spam }, actor);
    if (spam) await this.purge(id, 'Removed as spam');
    else await this.requests.email(r, 'declined', { reason });
    return this.get(id);
  }

  /** Delete photos and blank contact details (spam, or a personal-data request). Old tracking links stop working. */
  private async purge(id: string, name: string) {
    await this.attachments.purgeRequestPhotos(id);
    await this.prisma.serviceRequest.update({
      where: { id },
      data: { requesterName: name, requesterEmail: '', requesterPhone: '', ipHash: '', trackSalt: newSalt(), version: { increment: 1 } },
    });
  }

  /** Erase a requester's contact details once the request has been decided. */
  async erase(id: string, actor: Actor) {
    const r = await this.row(id);
    if (r.status === 'NEW') throw new BadRequestException('Decide the request first — then the contact details can be erased');
    await this.purge(id, 'Erased');
    await this.prisma.requestMessage.updateMany({ where: { requestId: id, from: 'REQUESTER' }, data: { by: 'Erased' } });
    if (r.jobId) await this.jobs.addNote(r.jobId, `Requester contact details for ${r.id} erased`, actor).catch(() => undefined);
    return this.get(id);
  }

  /** Staff log a request for someone who phoned or walked in; they get a tracking link too. */
  async logForCaller(body: Record<string, unknown>, actor: Actor) {
    const { input, errors } = cleanInput(body);
    if (input.site && !this.store.has('site', input.site)) errors.push('Choose one of the sites listed');
    if (input.category && !this.store.has('category', input.category)) errors.push('Choose one of the types listed');
    const assetId = typeof body.assetId === 'string' && body.assetId ? body.assetId : null;
    const asset = assetId ? await this.prisma.asset.findUnique({ where: { id: assetId }, select: { id: true, site: true } }) : null;
    if (assetId && !asset) errors.push(`Asset ${assetId} not found`);
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: errors.length === 1 ? errors[0] : 'The request has problems', errors });
    const r = await this.requests.create({
      description: input.description, place: input.place, site: input.site || asset?.site || '', assetId: asset?.id ?? null, category: input.category,
      urgent: input.urgent, requesterName: input.name, requesterEmail: input.email, requesterPhone: input.phone, lang: input.lang, source: 'STAFF',
    });
    await this.requests.email(r, 'received');
    return this.get(r.id);
  }

  // ─── QR posters and stickers ───────────────────────────────────────────────

  /** 8 characters from 55 that cannot be confused (no 0/O, 1/l/I): about 2^46 codes. */
  private newCode(): string {
    const alphabet = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
  }

  private pointView(p: { code: string; label: string; site: string; assetId: string | null; active: boolean; createdBy: string; createdAt: Date }, counts: Map<string, number>, tags: Map<string, string>) {
    return {
      code: p.code, label: p.label, site: p.site, siteLabel: p.site ? this.store.label('site', p.site) : '', assetId: p.assetId,
      assetTag: p.assetId ? tags.get(p.assetId) ?? null : null, active: p.active, createdBy: p.createdBy, createdAt: p.createdAt.toISOString(),
      requests: counts.get(p.code) ?? 0,
    };
  }

  async points() {
    const rows = await this.prisma.requestPoint.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'desc' }], take: 2000 });
    const counts = new Map((await this.prisma.serviceRequest.groupBy({ by: ['pointCode'], where: { pointCode: { not: null } }, _count: { _all: true } })).map((c) => [c.pointCode!, c._count._all]));
    const assetIds = rows.map((r) => r.assetId).filter((a): a is string => !!a);
    const tags = new Map((await this.prisma.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, tag: true } })).map((a) => [a.id, a.tag]));
    return rows.map((r) => this.pointView(r, counts, tags));
  }

  /** A poster for a place: "Level 3 — east toilets". */
  async addPoint(body: { label?: string; site?: string }, actor: Actor) {
    const label = text(body.label, 80);
    if (label.length < 2) throw new BadRequestException('Name the place the poster is for');
    const site = text(body.site, 40);
    if (site && !this.store.has('site', site)) throw new BadRequestException(`Unknown site ${site}`);
    const p = await this.prisma.requestPoint.create({ data: { code: this.newCode(), label, site, createdBy: actor.name } });
    return this.pointView(p, new Map(), new Map());
  }

  /** Points for assets (one each; an existing active one is reused), for stickers. */
  async pointsForAssets(assetIds: unknown, actor: Actor) {
    const ids = Array.isArray(assetIds) ? [...new Set(assetIds.map(String))] : [];
    if (!ids.length) throw new BadRequestException('Choose at least one asset');
    if (ids.length > MAX_LABELS) throw new BadRequestException(`At most ${MAX_LABELS} at a time`);
    const assets = await this.prisma.asset.findMany({ where: { id: { in: ids } }, select: { id: true, tag: true, name: true, site: true } });
    const missing = ids.find((id) => !assets.some((a) => a.id === id));
    if (missing) throw new NotFoundException(`Asset ${missing} not found`);
    const existing = await this.prisma.requestPoint.findMany({ where: { assetId: { in: ids }, active: true } });
    const codes: string[] = [];
    for (const id of ids) {
      const have = existing.find((p) => p.assetId === id);
      if (have) { codes.push(have.code); continue; }
      const a = assets.find((x) => x.id === id)!;
      const p = await this.prisma.requestPoint.create({ data: { code: this.newCode(), label: `${a.tag} · ${a.name}`.slice(0, 80), site: a.site, assetId: a.id, createdBy: actor.name } });
      codes.push(p.code);
    }
    return { codes };
  }

  async updatePoint(code: string, body: { label?: string; active?: boolean }) {
    const p = await this.prisma.requestPoint.findUnique({ where: { code } });
    if (!p) throw new NotFoundException(`Poster ${code} not found`);
    const label = body.label !== undefined ? text(body.label, 80) : p.label;
    if (label.length < 2) throw new BadRequestException('Name the place the poster is for');
    await this.prisma.requestPoint.update({ where: { code }, data: { label, ...(typeof body.active === 'boolean' ? { active: body.active } : {}) } });
    return (await this.points()).find((x) => x.code === code);
  }

  /** A4 posters (one per page) or a sheet of stickers, for the codes asked for. */
  async posters(codes: string[], format: string, webBase: string): Promise<{ filename: string; pdf: Buffer }> {
    const unique = [...new Set(codes.map((c) => c.trim()).filter(Boolean))];
    if (!unique.length) throw new BadRequestException('Choose at least one poster');
    if (unique.length > MAX_LABELS) throw new BadRequestException(`At most ${MAX_LABELS} per print run`);
    const rows = await this.prisma.requestPoint.findMany({ where: { code: { in: unique } } });
    const missing = unique.find((c) => !rows.some((r) => r.code === c));
    if (missing) throw new NotFoundException(`Poster ${missing} not found`);
    const inactive = rows.find((r) => !r.active);
    if (inactive) throw new BadRequestException(`${inactive.label} is switched off — switch it on before printing`);
    const points = unique.map((c) => rows.find((r) => r.code === c)!).map((r) => ({ code: r.code, label: r.label, siteLabel: r.site ? this.store.label('site', r.site) : '' }));
    const org = this.settings.company.name || currentTenant().name;
    if (format === 'stickers') return { filename: `request-stickers-${points.length}.pdf`, pdf: await stickerPdf(points, webBase) };
    if (format && format !== 'poster') throw new BadRequestException('format must be poster or stickers');
    return { filename: points.length === 1 ? `request-poster-${points[0].code}.pdf` : `request-posters-${points.length}.pdf`, pdf: await posterPdf(points, org, webBase, this.settings.logo) };
  }

  /** A message to the requester, shown on their tracking page and emailed. */
  async message(id: string, body: unknown, actor: Actor) {
    const r = await this.row(id);
    if (r.status === 'CANCELLED' || (r.status === 'DECLINED' && r.spam)) throw new BadRequestException('This request is closed');
    const msg = text(body, 1000);
    if (msg.length < 2) throw new BadRequestException('Write a message');
    await this.prisma.requestMessage.create({ data: { requestId: id, from: 'TEAM', by: actor.name, body: msg } });
    if (r.jobId) await this.jobs.addNote(r.jobId, `Message to ${r.requesterName} (${r.id}): ${msg}`.slice(0, 1000), actor).catch(() => undefined);
    await this.requests.email(r, 'message');
    return this.get(id);
  }
}
