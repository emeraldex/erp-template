/** Next "<PREFIX>-<year>-<nnnn>" number after the highest one in use. */
export function nextId(prefix: string, ids: string[]): string {
  const max = ids
    .filter((x) => x.startsWith(`${prefix}-`))
    .map((x) => Number(x.split('-').pop()))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${new Date().getFullYear()}-${String(max + 1).padStart(4, '0')}`;
}

export const DAY_MS = 86_400_000;

export const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
