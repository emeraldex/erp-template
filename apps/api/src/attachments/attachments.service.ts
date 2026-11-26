import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { AuditEntry, Role } from '../common/types';
import { checkFileType, cleanFilename, decodeUploadName } from './file-types';
import type { ObjectStorage } from './storage';
import { currentTenant } from '../tenancy/tenant';

export const STORAGE = Symbol('STORAGE');
export const ENTITIES = ['JOB', 'DEMAND', 'OV', 'INVOICE', 'PARTNER', 'FOD', 'REQUEST'] as const;
export type Entity = (typeof ENTITIES)[number];

export const maxBytes = () => Number(process.env.ATTACHMENT_MAX_MB || 20) * 1024 * 1024;

export interface AttachmentView {
  id: string; entity: Entity; entityId: string; formNo?: string; filename: string;
  contentType: string; sizeBytes: number; sha256: string; uploadedBy: string; uploadedAt: string;
  kind: 'file' | 'photo' | 'signature'; caption?: string; signedBy?: string;
}

export const ATTACHMENT_KINDS = ['file', 'photo', 'signature'] as const;
const SIGNATURE_MAX_BYTES = 200 * 1024;
export const REQUEST_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

type Audited = { audit: AuditEntry[]; status?: string };

const view = (a: {
  id: string; entity: string; entityId: string; formNo: string | null; filename: string; contentType: string;
  sizeBytes: number; sha256: string; uploadedBy: string; uploadedAt: Date;
  kind?: string; caption?: string | null; signedBy?: string | null;
}): AttachmentView => ({
  id: a.id, entity: a.entity as Entity, entityId: a.entityId, ...(a.formNo ? { formNo: a.formNo } : {}),
  filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes, sha256: a.sha256,
  uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt.toISOString(),
  kind: (a.kind ?? 'file') as AttachmentView['kind'],
  ...(a.caption ? { caption: a.caption } : {}), ...(a.signedBy ? { signedBy: a.signedBy } : {}),
});

/**
 * Files attached to records. Attachments are evidence (signed forms, release
 * certificates), so there is deliberately no delete: a wrong file is
 * superseded by uploading the right one, and both stay on the audit trail.
 */
