import { Body, Controller, Get, HttpCode, Post, Query, Req, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { authConfig } from '../auth/auth.config';
import { webBaseFor } from '../auth/web-origin';
import { REQUEST_PHOTO_MAX_BYTES } from '../attachments/attachments.service';
import { currentTenant } from '../tenancy/tenant';
import { TenantRegistry } from '../tenancy/tenant-registry';
import { MAX_PHOTOS, RequestsService } from './requests.service';

const PER_MINUTE = (limit: number) => ({ default: { limit, ttl: 60_000 } });

/**
 * The request portal's public side: no account, no cookie. Answers 404 while
 * the organisation has the portal switched off. Tracking tokens travel in the
 * request body, never in the URL.
 */
@Controller('public')
export class PublicRequestsController {
  constructor(private readonly requests: RequestsService, private readonly registry: TenantRegistry) {}

  @Get('portal')
  @Throttle(PER_MINUTE(60))
  portal(@Query('p') p?: string) {
    return this.requests.portalInfo(p);
  }

  /** Multipart: the form's fields, and up to three photos in "photos". */
  @Post('requests')
  @Throttle({ default: { limit: authConfig.portalRateLimit, ttl: 60_000 }, hourly: { limit: authConfig.portalHourlyLimit, ttl: 3_600_000 } })
  @UseInterceptors(FilesInterceptor('photos', MAX_PHOTOS, { limits: { fileSize: REQUEST_PHOTO_MAX_BYTES, files: MAX_PHOTOS, fields: 20, fieldSize: 4096 } }))
  submit(@Body() body: Record<string, unknown>, @UploadedFiles() files: Express.Multer.File[] | undefined, @Req() req: Request) {
    return this.requests.submit(body ?? {}, files ?? [], { ip: req.ip, webBase: webBaseFor(req, this.registry, currentTenant()) });
  }

  @Post('track')
  @HttpCode(200)
  @Throttle(PER_MINUTE(60))
  track(@Body() body: { token?: string }) {
    return this.requests.track(body?.token);
  }

  @Post('track/messages')
  @HttpCode(200)
  @Throttle(PER_MINUTE(10))
  message(@Body() body: { token?: string; body?: string }) {
    return this.requests.requesterMessage(body?.token, body?.body);
  }

  @Post('track/rating')
  @HttpCode(200)
  @Throttle(PER_MINUTE(10))
  rate(@Body() body: { token?: string; rating?: number; comment?: string }) {
    return this.requests.rate(body?.token, body?.rating, body?.comment);
  }

  @Post('track/cancel')
  @HttpCode(200)
  @Throttle(PER_MINUTE(10))
  cancel(@Body() body: { token?: string }) {
    return this.requests.cancel(body?.token);
  }
}
