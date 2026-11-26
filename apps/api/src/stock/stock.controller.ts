import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { webBaseFor } from '../auth/web-origin';
import { partLabels } from '../assets/labels';
import { currentTenant } from '../tenancy/tenant';
import { TenantRegistry } from '../tenancy/tenant-registry';
import { CountsService } from './counts.service';
import { IMPORT_MAX_BYTES, StockImportService } from './import.service';
import type { AuthUser } from '../auth/auth.service';
import { InModule, Requires } from '../auth/roles.decorator';
import { ClientOpInterceptor } from '../common/client-ops';
import { PartInput, quantity, StockService } from './stock.service';
import { BadRequestException } from '@nestjs/common';
import { text } from '../assets/ids';

type Req = Request & { user: AuthUser };
const who = (r: Req) => ({ name: r.user.name, role: r.user.role });

/** Parts and stock. Anyone signed in may look; changes need stock.manage or stock.issue. */
@Controller('stock')
@UseGuards(AuthGuard)
@InModule('stock')
export class StockController {
  constructor(
    private readonly stock: StockService,
    private readonly counts: CountsService,
    private readonly importer: StockImportService,
    private readonly registry: TenantRegistry,
  ) {}

  @Get('parts')
  list(@Query('q') q?: string, @Query('group') group?: string, @Query('store') store?: string, @Query('low') low?: string, @Query('all') all?: string) {
    return this.stock.list({ q, group, store, low: low === '1' || low === 'true', includeInactive: all === '1' });
  }

  @Get('parts/:id')
  get(@Param('id') id: string) {
    return this.stock.get(id);
  }

  @Post('parts')
  @Requires('stock.manage')
  create(@Body() body: PartInput, @Req() req: Req) {
    return this.stock.create(body ?? {}, who(req));
  }

  @Patch('parts/:id')
  @Requires('stock.manage')
  update(@Param('id') id: string, @Body() body: PartInput) {
    return this.stock.update(id, body ?? {});
  }

  @Put('parts/:id/levels/:store')
  @Requires('stock.manage')
  level(@Param('id') id: string, @Param('store') store: string, @Body() body: { bin?: string; reorderPoint?: number | null; reorderQty?: number | null }) {
    return this.stock.setLevel(id, store, body ?? {});
  }

  /** Issue a part to a work order. Safe to resend with the same X-Client-Op. */
  @Post('issue')
  @Requires('stock.issue')
  @UseInterceptors(ClientOpInterceptor)
  issue(@Body() body: { partId?: string; store?: string; qty?: number; jobId?: string }, @Req() req: Req) {
    return this.stock.issue(body ?? {}, who(req));
  }

  /** Take unused parts back from a work order. */
  @Post('return')
  @Requires('stock.issue')
  @UseInterceptors(ClientOpInterceptor)
  giveBack(@Body() body: { partId?: string; store?: string; qty?: number; jobId?: string }, @Req() req: Req) {
    return this.stock.returnToStock(body ?? {}, who(req));
  }

  /** Stock received without a purchase request (e.g. opening stock, free issue), at a unit cost. */
  @Post('receive')
  @Requires('stock.manage')
  async receive(@Body() body: { partId?: string; store?: string; qty?: number; unitCost?: number; reason?: string }, @Req() req: Req) {
    const qty = quantity(body?.qty);
    const unitCost = Number(body?.unitCost ?? NaN);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new BadRequestException('Give the unit cost (0 or more)');
    const reason = text(body?.reason, 200);
    if (!reason) throw new BadRequestException('Say where the stock came from');
    return this.stock.receiveDirect({ partId: String(body?.partId ?? ''), store: String(body?.store ?? ''), qty, unitCost, reason }, who(req));
  }

  @Post('adjust')
  @Requires('stock.manage')
  adjust(@Body() body: { partId?: string; store?: string; qty?: number; reason?: string }, @Req() req: Req) {
    return this.stock.adjust(body ?? {}, who(req));
  }

  @Post('transfer')
  @HttpCode(200)
  @Requires('stock.manage')
  transfer(@Body() body: { partId?: string; from?: string; to?: string; qty?: number }, @Req() req: Req) {
    return this.stock.transfer(body ?? {}, who(req));
  }

  /** At or below the reorder point, with suggested quantities. */
  @Get('reorder')
  reorder() {
    return this.stock.reorderList();
  }

  /** Raise purchase requests for stock: `{ items: [{ partId, store, qty }] }`. */
  @Post('reorder')
  @Requires('stock.manage')
  raise(@Body() body: { items?: unknown }, @Req() req: Req) {
    return this.stock.raiseReorder(body?.items, who(req));
  }

  @Get('movements')
  movements(@Query('partId') partId?: string, @Query('store') store?: string, @Query('jobId') jobId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.stock.movements({ partId, store, jobId, from, to });
  }

  /** GET /stock/labels?ids=PRT-…,PRT-…[&store=MAIN] — A4 sheets of QR labels for shelves and bins. */
  @Get('labels')
  async labels(@Query('ids') ids: string | undefined, @Query('store') store: string | undefined, @Req() req: Req, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const parts = await this.stock.forLabels((ids ?? '').split(','), store || undefined);
    const { filename, pdf } = await partLabels(parts, webBaseFor(req, this.registry, currentTenant()));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(pdf);
  }

  /**
   * POST /stock/import[?dryRun=1] — a CSV file (field "file") of parts, bins,
   * reorder levels and opening stock. A dry run lists what would happen and
   * every row's problems; the real run changes nothing unless all rows are good.
   */
  @Post('import')
  @HttpCode(200)
  @Requires('stock.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES + 1, files: 1, fields: 2 } }))
  import(@UploadedFile() file: Express.Multer.File | undefined, @Query('dryRun') dryRun: string | undefined, @Req() req: Req) {
    return this.importer.run(file?.buffer, dryRun === '1' || dryRun === 'true', who(req));
  }

  // ─── counts ────────────────────────────────────────────────────────────────

  @Get('counts')
  countList(@Query('store') store?: string, @Query('status') status?: string) {
    return this.counts.list({ store, status });
  }

  @Get('counts/:id')
  count(@Param('id') id: string) {
    return this.counts.get(id);
  }

  /** Start a count: `{ store, group?, note? }` — snapshots what the system says is there. */
  @Post('counts')
  @Requires('stock.manage')
  startCount(@Body() body: { store?: string; group?: string; note?: string }, @Req() req: Req) {
    return this.counts.start(body ?? {}, who(req));
  }

  /** Enter counted quantities: `{ lines: [{ partId, countedQty }] }`. */
  @Patch('counts/:id')
  @Requires('stock.manage')
  enterCount(@Param('id') id: string, @Body() body: { lines?: unknown }, @Req() req: Req) {
    return this.counts.enter(id, body ?? {}, who(req));
  }

  @Post('counts/:id/post')
  @HttpCode(200)
  @Requires('stock.manage')
  postCount(@Param('id') id: string, @Req() req: Req) {
    return this.counts.post(id, who(req));
  }

  @Post('counts/:id/cancel')
  @HttpCode(200)
  @Requires('stock.manage')
  cancelCount(@Param('id') id: string, @Req() req: Req) {
    return this.counts.cancel(id, who(req));
  }
}
