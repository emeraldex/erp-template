import { JOB_TRANSITIONS, INVOICE_TRANSITIONS } from '../../src/common/workflow-config';
import { AVIATION } from '../../src/packs/aviation';
import type { Kind } from '../../src/packs/types';
import { validateTransitions as validate, type WorkflowContext } from '../../src/workflow/workflow-rules';

const clone = <T,>(x: T): T => structuredClone(x);

/** The aviation organisation's vocabulary. */
const ctx = (kind: Kind): WorkflowContext => ({
  statuses: AVIATION.statuses[kind].map((s) => s.key),
  initial: AVIATION.statuses[kind][0].key,
  roles: AVIATION.roles.map((r) => r.key),
  locations: AVIATION.dictionaries.location.map((l) => l.key),
});
const validateTransitions = (kind: Kind, input: unknown) => validate(kind, input, ctx(kind));

describe('workflow editor validation', () => {
  it('accepts the shipped workflows unchanged', () => {
    expect(validateTransitions('JOB', clone(JOB_TRANSITIONS)).errors).toEqual([]);
    expect(validateTransitions('INVOICE', clone(INVOICE_TRANSITIONS)).errors).toEqual([]);
  });

  it('keeps fields mandatory while a step\'s action reads them', () => {
    const at = JOB_TRANSITIONS.findIndex((r) => r.to === 'REC_OV') + 1;
    const stripped = clone(JOB_TRANSITIONS).map((r) => (r.to === 'REC_OV' ? { ...r, requires: [] } : r));
    expect(validateTransitions('JOB', stripped).errors)
      .toContain(`Transition ${at} (TDI → REC_OV): field f135Ref is needed by the action "Open an outside-vendor repair" and must stay mandatory`);
    // Dropping the action as well frees the field.
    const plain = clone(JOB_TRANSITIONS).map((r) => (r.to === 'REC_OV' ? { ...r, requires: [], effects: [] } : r));
    expect(validateTransitions('JOB', plain).errors).toEqual([]);
  });

  it('lets an organisation remove a step together with its actions', () => {
    const withoutDemand = clone(JOB_TRANSITIONS).filter((r) => !(r.from === 'TDI' && r.to === 'AWAITING_SPARE'));
    expect(validateTransitions('JOB', withoutDemand).errors).toEqual([]);
  });

  it('rejects unknown actions and bad action settings', () => {
    const bad = clone(JOB_TRANSITIONS).map((r, i) => (i === 0 ? { ...r, effects: [{ type: 'launchRocket' }] } : r));
    expect(validateTransitions('JOB', bad).errors.join(' ')).toContain('launchRocket');
    const wrongKind = clone(INVOICE_TRANSITIONS).map((r, i) => (i === 0 ? { ...r, effects: [{ type: 'raiseDemand', params: { refField: 'x' } }] } : r));
    expect(validateTransitions('INVOICE', wrongKind).errors.length).toBeGreaterThan(0);
  });

  it('checks against the organisation\'s own roles and statuses', () => {
    const fleet: WorkflowContext = { statuses: ['OPEN', 'DONE'], initial: 'OPEN', roles: ['TECH'], locations: ['DEPOT'] };
    const rules = [{ from: 'OPEN', to: 'DONE', label: 'Finish', labelMs: 'Selesai', roles: ['TECH'], requires: [], setLocation: 'DEPOT' }];
    expect(validate('JOB', rules, fleet).errors).toEqual([]);
    expect(validate('JOB', [{ ...rules[0], roles: ['STORES'] }], fleet).errors).toContain('Transition 1: unknown role STORES');
  });

  it('allows changing roles, labels and non-system fields', () => {
    const edited = clone(JOB_TRANSITIONS).map((r) =>
      r.from === 'REGISTERED' ? { ...r, roles: ['STORES', 'PCE'], label: 'Send to bay', requires: [...r.requires, { key: 'binNo', label: 'Bin number' }] } : r);
    const res = validateTransitions('JOB', edited);
    expect(res.errors).toEqual([]);
    expect(res.rules[0]).toEqual(expect.objectContaining({ roles: ['STORES', 'PCE'], label: 'Send to bay' }));
  });

  it('rejects malformed rules with a precise message', () => {
    const bad = [
      { from: 'REGISTERED', to: 'REGISTERED', label: 'x', labelMs: 'x', roles: ['STORES'], requires: [] },
      { from: 'REGISTERED', to: 'NOPE', label: '', labelMs: '', roles: [], requires: [{ key: '1bad', label: '' }] },
      { from: 'TDI', to: 'WIP', label: 'x', labelMs: 'x', roles: ['JANITOR'], requires: [], setLocation: 'MOON' },
    ];
    const { errors } = validateTransitions('JOB', bad);
    for (const msg of [
      'Transition 1: from and to are the same status',
      'Transition 2: unknown "to" status NOPE',
      'Transition 2: an English label is required',
      'Transition 2: a Bahasa Melayu label is required (§7.2)',
      'Transition 2: at least one role must own this step',
      'Transition 2, field 1: key must be letters and digits, starting with a letter',
      'Transition 3: unknown role JANITOR',
      'Transition 3: unknown location MOON',
    ]) expect(errors).toContain(msg);
    expect(validateTransitions('JOB', 'nope').errors).toEqual(['Body must be a list of transitions']);
  });

  it('rejects duplicates and locations on non-job workflows', () => {
    const dup = [...clone(INVOICE_TRANSITIONS), clone(INVOICE_TRANSITIONS[0])];
    expect(validateTransitions('INVOICE', dup).errors.some((e) => e.includes('is listed twice'))).toBe(true);
    const loc = clone(INVOICE_TRANSITIONS).map((r, i) => (i === 0 ? { ...r, setLocation: 'HQ' } : r));
    expect(validateTransitions('INVOICE', loc).errors).toContain('Transition 1: only job transitions can move the item');
  });

  it('warns about statuses that become unreachable', () => {
    const noSor = clone(JOB_TRANSITIONS).filter((r) => r.to !== 'SOR');
    const res = validateTransitions('JOB', noSor);
    expect(res.errors).toEqual([]);
    expect(res.warnings.join(' ')).toContain('Not reachable from REGISTERED: SOR');
  });
});
