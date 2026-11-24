import { BadRequestException, Injectable } from '@nestjs/common';
import { currentTenant } from '../tenancy/tenant';
import { PrismaService } from '../common/prisma.service';

export interface CompanyProfile {
  name: string;
  registrationNo: string;
  taxRegistrationNo: string;
  address: string[];
  phone: string;
  email: string;
  /** Name and title printed above the signature on covering letters. */
  signatoryName: string;
  signatoryTitle: string;
}

export interface TaxSettings {
  /** Printed on documents, e.g. "GST" or "SST". */
  label: string;
  /** Percentage, e.g. 6 for 6%. Applied to invoices drafted after a change. */
  ratePct: number;
}

export interface Settings {
  company: CompanyProfile;
  tax: TaxSettings;
}

export const DEFAULT_SETTINGS: Settings = {
  company: {
    name: 'Company Name Sdn. Bhd.',
    registrationNo: '',
    taxRegistrationNo: '',
    address: ['Address line 1', 'Address line 2'],
    phone: '',
    email: '',
    signatoryName: '',
    signatoryTitle: 'Head of Billing',
  },
  // CO-RFP-IT-001 specifies 6% GST. Malaysia's current regime is SST; change
  // both here without a redeploy.
  tax: { label: 'GST', ratePct: 6 },
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/** Organisation settings, cached in memory and persisted in the settings table. */
@Injectable()
export class SettingsService {
  /** Per tenant, re-read every 30 s so changes made on another replica show up. */
  private readonly caches = new Map<string, { settings: Settings; loadedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  private get cache(): Settings {
    const c = this.caches.get(currentTenant().id);
    if (!c) throw new Error(`Settings not loaded for tenant ${currentTenant().id}`);
    return c.settings;
  }

  async ensureLoaded(): Promise<void> {
    const c = this.caches.get(currentTenant().id);
    if (!c || Date.now() - c.loadedAt > 30_000) await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.prisma.setting.findMany();
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value as object]));
    this.caches.set(currentTenant().id, {
      settings: {
        company: { ...DEFAULT_SETTINGS.company, ...(byKey.company ?? {}) },
        tax: { ...DEFAULT_SETTINGS.tax, ...(byKey.tax ?? {}) },
      },
      loadedAt: Date.now(),
    });
  }

  get(): Settings {
    return structuredClone(this.cache);
  }

  get company(): CompanyProfile {
    return { ...this.cache.company };
  }

  get tax(): TaxSettings {
    return { ...this.cache.tax };
  }

  async updateCompany(patch: Partial<CompanyProfile>, by: string): Promise<CompanyProfile> {
    const next: CompanyProfile = { ...this.cache.company };
    for (const k of ['name', 'registrationNo', 'taxRegistrationNo', 'phone', 'email', 'signatoryName', 'signatoryTitle'] as const) {
      const v = str(patch[k], 160);
      if (v !== undefined) next[k] = v;
    }
    if (patch.address !== undefined) {
      if (!Array.isArray(patch.address)) throw new BadRequestException('address must be a list of lines');
      next.address = patch.address.map((l) => str(l, 160) ?? '').filter(Boolean).slice(0, 6);
    }
    if (!next.name) throw new BadRequestException('Company name is required');
    await this.save('company', next, by);
    return next;
  }

  async updateTax(patch: Partial<TaxSettings>, by: string): Promise<TaxSettings> {
    const label = str(patch.label, 12) ?? this.cache.tax.label;
    const ratePct = patch.ratePct === undefined ? this.cache.tax.ratePct : Number(patch.ratePct);
    if (!/^[A-Za-z][A-Za-z0-9 .-]{0,11}$/.test(label)) throw new BadRequestException('Tax label must be 1–12 letters, e.g. GST or SST');
    if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > 100) throw new BadRequestException('Tax rate must be between 0 and 100');
    const next = { label, ratePct: Math.round(ratePct * 100) / 100 };
    await this.save('tax', next, by);
    return next;
  }

  private async save(key: keyof Settings, value: object, by: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: value as never, updatedBy: by },
      update: { value: value as never, updatedBy: by },
    });
    await this.reload();
  }
}
