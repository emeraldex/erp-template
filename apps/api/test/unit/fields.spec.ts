import { checkTypedFields, type FieldLookups } from '../../src/workflow/fields';
import { validateTransitions } from '../../src/workflow/workflow-rules';
import { GENERAL } from '../../src/packs/sectors';

const files: Record<string, Awaited<ReturnType<FieldLookups['attachment']>>> = {
  'photo-1': { entity: 'JOB', entityId: 'WO-1', kind: 'photo', contentType: 'image/jpeg', filename: 'after.jpg', signedBy: null },
  'pdf-1': { entity: 'JOB', entityId: 'WO-1', kind: 'file', contentType: 'application/pdf', filename: 'report.pdf', signedBy: null },
  'other-job': { entity: 'JOB', entityId: 'WO-2', kind: 'photo', contentType: 'image/jpeg', filename: 'x.jpg', signedBy: null },
  'sig-1': { entity: 'JOB', entityId: 'WO-1', kind: 'signature', contentType: 'image/png', filename: 'sig.png', signedBy: 'Siti Aminah' },
};
const ctx: FieldLookups = {
  entity: 'JOB', entityId: 'WO-1',
  user: async (id) => (id === 'u-1' ? { name: 'Ravi Kumar' } : null),
  attachment: async (id) => files[id] ?? null,
};
const req = [
  { key: 'n', label: 'Odometer', type: 'number' as const },
  { key: 'd', label: 'Next due', type: 'date' as const },
  { key: 'u', label: 'Assigned to', type: 'user' as const },
  { key: 'p', label: 'Photo', type: 'photo' as const },
  { key: 's', label: 'Sign-off', type: 'signature' as const },
  { key: 't', label: 'Notes' },
];

describe('typed step fields', () => {
  it('accepts good values and shows readable ones in the audit trail', async () => {
    const shown = await checkTypedFields(req, { n: '84211', d: '2026-12-31', u: 'u-1', p: 'photo-1', s: 'sig-1', t: 'free text' }, ctx);
    expect(shown).toEqual({ u: 'Ravi Kumar', p: 'photo after.jpg', s: 'signed by Siti Aminah' });
  });

  it('lists every bad value', async () => {
    await expect(checkTypedFields(req, { n: 'abc', d: '2026-02-30', u: 'u-9', p: 'pdf-1', s: 'photo-1', t: 'x' }, ctx)).rejects.toMatchObject({
      response: {
        errors: [
          'Odometer: must be a number', 'Next due: must be a date (YYYY-MM-DD)', 'Assigned to: choose an active member of staff',
          'Photo: must be a photo', "Sign-off: must be a signature with the signer's name",
        ],
      },
    });
  });

  it("refuses another record's photo", async () => {
    await expect(checkTypedFields([req[3]], { p: 'other-job' }, ctx)).rejects.toThrow('Photo: attach the photo to this record first');
  });

  it('leaves missing values to the mandatory-field check', async () => {
    expect(await checkTypedFields(req, {}, ctx)).toEqual({});
  });
});

describe('workflow validator — field types', () => {
  const pack = GENERAL;
  const statuses = pack.statuses.JOB.map((s) => s.key);
  const ctxV = { statuses, initial: statuses[0], roles: pack.roles.map((r) => r.key), locations: pack.dictionaries.location.map((l) => l.key), final: ['CLOSED', 'CANCELLED'] };
  const rules = () => structuredClone(pack.transitions.JOB);

  it('keeps types and refuses unknown ones', () => {
    const ok = validateTransitions('JOB', rules(), ctxV);
    expect(ok.errors).toEqual([]);
    expect(ok.rules[0].requires[0]).toEqual({ key: 'assignee', label: 'Assigned to', type: 'user' });
    const bad = rules().map((r, i) => (i === 0 ? { ...r, requires: [{ key: 'assignee', label: 'Assigned to', type: 'colour' }] } : r));
    expect(validateTransitions('JOB', bad, ctxV).errors.join(' ')).toContain('unknown type colour');
  });

  it('needs a person field for "Assign to a person"', () => {
    const bad = rules().map((r, i) => (i === 0 ? { ...r, requires: [{ key: 'assignee', label: 'Assigned to' }] } : r));
    expect(validateTransitions('JOB', bad, ctxV).errors.join(' ')).toContain('must be a person field');
  });
});
