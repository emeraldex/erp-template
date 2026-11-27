import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Requires } from '../auth/roles.decorator';
import { DashboardService } from './dashboard.service';
import { StoreService } from '../common/store.service';
import { SettingsService } from '../settings/settings.service';
import { CAPABILITIES, PHASES } from '../packs/types';

@Controller()
export class DashboardController {
  constructor(private readonly svc: DashboardService, private readonly store: StoreService, private readonly settings: SettingsService) {}

  @Get('dashboard/kpis')
  @UseGuards(AuthGuard)
  kpis() {
    return this.svc.kpis();
  }

  /**
   * FR-02 — the workflow definition served as data. The web client renders
   * its status pills, action buttons and mandatory-field forms from this.
   * Any signed-in user may read it; rule mutation is ADMIN/QUALITY only below.
   */
  @Get('config')
  @UseGuards(AuthGuard)
  config() {
    const s = this.store;
    return {
      pack: this.settings.get().pack,
      terms: this.settings.terms,
      modules: this.settings.modules,
      currency: this.settings.currency,
      brand: this.settings.branding,
      phases: PHASES,
      capabilities: CAPABILITIES,
      // Every vocabulary the organisation has defined, in display order.
      dictionary: s.dictionaryAll(),
      jobStatusMeta: s.statusMeta('JOB'),
      demandStatusMeta: s.statusMeta('DEMAND'),
      ovStatusMeta: s.statusMeta('OV'),
      invoiceStatusMeta: s.statusMeta('INVOICE'),
      priorityMeta: s.dictMeta('priority'),
      repairRouteMeta: s.dictMeta('route'),
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
  @Requires('workflow.edit')
  patchSla(@Param('id') id: string, @Body() b: { days: number }) {
    return this.store.patchSla(id, b?.days);
  }
}
