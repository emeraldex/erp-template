import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { DashboardService } from './dashboard.service';
import { StoreService } from '../common/store.service';
import {
  DEMAND_STATUS_META, INVOICE_STATUS_META, JOB_STATUS_META, OV_STATUS_META,
  PRIORITY_META, REPAIR_ROUTE_META,
} from '../common/workflow-config';

@Controller()
export class DashboardController {
  constructor(private readonly svc: DashboardService, private readonly store: StoreService) {}

  @Get('dashboard/kpis')
  @UseGuards(AuthGuard)
  kpis() {
    return this.svc.kpis();
  }

  /**
   * FR-02 — the workflow definition served as data. The web client renders
   * its status pills, action buttons and mandatory-field forms from this.
   * Public read; rule mutation is ADMIN-only below.
   */
  @Get('config')
  config() {
    return {
      jobStatusMeta: JOB_STATUS_META,
      demandStatusMeta: DEMAND_STATUS_META,
      ovStatusMeta: OV_STATUS_META,
      invoiceStatusMeta: INVOICE_STATUS_META,
      priorityMeta: PRIORITY_META,
      repairRouteMeta: REPAIR_ROUTE_META,
      jobTransitions: this.store.jobTransitions,
      demandTransitions: this.store.demandTransitions,
      ovTransitions: this.store.ovTransitions,
      invoiceTransitions: this.store.invoiceTransitions,
      invoiceStreams: this.store.invoiceStreams,
      slaRules: this.store.slaRules,
    };
  }

  /** Change a rule at runtime — no redeploy. Now persisted, so it survives one. */
  @Patch('config/sla/:id')
  @UseGuards(AuthGuard)
  @Roles('ADMIN', 'QUALITY')
  patchSla(@Param('id') id: string, @Body() b: { days: number }) {
    return this.store.patchSla(id, b?.days);
  }
}
