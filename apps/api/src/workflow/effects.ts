import type { Kind } from '../packs/types';

/** An action a workflow step performs when it is taken. */
export interface Effect { type: string; params?: Record<string, unknown> }

interface ParamDef {
  name: string;
  label: string;
  /** field: a field key the user enters on the step; number; location: a location key; status: a status key of the parent job */
  type: 'field' | 'number' | 'location' | 'jobStatus';
  required?: boolean;
}

export interface EffectDef {
  type: string;
  kind: Kind;
  label: string;
  description: string;
  params: ParamDef[];
  /** Field params whose fields must be mandatory on the step for the action to work. */
  needs: string[];
}

/** Record attributes a step may copy a field onto, per workflow. */
export const ATTRIBUTES: Record<Kind, Record<string, string>> = {
  JOB: { indentRef: 'Customer order / indent reference' },
  DEMAND: { rfqRef: 'RFQ reference', poRef: 'Purchase order reference' },
  OV: { f134Ref: 'Customer approval request reference', poRef: 'Repair order reference' },
  INVOICE: {
    customerSignRef: 'Customer signature reference', ctcRef: 'Certified true copy reference',
    correctnessBy: 'Checked by', salesPerfRef: 'Sales report / payment-system reference',
  },
};

export const EFFECTS: EffectDef[] = [
  {
    type: 'setAttributes', kind: 'JOB', label: 'Copy fields onto the record', description: 'Store entered values on the record (map attribute → field).',
    params: [], needs: [],
  },
  {
    type: 'raiseDemand', kind: 'JOB', label: 'Raise a parts demand', description: 'Creates a parts demand linked to this work order, at the demand workflow’s first status.',
    params: [
      { name: 'refField', label: 'Demand number field', type: 'field', required: true },
      { name: 'descriptionField', label: 'Part description field', type: 'field' },
      { name: 'partNoField', label: 'Part number field', type: 'field' },
      { name: 'qtyField', label: 'Quantity field', type: 'field' },
    ],
    needs: ['refField'],
  },
  {
    type: 'openVendorRepair', kind: 'JOB', label: 'Open an outside-vendor repair', description: 'Creates a vendor repair record for this work order.',
    params: [
      { name: 'refField', label: 'Defect / referral reference field', type: 'field', required: true },
      { name: 'workOrderField', label: 'Customer work order field', type: 'field' },
    ],
    needs: ['refField'],
  },
  {
    type: 'recordStockCheck', kind: 'DEMAND', label: 'Record a stock check', description: 'Marks the stock check as done (nothing available yet).',
    params: [{ name: 'refField', label: 'Stock check reference field', type: 'field', required: true }], needs: ['refField'],
  },
  {
    type: 'issueFromStock', kind: 'DEMAND', label: 'Issue from stock', description: 'Marks the part as available from stock.',
    params: [{ name: 'holdingField', label: 'Holding store field', type: 'field' }], needs: [],
  },
  {
    type: 'evaluateQuotations', kind: 'DEMAND', label: 'Evaluate quotations', description: 'Requires a minimum number of quotations (unless a bypass approval is given) and records the selected supplier.',
    params: [
      { name: 'min', label: 'Minimum quotations', type: 'number', required: true },
      { name: 'refField', label: 'Evaluation reference field', type: 'field' },
      { name: 'selectionField', label: 'Selected supplier field', type: 'field' },
      { name: 'bypassField', label: 'Bypass approval field (e.g. local purchase)', type: 'field' },
    ],
    needs: [],
  },
  {
    type: 'recordReceipt', kind: 'DEMAND', label: 'Record receipt', description: 'Records an optional discrepancy report on receipt.',
    params: [
      { name: 'discrepancyField', label: 'Discrepancy report field', type: 'field' },
      { name: 'noteField', label: 'Discrepancy note field', type: 'field' },
    ],
    needs: [],
  },
  { type: 'setAttributes', kind: 'DEMAND', label: 'Copy fields onto the record', description: 'Store entered values on the record.', params: [], needs: [] },
  {
    type: 'setVendor', kind: 'OV', label: 'Set the vendor', description: 'Records the vendor (looked up in the supplier register).',
    params: [{ name: 'field', label: 'Vendor field', type: 'field', required: true }], needs: ['field'],
  },
  {
    type: 'recordCost', kind: 'OV', label: 'Record cost and delivery date', description: 'Stores the repair cost, expected delivery and quotation.',
    params: [
      { name: 'costField', label: 'Cost field', type: 'field', required: true },
      { name: 'eddField', label: 'Expected delivery (days) field', type: 'field' },
      { name: 'aboveIndentField', label: 'Above-order flag field', type: 'field' },
      { name: 'quoteField', label: 'Quotation reference field', type: 'field' },
    ],
    needs: ['costField'],
  },
  {
    type: 'closeParentJob', kind: 'OV', label: 'Close the work order', description: 'Closes the linked work order and moves the item (e.g. back to the customer).',
    params: [{ name: 'location', label: 'Move item to', type: 'location' }], needs: [],
  },
  {
    type: 'setParentLocation', kind: 'OV', label: 'Move the item', description: 'Updates where the linked work order’s item is.',
    params: [{ name: 'location', label: 'Location', type: 'location', required: true }], needs: [],
  },
  { type: 'setAttributes', kind: 'OV', label: 'Copy fields onto the record', description: 'Store entered values on the record.', params: [], needs: [] },
  {
    type: 'raiseTaxInvoice', kind: 'INVOICE', label: 'Raise the tax invoice', description: 'Records the tax invoice number and recalculates tax when an amount is entered.',
    params: [
      { name: 'numberField', label: 'Tax invoice number field', type: 'field', required: true },
      { name: 'amountField', label: 'Amount before tax field', type: 'field' },
    ],
    needs: ['numberField'],
  },
  {
    type: 'markPaid', kind: 'INVOICE', label: 'Record payment', description: 'Records the payment reference and date; the invoice is no longer outstanding.',
    params: [{ name: 'refField', label: 'Payment reference field', type: 'field', required: true }], needs: ['refField'],
  },
  { type: 'markOutstanding', kind: 'INVOICE', label: 'Mark outstanding', description: 'The invoice counts as outstanding again.', params: [], needs: [] },
  { type: 'setAttributes', kind: 'INVOICE', label: 'Copy fields onto the record', description: 'Store entered values on the record.', params: [], needs: [] },
];

