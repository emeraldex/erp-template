"use client";

import { useEffect, useState } from "react";
import { BigButton } from "@/components/m/ui";
import { api } from "@/lib/api";
import { useM } from "@/lib/m-text";
import { pendingFor, useField } from "@/lib/offline/field";
import { hm, type TimeEntry } from "@/components/labour/job-time";

const TIMER = (jobId: string) => `erp.timer.${jobId}`;
const localDate = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/**
 * Time on a work order, on the phone: tap 15 min … 2 h, or start and stop a
 * timer. Works without a signal — entries wait in the outbox and are sent
 * once (each carries its own id).
 */
export function PhoneTime({ jobId, locked }: { jobId: string; locked: boolean }) {
  const f = useField();
  const m = useM();
  const [logged, setLogged] = useState<TimeEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { const s = window.localStorage.getItem(TIMER(jobId)); setStartedAt(s ? Number(s) : null); } catch { /* private mode */ }
  }, [jobId]);
  useEffect(() => { if (!startedAt) return; const t = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(t); }, [startedAt]);
  useEffect(() => {
    if (!f.db) return;
    const key = `time:${jobId}`;
    let live = true;
    f.db.get<TimeEntry[]>(key).then((c) => { if (live && c) setLogged(c); }).catch(() => {});
    if (f.online) api.get<{ entries: TimeEntry[] }>(`/jobs/${encodeURIComponent(jobId)}/time`).then(async (r) => { if (live) setLogged(r.entries.filter((e) => e.mine)); await f.db?.set(key, r.entries.filter((e) => e.mine)); }).catch(() => {});
    return () => { live = false; };
  }, [jobId, f.db, f.online, f.outbox.length]);

  const waiting = pendingFor(f.outbox, jobId).filter((i) => i.type === "time");
  const mine = logged.reduce((s, e) => s + e.minutes, 0) + waiting.reduce((s, i) => s + Number(i.payload.minutes), 0);

  async function log(minutes: number) {
    setError(null);
    if (minutes < 1 || minutes > 24 * 60) { setError(m("timeRange")); return; }
    try { await f.queue("time", jobId, { minutes, workDate: localDate() }); } catch (e) { setError((e as Error).message); }
  }

  function startStop() {
    if (startedAt) {
      const minutes = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
      try { window.localStorage.removeItem(TIMER(jobId)); } catch { /* ignore */ }
      setStartedAt(null);
      void log(minutes);
    } else {
      const t = Date.now();
      try { window.localStorage.setItem(TIMER(jobId), String(t)); } catch { /* ignore */ }
      setStartedAt(t);
      setNow(t);
    }
  }

  return (
    <div>
      <p className="mb-2 text-base">{m("yourTime")}: <span className="mono">{hm(mine)}</span>{waiting.length > 0 && <span className="ml-2 text-sm text-amber">· {waiting.length} {m("waitingToSend")}</span>}</p>
      {!locked && (
        <>
          <div className="grid grid-cols-4 gap-2">
            {[15, 30, 60, 120].map((n) => (
              <button key={n} onClick={() => void log(n)} className="min-h-[48px] rounded-lg border hairline text-base text-fg">+{hm(n).replace(" min", "m").replace(" h", "h")}</button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, ""))} placeholder={m("minutes")} aria-label={m("minutes")}
              className="min-h-[48px] w-28 rounded-lg border hairline bg-ink-deep px-3 text-base outline-none focus:border-trace" />
            <BigButton tone="ghost" disabled={!custom} onClick={() => { void log(Number(custom)); setCustom(""); }}>{m("logTime")}</BigButton>
          </div>
          <div className="mt-2">
            <BigButton tone={startedAt ? "primary" : "ghost"} onClick={startStop}>
              {startedAt ? `■ ${m("stopTimer")} · ${hm(Math.max(0, Math.round((now - startedAt) / 60_000)))}` : `▶ ${m("startTimer")}`}
            </BigButton>
          </div>
        </>
      )}
      {error && <p className="mt-2 text-sm text-brand-bright">{error}</p>}
    </div>
  );
}
