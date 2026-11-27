"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, onConnectionChange } from "../api";
import { photoName, resizePhoto } from "../images";
import type { Job, StepField } from "../types";
import { openFieldDb, type FieldDb } from "./db";
import { discardItem, newItem, retryItem, syncOutbox, type OutboxItem, type OutboxType, type SendResult } from "./outbox";

/** What GET /jobs/mine returns per job. */
export interface WorkCard {
  id: string; component: string; serialNo: string; status: string; statusLabel: string; statusSince: string;
  site: string; location: string; jobType?: string; assignee: { id: string; name: string } | null;
  priority: string | null; asset: { id: string; tag: string } | null;
  checklist: { done: number; total: number }; sla: { days: number; overdueBy: number } | null;
}
export interface MyWork { mine: WorkCard[]; available: WorkCard[] }

/** What GET /jobs/:id/pack returns: everything to work on one job, also offline. */
export interface JobPack {
  job: Job;
  asset: {
    id: string; tag: string; name: string; type: string; site: string; location: string; make: string; model: string;
    serialNo: string; status: string; criticality: string;
    meters: { key: string; label: string; unit: string; value: number; readAt: string | null }[];
  } | null;
  pm: { id: string; title: string; instructions: string } | null;
  attachments: { id: string; filename: string; contentType: string; sizeBytes: number; kind: string; caption?: string; signedBy?: string; uploadedBy: string; uploadedAt: string }[];
  steps: { to: string; toLabel: string; label: string; labelMs: string; requires: StepField[] }[];
  locked: boolean;
  /** Catalogue parts used, when stock control is on. */
  parts?: { lines: { partId: string; partNo: string; name: string; unit: string; qty: number; cost: number }[]; total: number };
  fetchedAt: string;
}

const MAX_PACKS = 50;
const KEEP_OPENED_DAYS = 7;
const MAX_PHOTOS = 200;
const SYNC_EVERY_MS = 60_000;

export interface FieldState {
  ready: boolean;
  online: boolean;
  syncing: boolean;
  /** Changes waiting to be sent, and the ones the server refused. */
  outbox: OutboxItem[];
  lastSync: string | null;
  offlineSince: string | null;
  needsSignIn: boolean;
}

interface FieldApi extends FieldState {
  db: FieldDb | null;
  /** Queue a change made in the field; it is sent at once if possible. */
  queue(type: OutboxType, jobId: string, payload: Record<string, unknown>): Promise<void>;
  /** Queue a photo: shrunk on the phone first. */
  queuePhoto(jobId: string, file: File, caption: string): Promise<void>;
  sync(): Promise<void>;
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
  /** My work: from the server when online (and refresh the packs), else the last copy. */
  loadMyWork(): Promise<{ data: MyWork | null; fromCache: boolean }>;
  /** One job's pack: from the server when online, else the last copy. */
  loadPack(id: string): Promise<{ data: JobPack | null; fromCache: boolean }>;
  /** Drop cached packs and lists (unsent changes stay). */
  clearCache(): Promise<void>;
}

const Ctx = createContext<FieldApi | null>(null);

export function useField(): FieldApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useField must be used inside <FieldProvider>");
  return v;
}

export const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** Send one queued change to the API. */
async function send(item: OutboxItem): Promise<SendResult> {
  const op = { "X-Client-Op": item.id };
  const p = item.payload;
  const job = encodeURIComponent(item.jobId);
  try {
    switch (item.type) {
      case "checklist":
        await api.patch(`/jobs/${job}/checklist`, { items: [{ key: p.key, ...(p.done !== undefined ? { done: p.done } : {}), ...(p.note !== undefined ? { note: p.note } : {}) }], at: item.createdAt }, op);
        break;
      case "note":
        await api.post(`/jobs/${job}/notes`, { text: p.text }, op);
        break;
      case "meter":
        await api.post(`/assets/${encodeURIComponent(String(p.assetId))}/meters/${encodeURIComponent(String(p.key))}/readings`, { value: p.value, at: item.createdAt }, op);
        break;
      case "time":
        // The work date is the phone's own date when the time was logged.
        await api.post(`/jobs/${job}/time`, { minutes: p.minutes, workDate: p.workDate, ...(p.note ? { note: p.note } : {}) }, op);
        break;
      case "photo": {
        const form = new FormData();
        form.append("file", p.blob as Blob, String(p.filename ?? "photo.jpg"));
        form.append("kind", "photo");
        if (p.caption) form.append("caption", String(p.caption));
        await api.upload(`/attachments/job/${job}`, form, op);
        break;
      }
    }
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, status: e.status, message: e.message };
    return { ok: false, status: 0, message: (e as Error).message };
  }
}

