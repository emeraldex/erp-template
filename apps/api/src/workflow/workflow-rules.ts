import type { Role, TransitionRule } from '../common/types';
import type { Kind } from '../packs/types';
import { validateEffects } from './effects';

export type { Kind } from '../packs/types';
export { KINDS } from '../packs/types';

/** The organisation's vocabulary a workflow is checked against. */
export interface WorkflowContext {
  statuses: string[];
  /** Where records start: the first status. */
  initial: string;
  roles: string[];
  locations: string[];
  /** Final statuses, which need no way out. */
  final?: string[];
}

const KEY = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const FORM = /^[A-Za-z0-9 ./-]{1,20}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export interface ValidationResult { rules: TransitionRule[]; errors: string[]; warnings: string[] }

/** Normalise and check a full replacement list of transitions for one kind. */
export function validateTransitions(kind: Kind, input: unknown, ctx: WorkflowContext): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const statuses = ctx.statuses;
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
    for (const role of roles) if (!ctx.roles.includes(role)) errors.push(`${at}: unknown role ${role}`);

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
    if (setLocation && !ctx.locations.includes(setLocation)) errors.push(`${at}: unknown location ${setLocation}`);
    if (setLocation && kind !== 'JOB') errors.push(`${at}: only job transitions can move the item`);

    const fx = validateEffects(kind, r.effects, { fields: requires.map((x) => x.key), locations: ctx.locations });
    for (const e of fx.errors) errors.push(`${at} (${from} → ${to}): ${e}`);

    rules.push({
      from: from as never, to: to as never, label, labelMs, roles: roles as Role[], requires,
      ...(setLocation ? { setLocation: setLocation as never } : {}), ...(fx.effects.length ? { effects: fx.effects } : {}),
    });
  });

  // Reachability from the start status — a warning, since a status may be retired on purpose.
  const reach = new Set([ctx.initial]);
  for (let changed = true; changed;) {
    changed = false;
    for (const r of rules) if (reach.has(r.from) && !reach.has(r.to)) { reach.add(r.to); changed = true; }
  }
  const unreachable = statuses.filter((s) => !reach.has(s));
  if (unreachable.length) warnings.push(`Not reachable from ${ctx.initial}: ${unreachable.join(', ')}`);
  const exits = new Set(rules.map((r) => r.from));
  // Final statuses are meant to be dead ends; anything else that is one strands records.
  const deadEnds = [...reach].filter((s) => !exits.has(s) && !ctx.final?.includes(s));
  if (deadEnds.length) warnings.push(`No way out of: ${deadEnds.join(', ')}${ctx.final ? '' : ' (fine for final statuses)'}`);

  return { rules, errors, warnings };
}
