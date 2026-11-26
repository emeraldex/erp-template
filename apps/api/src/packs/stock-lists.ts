import type { Entry } from './types';

/** Units parts are counted in. */
export const UNITS: Entry[] = [
  { key: 'EA', label: 'Each', labelMs: 'Unit' },
  { key: 'SET', label: 'Set', labelMs: 'Set' },
  { key: 'BOX', label: 'Box', labelMs: 'Kotak' },
  { key: 'M', label: 'Metre', labelMs: 'Meter' },
  { key: 'L', label: 'Litre', labelMs: 'Liter' },
  { key: 'KG', label: 'Kilogram', labelMs: 'Kilogram' },
];

/** A store at a site; the first store is where purchases for stock arrive by default. */
export const store = (key: string, label: string, labelMs: string, site: string): Entry => ({ key, label, labelMs, meta: { site } });