@Injectable()
export class AttachmentsService {
  private readonly log = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: StoreService,
    @Inject(STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private parseEntity(entity: string): Entity {
    const e = entity.toUpperCase() as Entity;
    if (!ENTITIES.includes(e)) throw new BadRequestException(`Attachments go on ${ENTITIES.join(', ')} records`);
    return e;
  }

  private async record(entity: Entity, id: string): Promise<Audited | null> {
    switch (entity) {
      case 'JOB': return this.store.job(id);
      case 'DEMAND': return this.store.demand(id);
      case 'OV': return this.store.ovRepair(id);
      case 'INVOICE': return this.store.invoice(id);
      case 'PARTNER': return this.store.partner(id);
      case 'FOD': return this.store.fodIncident(id);
      // Photos reach a request only through the public form; staff attach to the work order.
      case 'REQUEST': return null;
    }
  }

  async list(entity: string, entityId: string): Promise<AttachmentView[]> {
    const e = this.parseEntity(entity);
    const rows = await this.prisma.attachment.findMany({ where: { entity: e, entityId }, orderBy: { uploadedAt: 'asc' } });
    return rows.map(view);
  }

  async upload(
    entity: string, entityId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
    formNo: string | undefined,
    actor: { name: string; role: Role },
    extra: { kind?: string; caption?: string; signedBy?: string } = {},
  ): Promise<AttachmentView> {
    const e = this.parseEntity(entity);
    if (!file?.buffer?.length) throw new BadRequestException('Attach a non-empty file in the "file" field');
    if (file.size > maxBytes()) throw new PayloadTooLargeException(`Files are limited to ${maxBytes() / 1024 / 1024} MB`);
    const filename = cleanFilename(decodeUploadName(file.originalname));
    const problem = checkFileType(filename, file.mimetype, file.buffer);
    if (problem) throw new BadRequestException(problem);
    const form = formNo?.trim().slice(0, 20) || undefined;
    if (form && !/^[A-Za-z0-9 ./-]+$/.test(form)) throw new BadRequestException('formNo may contain letters, digits, space, . / -');
    // Photos and signatures are proof of work that steps can ask for.
    const kind = (extra.kind?.trim() || 'file') as AttachmentView['kind'];
    if (!ATTACHMENT_KINDS.includes(kind)) throw new BadRequestException(`kind must be one of ${ATTACHMENT_KINDS.join(', ')}`);
    const caption = extra.caption?.trim().slice(0, 200) || undefined;
    const signedBy = extra.signedBy?.trim() || undefined;
    if (kind === 'photo' && !file.mimetype.startsWith('image/')) throw new BadRequestException('A photo must be an image');
    if (kind === 'signature') {
      if (file.mimetype !== 'image/png') throw new BadRequestException('A signature must be a PNG image');
      if (file.size > SIGNATURE_MAX_BYTES) throw new BadRequestException('A signature image must be under 200 KB');
      if (!signedBy || signedBy.length < 2 || signedBy.length > 80) throw new BadRequestException('Give the name of the person signing (2–80 characters)');
    } else if (signedBy) throw new BadRequestException('Only signatures carry a signer');

    const rec = await this.record(e, entityId);
    if (!rec) throw new NotFoundException(`${e} ${entityId} not found`);
    if (e === 'JOB' && rec.status && this.store.isFinal('JOB', rec.status)) throw new BadRequestException(`Job is closed — editing locked${this.store.procedureRef(' (QP.44 stage 10)')}`);

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const id = randomUUID();
    const storageKey = `${currentTenant().id}/${e.toLowerCase()}/${sha256.slice(0, 2)}/${id}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const row = await this.prisma.attachment.create({
      data: {
        id, entity: e, entityId, formNo: form ?? null, filename, contentType: file.mimetype, sizeBytes: file.size, sha256, storageKey,
        uploadedBy: actor.name, kind, caption: caption ?? null, signedBy: signedBy ?? null,
      },
    });
    const what = kind === 'signature' ? `Signature added (signed by ${signedBy})` : kind === 'photo' ? `Photo added: ${caption ?? filename}` : `Attachment added: ${filename}${form ? ` (${form})` : ''}`;
    rec.audit.push(this.store.audit(actor.name, actor.role, what, {
      attachmentId: id, sha256: sha256.slice(0, 16), ...(form ? { formNo: form } : {}),
    }));
    await this.store.save(rec);
    return view(row);
  }

  /**
   * A photo sent with a portal request. Only JPEG, PNG or WebP, recognised by
   * content, at most 5 MB. Not audited: the request is not a workflow record.
   */
  /** The type of an acceptable request photo, judged by its bytes; throws otherwise. */
  checkRequestPhoto(file: { buffer: Buffer; size: number }): 'image/jpeg' | 'image/png' | 'image/webp' {
    if (!file.buffer?.length) throw new BadRequestException('A photo is empty');
    if (file.size > REQUEST_PHOTO_MAX_BYTES) throw new PayloadTooLargeException('Photos are limited to 5 MB each');
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as const;
    const type = (Object.keys(ext) as (keyof typeof ext)[]).find((t) => !checkFileType(`x.${ext[t]}`, t, file.buffer));
    if (!type) throw new BadRequestException('Photos must be JPEG, PNG or WebP images');
    return type;
  }

  async storeRequestPhoto(requestId: string, file: { originalname: string; mimetype: string; buffer: Buffer; size: number }, uploadedBy: string): Promise<string> {
    const type = this.checkRequestPhoto(file);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const id = randomUUID();
    const storageKey = `${currentTenant().id}/request/${sha256.slice(0, 2)}/${id}`;
    await this.storage.put(storageKey, file.buffer, type);
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[type];
    await this.prisma.attachment.create({
      data: {
        id, entity: 'REQUEST', entityId: requestId, filename: `${requestId}-photo-${id.slice(0, 6)}.${ext}`, contentType: type, sizeBytes: file.size, sha256, storageKey,
        uploadedBy, kind: 'photo', caption: 'Photo from the requester',
      },
    });
    return id;
  }

  /** Move a request's photos onto the work order it became (or joined). */
  async moveRequestPhotos(requestId: string, jobId: string): Promise<number> {
    const res = await this.prisma.attachment.updateMany({ where: { entity: 'REQUEST', entityId: requestId }, data: { entity: 'JOB', entityId: jobId } });
    return res.count;
  }

  /** Delete a request's photos for good (declined as spam). */
  async purgeRequestPhotos(requestId: string): Promise<number> {
    const rows = await this.prisma.attachment.findMany({ where: { entity: 'REQUEST', entityId: requestId }, select: { id: true, storageKey: true } });
    for (const r of rows) await this.storage.delete(r.storageKey).catch((e) => this.log.error(`Could not delete ${r.storageKey}: ${(e as Error).message}`));
    await this.prisma.attachment.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
    return rows.length;
  }

  private async find(id: string) {
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new NotFoundException('Attachment not found');
    const row = await this.prisma.attachment.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Attachment not found');
    return row;
  }

  /** Download, refusing to serve bytes whose hash no longer matches the record. */
  async download(id: string): Promise<{ meta: AttachmentView; body: Buffer }> {
    const row = await this.find(id);
    const body = await this.storage.get(row.storageKey);
    const actual = createHash('sha256').update(body).digest('hex');
    if (actual !== row.sha256) {
      this.log.error(`Integrity check failed for attachment ${id}: expected ${row.sha256}, got ${actual}`);
      throw new InternalServerErrorException('Stored file failed its integrity check — contact an administrator');
    }
    return { meta: view(row), body };
  }

  async verify(id: string): Promise<{ id: string; ok: boolean; sha256: string; actual: string }> {
    const row = await this.find(id);
    let actual = 'missing';
    try {
      actual = createHash('sha256').update(await this.storage.get(row.storageKey)).digest('hex');
    } catch (err) {
      this.log.error(`Attachment ${id} could not be read: ${(err as Error).message}`);
    }
    return { id, ok: actual === row.sha256, sha256: row.sha256, actual };
  }
}
