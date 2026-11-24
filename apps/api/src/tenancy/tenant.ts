import { AsyncLocalStorage } from 'async_hooks';

export interface Tenant {
  /** Short stable id, used in tokens, storage keys and logs (e.g. "acme"). */
  id: string;
  name: string;
  /** PostgreSQL schema holding this tenant's data. */
  schema: string;
  /** Web addresses that belong to this tenant (host or host:port, lower case). */
  hosts: string[];
  status: 'active' | 'suspended';
  isDefault: boolean;
}

const als = new AsyncLocalStorage<{ tenant: Tenant }>();

/** Run `fn` with `tenant` as the current tenant for everything it awaits. */
export function runWithTenant<T>(tenant: Tenant, fn: () => T): T {
  return als.run({ tenant }, fn);
}

/** The tenant of the request (or background job) in progress. */
export function currentTenant(): Tenant {
  const t = als.getStore()?.tenant;
  if (!t) {
    // Failing loudly beats silently reading or writing another client's data.
    throw new Error('No tenant in context: wrap background work in runWithTenant()');
  }
  return t;
}

export function maybeTenant(): Tenant | undefined {
  return als.getStore()?.tenant;
}

export const TENANT_ID = /^[a-z][a-z0-9-]{1,30}$/;
export const schemaFor = (id: string) => `t_${id.replace(/-/g, '_')}`;
