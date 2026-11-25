import { createHash } from 'crypto';

/** Fingerprint of a config list, for optimistic concurrency between editors. */
export const versionOf = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
