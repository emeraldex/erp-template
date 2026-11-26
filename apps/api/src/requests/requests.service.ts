import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { Mailer } from '../notifications/mailer';
import { SettingsService } from '../settings/settings.service';
import { authConfig } from '../auth/auth.config';
import { configuredOrigins } from '../auth/web-origin';
import { currentTenant } from '../tenancy/tenant';
import type { Capability } from '../packs/types';
import { JobDoneHook } from './job-hook';
import { checkToken, cleanInput, langOf, Lang, makeToken, newSalt, requestEmail, STAGE_LABEL, stageOf, tokenId } from './logic';

export type RequestRow = Prisma.ServiceRequestGetPayload<{ include: { messages: true } }>;
type Upload = { originalname: string; mimetype: string; buffer: Buffer; size: number };

export const MAX_PHOTOS = 3;
export const MAX_NEW_REQUESTS = 500;
export const MAX_PER_EMAIL_PER_HOUR = 3;
export const MAX_REQUESTER_MESSAGES_PER_HOUR = 10;
export const MAX_REQUESTER_MESSAGES = 50;

/** 404 for everything public while the portal is off, so it cannot be probed. */
const notFound = () => new NotFoundException('Not found');

/**
 * The request portal: what the public side does (send, track, reply, rate,
 * cancel) and what staff screens share (links, emails, notifications). Triage
 * lives in RequestsInboxService, which can also reach work orders.
 */
@Injectable()
export class RequestsService implements JobDoneHook {
  private readonly log = new Logger(RequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    readonly store: StoreService,
    private readonly settings: SettingsService,
    private readonly mailer: Mailer,
    private readonly attachments: AttachmentsService,
  ) {}

  // ─── shared ────────────────────────────────────────────────────────────────

  get enabled(): boolean {
    return !!this.settings.modules.requests;
  }

  private org(): string {
    return this.settings.company.name || currentTenant().name;
  }

  token(r: { id: string; trackSalt: string }): string {
    return makeToken(authConfig.secret, currentTenant().id, r.id, r.trackSalt);
  }

  /** The web address of the tracking page; the token travels in the fragment, so it never reaches server logs. */
  trackLink(r: { id: string; trackSalt: string }, webBase?: string): string {
    const tenant = currentTenant();
    const base = (webBase ?? configuredOrigins()[0] ?? (tenant.hosts[0] ? `https://${tenant.hosts[0]}` : 'http://localhost:3000')).replace(/\/+$/, '');
    return `${base}/r/track#${this.token(r)}`;
  }

  async email(r: { id: string; trackSalt: string; requesterEmail: string; lang: string }, kind: Parameters<typeof requestEmail>[0], extra: { reason?: string; webBase?: string } = {}): Promise<boolean> {
    if (!r.requesterEmail || !this.mailer.enabled) return false;
    const m = requestEmail(kind, langOf(r.lang), { org: this.org(), id: r.id, link: this.trackLink(r, extra.webBase), reason: extra.reason });
    return this.mailer.send({ to: r.requesterEmail, subject: m.subject, text: m.text });
  }

  /** Tell everyone whose role holds a permission (and anyone else named). */
  async notifyHolders(capability: Capability, n: { kind: string; title: string; body: string; ref: string }, alsoUserIds: string[] = []): Promise<void> {
    const roles = this.store.rolesWith(capability);
    const people = await this.prisma.user.findMany({ where: { deactivatedAt: null, OR: [{ role: { in: roles } }, { id: { in: alsoUserIds } }] }, select: { id: true } });
    for (const p of people) await this.store.notify(p.id, n);
  }

  /** A keyed hash of the sender's address — enough to spot abuse, useless to anyone else. */
  ipHash(ip: string | undefined): string {
    return ip ? createHmac('sha256', authConfig.secret).update(`ip:${ip}`).digest('base64url').slice(0, 16) : '';
  }

  async nextId(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `REQ-${year}-`;
    const last = await this.prisma.serviceRequest.findFirst({ where: { id: { startsWith: prefix } }, orderBy: { id: 'desc' }, select: { id: true } });
    const n = last ? Number(last.id.slice(prefix.length)) + 1 : 1;
    return `${prefix}${String(n).padStart(4, '0')}`;
  }

