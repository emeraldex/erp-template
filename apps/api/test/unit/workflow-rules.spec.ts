import { JOB_TRANSITIONS, INVOICE_TRANSITIONS } from '../../src/common/workflow-config';
import { protectedRules, validateTransitions } from '../../src/workflow/workflow-rules';

const clone = <T,>(x: T): T => structuredClone(x);

describe('workflow editor validation', () => {
  it('accepts the shipped workflows unchanged', () => {
    expect(validateTransitions('JOB', clone(JOB_TRANSITIONS)).errors).toEqual([]);
    expect(validateTransitions('INVOICE', clone(INVOICE_TRANSITIONS)).errors).toEqual([]);
  });

  it('protects transitions and fields the system logic reads', () => {
    expect(protectedRules('JOB')).toEqual(expect.arrayContaining([
      { from: 'TDI', to: 'AWAITING_SPARE', keys: ['f212Ref'] },
      { from: 'TDI', to: 'REC_OV', keys: ['f135Ref'] },
    ]));
    const withoutDemand = clone(JOB_TRANSITIONS).filter((r) => !(r.from === 'TDI' && r.to === 'AWAITING_SPARE'));
    expect(validateTransitions('JOB', withoutDemand).errors).toContain('TDI → AWAITING_SPARE is used by the system and cannot be removed');
    const stripped = clone(JOB_TRANSITIONS).map((r) => (r.to === 'REC_OV' ? { ...r, requires: [] } : r));
    expect(validateTransitions('JOB', stripped).errors).toContain('TDI → REC_OV: field f135Ref is used by the system and cannot be removed');
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
