import { Global, Module } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { StoreService } from './common/store.service';
import { AuthModule } from './auth/auth.module';
import { JobsModule } from './jobs/jobs.module';
import { DemandsModule } from './demands/demands.module';
import { OvModule } from './ov/ov.module';
import { RegistersModule } from './registers/registers.module';
import { FodModule } from './fod/fod.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { DashboardModule } from './dashboard/dashboard.module';

@Global()
@Module({
  imports: [AuthModule, JobsModule, DemandsModule, OvModule, RegistersModule, FodModule, InvoicingModule, DashboardModule],
  providers: [PrismaService, StoreService],
  exports: [PrismaService, StoreService],
})
export class AppModule {}
