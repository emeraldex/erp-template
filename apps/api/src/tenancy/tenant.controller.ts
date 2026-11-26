import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SettingsService } from '../settings/settings.service';
import { currentTenant } from './tenant';

/** Public: which organisation this address belongs to, for the sign-in page. */
@Controller('tenant')
@SkipThrottle()
export class TenantController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  info() {
    const t = currentTenant();
    // The sector pack lets the sign-in page offer the right demo accounts.
    return { id: t.id, name: this.settings.company.name || t.name, pack: this.settings.get().pack?.id ?? 'aviation' };
  }
}
