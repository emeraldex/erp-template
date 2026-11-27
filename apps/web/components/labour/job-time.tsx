"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { loadStaff } from "@/components/step-form";
import type { StaffMember } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button } from "@/components/ui";

export interface TimeEntry { id: string; userId: string; userName: string; workDate: string; minutes: number; note: string; rate?: number | null; cost?: number; mine: boolean }
export interface JobCost {
  currency: string; parts: number; purchases: { total: number }; vendorRepairs: { total: number };
  labour: { minutes: number; cost: number | null }; total: number | null; totalWithoutLabour: number;
}

export const hm = (m: number) => { const h = Math.floor(m / 60); const r = m % 60; return [h ? `${h} h` : "", r ? `${r} min` : ""].filter(Boolean).join(" ") || "0 min"; };
const field = "mono rounded-md border hairline bg-ink-deep px-2 py-1.5 text-xs text-fg outline-none focus:border-trace";

/** Time logged on a work order, and logging more. Rates and cost show only to people who manage labour. */
export function JobTime({ jobId, closed, onChanged }: { jobId: string; closed: boolean; onChanged?: () => void }) {
  const { can, modules } = useVocab();
  const manage = can("labour.manage");
  const mayLog = can("labour.log") || manage;
  const [data, setData] = useState<{ entries: TimeEntry[]; minutes: number; cost?: number } | null>(null);
  const [f, setF] = useState({ hours: "", minutes: "", workDate: new Date().toISOString().slice(0, 10), note: "", userId: "" });
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<{ entries: TimeEntry[]; minutes: number; cost?: number }>(`/jobs/${encodeURIComponent(jobId)}/time`).then(setData).catch(() => setData(null)); }, [jobId]);
  useEffect(() => { if (modules.labour) load(); }, [load, modules.labour]);
  useEffect(() => { if (manage) loadStaff().then(setStaff).catch(() => {}); }, [manage]);
  if (!modules.labour || !data) return null;

  const total = (Number(f.hours) || 0) * 60 + (Number(f.minutes) || 0);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); load(); onChanged?.(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="eyebrow">Time · {hm(data.minutes)}</p>
        {manage && data.cost !== undefined && <p className="mono text-xs text-steel">Labour {fmtMoney(data.cost)}</p>}
      </div>
      {data.entries.length === 0 ? <p className="text-sm text-dim">No time logged yet.</p> : (
        <table className="w-full text-left text-sm">
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id} className="border-b hairline last:border-0">
                <td className="mono py-1.5 pr-2 text-[11px] text-dim">{e.workDate}</td>
                <td className="py-1.5 pr-2">{e.userName}{e.note && <span className="ml-2 text-xs text-steel">{e.note}</span>}</td>
                <td className="mono py-1.5 pr-2 text-right text-xs tabular-nums">{hm(e.minutes)}</td>
                {manage && <td className="mono py-1.5 pr-2 text-right text-xs tabular-nums text-steel">{e.cost !== undefined ? fmtMoney(e.cost) : ""}{e.rate == null ? <span className="ml-1 text-dim" title="No rate set">·</span> : null}</td>}
                <td className="py-1.5 text-right">
                  {!closed && (e.mine || manage) && (
                    <button onClick={() => { if (window.confirm(`Remove ${hm(e.minutes)} by ${e.userName}?`)) void run(() => api.remove(`/time/${e.id}`), "Removed."); }}
                      className="mono text-[10px] text-steel hover:text-brand-bright" aria-label={`Remove ${hm(e.minutes)} by ${e.userName}`}>✕</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
      {mayLog && !closed && (
        <div className="mt-3 flex flex-wrap items-end gap-2 rounded border hairline bg-ink-deep/40 p-3">
          <label className="block"><span className="mono mb-1 block text-[9.5px] tracking-widest text-dim">HOURS</span>
            <input inputMode="numeric" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value.replace(/\D/g, "") })} className={`${field} w-16`} aria-label="Hours" /></label>
          <label className="block"><span className="mono mb-1 block text-[9.5px] tracking-widest text-dim">MINUTES</span>
            <input inputMode="numeric" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value.replace(/\D/g, "") })} className={`${field} w-16`} aria-label="Minutes" /></label>
          <label className="block"><span className="mono mb-1 block text-[9.5px] tracking-widest text-dim">DATE</span>
            <input type="date" value={f.workDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, workDate: e.target.value })} className={field} aria-label="Work date" /></label>
          {manage && (
            <label className="block"><span className="mono mb-1 block text-[9.5px] tracking-widest text-dim">PERSON</span>
              <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} className={field} aria-label="Person">
                <option value="">Me</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></label>
          )}
          <label className="block flex-1"><span className="mono mb-1 block text-[9.5px] tracking-widest text-dim">NOTE</span>
            <input value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} className={`${field} w-full`} aria-label="Note" /></label>
          <Button disabled={busy || total < 1} onClick={() => run(
            () => api.post(`/jobs/${encodeURIComponent(jobId)}/time`, { minutes: total, workDate: f.workDate, note: f.note, ...(f.userId ? { userId: f.userId } : {}) }),
            `Logged ${hm(total)}.`,
          ).then(() => setF((x) => ({ ...x, hours: "", minutes: "", note: "" })))}>Log time</Button>
        </div>
      )}
    </div>
  );
}

/** What the work has cost so far. */
export function JobCostPanel({ jobId, refresh = 0 }: { jobId: string; refresh?: number }) {
  const [c, setC] = useState<JobCost | null>(null);
  useEffect(() => { api.get<JobCost>(`/jobs/${encodeURIComponent(jobId)}/cost`).then(setC).catch(() => setC(null)); }, [jobId, refresh]);
  if (!c) return null;
  const rows: [string, number | null][] = [
    ["Parts from stock", c.parts], ["Purchases", c.purchases.total], ["Vendor repairs", c.vendorRepairs.total],
    ...(c.labour.cost !== null ? [[`Labour (${hm(c.labour.minutes)})`, c.labour.cost] as [string, number]] : []),
  ];
  const total = c.total ?? c.totalWithoutLabour;
  if (total === 0 && c.labour.minutes === 0) return null;
  return (
    <div>
      <p className="eyebrow mb-2">Cost so far</p>
      <table className="w-full text-sm">
        <tbody>
          {rows.filter(([, v]) => v).map(([k, v]) => (
            <tr key={k} className="border-b hairline"><td className="py-1 text-steel">{k}</td><td className="mono py-1 text-right tabular-nums">{fmtMoney(v ?? 0)}</td></tr>
          ))}
          <tr><td className="mono pt-2 text-[10.5px] tracking-widest text-steel">{c.total === null ? "TOTAL (WITHOUT LABOUR)" : "TOTAL"}</td><td className="mono pt-2 text-right text-base tabular-nums">{fmtMoney(total)}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
