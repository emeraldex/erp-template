import { BadRequestException, Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { StoreService } from '../common/store.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Requires } from '../auth/roles.decorator';
import type { Modules, Terms } from '../packs/types';
import { CompanyProfile, SettingsService, TaxSettings, WorkflowDefaults } from './settings.service';

@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService, private readonly store: StoreService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch('company')
  @Requires('org.admin')
  company(@Body() body: Partial<CompanyProfile>, @Req() req: { user: AuthUser }) {
    return this.settings.updateCompany(body ?? {}, req.user.name);
  }

  @Patch('tax')
  @Requires('org.admin')
  tax(@Body() body: Partial<TaxSettings>, @Req() req: { user: AuthUser }) {
    return this.settings.updateTax(body ?? {}, req.user.name);
  }

  /** The words the screens use: "Work order" or "Job", "Asset" or "Vehicle"… */
  @Patch('terms')
  @Requires('org.admin')
  terms(@Body() body: Partial<Terms>, @Req() req: { user: AuthUser }) {
    return this.settings.updateTerms(body ?? {}, req.user.name);
  }

  /** Switch optional modules (procurement, vendor repair, assets, PM…) on or off. */
  @Patch('modules')
  @Requires('org.admin')
  modules(@Body() body: Partial<Modules>, @Req() req: { user: AuthUser }) {
    return this.settings.updateModules(body ?? {}, req.user.name);
  }

  @Patch('defaults')
  @Requires('org.admin')
  defaults(@Body() body: Partial<WorkflowDefaults>, @Req() req: { user: AuthUser }) {
    if (body?.initialLocation !== undefined && !this.store.has('location', String(body.initialLocation))) {
      throw new BadRequestException(`Unknown location ${body.initialLocation}`);
    }
    return this.settings.updateDefaults(body ?? {}, req.user.name);
  }
}
