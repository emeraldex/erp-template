import { BadRequestException, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { authConfig } from './auth.config';

/** One organisation's OpenID Connect settings (stored in its settings table). */
export interface SsoConfig {
  enabled: boolean;
  /** Issuer URL, e.g. https://login.microsoftonline.com/<tenant-id>/v2.0 */
  issuer: string;
  clientId: string;
  /** Encrypted at rest; never returned by the API. */
  clientSecretEnc?: string;
  /** Text on the sign-in button, e.g. "Microsoft". */
  label: string;
  /** When false, only administrators may still sign in with a password (break-glass). */
  allowPasswordLogin: boolean;
}

export type PublicSsoConfig = Omit<SsoConfig, 'clientSecretEnc'> & { hasClientSecret: boolean };

const DEFAULT: SsoConfig = { enabled: false, issuer: '', clientId: '', label: 'your organisation', allowPasswordLogin: true };

// Client secrets are sealed with a key derived from AUTH_SECRET: rotating
// AUTH_SECRET means re-entering each organisation's SSO client secret.
function key(): Buffer {
  return Buffer.from(hkdfSync('sha256', authConfig.secret, 'erp-sso', 'oidc-client-secret', 32));
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function unseal(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

@Injectable()
export class SsoConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<SsoConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: 'sso' } });
    return { ...DEFAULT, ...((row?.value as Partial<SsoConfig>) ?? {}) };
  }

  async getPublic(): Promise<PublicSsoConfig> {
    const { clientSecretEnc, ...rest } = await this.get();
    return { ...rest, hasClientSecret: !!clientSecretEnc };
  }

  async clientSecret(): Promise<string | undefined> {
    const c = await this.get();
    return c.clientSecretEnc ? unseal(c.clientSecretEnc) : undefined;
  }

  /** Validate and save. A blank clientSecret keeps the stored one; null removes it. */
  async save(patch: Partial<SsoConfig> & { clientSecret?: string | null }, by: string, verify: (issuer: string) => Promise<void>): Promise<PublicSsoConfig> {
    const cur = await this.get();
    const next: SsoConfig = {
      enabled: patch.enabled ?? cur.enabled,
      issuer: (patch.issuer ?? cur.issuer).trim().replace(/\/+$/, ''),
      clientId: (patch.clientId ?? cur.clientId).trim(),
      label: (patch.label ?? cur.label).trim().slice(0, 40) || DEFAULT.label,
      allowPasswordLogin: patch.allowPasswordLogin ?? cur.allowPasswordLogin,
      clientSecretEnc: patch.clientSecret === null ? undefined : patch.clientSecret ? seal(patch.clientSecret) : cur.clientSecretEnc,
    };
    if (next.enabled) {
      let url: URL;
      try {
        url = new URL(next.issuer);
      } catch {
        throw new BadRequestException('Issuer must be a URL, e.g. https://login.microsoftonline.com/<tenant-id>/v2.0');
      }
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(local && process.env.NODE_ENV !== 'production')) {
        throw new BadRequestException('Issuer must use https');
      }
      if (!next.clientId) throw new BadRequestException('Client ID is required');
      await verify(next.issuer); // refuse a configuration that cannot work
    }
    await this.prisma.setting.upsert({
      where: { key: 'sso' }, create: { key: 'sso', value: next as never, updatedBy: by }, update: { value: next as never, updatedBy: by },
    });
    return this.getPublic();
  }
}
