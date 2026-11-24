import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { NotificationsService } from '../notifications/notifications.service';
import { RetentionService } from '../retention/retention.service';
import { StoreService } from '../common/store.service';
import { runWithTenant } from '../tenancy/tenant';
import { TenantRegistry } from '../tenancy/tenant-registry';

/**
 * Background jobs: SLA alerts every ALERT_INTERVAL_MINUTES (default 15) and
 * archiving every ARCHIVE_INTERVAL_HOURS (default 24). Set either to 0 to turn
 * it off, or SCHEDULER_ENABLED=false for all. Both jobs are safe to run on
 * several replicas: alerts de-duplicate in the database, archiving is idempotent.
 */
@Injectable()
export class SchedulerService implements OnApplicationBootstrap {
  private readonly log = new Logger(SchedulerService.name);

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly notifications: NotificationsService,
    private readonly retention: RetentionService,
    private readonly tenants: TenantRegistry,
    private readonly store: StoreService,
  ) {}

  /** Run a job for every active tenant in turn; one tenant's failure doesn't stop the rest. */
  async forEachTenant(name: string, job: () => Promise<unknown>): Promise<void> {
    for (const tenant of this.tenants.all().filter((t) => t.status === 'active')) {
      try {
        await runWithTenant(tenant, async () => {
          await this.store.ensureConfig();
          await job();
        });
      } catch (err) {
        this.log.error(`${name} failed for tenant ${tenant.id}: ${(err as Error).message}`);
      }
    }
  }

  onApplicationBootstrap(): void {
    if (['false', '0', 'off'].includes((process.env.SCHEDULER_ENABLED || 'true').toLowerCase())) {
      this.log.log('Scheduler disabled');
      return;
    }
    this.every('sla-alerts', Number(process.env.ALERT_INTERVAL_MINUTES || 15) * 60_000, () => this.forEachTenant('sla-alerts', () => this.notifications.runAlerts()));
    this.every('archive', Number(process.env.ARCHIVE_INTERVAL_HOURS || 24) * 3_600_000, () => this.forEachTenant('archive', () => this.retention.archiveClosedJobs()));
  }

  private every(name: string, ms: number, job: () => Promise<unknown>): void {
    if (!Number.isFinite(ms) || ms <= 0) {
      this.log.log(`${name}: off`);
      return;
    }
    let running = false;
    const run = async () => {
      if (running) return; // never overlap a slow run
      running = true;
      try {
        await job();
      } catch (err) {
        this.log.error(`${name} failed: ${(err as Error).message}`);
      } finally {
        running = false;
      }
    };
    this.registry.addInterval(name, setInterval(run, ms));
    setTimeout(run, 10_000).unref(); // first run shortly after start-up
    this.log.log(`${name}: every ${Math.round(ms / 60_000)} min`);
  }
}
