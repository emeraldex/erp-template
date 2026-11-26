import { hostOf, TenantRegistry } from '../tenancy/tenant-registry';
import type { Tenant } from '../tenancy/tenant';

/** WEB_ORIGIN as a list (empty in development, where any origin is accepted). */
export const configuredOrigins = () => (process.env.WEB_ORIGIN ?? '').split(',').map((o) => o.trim()).filter(Boolean);

/**
 * The web address a printed QR code should open: the page that asked for the
 * print, if it is one of ours; otherwise WEB_ORIGIN or the organisation's address.
 */
export function webBaseFor(req: { get(name: string): string | undefined; protocol: string }, registry: TenantRegistry, tenant: Tenant): string {
  const origin = req.get('origin');
  if (origin && isAllowedWebOrigin(origin, registry, tenant)) return origin;
  const tenantHost = tenant.hosts[0];
  return configuredOrigins()[0] ?? (tenantHost ? `https://${tenantHost}` : `${req.protocol}://${req.get('host')}`);
}

/** May the browser be sent back to `origin` after a redirect? */
export function isAllowedWebOrigin(origin: string | undefined, registry: TenantRegistry, tenant?: Tenant): boolean {
  if (!origin) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const configured = configuredOrigins();
  if (configured.includes(u.origin)) return true;
  const host = hostOf(u.origin)?.toLowerCase();
  if (host && (tenant ? tenant.hosts : [...registry.knownHosts()]).includes(host)) return true;
  return !configured.length && process.env.NODE_ENV !== 'production';
}