  /** Create a request, retrying if two arrive at once and pick the same number. */
  async create(data: Omit<Prisma.ServiceRequestUncheckedCreateInput, 'id' | 'trackSalt'>) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.serviceRequest.create({ data: { ...data, id: await this.nextId(), trackSalt: newSalt() } });
      } catch (e) {
        if (attempt < 4 && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  // ─── the public side ───────────────────────────────────────────────────────

  private assertOpen(): void {
    if (!this.enabled || !this.settings.portal.open) throw notFound();
  }

  /** A poster's place or asset, if the code names an active one. */
  private async point(code: unknown) {
    if (typeof code !== 'string' || !/^[A-Za-z0-9]{8}$/.test(code)) return null;
    const p = await this.prisma.requestPoint.findUnique({ where: { code } });
    if (!p?.active) return null;
    const asset = p.assetId ? await this.prisma.asset.findUnique({ where: { id: p.assetId }, select: { id: true, tag: true, name: true, site: true, status: true } }) : null;
    return { ...p, asset };
  }

  /** What the public form needs to show. */
  async portalInfo(pointCode?: string) {
    if (!this.enabled) throw notFound();
    const portal = this.settings.portal;
    const p = await this.point(pointCode);
    const entry = (e: { key: string; label: string; labelMs: string }) => ({ key: e.key, label: e.label, labelMs: e.labelMs || e.label });
    return {
      org: this.org(),
      open: portal.open,
      intro: portal.intro, introMs: portal.introMs,
      needsCode: !!portal.accessCode && !p,
      sites: this.store.dict('site', true).map(entry),
      categories: portal.askCategory ? this.store.dict('category', true).map(entry) : [],
      point: p ? {
        code: p.code, label: p.label, site: p.site, siteLabel: p.site ? this.store.label('site', p.site) : '',
        asset: p.asset ? { tag: p.asset.tag, name: p.asset.name } : null,
      } : null,
      maxPhotos: MAX_PHOTOS,
    };
  }

  private codeMatches(given: unknown): boolean {
    const want = this.settings.portal.accessCode;
    if (!want) return true;
    const a = Buffer.from(String(given ?? '').trim().toLowerCase());
    const b = Buffer.from(want.toLowerCase());
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Someone reports a problem. Returns the reference and the private tracking token. */
  async submit(body: Record<string, unknown>, files: Upload[], meta: { ip?: string; webBase: string }): Promise<{ id: string | null; track: string | null }> {
    this.assertOpen();
    // People leave the hidden "website" field empty; automated form-fillers do not.
    if (typeof body.website === 'string' && body.website.trim()) return { id: null, track: null };
    const p = await this.point(body.p);
    if (!p && !this.codeMatches(body.accessCode)) throw new BadRequestException('The access code is not right — it is on the notice where you found this page');
    const { input, errors } = cleanInput(body);
    const sites = this.store.dict('site', true);
    const site = p?.site || p?.asset?.site || input.site || (sites.length === 1 ? sites[0].key : '');
    if (!p && input.site && !this.store.has('site', input.site)) errors.push('Choose one of the sites listed');
    if (!p && sites.length > 1 && !site) errors.push('Choose the site');
    if (input.category && !this.store.has('category', input.category)) errors.push('Choose one of the types listed');
    if (files.length > MAX_PHOTOS) errors.push(`At most ${MAX_PHOTOS} photos`);
    else for (const f of files) {
      try { this.attachments.checkRequestPhoto(f); } catch (e) { errors.push((e as Error).message); break; }
    }
    if (errors.length) throw new BadRequestException({ statusCode: 400, message: errors.length === 1 ? errors[0] : 'Please check the form', errors });

    if ((await this.prisma.serviceRequest.count({ where: { status: 'NEW' } })) >= MAX_NEW_REQUESTS) {
      throw new HttpException('The help desk is very busy right now — please try again later or call them', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (input.email && (await this.prisma.serviceRequest.count({ where: { requesterEmail: input.email, createdAt: { gt: new Date(Date.now() - 3_600_000) } } })) >= MAX_PER_EMAIL_PER_HOUR) {
      throw new HttpException('You have sent several requests in the last hour — the team has them. Follow them with the links you were given.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const r = await this.create({
      description: input.description, place: p ? p.label : input.place, site, assetId: p?.asset?.id ?? null, pointCode: p?.code ?? null,
      category: input.category, urgent: input.urgent, requesterName: input.name, requesterEmail: input.email, requesterPhone: input.phone,
      lang: input.lang, source: p ? 'POSTER' : 'PORTAL', ipHash: this.ipHash(meta.ip),
    });
    for (const f of files) await this.attachments.storeRequestPhoto(r.id, f, input.name);
    await this.notifyHolders('requests.manage', {
      kind: input.urgent ? 'request.urgent' : 'request.new',
      title: `${input.urgent ? 'URGENT request' : 'New request'} ${r.id}${r.place ? ` — ${r.place}` : site ? ` — ${this.store.label('site', site)}` : ''}`,
      body: input.description.slice(0, 160), ref: `REQUEST:${r.id}`,
    });
    await this.email(r, 'received', { webBase: meta.webBase });
    return { id: r.id, track: this.token(r) };
  }

  /** The request a tracking token names, or 404 — a wrong token and an unknown request look the same. */
  async byToken(token: unknown): Promise<RequestRow> {
    if (!this.enabled) throw notFound();
    const id = tokenId(token);
    if (!id) throw notFound();
    const r = await this.prisma.serviceRequest.findUnique({ where: { id }, include: { messages: { orderBy: { id: 'asc' } } } });
    if (!r || !checkToken(authConfig.secret, currentTenant().id, token as string, r.trackSalt)) throw notFound();
    return r;
  }

  private async jobPhase(jobId: string | null) {
    if (!jobId) return null;
    const job = await this.prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
    return job ? this.store.phaseOf('JOB', job.status) ?? null : null;
  }

  /** What the requester sees. Never staff names, internal statuses, costs or the photos themselves. */
  async requesterView(r: RequestRow) {
    const stage = stageOf(r.status, await this.jobPhase(r.jobId));
    const photos = await this.prisma.attachment.count({ where: { OR: [{ entity: 'REQUEST', entityId: r.id }, ...(r.jobId ? [{ entity: 'JOB', entityId: r.jobId, filename: { startsWith: `${r.id}-` } }] : [])] } });
    const asset = r.assetId ? await this.prisma.asset.findUnique({ where: { id: r.assetId }, select: { tag: true, name: true } }) : null;
    const org = this.org();
    return {
      id: r.id, org, createdAt: r.createdAt.toISOString(), lang: r.lang as Lang,
      description: r.description, place: r.place, site: r.site ? this.store.label('site', r.site) : '',
      asset: asset ? `${asset.tag} · ${asset.name}` : null,
      category: r.category ? this.store.label('category', r.category) : '', urgent: r.urgent, photos,
      stage, stageLabel: STAGE_LABEL[stage],
      declineReason: r.status === 'DECLINED' ? r.declineReason : '',
      name: r.requesterName,
      messages: r.messages.map((m) => ({ from: m.from as 'TEAM' | 'REQUESTER', by: m.from === 'TEAM' ? org : r.requesterName, body: m.body, at: m.at.toISOString() })),
      canCancel: r.status === 'NEW',
      canMessage: r.status === 'NEW' || (r.status === 'ACCEPTED' && stage !== 'done'),
      canRate: stage === 'done' && r.rating === null,
      rating: r.rating, ratingComment: r.ratingComment,
    };
  }

  async track(token: unknown) {
    return this.requesterView(await this.byToken(token));
  }

  /** The requester adds information or answers a question. */
  async requesterMessage(token: unknown, body: unknown) {
    const r = await this.byToken(token);
    const view = await this.requesterView(r);
    if (!view.canMessage) throw new BadRequestException(view.stage === 'done' ? 'This request is done — rate it, or send a new request if something is still wrong' : 'This request is closed');
    const text = typeof body === 'string' ? body.trim().slice(0, 1000) : '';
    if (text.length < 2) throw new BadRequestException('Write a message');
    const mine = r.messages.filter((m) => m.from === 'REQUESTER');
    if (mine.length >= MAX_REQUESTER_MESSAGES) throw new HttpException('This request has reached its message limit — please call the help desk', HttpStatus.TOO_MANY_REQUESTS);
    if (mine.filter((m) => m.at.getTime() > Date.now() - 3_600_000).length >= MAX_REQUESTER_MESSAGES_PER_HOUR) {
      throw new HttpException('You have sent several messages in the last hour — please wait for a reply', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.prisma.requestMessage.create({ data: { requestId: r.id, from: 'REQUESTER', by: r.requesterName, body: text } });
    const assignee = r.jobId ? (await this.prisma.job.findUnique({ where: { id: r.jobId }, select: { assigneeId: true } }))?.assigneeId : null;
    await this.notifyHolders('requests.manage', {
      kind: 'request.reply', title: `Reply on ${r.id}${r.jobId ? ` (${r.jobId})` : ''} from ${r.requesterName}`, body: text.slice(0, 160),
      ref: r.jobId ? `JOB:${r.jobId}` : `REQUEST:${r.id}`,
    }, assignee ? [assignee] : []);
    return this.track(token);
  }

  /** One rating per request, once the work is done. */
  async rate(token: unknown, rating: unknown, comment: unknown) {
    const r = await this.byToken(token);
    const view = await this.requesterView(r);
    const n = Number(rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new BadRequestException('Choose from 1 to 5 stars');
    if (!view.canRate) throw new BadRequestException(r.rating !== null ? 'You have already rated this request — thank you' : 'You can rate the work once it is done');
    const text = typeof comment === 'string' ? comment.trim().slice(0, 500) : '';
    const done = await this.prisma.serviceRequest.updateMany({ where: { id: r.id, rating: null }, data: { rating: n, ratingComment: text, ratedAt: new Date(), version: { increment: 1 } } });
    if (!done.count) throw new ConflictException('You have already rated this request — thank you');
    if (n <= 2) {
      await this.notifyHolders('requests.manage', {
        kind: 'request.lowRating', title: `${n}★ rating on ${r.id}${r.jobId ? ` (${r.jobId})` : ''}`, body: text.slice(0, 160) || 'No comment given',
        ref: r.jobId ? `JOB:${r.jobId}` : `REQUEST:${r.id}`,
      });
    }
    return this.track(token);
  }

  /** The requester withdraws a request nobody has looked at yet. */
  async cancel(token: unknown) {
    const r = await this.byToken(token);
    const done = await this.prisma.serviceRequest.updateMany({ where: { id: r.id, status: 'NEW' }, data: { status: 'CANCELLED', decidedAt: new Date(), decidedBy: r.requesterName, version: { increment: 1 } } });
    if (!done.count) throw new BadRequestException('This request has already been dealt with and can no longer be cancelled');
    return this.track(token);
  }

  // ─── work orders ───────────────────────────────────────────────────────────

  /** Who asked for a work order, how to reach them, what was said and how they rated it. */
  async forJob(jobId: string) {
    if (!this.enabled) return [];
    const rows = await this.prisma.serviceRequest.findMany({ where: { jobId }, include: { messages: { orderBy: { id: 'asc' } } }, orderBy: { createdAt: 'asc' } });
    return rows.map((r) => ({
      id: r.id, createdAt: r.createdAt.toISOString(), merged: r.merged, requesterName: r.requesterName, requesterEmail: r.requesterEmail,
      requesterPhone: r.requesterPhone, urgent: r.urgent, description: r.description, rating: r.rating, ratingComment: r.ratingComment,
      ratedAt: r.ratedAt?.toISOString() ?? null, doneNotified: !!r.doneNotifiedAt,
      messages: r.messages.map((m) => ({ from: m.from, by: m.by, body: m.body, at: m.at.toISOString() })),
    }));
  }

  /** Remind the help desk, once, about requests still new after the organisation's triage time. */
  async remindStale(now = Date.now()): Promise<number> {
    const hours = this.settings.portal.triageHours;
    if (!this.enabled || !hours) return 0;
    const stale = await this.prisma.serviceRequest.findMany({
      where: { status: 'NEW', remindedAt: null, createdAt: { lt: new Date(now - hours * 3_600_000) } }, orderBy: { createdAt: 'asc' }, take: 200,
    });
    let sent = 0;
    for (const r of stale) {
      const claimed = await this.prisma.serviceRequest.updateMany({ where: { id: r.id, remindedAt: null }, data: { remindedAt: new Date(now) } });
      if (!claimed.count) continue;
      await this.notifyHolders('requests.manage', {
        kind: 'request.waiting', title: `${r.id} has been waiting more than ${hours} h`, body: r.description.slice(0, 160), ref: `REQUEST:${r.id}`,
      });
      sent += 1;
    }
    return sent;
  }

  /**
   * A work order changed status. When it reaches a done phase, tell each
   * requester linked to it — once — and invite a rating.
   */
  async jobChanged(jobId: string, status: string): Promise<void> {
    if (!this.enabled) return;
    const phase = this.store.phaseOf('JOB', status);
    if (phase !== 'done' && phase !== 'closed') return;
    const rows = await this.prisma.serviceRequest.findMany({ where: { jobId, status: 'ACCEPTED', doneNotifiedAt: null } });
    for (const r of rows) {
      const claimed = await this.prisma.serviceRequest.updateMany({ where: { id: r.id, doneNotifiedAt: null }, data: { doneNotifiedAt: new Date() } });
      if (claimed.count) await this.email(r, 'done');
    }
  }
}
