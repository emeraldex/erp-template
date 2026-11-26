import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuditEntry, FormRecord, Role, TransitionRule } from './types';

interface Workflowed {
  status: string;
  statusSince: string;
  records: FormRecord[];
  audit: AuditEntry[];
  location?: string;
}

/**
 * Config-driven transition engine (FR-02).
 * Enforces: legal from→to (FR-02), role/process-owner gate (FR-03),
 * mandatory fields (FR-05), and appends a timestamped audit entry with
 * the entered field values (FR-04). Form-numbered fields are also filed
 * into the entity's records register (Section 6).
 */
export function applyTransition<S extends string>(
  entity: Workflowed & { status: S },
  rules: TransitionRule<S>[],
  to: S,
  fields: Record<string, string>,
  actor: { name: string; role: Role },
): TransitionRule<S> {
  const rule = rules.find((r) => r.from === entity.status && r.to === to);
  if (!rule) {
    throw new BadRequestException(`Illegal transition ${entity.status} → ${to}`);
  }
  if (actor.role !== 'ADMIN' && !rule.roles.includes(actor.role)) {
    throw new ForbiddenException(
      `Stage owned by: ${rule.roles.join(' | ')} (process owner) — your role ${actor.role} may not set this status`,
    );
  }
  const missing = rule.requires.filter((f) => !f.optional && !fields?.[f.key]?.toString().trim());
  if (missing.length) {
    throw new BadRequestException(`Mandatory fields missing: ${missing.map((m) => m.label).join(', ')}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const req of rule.requires) {
    if (req.formNo && fields?.[req.key]?.toString().trim()) {
      entity.records.push({ formNo: req.formNo, refNo: fields[req.key], date: today, by: actor.name });
    }
  }
  entity.status = to;
  entity.statusSince = new Date().toISOString();
  if (rule.setLocation) entity.location = rule.setLocation;
  entity.audit.push({
    at: new Date().toISOString(),
    by: actor.name,
    role: actor.role,
    action: `Status → ${to}: ${rule.label}`,
    ...(Object.keys(fields ?? {}).length ? { fields } : {}),
  });
  return rule;
}
