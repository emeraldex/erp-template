import { BadRequestException, Controller, Get, HttpCode, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { Requires } from '../auth/roles.decorator';
import { toCsv, toXlsx } from '../reports/tabular';
import { RetentionService } from './retention.service';

@Controller('retention')
@UseGuards(AuthGuard)
export class RetentionController {
  constructor(private readonly svc: RetentionService) {}

  @Get('report')
  @Requires('reports.audit')
  async report(@Query('format') format: string | undefined, @Res({ passthrough: true }) res: Response) {
    const fmt = format ?? 'xlsx';
    if (fmt !== 'xlsx' && fmt !== 'csv') throw new BadRequestException('format must be xlsx or csv');
    const report = await this.svc.report();
    res.set({
      'Content-Type': fmt === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="retention_${new Date().toISOString().slice(0, 10)}.${fmt}"`,
    });
    return new StreamableFile(fmt === 'csv' ? toCsv(report.sheets[0]) : await toXlsx(report));
  }

  /** Archive eligible jobs now instead of waiting for the schedule. */
  @Post('archive')
  @HttpCode(200)
  @Requires('org.admin')
  archive() {
    return this.svc.archiveClosedJobs();
  }
}
