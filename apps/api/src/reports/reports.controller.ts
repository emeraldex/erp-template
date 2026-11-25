import { BadRequestException, Controller, Get, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { InModule, Requires } from '../auth/roles.decorator';
import { parsePeriod, ReportsService } from './reports.service';
import { Report, toCsv, toXlsx } from './tabular';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  private async send(report: Report, base: string, format: string | undefined, res: Response): Promise<StreamableFile> {
    const fmt = format ?? 'xlsx';
    if (fmt !== 'xlsx' && fmt !== 'csv') throw new BadRequestException('format must be xlsx or csv');
    const body = fmt === 'csv' ? toCsv(report.sheets[0]) : await toXlsx(report);
    res.set({
      'Content-Type': fmt === 'csv' ? 'text/csv; charset=utf-8' : XLSX,
      'Content-Disposition': `attachment; filename="${base.replace(/[^A-Za-z0-9._-]/g, '_')}.${fmt}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(body);
  }

  @Get('sales-performance')
  @InModule('invoicing')
  @Requires('reports.billing')
  async sales(@Query('from') from: string, @Query('to') to: string, @Query('format') format: string, @Res({ passthrough: true }) res: Response) {
    const p = parsePeriod(from, to);
    return this.send(await this.reports.salesPerformance(p), `sales-performance_${p.from}_${p.to}`, format, res);
  }

  @Get('e-payment')
  @InModule('invoicing')
  @Requires('reports.payments')
  async ePayment(@Query('from') from: string, @Query('to') to: string, @Query('format') format: string, @Res({ passthrough: true }) res: Response) {
    const p = parsePeriod(from, to);
    return this.send(await this.reports.ePayment(p), `e-payment_${p.from}_${p.to}`, format ?? 'csv', res);
  }

  @Get('outstanding')
  @InModule('invoicing')
  @Requires('reports.billing')
  async outstanding(@Query('format') format: string, @Res({ passthrough: true }) res: Response) {
    return this.send(await this.reports.outstanding(), `outstanding_${new Date().toISOString().slice(0, 10)}`, format, res);
  }

  @Get('audit')
  @Requires('reports.audit')
  async audit(
    @Query('from') from: string, @Query('to') to: string, @Query('entity') entity: string | undefined,
    @Query('format') format: string, @Res({ passthrough: true }) res: Response,
  ) {
    const p = parsePeriod(from, to);
    return this.send(await this.reports.auditTrail(p, entity), `audit_${entity ?? 'all'}_${p.from}_${p.to}`, format, res);
  }
}
