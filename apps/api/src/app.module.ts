import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { StoreService } from './common/store.service';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { authConfig } from './auth/auth.config';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { RequestsModule } from './requests/requests.module';
import { LabourModule } from './labour/labour.module';
import { AccountingModule } from './accounting/accounting.module';
import { RequestsInboxModule } from './requests/inbox.module';
import { AssetsModule } from './assets/assets.module';
import { StockModule } from './stock/stock.module';
import { DemandsModule } from './demands/demands.module';
import { OvModule } from './ov/ov.module';
import { RegistersModule } from './registers/registers.module';
import { FodModule } from './fod/fod.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SettingsModule } from './settings/settings.module';
import { DocumentsModule } from './documents/documents.module';
import { ReportsModule } from './reports/reports.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RetentionModule } from './retention/retention.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { WorkflowModule } from './workflow/workflow.module';
import { UsersModule } from './users/users.module';
import { TenantMiddleware } from './tenancy/tenant.middleware';

@Global()
@Module({
  imports: [
    // Per-IP request ceiling for the whole API; sign-in has a tighter limit.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: authConfig.apiRateLimit },
      // Only the request portal tightens this; for everything else it is effectively off.
      { name: 'hourly', ttl: 3_600_000, limit: 1_000_000 },
    ]),
    TenancyModule, SettingsModule, AuthModule, AssetsModule, StockModule, JobsModule, DemandsModule, OvModule, RegistersModule, FodModule, InvoicingModule, DashboardModule, DocumentsModule, ReportsModule, AttachmentsModule,
    NotificationsModule, RequestsModule, RequestsInboxModule, LabourModule, AccountingModule, RetentionModule, SchedulerModule, WorkflowModule, UsersModule,
  ],
  controllers: [HealthController],
  providers: [StoreService, TenantMiddleware, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [StoreService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Every route runs inside its tenant, except the health check (no tenant needed).
    consumer.apply(TenantMiddleware, RequestLoggerMiddleware).exclude('health').forRoutes('{*path}');
  }
}
