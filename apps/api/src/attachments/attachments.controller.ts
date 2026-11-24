import {
  Body, Controller, Get, Param, Post, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { AttachmentsService, maxBytes } from './attachments.service';

/** RFC 6266/5987 Content-Disposition that survives non-ASCII names. */
function disposition(kind: 'attachment' | 'inline', filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

@Controller('attachments')
@UseGuards(AuthGuard)
export class AttachmentsController {
  constructor(private readonly svc: AttachmentsService) {}

  @Get('file/:id')
  async download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { meta, body } = await this.svc.download(id);
    // Always a download, never rendered in the app's origin, and never sniffed.
    res.set({
      'Content-Type': meta.contentType,
      'Content-Disposition': disposition('attachment', meta.filename),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
      'X-Checksum-SHA256': meta.sha256,
    });
    return new StreamableFile(body);
  }

  @Get('file/:id/verify')
  @Roles('QUALITY', 'MM')
  verify(@Param('id') id: string) {
    return this.svc.verify(id);
  }

  @Get(':entity/:entityId')
  list(@Param('entity') entity: string, @Param('entityId') entityId: string) {
    return this.svc.list(entity, entityId);
  }

  @Post(':entity/:entityId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxBytes() + 1, files: 1, fields: 5 } }))
  upload(
    @Param('entity') entity: string,
    @Param('entityId') entityId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('formNo') formNo: string | undefined,
    @Req() req: { user: AuthUser },
  ) {
    return this.svc.upload(entity, entityId, file, formNo, { name: req.user.name, role: req.user.role });
  }
}
