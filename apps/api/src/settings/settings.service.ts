import { CURRENCIES, Currency, currencyOf } from './currency';
import { accentProblem, imageInfo, LOGO_MAX_BYTES, LOGO_MIN_EDGE } from './brand';
import { createHash } from 'crypto';
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
  /** The currency the organisation keeps its books in (ISO code). */
  currency: { code: string };
  /** Brand colour (null = the product's own) and the theme people start with. */
  brand: BrandSettings;
  /** Cost per hour by role, and the organisation's default (null = labour is not costed). */
  labour: LabourSettings;
  /** Preventive work counts as on time if done by its due date plus this many days. */
  maintenance: { pmGraceDays: number };
  /** Account codes for the accounting export. */
  accounting: AccountingSettings;
}

export interface AccountingSettings {
  receivables: string; bank: string; outputTax: string; taxCode: string; purchases: string; stock: string;
  revenueDefault: string; revenueByStream: Record<string, string>;
}

export interface LabourSettings { defaultRate: number | null; roleRates: Record<string, number> }

export type Theme = 'dark' | 'light' | 'system';
export interface BrandSettings { accent: string | null; defaultTheme: Theme }
export interface Logo { contentType: 'image/png' | 'image/jpeg'; data: string; sha256: string; width: number; height: number; updatedAt: string }

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
  currency: { code: 'MYR' },
  brand: { accent: null, defaultTheme: 'dark' },
  labour: { defaultRate: null, roleRates: {} },
  maintenance: { pmGraceDays: 7 },
  accounting: { receivables: '1200', bank: '1000', outputTax: '2200', taxCode: 'SR', purchases: '5000', stock: '1300', revenueDefault: '4000', revenueByStream: {} },
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/** Organisation settings, cached in memory and persisted in the settings table. */
@Injectable()
export class SettingsService {
  /** Per tenant, re-read every 30 s so changes made on another replica show up. */
  private readonly caches = new Map<string, { settings: Settings; logo: Logo | null; loadedAt: number }>();

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
        currency: { ...DEFAULT_SETTINGS.currency, ...(byKey.currency ?? {}) },
        brand: { ...DEFAULT_SETTINGS.brand, ...(byKey.brand ?? {}) },
        labour: { ...DEFAULT_SETTINGS.labour, ...(byKey.labour ?? {}) },
        maintenance: { ...DEFAULT_SETTINGS.maintenance, ...(byKey.maintenance ?? {}) },
        accounting: { ...DEFAULT_SETTINGS.accounting, ...(byKey.accounting ?? {}) },
      },
      logo: (byKey.logo as Logo | undefined)?.data ? (byKey.logo as Logo) : null,
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

  /** The organisation's currency: symbol, decimals and the words invoices use. */
  get currency(): Currency {
    return currencyOf(this.cache.currency.code);
  }

  /** Has the organisation recorded any money yet? Then its currency can no longer be changed here. */
  async moneyRecorded(): Promise<boolean> {
    const [invoices, quotes, moves, time] = await Promise.all([
      this.prisma.invoice.count(), this.prisma.quotation.count(), this.prisma.stockMovement.count({ where: { unitCost: { gt: 0 } } }),
      this.prisma.timeEntry.count({ where: { cost: { gt: 0 } } }),
    ]);
    return invoices + quotes + moves + time > 0;
  }

  async updateCurrency(code: unknown, by: string): Promise<Currency> {
    const next = CURRENCIES.find((x) => x.code === String(code ?? '').toUpperCase());
    if (!next) throw new BadRequestException(`Choose one of: ${CURRENCIES.map((x) => x.code).join(', ')}`);
    if (next.code === this.cache.currency.code) return next;
    if (await this.moneyRecorded()) {
      throw new BadRequestException('Amounts are already recorded in this currency — changing it would relabel them without converting. Ask your system administrator (tenants-cli set-currency --force).');
    }
    await this.save('currency', { code: next.code }, by);
    return next;
  }

  get brand(): BrandSettings {
    return { ...this.cache.brand };
  }

  async updateBrand(patch: Partial<BrandSettings>, by: string): Promise<BrandSettings> {
    const next = { ...this.cache.brand };
    if (patch.accent !== undefined) {
      if (patch.accent === null || patch.accent === '') next.accent = null;
      else {
        const problem = accentProblem(patch.accent);
        if (problem) throw new BadRequestException(problem);
        next.accent = String(patch.accent).toLowerCase();
      }
    }
    if (patch.defaultTheme !== undefined) {
      if (!['dark', 'light', 'system'].includes(String(patch.defaultTheme))) throw new BadRequestException('Theme: dark, light or system');
      next.defaultTheme = patch.defaultTheme as Theme;
    }
    await this.save('brand', next, by);
    return next;
  }

  /** The organisation's logo, if it has one. */
  get logo(): { buffer: Buffer; contentType: string; sha256: string; width: number; height: number } | null {
    const l = this.caches.get(currentTenant().id)?.logo ?? null;
    return l ? { buffer: Buffer.from(l.data, 'base64'), contentType: l.contentType, sha256: l.sha256, width: l.width, height: l.height } : null;
  }

  /** PNG or JPEG, recognised by content (never SVG, which can carry scripts), up to 512 KB, at least 64 px. */
  async setLogo(file: { buffer: Buffer; size: number } | undefined, by: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach the logo in the "file" field');
    if (file.size > LOGO_MAX_BYTES) throw new BadRequestException('The logo must be 512 KB or smaller');
    const info = imageInfo(file.buffer);
    if (!info) throw new BadRequestException('The logo must be a PNG or JPEG image');
    if (Math.min(info.width, info.height) < LOGO_MIN_EDGE) throw new BadRequestException(`The logo is too small (${info.width} × ${info.height}); it needs at least ${LOGO_MIN_EDGE} pixels on its short side`);
    if (Math.max(info.width, info.height) > 4000) throw new BadRequestException('The logo is too large (more than 4000 pixels on a side)');
    const logo: Logo = {
      contentType: info.type, data: file.buffer.toString('base64'), sha256: createHash('sha256').update(file.buffer).digest('hex'),
      width: info.width, height: info.height, updatedAt: new Date().toISOString(),
    };
    await this.prisma.setting.upsert({ where: { key: 'logo' }, create: { key: 'logo', value: logo as never, updatedBy: by }, update: { value: logo as never, updatedBy: by } });
    await this.reload();
    return { width: info.width, height: info.height, contentType: info.type, version: logo.sha256.slice(0, 12) };
  }

  async removeLogo(): Promise<void> {
    await this.prisma.setting.deleteMany({ where: { key: 'logo' } });
    await this.reload();
  }

  /** What screens need to brand themselves (no image bytes). */
  get branding() {
    const l = this.caches.get(currentTenant().id)?.logo ?? null;
    return { ...this.cache.brand, logo: l ? l.sha256.slice(0, 12) : null };
  }

  get labour(): LabourSettings {
    return { defaultRate: this.cache.labour.defaultRate, roleRates: { ...this.cache.labour.roleRates } };
  }

  async updateLabour(patch: Partial<LabourSettings>, roles: string[], by: string): Promise<LabourSettings> {
    const rate = (v: unknown, label: string) => {
      if (v === null || v === '' || v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new BadRequestException(`${label}: a cost per hour from 0 to 1,000,000`);
      return Math.round(n * 10_000) / 10_000;
    };
    const next = this.labour;
    if (patch.defaultRate !== undefined) next.defaultRate = rate(patch.defaultRate, 'Default rate');
    if (patch.roleRates !== undefined) {
      if (typeof patch.roleRates !== 'object' || patch.roleRates === null || Array.isArray(patch.roleRates)) throw new BadRequestException('roleRates: { ROLE: rate }');
      const out: Record<string, number> = {};
      for (const [role, v] of Object.entries(patch.roleRates)) {
        if (!roles.includes(role)) throw new BadRequestException(`Unknown role ${role}`);
        const r = rate(v, role);
        if (r !== null) out[role] = r;
      }
      next.roleRates = out;
    }
    await this.save('labour', next, by);
    return next;
  }

  get maintenance(): { pmGraceDays: number } {
    return { ...this.cache.maintenance };
  }

  async updateMaintenance(patch: { pmGraceDays?: unknown }, by: string) {
    const next = this.maintenance;
    if (patch.pmGraceDays !== undefined) {
      const n = Number(patch.pmGraceDays);
      if (!Number.isInteger(n) || n < 0 || n > 90) throw new BadRequestException('Grace for preventive work: 0 to 90 days');
      next.pmGraceDays = n;
    }
    await this.save('maintenance', next, by);
    return next;
  }

  get accounting(): AccountingSettings {
    return { ...this.cache.accounting, revenueByStream: { ...this.cache.accounting.revenueByStream } };
  }

  async updateAccounting(patch: Partial<AccountingSettings>, streams: string[], by: string): Promise<AccountingSettings> {
    const code = (v: unknown, label: string) => {
      const s = String(v ?? '').trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9 ./-]{0,23}$/.test(s)) throw new BadRequestException(`${label}: 1–24 letters, digits, spaces or . / -`);
      return s;
    };
    const next = this.accounting;
    const labels: [keyof AccountingSettings, string][] = [['receivables', 'Receivables account'], ['bank', 'Bank account'], ['outputTax', 'Output tax account'], ['taxCode', 'Tax code'], ['purchases', 'Purchases account'], ['stock', 'Stock account'], ['revenueDefault', 'Revenue account']];
    for (const [k, label] of labels) if (patch[k] !== undefined) (next as unknown as Record<string, string>)[k] = code(patch[k], label);
    if (patch.revenueByStream !== undefined) {
      if (typeof patch.revenueByStream !== 'object' || patch.revenueByStream === null) throw new BadRequestException('revenueByStream: { STREAM: account }');
      const out: Record<string, string> = {};
      for (const [stream, v] of Object.entries(patch.revenueByStream)) {
        if (!streams.includes(stream)) throw new BadRequestException(`Unknown invoicing stream ${stream}`);
        if (v !== null && v !== '') out[stream] = code(v, `Revenue account for ${stream}`);
      }
      next.revenueByStream = out;
    }
    await this.save('accounting', next, by);
    return next;
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
