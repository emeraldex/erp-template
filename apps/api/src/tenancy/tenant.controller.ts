import { Controller, Get, NotFoundException, Req, Res, StreamableFile } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { SettingsService } from '../settings/settings.service';
import { currentTenant } from './tenant';

/** Public: which organisation this address belongs to, for the sign-in page and the request portal. */
@Controller('tenant')
@SkipThrottle()
export class TenantController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  info() {
    const t = currentTenant();
    // The sector pack lets the sign-in page offer the right demo accounts.
    return {
      id: t.id, name: this.settings.company.name || t.name, pack: this.settings.get().pack?.id ?? 'aviation',
      currency: this.settings.currency.code, brand: this.settings.branding,
    };
  }

  /** The organisation's logo, for pages shown before anyone signs in. Never executable: PNG or JPEG only, nosniff. */
  @Get('logo')
  logo(@Req() req: Request, @Res({ passthrough: true }) res: Response): StreamableFile | undefined {
    const logo = this.settings.logo;
    if (!logo) throw new NotFoundException('No logo');
    const etag = `"${logo.sha256.slice(0, 32)}"`;
    res.set({
      'Content-Type': logo.contentType, 'X-Content-Type-Options': 'nosniff', ETag: etag,
      'Cache-Control': 'public, max-age=3600', 'Content-Security-Policy': "default-src 'none'",
      // The web app may sit on another port or address of the same organisation.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    if (req.headers['if-none-match'] === etag) {
      res.status(304);
      return undefined;
    }
    return new StreamableFile(logo.buffer);
  }
}
