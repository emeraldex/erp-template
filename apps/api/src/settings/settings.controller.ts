import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.service';
import { Roles } from '../auth/roles.decorator';
import { CompanyProfile, SettingsService, TaxSettings } from './settings.service';

@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch('company')
  @Roles('ADMIN')
  company(@Body() body: Partial<CompanyProfile>, @Req() req: { user: AuthUser }) {
    return this.settings.updateCompany(body ?? {}, req.user.name);
  }

  @Patch('tax')
  @Roles('ADMIN')
  tax(@Body() body: Partial<TaxSettings>, @Req() req: { user: AuthUser }) {
    return this.settings.updateTax(body ?? {}, req.user.name);
  }
}
