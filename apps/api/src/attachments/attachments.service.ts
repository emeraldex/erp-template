import { BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { AuditEntry, Role } from '../common/types';
import { checkFileType, cleanFilename, decodeUploadName } from './file-types';
import type { ObjectStorage } from './storage';

export const STORAGE = Symbol('STORAGE');
export const ENTITIES = ['JOB', 'DEMAND', 'OV', 'INVOICE', 'PARTNER', 'FOD'] as const;
export type Entity = (typeof ENTITIES)[number];

export const maxBytes = () => Number(process.env.ATTACHMENT_MAX_MB ?? 20) * 1024 * 1024;

export interface AttachmentView {
  id: string; entity: Entity; entityId: string; formNo?: string; filename: string;
  contentType: string; sizeBytes: number; sha256: string; uploadedBy: string; uploadedAt: string;
}

type Audited = { audit: AuditEntry[]; status?: string };

const view = (a: {
  id: string; entity: string; entityId: string; formNo: string | null; filename: string; contentType: string;
  sizeBytes: number; sha256: string; uploadedBy: string; uploadedAt: Date;
}): AttachmentView => ({
  id: a.id, entity: a.entity as Entity, entityId: a.entityId, ...(a.formNo ? { formNo: a.formNo } : {}),
  filename: a.filename, contentType: a.contentType, sizeBytes: a.sizeBytes, sha256: a.sha256,
  uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt.toISOString(),
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
  ): Promise<AttachmentView> {
    const e = this.parseEntity(entity);
    if (!file?.buffer?.length) throw new BadRequestException('Attach a non-empty file in the "file" field');
    if (file.size > maxBytes()) throw new PayloadTooLargeException(`Files are limited to ${maxBytes() / 1024 / 1024} MB`);
    const filename = cleanFilename(decodeUploadName(file.originalname));
    const problem = checkFileType(filename, file.mimetype, file.buffer);
    if (problem) throw new BadRequestException(problem);
    const form = formNo?.trim().slice(0, 20) || undefined;
    if (form && !/^[A-Za-z0-9 ./-]+$/.test(form)) throw new BadRequestException('formNo may contain letters, digits, space, . / -');

    const rec = await this.record(e, entityId);
    if (!rec) throw new NotFoundException(`${e} ${entityId} not found`);
    if (e === 'JOB' && rec.status === 'CLOSED') throw new BadRequestException('Job is closed — editing locked (QP.44 stage 10)');

    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const id = randomUUID();
    const storageKey = `${e.toLowerCase()}/${sha256.slice(0, 2)}/${id}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const row = await this.prisma.attachment.create({
      data: { id, entity: e, entityId, formNo: form ?? null, filename, contentType: file.mimetype, sizeBytes: file.size, sha256, storageKey, uploadedBy: actor.name },
    });
    rec.audit.push(this.store.audit(actor.name, actor.role, `Attachment added: ${filename}${form ? ` (${form})` : ''}`, {
      attachmentId: id, sha256: sha256.slice(0, 16), ...(form ? { formNo: form } : {}),
    }));
    await this.store.save(rec);
    return view(row);
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
