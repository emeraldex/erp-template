import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { StoreService } from '../common/store.service';
import { SettingsService } from '../settings/settings.service';
import { runWithTenant } from './tenant';
import { TenantRegistry } from './tenant-registry';

/** Resolve the tenant for each request and run the rest of the request inside it. */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly registry: TenantRegistry,
    private readonly store: StoreService,
    private readonly settings: SettingsService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const host = (req.app.get('trust proxy') && req.headers['x-forwarded-host']?.toString().split(',')[0]) || req.headers.host;
    const tenant = this.registry.resolve(host, req.headers.origin);
    if (!tenant) {
      res.status(404).json({ statusCode: 404, message: 'No organisation is configured for this address' });
      return;
    }
    if (tenant.status !== 'active') {
      res.status(403).json({ statusCode: 403, message: 'This organisation is suspended' });
      return;
    }
    (req as Request & { tenant?: typeof tenant }).tenant = tenant;
    runWithTenant(tenant, () => {
      Promise.all([this.store.ensureConfig(), this.settings.ensureLoaded()]).then(() => next(), next);
    });
  }
}
