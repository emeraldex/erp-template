import { PACKS } from '../../src/packs';
import { CAPABILITIES, KINDS, MODULE_KEYS, PHASES, type Pack } from '../../src/packs/types';
import { validateTransitions } from '../../src/workflow/workflow-rules';

const packs = Object.values(PACKS);
const keys = (list: { key: string }[]) => list.map((e) => e.key);

describe('sector packs', () => {
  it('ships aviation plus the general-purpose packs', () => {
    expect(Object.keys(PACKS).sort()).toEqual(['aviation', 'facilities', 'fleet', 'general', 'industrial', 'medical']);
  });

  describe.each(packs.map((p) => [p.id, p] as [string, Pack]))('%s', (_id, pack) => {
    const roles = keys(pack.roles);
    const locations = keys(pack.dictionaries.location);

    it.each(KINDS)('has a valid %s workflow whose actions read mandatory fields', (kind) => {
      const statuses = keys(pack.statuses[kind]);
      const res = validateTransitions(kind, structuredClone(pack.transitions[kind]), {
        statuses, initial: statuses[0], roles, locations, final: pack.statuses[kind].filter((s) => s.meta?.final).map((s) => s.key),
      });
      expect(res.errors).toEqual([]);
      // Known in the original aviation configuration, kept unchanged: stock issues end there.
      const known = pack.id === 'aviation' && kind === 'DEMAND' ? ['No way out of: ISSUED_FROM_STOCK'] : [];
      expect(res.warnings).toEqual(known);
    });

    it('gives every status a phase, and at least one is final', () => {
      for (const kind of KINDS) {
        for (const s of pack.statuses[kind]) expect(PHASES).toContain(s.meta?.phase);
        expect(pack.statuses[kind].some((s) => s.meta?.final)).toBe(true);
        expect(new Set(keys(pack.statuses[kind])).size).toBe(pack.statuses[kind].length);
      }
    });

    it('has an ADMIN role and only known permissions', () => {
      expect(roles).toContain('ADMIN');
      for (const r of pack.roles) for (const c of r.meta?.capabilities ?? []) expect(Object.keys(CAPABILITIES)).toContain(c);
      // Every role that owns a step exists, and someone can register work.
      expect(pack.roles.some((r) => r.meta?.capabilities.includes('jobs.register'))).toBe(true);
    });

    it('points timers, streams and defaults at things that exist', () => {
      for (const s of pack.slaRules) expect(keys(pack.statuses[s.entity])).toContain(s.status);
      expect(new Set(pack.slaRules.map((s) => s.id)).size).toBe(pack.slaRules.length);
      for (const st of pack.invoiceStreams) {
        for (const status of Object.keys(st.requiredFields ?? {})) expect(keys(pack.statuses.INVOICE)).toContain(status);
      }
      expect(locations).toContain(pack.defaults.initialLocation);
      expect(pack.defaults.jobPrefix).toMatch(/^[A-Z][A-Z0-9]{0,7}$/);
      expect(pack.dictionaries.site.length).toBeGreaterThan(0);
      expect(pack.dictionaries.priority.length).toBeGreaterThan(0);
    });

    it('sets every module and term', () => {
      for (const m of MODULE_KEYS) expect(typeof pack.modules[m]).toBe('boolean');
      if (pack.modules.pm) expect(pack.modules.assets).toBe(true);
      for (const t of Object.keys(PACKS.aviation.terms)) expect((pack.terms as unknown as Record<string, string>)[t]).toBeTruthy();
    });

    it('has Bahasa Melayu labels for statuses and steps', () => {
      for (const kind of KINDS) {
        for (const s of pack.statuses[kind]) expect(s.labelMs).toBeTruthy();
        for (const t of pack.transitions[kind]) expect(t.labelMs).toBeTruthy();
      }
    });
  });
});
