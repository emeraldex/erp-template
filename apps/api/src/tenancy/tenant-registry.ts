import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Database } from './database';
import { Tenant } from './tenant';

export const CONTROL_SCHEMA = 'erp_control';

const REFRESH_MS = 30_000;

/** Lower-case host, also without its port, for matching. */
function hostKeys(host: string | undefined): string[] {
  if (!host) return [];
  const h = host.trim().toLowerCase();
  const noPort = h.replace(/:\d+$/, '');
  return noPort === h ? [h] : [h, noPort];
}

export function hostOf(urlOrHost: string | undefined): string | undefined {
  if (!urlOrHost) return undefined;
  try {
    return new URL(urlOrHost).host;
  } catch {
    return urlOrHost;
  }
}

/**
 * The list of client organisations, kept in its own schema. The default tenant
 * (DATABASE_URL's schema) always exists, so a single-client install needs no
 * registration at all.
 */
@Injectable()
export class TenantRegistry implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TenantRegistry.name);
  private tenants: Tenant[] = [];
  private timer?: NodeJS.Timeout;
  readonly defaultTenant: Tenant;

  constructor(private readonly db: Database) {
    this.defaultTenant = {
      id: 'default', name: process.env.DEFAULT_TENANT_NAME || 'Default', schema: db.defaultSchema,
      hosts: [], status: 'active', isDefault: true,
    };
  }

  async onModuleInit(): Promise<void> {
    await ensureControlSchema(this.db);
    await this.refresh();
    this.timer = setInterval(() => this.refresh().catch((e) => this.log.error(`Tenant refresh failed: ${e.message}`)), REFRESH_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async refresh(): Promise<void> {
    const { rows } = await this.db.pool.query(
      `SELECT id, name, schema_name, hosts, status FROM ${CONTROL_SCHEMA}.tenants ORDER BY id`,
    );
    this.tenants = rows.map((r) => ({
      id: r.id, name: r.name, schema: r.schema_name, hosts: (r.hosts ?? []).map((h: string) => h.toLowerCase()),
      status: r.status, isDefault: false,
    }));
  }

  all(): Tenant[] {
    return [this.defaultTenant, ...this.tenants];
  }

  byId(id: string): Tenant | undefined {
    return this.all().find((t) => t.id === id);
  }

  /** Every origin a tenant's web app is served from, for CORS. */
  knownHosts(): Set<string> {
    return new Set(this.tenants.flatMap((t) => t.hosts));
  }

  /**
   * Which tenant a request is for: the address it was sent to, else the web
   * page that sent it (Origin), else the default tenant — unless
   * TENANT_STRICT_HOSTS=true, in which case unknown addresses get nothing.
   */
  resolve(host: string | undefined, origin: string | undefined): Tenant | undefined {
    for (const candidate of [host, hostOf(origin)]) {
      const keys = hostKeys(candidate);
      const hit = this.tenants.find((t) => t.hosts.some((h) => keys.includes(h)));
      if (hit) return hit;
    }
    return ['1', 'true'].includes((process.env.TENANT_STRICT_HOSTS ?? '').toLowerCase()) ? undefined : this.defaultTenant;
  }
}

export async function ensureControlSchema(db: { pool: { query: (sql: string) => Promise<unknown> } }): Promise<void> {
  await db.pool.query(`CREATE SCHEMA IF NOT EXISTS ${CONTROL_SCHEMA}`);
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS ${CONTROL_SCHEMA}.tenants (
      id          text PRIMARY KEY,
      name        text NOT NULL,
      schema_name text NOT NULL UNIQUE,
      hosts       text[] NOT NULL DEFAULT '{}',
      status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      sso         jsonb,
      created_at  timestamptz NOT NULL DEFAULT now()
    )`);
}
