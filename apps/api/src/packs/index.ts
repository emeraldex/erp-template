import { AVIATION } from './aviation';
import { FACILITIES, FLEET, GENERAL, INDUSTRIAL, MEDICAL } from './sectors';
import type { Pack } from './types';

/** Every sector pack that ships, by id. */
export const PACKS: Record<string, Pack> = Object.fromEntries(
  [GENERAL, AVIATION, FACILITIES, FLEET, INDUSTRIAL, MEDICAL].map((p) => [p.id, p]),
);

export const DEFAULT_PACK = 'aviation';

export function getPack(id: string | undefined): Pack {
  const pack = PACKS[id ?? DEFAULT_PACK];
  if (!pack) throw new Error(`Unknown sector pack "${id}". Available: ${Object.keys(PACKS).join(', ')}`);
  return pack;
}
