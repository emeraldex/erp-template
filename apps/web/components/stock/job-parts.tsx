"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { JobParts as JobPartsData, Part } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { loadParts } from "@/components/step-form";
import { Button } from "@/components/ui";
import { errText, input, money, Msg, qty } from "./common";

/** Catalogue parts used on a work order, their cost, and issue/return for people allowed to. */
export function JobParts({ jobId, closed, onChanged }: { jobId: string; closed: boolean; onChanged?: () => void }) {
  const { dict, label, can, lang } = useVocab();
  const [data, setData] = useState<JobPartsData | null>(null);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [mode, setMode] = useState<"issue" | "return" | null>(null);
  const [f, setF] = useState({ q: "", partId: "", store: "", qty: "1" });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const canIssue = can("stock.issue") && !closed;

  const load = useCallback(() => {
    api.get<JobPartsData>(`/jobs/${encodeURIComponent(jobId)}/parts`).then(setData).catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, [jobId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (mode && !parts) loadParts().then(setParts).catch((e) => setMsg({ ok: false, text: errText(e) })); }, [mode, parts]);

  const part = parts?.find((p) => p.id === f.partId);
  const stores = dict("store");
  const store = f.store || part?.levels.find((l) => l.qty > 0)?.store || stores[0]?.key || "";
  const needle = f.q.trim().toLowerCase();
  const choices = (mode === "return" ? (parts ?? []).filter((p) => data?.lines.some((l) => l.partId === p.id)) : parts ?? [])
    .filter((p) => p.id === f.partId || !needle || `${p.partNo} ${p.name}`.toLowerCase().includes(needle)).slice(0, 60);

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/stock/${mode}`, { partId: f.partId, store, qty: Number(f.qty), jobId });
      setMsg({ ok: true, text: `${mode === "issue" ? "Issued" : "Returned"} ${f.qty} ${label("unit", part?.unit ?? "")} ${part?.partNo}.` });
      setMode(null); setF({ q: "", partId: "", store: "", qty: "1" });
      load(); onChanged?.();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="eyebrow">Parts used</p>
        {canIssue && (
          <div className="flex gap-1.5">
            {(["issue", "return"] as const).filter((m) => m === "issue" || (data?.lines.length ?? 0) > 0).map((m) => (
              <button key={m} onClick={() => { setMode(mode === m ? null : m); setF({ q: "", partId: "", store: "", qty: "1" }); }}
                className={`mono rounded-md border px-2.5 py-1 text-[10px] tracking-widest ${mode === m ? "border-trace bg-trace/10 text-trace" : "hairline text-steel hover:text-fg"}`}>
                {m === "issue" ? "+ ISSUE PART" : "RETURN"}
              </button>
            ))}
          </div>
        )}
      </div>
      {msg && <p className={`mb-2 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
      {!data ? <p className="text-sm text-dim">…</p> : data.lines.length === 0 ? <p className="text-sm text-dim">No catalogue parts issued yet.</p> : (
        <table className="w-full text-left text-sm">
          <tbody>
            {data.lines.map((l) => (
              <tr key={l.partId} className="border-b hairline last:border-0">
                <td className="py-1.5 pr-2"><Link href={`/stock?part=${encodeURIComponent(l.partId)}`} className="mono text-xs text-trace hover:underline">{l.partNo}</Link> {l.name}</td>
                <td className="mono py-1.5 pr-2 text-right text-xs tabular-nums">{qty(l.qty)} {label("unit", l.unit)}</td>
                <td className="mono py-1.5 text-right text-xs tabular-nums text-steel">{money(l.cost)}</td>
              </tr>
            ))}
            <tr>
              <td className="mono pt-2 text-[10.5px] tracking-widest text-steel" colSpan={2}>PARTS COST</td>
              <td className="mono pt-2 text-right text-sm tabular-nums">{money(data.total)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {mode && (
        <div className="mt-3 grid gap-2 rounded border hairline bg-ink-deep/40 p-3 sm:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2">
            <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Search part no. or name…" className={input} />
            <select value={f.partId} onChange={(e) => setF({ ...f, partId: e.target.value })} className={input} aria-label="Part">
              <option value="">{parts ? "— choose a part —" : "…"}</option>
              {choices.map((p) => <option key={p.id} value={p.id}>{p.partNo} · {p.name} — {qty(p.onHand)} {label("unit", p.unit)}</option>)}
            </select>
          </div>
          <select value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} className={input} aria-label="Store">
            <option value="">{label("store", store)}{part ? ` (${qty(part.levels.find((l) => l.store === store)?.qty ?? 0)})` : ""}</option>
            {stores.map((s) => <option key={s.key} value={s.key}>{lang === "ms" && s.labelMs ? s.labelMs : s.label}{part ? ` (${qty(part.levels.find((l) => l.store === s.key)?.qty ?? 0)})` : ""}</option>)}
          </select>
          <input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} aria-label="Quantity" className={input} />
          <div className="sm:col-span-4"><Button disabled={busy || !f.partId || !f.qty} onClick={submit}>{mode === "issue" ? "Issue to this work order" : "Return to stock"}</Button></div>
        </div>
      )}
    </div>
  );
}
