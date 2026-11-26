"use client";

import { memoryStore, type OutboxItem, type OutboxStore } from "./outbox";

/**
 * Field data kept on the phone, one database per organisation address and
 * person — so a shared phone never shows one technician another's data.
 * Two stores: `kv` (cached job packs, My work, config, assets) and `outbox`
 * (changes waiting to be sent; photos are kept as Blobs).
 */
const VERSION = 1;

export interface FieldDb {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  /** Remove cached data but keep unsent changes. */
  clearCache(): Promise<void>;
  outbox: OutboxStore;
}

export const dbName = (userId: string) => `erp-field:${typeof location === "undefined" ? "" : location.host}:${userId}`;

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function open(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Open the person's field database; falls back to memory when IndexedDB is unavailable (private mode). */
export async function openFieldDb(userId: string): Promise<FieldDb> {
  let db: IDBDatabase;
  try {
    db = await open(dbName(userId));
  } catch {
    return memoryDb();
  }
  const store = (name: "kv" | "outbox", mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
  return {
    get: async <T,>(key: string) => (await req(store("kv", "readonly").get(key))) as T | undefined,
    set: async (key, value) => { await req(store("kv", "readwrite").put(value, key)); },
    del: async (key) => { await req(store("kv", "readwrite").delete(key)); },
    keys: async (prefix = "") => ((await req(store("kv", "readonly").getAllKeys())) as string[]).filter((k) => String(k).startsWith(prefix)),
    clearCache: async () => { await req(store("kv", "readwrite").clear()); },
    outbox: {
      all: async () => (await req(store("outbox", "readonly").getAll())) as OutboxItem[],
      put: async (item) => { await req(store("outbox", "readwrite").put(item)); },
      remove: async (id) => { await req(store("outbox", "readwrite").delete(id)); },
    },
  };
}

/** How many changes made on this phone are still waiting to be sent. */
export async function unsentCount(userId: string): Promise<number> {
  try { return (await (await openFieldDb(userId)).outbox.all()).length; } catch { return 0; }
}

/** On sign-out: drop cached copies; unsent changes stay for the same person. */
export async function clearFieldCache(userId: string): Promise<void> {
  try { await (await openFieldDb(userId)).clearCache(); } catch { /* nothing cached */ }
}

function memoryDb(): FieldDb {
  const kv = new Map<string, unknown>();
  return {
    get: async <T,>(key: string) => kv.get(key) as T | undefined,
    set: async (key, value) => { kv.set(key, value); },
    del: async (key) => { kv.delete(key); },
    keys: async (prefix = "") => [...kv.keys()].filter((k) => k.startsWith(prefix)),
    clearCache: async () => kv.clear(),
    outbox: memoryStore(),
  };
}
