import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Database, tenantPrismaProxy } from './database';
import { TenantController } from './tenant.controller';
import { TenantRegistry } from './tenant-registry';

@Global()
@Module({
  controllers: [TenantController],
  providers: [
    Database,
    TenantRegistry,
    { provide: PrismaService, useFactory: (db: Database) => tenantPrismaProxy(db), inject: [Database] },
  ],
  exports: [Database, TenantRegistry, PrismaService],
})
export class TenancyModule {}
