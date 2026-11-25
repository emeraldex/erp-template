import { AVIATION } from './aviation';
import type { Pack } from './types';

/** Every sector pack that ships, by id. */
export const PACKS: Record<string, Pack> = { [AVIATION.id]: AVIATION };

export const DEFAULT_PACK = 'aviation';

export function getPack(id: string | undefined): Pack {
  const pack = PACKS[id ?? DEFAULT_PACK];
  if (!pack) throw new Error(`Unknown sector pack "${id}". Available: ${Object.keys(PACKS).join(', ')}`);
  return pack;
}
