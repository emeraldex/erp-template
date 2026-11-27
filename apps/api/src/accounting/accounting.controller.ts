import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.service';
import { InModule, Requires } from '../auth/roles.decorator';
import { toCsv, toXlsx } from '../reports/tabular';
import { AccountingService } from './accounting.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SHEETS = ['sales', 'receipts', 'purchases'] as const;

/** Sales, receipts and purchases for the accounting system, in batches that are never exported twice. */
@Controller('accounting')
@UseGuards(AuthGuard)
@InModule('invoicing')
@Requires('accounting.export')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('settings')
  settings() {
    return this.accounting.accountSettings();
  }

  /** Account codes: receivables, bank, outputTax, taxCode, purchases, stock, revenueDefault, revenueByStream. */
  @Put('settings')
  setSettings(@Body() body: Record<string, unknown>, @Req() req: { user: AuthUser }) {
    return this.accounting.setAccountSettings(body ?? {}, req.user);
  }

  @Get('preview')
  preview(@Query('from') from: string, @Query('to') to: string) {
    return this.accounting.preview(from, to);
  }

  @Get('exports')
  list() {
    return this.accounting.list();
  }

  /** `{ from, to, includeExported? }` — a new batch of what has not been exported before. */
  @Post('exports')
  create(@Body() body: { from?: string; to?: string; includeExported?: boolean }, @Req() req: { user: AuthUser }) {
    return this.accounting.create(body ?? {}, req.user);
  }

  /** The batch as Excel (three sheets) or CSV (`sheet=sales|receipts|purchases`). */
  @Get('exports/:id/file')
  async file(@Param('id') id: string, @Query('format') format: string | undefined, @Query('sheet') sheet: string | undefined, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const report = await this.accounting.report(id);
    const fmt = format ?? 'xlsx';
    if (fmt !== 'xlsx' && fmt !== 'csv') throw new BadRequestException('format must be xlsx or csv');
    if (fmt === 'csv') {
      const i = SHEETS.indexOf((sheet ?? 'sales') as (typeof SHEETS)[number]);
      if (i < 0) throw new BadRequestException(`sheet must be one of ${SHEETS.join(', ')}`);
      res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}-${SHEETS[i]}.csv"`, 'Cache-Control': 'no-store' });
      return new StreamableFile(toCsv(report.sheets[i]));
    }
    res.set({ 'Content-Type': XLSX, 'Content-Disposition': `attachment; filename="${id}.xlsx"`, 'Cache-Control': 'no-store' });
    return new StreamableFile(await toXlsx(report));
  }
}
