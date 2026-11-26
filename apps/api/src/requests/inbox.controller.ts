import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { webBaseFor } from '../auth/web-origin';
import { currentTenant } from '../tenancy/tenant';
import { TenantRegistry } from '../tenancy/tenant-registry';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { InModule, Requires } from '../auth/roles.decorator';
import { RequestsInboxService } from './inbox.service';
import { RequestsService } from './requests.service';

type Req = Request & { user: AuthUser };
const who = (r: Req) => ({ name: r.user.name, role: r.user.role });

/** Triage of portal requests. Needs requests.manage. */
@Controller('requests')
@UseGuards(AuthGuard)
@InModule('requests')
@Requires('requests.manage')
export class RequestsInboxController {
  constructor(private readonly inbox: RequestsInboxService, private readonly requests: RequestsService, private readonly registry: TenantRegistry) {}

  @Get()
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.inbox.list({ status, q });
  }

  /** Staff log a request for a caller: the same fields as the public form. */
  @Post()
  log(@Body() body: Record<string, unknown>, @Req() req: Req) {
    return this.inbox.logForCaller(body ?? {}, who(req));
  }

  /** Remind the help desk about requests waiting too long (also runs on a timer). */
  @Post('remind')
  @HttpCode(200)
  @Requires('org.admin')
  async remind() {
    return { reminded: await this.requests.remindStale() };
  }

  // ─── QR posters (before ':id', which would otherwise catch "points") ───────

  @Get('points')
  points() {
    return this.inbox.points();
  }

  /** A poster for a place: `{ label, site? }`. */
  @Post('points')
  addPoint(@Body() body: { label?: string; site?: string }, @Req() req: Req) {
    return this.inbox.addPoint(body ?? {}, who(req));
  }

  /** Points for assets, for stickers: `{ assetIds: [...] }` → `{ codes }`. */
  @Post('points/assets')
  @HttpCode(200)
  pointsForAssets(@Body() body: { assetIds?: unknown }, @Req() req: Req) {
    return this.inbox.pointsForAssets(body?.assetIds, who(req));
  }

  @Patch('points/:code')
  updatePoint(@Param('code') code: string, @Body() body: { label?: string; active?: boolean }) {
    return this.inbox.updatePoint(code, body ?? {});
  }

  /** GET /requests/points/posters?codes=a,b&format=poster|stickers — a PDF to print. */
  @Get('points/posters')
  async posters(@Query('codes') codes: string | undefined, @Query('format') format: string | undefined, @Req() req: Req, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { filename, pdf } = await this.inbox.posters((codes ?? '').split(','), format ?? 'poster', webBaseFor(req, this.registry, currentTenant()));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(pdf);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.inbox.get(id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@Param('id') id: string, @Body() body: { assetId?: string; category?: string; site?: string; jobType?: string; component?: string }, @Req() req: Req) {
    return this.inbox.accept(id, body ?? {}, who(req));
  }

  @Post(':id/merge')
  @HttpCode(200)
  merge(@Param('id') id: string, @Body() body: { jobId?: string }, @Req() req: Req) {
    return this.inbox.merge(id, body ?? {}, who(req));
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(@Param('id') id: string, @Body() body: { reason?: string; spam?: boolean }, @Req() req: Req) {
    return this.inbox.decline(id, body ?? {}, who(req));
  }

  @Post(':id/messages')
  @HttpCode(200)
  message(@Param('id') id: string, @Body() body: { body?: string }, @Req() req: Req) {
    return this.inbox.message(id, body?.body, who(req));
  }

  /** Blank the requester's name, email and phone (a personal-data request). */
  @Post(':id/erase')
  @HttpCode(200)
  erase(@Param('id') id: string, @Req() req: Req) {
    return this.inbox.erase(id, who(req));
  }
}
