import { Controller, Get, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { webBaseFor } from '../auth/web-origin';
import { currentTenant } from '../tenancy/tenant';
import { TenantRegistry } from '../tenancy/tenant-registry';
import { JobCardService } from './job-card.service';

@Controller('job-cards')
@UseGuards(AuthGuard)
export class JobCardsController {
  constructor(private readonly cards: JobCardService, private readonly registry: TenantRegistry) {}

  /** Where a scanned job-card QR code should open the ERP: the page that asked, if known. */
  private webBase(req: Request): string {
    return webBaseFor(req, this.registry, currentTenant());
  }

  /** GET /job-cards?ids=PS-…,PS-… — printable A6 tags with a QR code to the job. */
  @Get()
  async jobCards(@Query('ids') ids: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { filename, pdf } = await this.cards.cards((ids ?? '').split(','), this.webBase(req));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(pdf);
  }

}
