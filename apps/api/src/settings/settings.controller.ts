import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Patch, Put, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { LOGO_MAX_BYTES } from './brand';
import { StoreService } from '../common/store.service';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Requires } from '../auth/roles.decorator';
import type { Modules, Terms } from '../packs/types';
import { BrandSettings, CompanyProfile, PortalSettings, SettingsService, TaxSettings, WorkflowDefaults } from './settings.service';
import { CURRENCIES } from './currency';

@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService, private readonly store: StoreService) {}

  @Get()
  get(@Req() req: { user: AuthUser }) {
    const s = this.settings.get();
    // The portal's access code is for administrators to set and hand out.
    if (!this.store.capabilitiesOf(req.user.role).includes('org.admin')) s.portal = { ...s.portal, accessCode: s.portal.accessCode ? '********' : '' };
    return s;
  }

  /** Brand colour (white text on it must stay readable) and the theme people start with. */
  @Patch('brand')
  @Requires('org.admin')
  brand(@Body() body: Partial<BrandSettings>, @Req() req: { user: AuthUser }) {
    return this.settings.updateBrand(body ?? {}, req.user.name);
  }

  /** The organisation's logo: PNG or JPEG in "file", up to 512 KB. Shown on screens, the request portal and PDFs. */
  @Put('logo')
  @Requires('org.admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1, files: 1, fields: 2 } }))
  logo(@UploadedFile() file: Express.Multer.File | undefined, @Req() req: { user: AuthUser }) {
    return this.settings.setLogo(file, req.user.name);
  }

  @Delete('logo')
  @HttpCode(204)
  @Requires('org.admin')
  async removeLogo() {
    await this.settings.removeLogo();
  }

  /** How many days late preventive work may be and still count as on time. */
  @Patch('maintenance')
  @Requires('org.admin')
  maintenance(@Body() body: { pmGraceDays?: number }, @Req() req: { user: AuthUser }) {
    return this.settings.updateMaintenance(body ?? {}, req.user.name);
  }

  /** The currency the organisation keeps its books in. Locked once amounts are recorded. */
  @Get('currencies')
  async currencies() {
    return { current: this.settings.currency.code, locked: await this.settings.moneyRecorded(), list: CURRENCIES };
  }

  @Patch('currency')
  @Requires('org.admin')
  currency(@Body() body: { code?: string }, @Req() req: { user: AuthUser }) {
    return this.settings.updateCurrency(body?.code, req.user.name);
  }

  /** The public request portal: open or closed, access code, intro text, triage reminder. */
  @Patch('portal')
  @Requires('org.admin')
  portal(@Body() body: Partial<PortalSettings>, @Req() req: { user: AuthUser }) {
    return this.settings.updatePortal(body ?? {}, req.user.name);
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
  async modules(@Body() body: Partial<Modules>, @Req() req: { user: AuthUser }) {
    const modules = await this.settings.updateModules(body ?? {}, req.user.name);
    await this.store.reloadConfig(); // switching stock on may have added a store and units
    return modules;
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
