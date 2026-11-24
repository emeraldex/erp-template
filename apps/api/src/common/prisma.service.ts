import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * PrismaClient bound to the pg driver adapter (Prisma 7 no longer reads the
 * connection URL from schema.prisma). Connection pooling is handled by node-pg;
 * size it with PG_POOL_MAX when running more than one API replica so the
 * replicas together stay under Postgres' max_connections.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private static readonly log = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — the API cannot start without a database.');
    }
    super({
      adapter: new PrismaPg({
        connectionString,
        max: Number(process.env.PG_POOL_MAX ?? 10),
      }),
      log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    PrismaService.log.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