export const effectDef = (kind: Kind, type: string) => EFFECTS.find((e) => e.kind === kind && e.type === type);

/** Fields a step's actions need to be mandatory. */
export function neededFields(kind: Kind, effects: Effect[] = []): { key: string; by: string }[] {
  const out: { key: string; by: string }[] = [];
  for (const e of effects) {
    const def = effectDef(kind, e.type);
    if (!def) continue;
    for (const p of def.needs) {
      const key = e.params?.[p];
      if (typeof key === 'string' && key) out.push({ key, by: def.label });
    }
  }
  return out;
}

/** Problems with a step's actions (unknown type, bad parameters, missing fields). */
export function validateEffects(kind: Kind, effects: unknown, ctx: { fields: string[]; locations: string[] }): { effects: Effect[]; errors: string[] } {
  const errors: string[] = [];
  if (effects === undefined || effects === null) return { effects: [], errors };
  if (!Array.isArray(effects)) return { effects: [], errors: ['actions must be a list'] };
  const out: Effect[] = [];
  for (const raw of effects) {
    const e = (raw ?? {}) as { type?: unknown; params?: unknown };
    const def = typeof e.type === 'string' ? effectDef(kind, e.type) : undefined;
    if (!def) {
      errors.push(`unknown action "${String(e.type)}" for this workflow`);
      continue;
    }
    const params = (e.params && typeof e.params === 'object' ? e.params : {}) as Record<string, unknown>;
    if (def.type === 'setAttributes') {
      for (const [attr, field] of Object.entries(params)) {
        if (!(attr in ATTRIBUTES[kind])) errors.push(`${def.label}: unknown attribute ${attr}`);
        if (typeof field !== 'string' || !field) errors.push(`${def.label}: ${attr} needs a field`);
      }
    } else {
      for (const p of def.params) {
        const v = params[p.name];
        if (v === undefined || v === '') {
          if (p.required) errors.push(`${def.label}: ${p.label} is required`);
          continue;
        }
        if (p.type === 'number' && (!Number.isInteger(Number(v)) || Number(v) < 0)) errors.push(`${def.label}: ${p.label} must be a whole number`);
        if (p.type === 'location' && !ctx.locations.includes(String(v))) errors.push(`${def.label}: unknown location ${String(v)}`);
        if (p.type === 'field' && typeof v !== 'string') errors.push(`${def.label}: ${p.label} must be a field key`);
      }
      for (const name of Object.keys(params)) {
        if (!def.params.some((p) => p.name === name)) errors.push(`${def.label}: unknown setting ${name}`);
      }
    }
    for (const n of def.needs) {
      const key = params[n];
      if (typeof key === 'string' && key && !ctx.fields.includes(key)) {
        errors.push(`field ${key} is needed by the action "${def.label}" and must stay mandatory`);
      }
    }
    out.push({ type: def.type, ...(Object.keys(params).length ? { params } : {}) });
  }
  return { effects: out, errors };
}
