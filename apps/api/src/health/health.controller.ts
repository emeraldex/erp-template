import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Database } from '../tenancy/database';

/**
 * Liveness + readiness for load balancers, Docker and uptime monitors.
 * Unauthenticated, and reveals nothing beyond up/down.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  private readonly started = Date.now();

  constructor(private readonly db: Database) {}

  @Get()
  @HttpCode(200)
  async check() {
    try {
      await this.db.pool.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return { status: 'ok', database: 'up', uptimeSeconds: Math.round((Date.now() - this.started) / 1000) };
  }
}
