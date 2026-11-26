/**
 * What work orders tell the request portal. A class with no imports, so the
 * jobs service can depend on it without loading the portal (and its secrets).
 */
export abstract class JobDoneHook {
  /** A work order changed status; requesters hear when it is done. */
  abstract jobChanged(jobId: string, status: string): Promise<void>;
}
