/**
 * The phone's queue of changes made in the field — checklist ticks, notes,
 * photos and meter readings — and the rules for sending them. Framework-free
 * so it can be unit-tested in Node (`node --test`); storage and the network
 * are passed in.
 *
 * Rules:
 * - Changes go oldest first. One job's changes go in order: if one of them is
 *   held back (failed, or waiting to retry), that job's later changes wait too.
 * - No connection → stop; everything stays waiting.
 * - Signed out (401) → stop; changes are kept for the same person.
 * - Conflict (409) or server error (5xx) → retry later; a conflict fails after 3 tries.
 * - Any other refusal (4xx) → failed, with the server's reason. The technician
 *   can retry or discard it.
 * - Each change carries its own id, sent as X-Client-Op, so a change that
 *   reached the server but whose answer was lost is not applied twice.
 */

export type OutboxType = "checklist" | "note" | "photo" | "meter";

export interface OutboxItem {
  /** Unique id; also the X-Client-Op header. */
  id: string;
  jobId: string;
  type: OutboxType;
  /** What to send: a checklist change, note text, photo blob + caption, or meter reading. */
  payload: Record<string, unknown>;
  /** When the technician made the change (ISO). */
  createdAt: string;
  tries: number;
  state: "pending" | "failed";
  lastError?: string;
}

export interface OutboxStore {
  all(): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
}

/** What happened when one change was sent. status 0 = no connection. */
export type SendResult = { ok: true } | { ok: false; status: number; message: string };
export type Sender = (item: OutboxItem) => Promise<SendResult>;

export interface SyncReport {
  sent: number;
  failed: number;
  waiting: number;
  offline: boolean;
  needsSignIn: boolean;
}

export const MAX_CONFLICT_TRIES = 3;

export function newItem(type: OutboxType, jobId: string, payload: Record<string, unknown>, id: string, now = new Date()): OutboxItem {
  return { id, jobId, type, payload, createdAt: now.toISOString(), tries: 0, state: "pending" };
}

/** Oldest first; ties keep insertion order. */
export function ordered(items: OutboxItem[]): OutboxItem[] {
  return items.map((it, i) => ({ it, i })).sort((a, b) => a.it.createdAt.localeCompare(b.it.createdAt) || a.i - b.i).map((x) => x.it);
}

/** Send what can be sent now, following the rules above. */
export async function syncOutbox(store: OutboxStore, send: Sender): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, failed: 0, waiting: 0, offline: false, needsSignIn: false };
  const held = new Set<string>(); // jobs whose earlier change is held back
  const items = ordered(await store.all());
  for (const item of items) {
    if (report.offline || report.needsSignIn) break;
    if (item.state === "failed") {
      held.add(item.jobId);
      continue;
    }
    if (held.has(item.jobId)) continue;
    const res = await send(item);
    if (res.ok) {
      await store.remove(item.id);
      report.sent++;
      continue;
    }
    if (res.status === 0) { report.offline = true; break; }
    if (res.status === 401) { report.needsSignIn = true; break; }
    held.add(item.jobId);
    const tries = item.tries + 1;
    if (res.status === 409 && tries < MAX_CONFLICT_TRIES) {
      await store.put({ ...item, tries, lastError: res.message });
    } else if (res.status >= 500) {
      await store.put({ ...item, tries, lastError: res.message });
    } else {
      await store.put({ ...item, tries, state: "failed", lastError: res.message });
    }
  }
  const after = await store.all();
  report.failed = after.filter((i) => i.state === "failed").length;
  report.waiting = after.length - report.failed;
  return report;
}

/** Try a failed change again. */
export async function retryItem(store: OutboxStore, id: string): Promise<void> {
  const item = (await store.all()).find((i) => i.id === id);
  if (item) await store.put({ ...item, state: "pending", tries: 0, lastError: undefined });
}

/** Give up on a change (the technician confirmed). */
export async function discardItem(store: OutboxStore, id: string): Promise<void> {
  await store.remove(id);
}

/** An in-memory store, for tests and as a fallback when the browser has no IndexedDB. */
export function memoryStore(initial: OutboxItem[] = []): OutboxStore & { items: Map<string, OutboxItem> } {
  const items = new Map(initial.map((i) => [i.id, i]));
  return {
    items,
    async all() { return [...items.values()]; },
    async put(item) { items.set(item.id, item); },
    async remove(id) { items.delete(id); },
  };
}
