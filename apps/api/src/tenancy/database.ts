import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client';
import { currentTenant, maybeTenant } from './tenant';

/**
 * DATABASE_URL without Prisma's ?schema= parameter, plus that schema as the
 * default tenant's schema (so existing single-client installs keep working).
 */
export function parseDatabaseUrl(raw = process.env.DATABASE_URL): { url: string; schema: string } {
  if (!raw) throw new Error('DATABASE_URL is not set — the API cannot start without a database.');
  const u = new URL(raw);
  const schema = u.searchParams.get('schema') || process.env.DEFAULT_TENANT_SCHEMA || 'public';
  u.searchParams.delete('schema');
  return { url: u.toString(), schema };
}

/**
 * One shared connection pool, one Prisma client per tenant schema. The schema
 * option only changes the generated SQL (fully qualified table names), so all
 * tenants can safely share the pool.
 */
@Injectable()
export class Database implements OnModuleDestroy {
  private static readonly log = new Logger('Database');
  readonly pool: Pool;
  readonly defaultSchema: string;
  private readonly clients = new Map<string, PrismaClient>();

  constructor() {
    const { url, schema } = parseDatabaseUrl();
    this.defaultSchema = schema;
    this.pool = new Pool({ connectionString: url, max: Number(process.env.PG_POOL_MAX || 10) });
    this.pool.on('error', (err) => Database.log.error(`Idle connection error: ${err.message}`));
  }

  client(schema: string): PrismaClient {
    let c = this.clients.get(schema);
    if (!c) {
      c = new PrismaClient({
        adapter: new PrismaPg(this.pool, { schema }),
        log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn', 'error'],
      });
      this.clients.set(schema, c);
    }
    return c;
  }

  /** The client for whichever tenant is current. */
  current(): PrismaClient {
    return this.client(currentTenant().schema);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.clients.values()].map((c) => c.$disconnect()));
    await this.pool.end();
  }
}

const LIFECYCLE = new Set(['onModuleInit', 'onModuleDestroy', 'onApplicationBootstrap', 'beforeApplicationShutdown', 'onApplicationShutdown', 'then']);

/** A PrismaClient-shaped object that forwards every call to the current tenant's client. */
export function tenantPrismaProxy(db: Database): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_t, prop) {
      if (typeof prop === 'string' && LIFECYCLE.has(prop)) return undefined;
      // Framework introspection (Nest probes built-in Object members) needs no
      // tenant; any real database access outside one still throws in current().
      if (!maybeTenant() && (typeof prop === 'symbol' || prop in Object.prototype)) return undefined;
      const client = db.current() as unknown as Record<string | symbol, unknown>;
      const v = client[prop];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(client) : v;
    },
  });
}
