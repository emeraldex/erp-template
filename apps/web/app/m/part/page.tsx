"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { BigButton, MHeader, Notice, Section } from "@/components/m/ui";
import { api, ApiError } from "@/lib/api";
import { useM } from "@/lib/m-text";
import { useField, uuid } from "@/lib/offline/field";
import type { Part } from "@/lib/types";
import { useVocab } from "@/lib/vocab";

const box = "min-h-[48px] w-full rounded-lg border hairline bg-ink-deep px-3 text-base outline-none focus:border-trace";
const q3 = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });

export default function PartScreen() {
  return (
    <Suspense fallback={null}>
      <PartView />
    </Suspense>
  );
}

/** A part on the phone — what each store holds and where — opened from a shelf or bin label. */
function PartView() {
  const id = useSearchParams().get("id") ?? "";
  const f = useField();
  const m = useM();
  const { label, can, modules, cfg, lang } = useVocab();
  const [p, setP] = useState<Part | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [form, setForm] = useState({ jobId: "", store: "", qty: "1" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id || !f.db) return;
    try {
      const data = await api.get<Part>(`/stock/parts/${encodeURIComponent(id)}`);
      await f.db.set(`part:${id}`, data);
      setP(data); setFromCache(false);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) { setError(e.message); return; }
      setP((await f.db.get<Part>(`part:${id}`)) ?? null); setFromCache(true);
    }
  }, [id, f.db]);
  useEffect(() => { void load(); }, [load]);

  async function issue() {
    if (!p) return;
    setBusy(true); setError(null); setDone(null);
    const store = form.store || p.levels.find((l) => l.qty > 0)?.store || "";
    try {
      await api.post("/stock/issue", { partId: p.id, store, qty: Number(form.qty), jobId: form.jobId.trim() }, { "X-Client-Op": uuid() });
      setDone(`${m("issued")}: ${form.qty} ${label("unit", p.unit)} → ${form.jobId.trim()}`);
      setIssuing(false); setForm({ jobId: "", store: "", qty: "1" });
      void load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (cfg && !modules.stock) return <div><MHeader title={m("part")} back /><Notice>Stock control is switched off.</Notice></div>;
  if (!p) {
    return (
      <div>
        <MHeader title={m("part")} back />
        {error ? <Notice tone="bad">{error}</Notice> : fromCache ? <Notice>{m("noCopy")}</Notice> : <p className="px-4 py-10 text-center text-steel">{m("loading")}</p>}
      </div>
    );
  }
  const held = p.levels.filter((l) => l.qty > 0);

  return (
    <div>
      <MHeader title={p.partNo} back />
      {fromCache && <Notice>{m("savedCopy")}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {done && <Notice tone="good">{done}</Notice>}
      <div className="border-b hairline px-4 py-4">
        <p className="text-xl font-semibold">{p.name}</p>
        <p className="text-sm text-steel">{[label("unit", p.unit), p.group && label("partGroup", p.group), p.manufacturer, p.mfrPartNo].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 text-2xl font-semibold tabular-nums">{q3(p.onHand)} <span className="text-base font-normal text-steel">{label("unit", p.unit)}</span></p>
      </div>

      <Section title={m("stockByStore")}>
        {p.levels.length === 0 ? <p className="text-sm text-steel">—</p> : (
          <ul className="space-y-2">
            {p.levels.map((l) => (
              <li key={l.store} className={`rounded-lg border px-3 py-2 ${l.low ? "border-amber/50" : "hairline"}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-base">{l.storeLabel}</span>
                  <span className="mono text-lg tabular-nums">{q3(l.qty)}</span>
                </div>
                <p className="text-xs text-steel">
                  {l.bin && `${m("bin")} ${l.bin}`}{l.bin && l.reorderPoint != null && " · "}
                  {l.reorderPoint != null && `${m("reorderAt")} ${q3(l.reorderPoint)}`}
                  {l.low && <span className="ml-2 font-medium text-amber">{m("low")}</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {can("stock.issue") && (
        <Section title={m("issueToJob")}>
          {!issuing ? (
            <BigButton tone="ghost" disabled={!f.online || held.length === 0} onClick={() => setIssuing(true)}>＋ {m("issueToJob")}</BigButton>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm text-steel">{m("jobNo")}
                <input value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value.toUpperCase() })} placeholder="WO-2026-0001" className={box} autoCapitalize="characters" />
              </label>
              <label className="block text-sm text-steel">{m("fromStore")}
                <select value={form.store || held[0]?.store} onChange={(e) => setForm({ ...form, store: e.target.value })} className={box}>
                  {held.map((l) => <option key={l.store} value={l.store}>{l.storeLabel} ({q3(l.qty)})</option>)}
                </select>
              </label>
              <label className="block text-sm text-steel">{m("quantity")} ({label("unit", p.unit)})
                <input inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} className={box} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <BigButton tone="ghost" onClick={() => setIssuing(false)}>{m("back")}</BigButton>
                <BigButton disabled={busy || !f.online || !form.jobId.trim() || !Number(form.qty)} onClick={issue}>{m("issue")}</BigButton>
              </div>
            </div>
          )}
          {!f.online && <p className="mt-2 text-xs text-steel">{m("needsConnection")}</p>}
        </Section>
      )}

      {(p.requests ?? []).length > 0 && (
        <Section title={m("openRequests")}>
          <ul className="space-y-1 text-base">
            {p.requests!.map((r) => (
              <li key={r.id}><span className="mono text-sm text-trace">{r.id}</span> · {q3(r.qty)} {label("unit", p.unit)}
                <span className="text-sm text-steel"> · {r.jobId ?? label("store", r.forStore ?? "")} · {label("status:DEMAND", r.status)}</span></li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={m("recent")}>
        {(p.movements ?? []).length === 0 ? <p className="text-sm text-steel">—</p> : (
          <ul className="space-y-1.5">
            {p.movements!.slice(0, 10).map((mv) => (
              <li key={mv.id} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 text-steel">
                  {mv.at.slice(0, 10)} · {label("store", mv.store)}
                  {mv.jobId && <> · <Link href={`/m/job?id=${encodeURIComponent(mv.jobId)}`} className="text-trace">{mv.jobId}</Link></>}
                  {!mv.jobId && mv.reason && ` · ${mv.reason}`}
                </span>
                <span className={`mono shrink-0 tabular-nums ${mv.qty < 0 ? "text-amber" : "text-phosphor"}`}>{mv.qty > 0 ? "+" : ""}{q3(mv.qty)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <p className="px-4 pb-6 text-xs text-dim">{lang === "ms" ? "Imbas label rak atau tong untuk membuka alat ganti." : "Scan a shelf or bin label to open a part."}</p>
    </div>
  );
}
