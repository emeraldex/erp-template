import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { webBaseFor } from '../auth/web-origin';
import { currentTenant } from '../tenancy/tenant';
import { TenantRegistry } from '../tenancy/tenant-registry';
import { assetLabels } from './labels';
import { ClientOpInterceptor } from '../common/client-ops';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { InModule, Requires } from '../auth/roles.decorator';
import { AssetInput, AssetsService } from './assets.service';
import { PmService, ScheduleInput } from './pm.service';
import { ReliabilityService } from './reliability.service';
import { AssetImportService } from './import.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadedFile } from '@nestjs/common';

type Req = { user: AuthUser };
const who = (req: Req) => ({ name: req.user.name, role: req.user.role });

/** The asset register and meters. Anyone signed in may look; changing it needs assets.manage. */
@Controller('assets')
@UseGuards(AuthGuard)
@InModule('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService, private readonly registry: TenantRegistry, private readonly reliability: ReliabilityService, private readonly importer: AssetImportService) {}

  @Get()
  list(@Query('site') site?: string, @Query('type') type?: string, @Query('status') status?: string, @Query('parentId') parentId?: string, @Query('q') search?: string) {
    return this.assets.list({ site, type, status, parentId, search });
  }

  /** GET /assets/labels?ids=AST-…,AST-… — A4 sheets of QR labels (2 × 5). */
  @Get('labels')
  async labels(@Query('ids') ids: string | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const assets = await this.assets.forLabels((ids ?? '').split(','));
    const { filename, pdf } = await assetLabels(assets, webBaseFor(req, this.registry, currentTenant()));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(pdf);
  }

  /** POST /assets/import[?dryRun=1] — a CSV file ("file") of assets; checked in full, imported all or nothing. */
  @Post('import')
  @HttpCode(200)
  @Requires('assets.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 + 1, files: 1, fields: 2 } }))
  import(@UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun: string | undefined, @Req() req: Req) {
    return this.importer.run(file?.buffer, dryRun === '1' || dryRun === 'true', who(req));
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.assets.get(id);
  }

  /** The last twelve months: failures, downtime, availability, repair time, preventive compliance, cost; and downtime spells. */
  @Get(':id/reliability')
  reliabilityOf(@Param('id') id: string, @Query('months') months?: string) {
    const n = Math.min(Math.max(Number(months) || 12, 1), 36);
    return this.reliability.forAsset(id, n);
  }

  @Post()
  @Requires('assets.manage')
  create(@Body() body: AssetInput, @Req() req: Req) {
    return this.assets.create(body ?? {}, who(req));
  }

  @Patch(':id')
  @Requires('assets.manage')
  update(@Param('id') id: string, @Body() body: AssetInput, @Req() req: Req) {
    return this.assets.update(id, body ?? {}, who(req));
  }

  @Post(':id/meters')
  @Requires('assets.manage')
  addMeter(@Param('id') id: string, @Body() body: { key: string; label: string; unit: string; value?: number }) {
    return this.assets.addMeter(id, body ?? ({} as never));
  }

  @Get(':id/meters/:key/readings')
  readings(@Param('id') id: string, @Param('key') key: string, @Query('limit') limit?: string) {
    return this.assets.readings(id, key, Number(limit) || 100);
  }

  @Post(':id/meters/:key/readings')
  @Requires('meters.record')
  @UseInterceptors(ClientOpInterceptor)
  record(@Param('id') id: string, @Param('key') key: string, @Body() body: { value?: number; reset?: boolean; at?: string }, @Req() req: Req) {
    return this.assets.recordReading(id, key, body ?? {}, who(req));
  }
}

/** Preventive-maintenance schedules. */
@Controller('pm')
@UseGuards(AuthGuard)
@InModule('pm')
export class PmController {
  constructor(private readonly pm: PmService) {}

  /** ?due=1 for what is due or overdue now; ?assetId= for one asset. */
  @Get('schedules')
  list(@Query('assetId') assetId?: string, @Query('due') due?: string) {
    return this.pm.list({ assetId, due: due === '1' || due === 'true' });
  }

  @Get('forecast')
  forecast(@Query('days') days?: string) {
    return this.pm.forecast(Number(days) || 30);
  }

  @Get('schedules/:id')
  get(@Param('id') id: string) {
    return this.pm.get(id);
  }

  @Post('schedules')
  @Requires('assets.manage')
  create(@Body() body: ScheduleInput, @Req() req: Req) {
    return this.pm.create(body ?? {}, who(req));
  }

  @Patch('schedules/:id')
  @Requires('assets.manage')
  update(@Param('id') id: string, @Body() body: ScheduleInput) {
    return this.pm.update(id, body ?? {});
  }

  @Post('schedules/:id/skip')
  @HttpCode(200)
  @Requires('assets.manage')
  skip(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: Req) {
    return this.pm.skip(id, who(req), body?.reason);
  }

  /** Raise whatever has fallen due now, instead of waiting for the timer. */
  @Post('run')
  @HttpCode(200)
  @Requires('assets.manage')
  async run() {
    return { raised: await this.pm.generateDue() };
  }
}
