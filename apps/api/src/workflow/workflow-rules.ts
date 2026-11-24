import type { Role, TransitionRule } from '../common/types';
import {
  DEMAND_STATUS_META, DEMAND_TRANSITIONS, INVOICE_STATUS_META, INVOICE_TRANSITIONS, JOB_STATUS_META, JOB_TRANSITIONS,
  OV_STATUS_META, OV_TRANSITIONS,
} from '../common/workflow-config';

export type Kind = 'JOB' | 'DEMAND' | 'OV' | 'INVOICE';
export const KINDS: Kind[] = ['JOB', 'DEMAND', 'OV', 'INVOICE'];
export const ROLES: Role[] = ['ADMIN', 'STORES', 'WORKSHOP', 'MIS', 'MM', 'PURCHASING', 'PCE', 'QUALITY', 'FINANCE', 'BILLING'];
export const LOCATIONS = ['LOGISTIC', 'BAY', 'HQ', 'VENDOR', 'CUSTOMER'] as const;

/** Statuses are database enums: the editor can rewire them, not invent new ones. */
export const STATUSES: Record<Kind, string[]> = {
  JOB: Object.keys(JOB_STATUS_META),
  DEMAND: Object.keys(DEMAND_STATUS_META),
  OV: Object.keys(OV_STATUS_META),
  INVOICE: Object.keys(INVOICE_STATUS_META),
};

/** Where each kind's records start. */
export const INITIAL: Record<Kind, string> = { JOB: 'REGISTERED', DEMAND: 'RAISED', OV: 'RECEIVED_HQ', INVOICE: 'DRAFTED' };

/** Field keys the services read when a transition happens (see *.service.ts). */
const SYSTEM_KEYS: Record<Kind, string[]> = {
  JOB: ['f212Ref', 'f135Ref'],
  DEMAND: ['f244Ref', 'f220Ref', 'f221Ref', 'f312Ref'],
  OV: ['vendorId', 'f134Ref', 'f312Ref', 'costMYR', 'eddDays'],
  INVOICE: ['customerSignRef', 'ctcRef', 'f311Ref', 'amountMYR', 'correctnessBy', 'paymentRef'],
};

const SHIPPED: Record<Kind, TransitionRule[]> = {
  JOB: JOB_TRANSITIONS, DEMAND: DEMAND_TRANSITIONS, OV: OV_TRANSITIONS, INVOICE: INVOICE_TRANSITIONS,
};

/**
 * Transitions and mandatory fields the system logic depends on: the shipped
 * transition's required fields that a service reads. They cannot be removed.
 */
export function protectedRules(kind: Kind): { from: string; to: string; keys: string[] }[] {
  return SHIPPED[kind]
    .map((r) => ({ from: r.from, to: r.to, keys: r.requires.map((f) => f.key).filter((k) => SYSTEM_KEYS[kind].includes(k)) }))
    .filter((p) => p.keys.length);
}

const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const FORM = /^[A-Za-z0-9 ./-]{1,20}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface ValidationResult { rules: TransitionRule[]; errors: string[]; warnings: string[] }

/** Normalise and check a full replacement list of transitions for one kind. */
export function validateTransitions(kind: Kind, input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const statuses = STATUSES[kind];
  if (!Array.isArray(input)) return { rules: [], errors: ['Body must be a list of transitions'], warnings };
  if (input.length > 200) errors.push('At most 200 transitions');

  const rules: TransitionRule[] = [];
  const seen = new Set<string>();
  input.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const at = `Transition ${i + 1}`;
    const from = clean(r.from, 40);
    const to = clean(r.to, 40);
    if (!statuses.includes(from)) errors.push(`${at}: unknown "from" status ${from || '(empty)'}`);
    if (!statuses.includes(to)) errors.push(`${at}: unknown "to" status ${to || '(empty)'}`);
    if (from && from === to) errors.push(`${at}: from and to are the same status`);
    if (seen.has(`${from}>${to}`)) errors.push(`${at}: ${from} → ${to} is listed twice`);
    seen.add(`${from}>${to}`);

    const label = clean(r.label, 120);
    const labelMs = clean(r.labelMs, 120);
    if (!label) errors.push(`${at}: an English label is required`);
    if (!labelMs) errors.push(`${at}: a Bahasa Melayu label is required (§7.2)`);

    const roles = Array.isArray(r.roles) ? [...new Set(r.roles as string[])] : [];
    if (!roles.length) errors.push(`${at}: at least one role must own this step`);
    for (const role of roles) if (!ROLES.includes(role as Role)) errors.push(`${at}: unknown role ${role}`);

    const requires: TransitionRule['requires'] = [];
    const keys = new Set<string>();
    for (const [j, f] of (Array.isArray(r.requires) ? r.requires : []).entries()) {
      const field = (f ?? {}) as Record<string, unknown>;
      const key = clean(field.key, 41);
      const flabel = clean(field.label, 120);
      const formNo = clean(field.formNo, 20);
      if (!KEY.test(key)) errors.push(`${at}, field ${j + 1}: key must be letters and digits, starting with a letter`);
      if (keys.has(key)) errors.push(`${at}: field ${key} is listed twice`);
      keys.add(key);
      if (!flabel) errors.push(`${at}, field ${key || j + 1}: a label is required`);
      if (formNo && !FORM.test(formNo)) errors.push(`${at}, field ${key}: form number may contain letters, digits, space, . / -`);
      requires.push({ key, label: flabel, ...(formNo ? { formNo } : {}) });
    }
    if (requires.length > 15) errors.push(`${at}: at most 15 mandatory fields`);

    const setLocation = clean(r.setLocation, 20) || undefined;
    if (setLocation && !(LOCATIONS as readonly string[]).includes(setLocation)) errors.push(`${at}: unknown location ${setLocation}`);
    if (setLocation && kind !== 'JOB') errors.push(`${at}: only job transitions can move the item`);

    rules.push({ from: from as never, to: to as never, label, labelMs, roles: roles as Role[], requires, ...(setLocation ? { setLocation: setLocation as never } : {}) });
  });

  for (const p of protectedRules(kind)) {
    const rule = rules.find((r) => r.from === p.from && r.to === p.to);
    if (!rule) {
      errors.push(`${p.from} → ${p.to} is used by the system and cannot be removed`);
      continue;
    }
    for (const key of p.keys) {
      if (!rule.requires.some((f) => f.key === key)) errors.push(`${p.from} → ${p.to}: field ${key} is used by the system and cannot be removed`);
    }
  }

  // Reachability from the start status — a warning, since a status may be retired on purpose.
  const reach = new Set([INITIAL[kind]]);
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rules) if (reach.has(r.from) && !reach.has(r.to)) { reach.add(r.to); changed = true; }
  }
  const unreachable = statuses.filter((s) => !reach.has(s));
  if (unreachable.length) warnings.push(`Not reachable from ${INITIAL[kind]}: ${unreachable.join(', ')}`);
  const exits = new Set(rules.map((r) => r.from));
  const deadEnds = [...reach].filter((s) => !exits.has(s));
  if (deadEnds.length) warnings.push(`No way out of: ${deadEnds.join(', ')} (fine for final statuses)`);

  return { rules, errors, warnings };
}
