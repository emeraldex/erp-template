import type { TransitionRule } from '../common/types';
import type { InvoiceStreamDef, SlaRule } from '../common/workflow-config';

export type Kind = 'JOB' | 'DEMAND' | 'OV' | 'INVOICE';
export const KINDS: Kind[] = ['JOB', 'DEMAND', 'OV', 'INVOICE'];

export type Tone = 'neutral' | 'info' | 'warn' | 'good' | 'bad';

/**
 * What a status means, independent of its name. Dashboards, locking, archiving
 * and alerts work from phases, so any sector can name its statuses freely.
 */
export type Phase = 'new' | 'active' | 'waiting_parts' | 'waiting_customer' | 'external' | 'done' | 'closed';
export const PHASES: Phase[] = ['new', 'active', 'waiting_parts', 'waiting_customer', 'external', 'done', 'closed'];

export interface StatusMeta {
  tone: Tone;
  phase: Phase;
  /** No further changes: the record is locked (and later archived). */
  final?: boolean;
  /** Invoices: documents carry a DRAFT watermark in this status. */
  draftDocuments?: boolean;
  /** Demands: supplier quotations can be recorded in this status. */
  acceptsQuotations?: boolean;
}

export interface Entry<M = Record<string, unknown>> {
  key: string;
  label: string;
  labelMs?: string;
  meta?: M;
}

/**
 * Everything a role may do beyond the workflow steps it owns. ADMIN is a
 * reserved role that holds every capability.
 */
export const CAPABILITIES = {
  'org.admin': 'Users, settings, single sign-on, run background jobs',
  'workflow.edit': 'Workflow editor and SLA timers',
  'jobs.register': 'Register new work orders',
  'priority.raise': 'Raise and update priorities',
  'priority.close': 'Close priorities',
  'procurement.quote': 'Record supplier quotations',
  'invoices.create': 'Open invoices',
  'invoices.documents': 'Download billing documents',
  'registers.propose': 'Propose and register suppliers',
  'registers.evaluate': 'Evaluate and reassess suppliers',
  'registers.approve': 'Approve suppliers and issue CARs',
  'incidents.manage': 'Review and close incidents',
  'tools.handle': 'Sign tools in and out',
  'assets.manage': 'Create and edit assets and PM schedules',
  'meters.record': 'Record meter readings',
  'reports.billing': 'Revenue and outstanding-payment reports',
  'reports.payments': 'Payment-system export files',
  'reports.audit': 'Audit trail, retention report, attachment checks',
  'alerts.escalation': 'Receive escalations for every SLA breach',
} as const;
export type Capability = keyof typeof CAPABILITIES;
export const ADMIN_ROLE = 'ADMIN';

export interface RoleMeta { capabilities: Capability[]; description?: string }

/** Words the interface uses, so each sector sees its own vocabulary. */
export interface Terms {
  job: string; jobs: string; jobNo: string; jobRegister: string;
  component: string; originUnit: string; site: string; sites: string;
  demand: string; demands: string; vendorRepair: string; vendorRepairs: string;
  priority: string; incident: string; incidents: string; registers: string;
  asset: string; assets: string; pm: string;
}

export interface Modules {
  procurement: boolean; vendorRepair: boolean; priority: boolean; incidents: boolean;
  tools: boolean; training: boolean; invoicing: boolean; registers: boolean;
  assets: boolean; pm: boolean;
}
export const MODULE_KEYS: (keyof Modules)[] = ['procurement', 'vendorRepair', 'priority', 'incidents', 'tools', 'training', 'invoicing', 'registers', 'assets', 'pm'];

/** Dictionary kinds a pack fills in (besides statuses and roles). */
export const DICT_KINDS = ['site', 'location', 'category', 'priority', 'route', 'incidentArea', 'course', 'jobType', 'assetType'] as const;
export type DictKind = (typeof DICT_KINDS)[number];

export interface Pack {
  id: string;
  name: string;
  description: string;
  terms: Terms;
  modules: Modules;
  statuses: Record<Kind, Entry<StatusMeta>[]>;
  transitions: Record<Kind, TransitionRule[]>;
  roles: Entry<RoleMeta>[];
  dictionaries: Record<DictKind, Entry[]>;
  slaRules: SlaRule[];
  invoiceStreams: InvoiceStreamDef[];
  defaults: {
    /** Prefix of work-order numbers, e.g. "PS" → PS-2026-0001. */
    jobPrefix: string;
    /** Location of a newly registered item. */
    initialLocation: string;
    tax: { label: string; ratePct: number };
  };
}