export function FieldProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [db, setDb] = useState<FieldDb | null>(null);
  const [state, setState] = useState<FieldState>({
    ready: false, online: true, syncing: false, outbox: [], lastSync: null, offlineSince: null, needsSignIn: false,
  });
  const syncing = useRef(false);

  const refreshOutbox = useCallback(async (d: FieldDb) => {
    const outbox = await d.outbox.all();
    setState((s) => ({ ...s, outbox }));
  }, []);

  useEffect(() => {
    let alive = true;
    openFieldDb(userId).then(async (d) => {
      if (!alive) return;
      setDb(d);
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      setState((s) => ({ ...s, ready: true, online, offlineSince: online ? null : new Date().toISOString() }));
      await refreshOutbox(d);
    });
    return () => { alive = false; };
  }, [userId, refreshOutbox]);

  const setOnline = useCallback((online: boolean) => {
    setState((s) => (s.online === online ? s : { ...s, online, offlineSince: online ? null : (s.offlineSince ?? new Date().toISOString()) }));
  }, []);

  const sync = useCallback(async () => {
    if (!db || syncing.current) return;
    syncing.current = true;
    setState((s) => ({ ...s, syncing: true }));
    try {
      const r = await syncOutbox(db.outbox, send);
      setOnline(!r.offline);
      setState((s) => ({ ...s, needsSignIn: r.needsSignIn, ...(r.offline ? {} : { lastSync: new Date().toISOString() }) }));
      // Sent changes are on the server now: refresh those jobs' packs next time they load.
      if (r.sent) for (const k of await db.keys("pack:")) await db.set(`stale:${k.slice(5)}`, true);
    } finally {
      syncing.current = false;
      setState((s) => ({ ...s, syncing: false }));
      await refreshOutbox(db);
    }
  }, [db, refreshOutbox, setOnline]);

  // Sync when the connection comes back, when the app regains focus, and every minute while anything waits.
  useEffect(() => {
    if (!db) return;
    const goOnline = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);
    const visible = () => { if (document.visibilityState === "visible") sync(); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", visible);
    const offConn = onConnectionChange((c) => setOnline(c === "ok"));
    sync();
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", visible);
      offConn();
    };
  }, [db, sync, setOnline]);

  const waiting = state.outbox.some((i) => i.state === "pending");
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { sync(); }, SYNC_EVERY_MS);
    return () => clearInterval(t);
  }, [waiting, sync]);

  const queue = useCallback(async (type: OutboxType, jobId: string, payload: Record<string, unknown>) => {
    if (!db) throw new Error("Offline storage is not ready yet");
    await db.outbox.put(newItem(type, jobId, payload, uuid()));
    await refreshOutbox(db);
    void sync();
  }, [db, refreshOutbox, sync]);

  const queuePhoto = useCallback(async (jobId: string, file: File, caption: string) => {
    if (!db) throw new Error("Offline storage is not ready yet");
    const photos = (await db.outbox.all()).filter((i) => i.type === "photo").length;
    if (photos >= MAX_PHOTOS) throw new Error(`${MAX_PHOTOS} photos are waiting to be sent — connect to send them before taking more`);
    const blob = await resizePhoto(file);
    await queue("photo", jobId, { blob, filename: photoName(file.name), caption });
  }, [db, queue]);

  const loadMyWork = useCallback(async () => {
    if (!db) return { data: null, fromCache: true };
    try {
      const data = await api.get<MyWork>("/jobs/mine");
      setOnline(true);
      await db.set("mine", data);
      // Keep packs for my assigned work, so it opens without a signal.
      void (async () => {
        for (const card of data.mine.slice(0, MAX_PACKS)) {
          try {
            const pack = await api.get<JobPack>(`/jobs/${encodeURIComponent(card.id)}/pack`);
            await db.set(`pack:${card.id}`, pack);
            await db.del(`stale:${card.id}`);
          } catch { /* keep the older copy */ }
        }
        await prunePacks(db, new Set(data.mine.map((c) => c.id)));
      })();
      return { data, fromCache: false };
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) throw e;
      setOnline(false);
      return { data: (await db.get<MyWork>("mine")) ?? null, fromCache: true };
    }
  }, [db, setOnline]);

  const loadPack = useCallback(async (id: string) => {
    if (!db) return { data: null, fromCache: true };
    try {
      const data = await api.get<JobPack>(`/jobs/${encodeURIComponent(id)}/pack`);
      setOnline(true);
      await db.set(`pack:${id}`, data);
      await db.set(`opened:${id}`, new Date().toISOString());
      await db.del(`stale:${id}`);
      return { data, fromCache: false };
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) throw e;
      setOnline(false);
      return { data: (await db.get<JobPack>(`pack:${id}`)) ?? null, fromCache: true };
    }
  }, [db, setOnline]);

  const value = useMemo<FieldApi>(() => ({
    ...state,
    db,
    queue,
    queuePhoto,
    sync,
    retry: async (id) => { if (db) { await retryItem(db.outbox, id); await refreshOutbox(db); void sync(); } },
    discard: async (id) => { if (db) { await discardItem(db.outbox, id); await refreshOutbox(db); } },
    loadMyWork,
    loadPack,
    clearCache: async () => { if (db) await db.clearCache(); },
  }), [state, db, queue, queuePhoto, sync, refreshOutbox, loadMyWork, loadPack]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Keep packs for current work and jobs opened in the last week; drop the rest. */
async function prunePacks(db: FieldDb, keep: Set<string>) {
  const cutoff = Date.now() - KEEP_OPENED_DAYS * 86_400_000;
  for (const key of await db.keys("pack:")) {
    const id = key.slice(5);
    if (keep.has(id)) continue;
    const opened = await db.get<string>(`opened:${id}`);
    if (!opened || new Date(opened).getTime() < cutoff) {
      await db.del(key);
      await db.del(`opened:${id}`);
    }
  }
}

/** Changes still on the phone for one job, to show on screen until they are sent. */
export function pendingFor(outbox: OutboxItem[], jobId: string) {
  return outbox.filter((i) => i.jobId === jobId);
}
