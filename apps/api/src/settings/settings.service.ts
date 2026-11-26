import { BadRequestException, Injectable } from '@nestjs/common';
import { currentTenant } from '../tenancy/tenant';
import { AVIATION } from '../packs/aviation';
import { UNITS } from '../packs/stock-lists';
import { MODULE_KEYS, type Modules, type Terms } from '../packs/types';
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

export interface WorkflowDefaults { jobPrefix: string; initialLocation: string }

/** The public request portal. */
export interface PortalSettings {
  /** The public form accepts requests. */
  open: boolean;
  /** Asked for on the plain form (not from a QR poster); empty = none. */
  accessCode: string;
  /** Shown above the form. */
  intro: string;
  introMs: string;
  /** Ask the requester what type of problem it is. */
  askCategory: boolean;
  /** Remind the help desk once about a request still new after this many hours; 0 = never. */
  triageHours: number;
}

export interface Settings {
  company: CompanyProfile;
  tax: TaxSettings;
  /** The sector pack the organisation started from (informational). */
  pack: { id: string; name: string };
  terms: Terms;
  modules: Modules;
  defaults: WorkflowDefaults;
  portal: PortalSettings;
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
  // Organisations created before sector packs existed are aviation ones.
  pack: { id: AVIATION.id, name: AVIATION.name },
  terms: AVIATION.terms,
  modules: AVIATION.modules,
  defaults: { jobPrefix: AVIATION.defaults.jobPrefix, initialLocation: AVIATION.defaults.initialLocation },
  portal: { open: true, accessCode: '', intro: '', introMs: '', askCategory: true, triageHours: 4 },
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
        pack: { ...DEFAULT_SETTINGS.pack, ...(byKey.pack ?? {}) },
        terms: { ...DEFAULT_SETTINGS.terms, ...(byKey.terms ?? {}) },
        modules: { ...DEFAULT_SETTINGS.modules, ...(byKey.modules ?? {}) },
        defaults: { ...DEFAULT_SETTINGS.defaults, ...(byKey.defaults ?? {}) },
        portal: { ...DEFAULT_SETTINGS.portal, ...(byKey.portal ?? {}) },
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

  get terms(): Terms {
    return { ...this.cache.terms };
  }

  get modules(): Modules {
    return { ...this.cache.modules };
  }

  get defaults(): WorkflowDefaults {
    return { ...this.cache.defaults };
  }

  get portal(): PortalSettings {
    return { ...this.cache.portal };
  }

  async updatePortal(patch: Partial<PortalSettings>, by: string): Promise<PortalSettings> {
    const next = { ...this.cache.portal };
    if (patch.open !== undefined) next.open = !!patch.open;
    if (patch.askCategory !== undefined) next.askCategory = !!patch.askCategory;
    if (patch.accessCode !== undefined) {
      const code = String(patch.accessCode ?? '').trim();
      if (code && !/^[A-Za-z0-9-]{4,32}$/.test(code)) throw new BadRequestException('Access code: 4–32 letters, digits or hyphens (or empty for none)');
      next.accessCode = code;
    }
    if (patch.intro !== undefined) next.intro = str(patch.intro, 500) ?? '';
    if (patch.introMs !== undefined) next.introMs = str(patch.introMs, 500) ?? '';
    if (patch.triageHours !== undefined) {
      const h = Number(patch.triageHours);
      if (!Number.isInteger(h) || h < 0 || h > 168) throw new BadRequestException('Reminder after: a whole number of hours from 0 (never) to 168');
      next.triageHours = h;
    }
    await this.save('portal', next, by);
    return next;
  }

  async updateTerms(patch: Partial<Terms>, by: string): Promise<Terms> {
    const next = { ...this.cache.terms };
    for (const k of Object.keys(next) as (keyof Terms)[]) {
      const v = str(patch[k], 60);
      if (v) next[k] = v;
    }
    await this.save('terms', next, by);
    return next;
  }

  async updateModules(patch: Partial<Modules>, by: string): Promise<Modules> {
    const next = { ...this.cache.modules };
    for (const k of MODULE_KEYS) if (typeof patch[k] === 'boolean') next[k] = patch[k] as boolean;
    if (next.pm && !next.assets) throw new BadRequestException('Preventive maintenance needs the asset register');
    if (next.stock && !this.cache.modules.stock) await this.ensureStockLists();
    await this.save('modules', next, by);
    return next;
  }

  /**
   * Stock needs somewhere to keep parts and units to count them in. When an
   * organisation without them switches stock on, add a main store at its first
   * site and the standard units; existing lists are left alone.
   */
  private async ensureStockLists(): Promise<void> {
    const [stores, units, site] = await Promise.all([
      this.prisma.dictionaryEntry.count({ where: { kind: 'store' } }),
      this.prisma.dictionaryEntry.count({ where: { kind: 'unit' } }),
      this.prisma.dictionaryEntry.findFirst({ where: { kind: 'site', active: true }, orderBy: [{ seq: 'asc' }, { id: 'asc' }] }),
    ]);
    const rows: { kind: string; key: string; label: string; labelMs: string; meta: object; seq: number }[] = [];
    if (!stores) rows.push({ kind: 'store', key: 'MAIN', label: 'Main store', labelMs: 'Stor utama', meta: { site: site?.key ?? 'HQ' }, seq: 0 });
    if (!units) UNITS.forEach((u, seq) => rows.push({ kind: 'unit', key: u.key, label: u.label, labelMs: u.labelMs ?? '', meta: {}, seq }));
    if (rows.length) await this.prisma.dictionaryEntry.createMany({ data: rows.map((r) => ({ ...r, meta: r.meta as never })), skipDuplicates: true });
  }

  async updateDefaults(patch: Partial<WorkflowDefaults>, by: string): Promise<WorkflowDefaults> {
    const jobPrefix = (str(patch.jobPrefix, 8) ?? this.cache.defaults.jobPrefix).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{0,7}$/.test(jobPrefix)) throw new BadRequestException('Number prefix: 1–8 letters or digits, starting with a letter');
    const next = { jobPrefix, initialLocation: str(patch.initialLocation, 40) || this.cache.defaults.initialLocation };
    await this.save('defaults', next, by);
    return next;
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
