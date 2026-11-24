import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './common/prisma.service';
import { StoreService } from './common/store.service';
import { RequestLoggerMiddleware } from './common/request-logger.middleware';
import { authConfig } from './auth/auth.config';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs/jobs.module';
import { DemandsModule } from './demands/demands.module';
import { OvModule } from './ov/ov.module';
import { RegistersModule } from './registers/registers.module';
import { FodModule } from './fod/fod.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Global()
@Module({
  imports: [
    // Per-IP request ceiling for the whole API; sign-in has a tighter limit.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: authConfig.apiRateLimit }]),
    AuthModule, JobsModule, DemandsModule, OvModule, RegistersModule, FodModule, InvoicingModule, DashboardModule,
  ],
  controllers: [HealthController],
  providers: [PrismaService, StoreService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [PrismaService, StoreService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLoggerMiddleware).forRoutes('{*path}');
  }
}
