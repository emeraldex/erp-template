import { BadRequestException } from '@nestjs/common';
import type { TransitionRule } from '../common/types';

/**
 * What a mandatory step field asks for. Untyped fields are free text, exactly
 * as before; the others are checked by the server, and the audit trail records
 * a readable value (a person's name, "signed by …") instead of an id.
 */
export const FIELD_TYPES = ['text', 'number', 'date', 'user', 'photo', 'signature'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

type Field = TransitionRule['requires'][number];

export interface FieldLookups {
  /** The record the step is taken on, e.g. { entity: 'JOB', entityId: 'WO-2026-0001' }. */
  entity: string;
  entityId: string;
  user(id: string): Promise<{ name: string } | null>;
  attachment(id: string): Promise<{ entity: string; entityId: string; kind: string; contentType: string; filename: string; signedBy: string | null } | null>;
}

const isDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/**
 * Check typed fields and return the values to show in the audit trail.
 * Throws a 400 listing every problem. Missing values are left to the
 * transition engine's own "Mandatory fields missing" check.
 */
export async function checkTypedFields(requires: Field[], fields: Record<string, string>, ctx: FieldLookups): Promise<Record<string, string>> {
  const shown: Record<string, string> = {};
  const errors: string[] = [];
  for (const f of requires) {
    const type = f.type ?? 'text';
    const raw = fields[f.key];
    const value = typeof raw === 'string' ? raw.trim() : raw === undefined || raw === null ? '' : String(raw);
    if (!value || type === 'text') continue;
    switch (type) {
      case 'number':
        if (!Number.isFinite(Number(value))) errors.push(`${f.label}: must be a number`);
        break;
      case 'date':
        if (!isDate(value)) errors.push(`${f.label}: must be a date (YYYY-MM-DD)`);
        break;
      case 'user': {
        const u = await ctx.user(value);
        if (!u) errors.push(`${f.label}: choose an active member of staff`);
        else shown[f.key] = u.name;
        break;
      }
      case 'photo':
      case 'signature': {
        const a = await ctx.attachment(value);
        if (!a || a.entity !== ctx.entity || a.entityId !== ctx.entityId) {
          errors.push(`${f.label}: attach the ${type} to this record first`);
        } else if (type === 'photo' && !a.contentType.startsWith('image/')) {
          errors.push(`${f.label}: must be a photo`);
        } else if (type === 'signature' && (a.kind !== 'signature' || !a.signedBy)) {
          errors.push(`${f.label}: must be a signature with the signer's name`);
        } else {
          shown[f.key] = type === 'signature' ? `signed by ${a.signedBy}` : `photo ${a.filename}`;
        }
        break;
      }
      default:
        errors.push(`${f.label}: unknown field type ${String(type)}`);
    }
  }
  if (errors.length) throw new BadRequestException({ statusCode: 400, message: errors.length === 1 ? errors[0] : 'Some fields are not valid', errors });
  return shown;
}
