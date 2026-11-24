import { PrismaClient } from '../generated/prisma/client';

/**
 * Injection token and type for database access. The provider (TenancyModule)
 * is a proxy that sends every query to the current tenant's schema, so
 * services keep writing `this.prisma.job.findMany()` unchanged.
 */
export abstract class PrismaService extends PrismaClient {}
