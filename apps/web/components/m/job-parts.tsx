"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BigButton } from "@/components/m/ui";
import { loadParts } from "@/components/step-form";
import { api } from "@/lib/api";
import { useM } from "@/lib/m-text";
import { uuid } from "@/lib/offline/field";
import type { Part } from "@/lib/types";
import { useVocab } from "@/lib/vocab";

const box = "min-h-[48px] w-full rounded-lg border hairline bg-ink-deep px-3 text-base outline-none focus:border-trace";
const q3 = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });

type Lines = NonNullable<import("@/lib/offline/field").JobPack["parts"]>;

/**
 * Parts on a work order, on the phone. Issuing and returning need a
 * connection (stock must be checked at the moment it leaves the shelf);
 * each request carries an id so a resend after a dropped reply counts once.
 */
export function PhoneJobParts({ jobId, parts, online, locked, onChanged }: { jobId: string; parts?: Lines; online: boolean; locked: boolean; onChanged: () => void }) {
  const m = useM();
  const { dict, label, can, lang } = useVocab();
  const [mode, setMode] = useState<"issue" | "return" | null>(null);
  const [catalogue, setCatalogue] = useState<Part[] | null>(null);
  const [q, setQ] = useState("");
  const [partId, setPartId] = useState("");
  const [store, setStore] = useState("");
  const [n, setN] = useState("1");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { if (mode && !catalogue) loadParts().then(setCatalogue).catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, [mode, catalogue]);

  const lines = parts?.lines ?? [];
  const part = catalogue?.find((p) => p.id === partId);
  const stores = dict("store");
  const chosenStore = store || part?.levels.find((l) => l.qty > 0)?.store || stores[0]?.key || "";
  const needle = q.trim().toLowerCase();
  const choices = (catalogue ?? [])
    .filter((p) => mode !== "return" || lines.some((l) => l.partId === p.id))
    .filter((p) => !needle || `${p.partNo} ${p.name}`.toLowerCase().includes(needle))
    .slice(0, 30);
  const canAct = can("stock.issue") && !locked;

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/stock/${mode}`, { partId, store: chosenStore, qty: Number(n), jobId }, { "X-Client-Op": uuid() });
      setMsg({ ok: true, text: `${mode === "issue" ? m("issued") : m("returned")}: ${n} ${label("unit", part?.unit ?? "")} ${part?.partNo ?? ""}` });
      setMode(null); setPartId(""); setQ(""); setN("1"); setStore("");
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  return (
    <div>
      {lines.length === 0 ? <p className="text-sm text-steel">{m("noParts")}</p> : (
        <ul className="space-y-1.5">
          {lines.map((l) => (
            <li key={l.partId} className="flex items-baseline justify-between gap-2 rounded-lg border hairline px-3 py-2">
              <Link href={`/m/part?id=${encodeURIComponent(l.partId)}`} className="min-w-0 text-base">
                <span className="mono text-sm text-trace">{l.partNo}</span> {l.name}
              </Link>
              <span className="mono shrink-0 text-base">{q3(l.qty)} {label("unit", l.unit)}</span>
            </li>
          ))}
          <li className="flex justify-between px-1 pt-1 text-sm text-steel"><span>{m("partsCost")}</span><span className="mono">RM {parts!.total.toFixed(2)}</span></li>
        </ul>
      )}
      {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
      {canAct && !mode && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <BigButton tone="ghost" disabled={!online} onClick={() => setMode("issue")}>＋ {m("issuePart")}</BigButton>
          {lines.length > 0 && <BigButton tone="ghost" disabled={!online} onClick={() => setMode("return")}>↩ {m("returnPart")}</BigButton>}
        </div>
      )}
      {canAct && !online && <p className="mt-2 text-xs text-steel">{m("needsConnection")}</p>}
      {mode && (
        <div className="mt-3 space-y-2 rounded-lg border hairline p-3">
          <p className="text-sm font-medium">{mode === "issue" ? m("issuePart") : m("returnPart")}</p>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={m("searchPart")} className={box} />
          <ul className="max-h-60 space-y-1 overflow-y-auto">
            {!catalogue && <li className="text-sm text-steel">{m("loading")}</li>}
            {choices.map((p) => (
              <li key={p.id}>
                <button onClick={() => setPartId(p.id)} className={`w-full rounded-lg border px-3 py-2 text-left ${partId === p.id ? "border-trace bg-trace/10" : "hairline"}`}>
                  <span className="mono text-sm text-trace">{p.partNo}</span> <span className="text-base">{p.name}</span>
                  <span className="block text-xs text-steel">{p.levels.filter((l) => l.qty > 0).map((l) => `${q3(l.qty)} ${label("unit", p.unit)} · ${l.storeLabel}${l.bin ? ` ${l.bin}` : ""}`).join(" — ") || "0"}</span>
                </button>
              </li>
            ))}
          </ul>
          {part && (
            <>
              <label className="block text-sm text-steel">{mode === "issue" ? m("fromStore") : m("toStore")}
                <select value={chosenStore} onChange={(e) => setStore(e.target.value)} className={box}>
                  {stores.map((s) => <option key={s.key} value={s.key}>{lang === "ms" && s.labelMs ? s.labelMs : s.label} ({q3(part.levels.find((l) => l.store === s.key)?.qty ?? 0)})</option>)}
                </select>
              </label>
              <label className="block text-sm text-steel">{m("quantity")} ({label("unit", part.unit)})
                <input inputMode="decimal" value={n} onChange={(e) => setN(e.target.value)} className={box} />
              </label>
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <BigButton tone="ghost" onClick={() => { setMode(null); setPartId(""); }}>{m("back")}</BigButton>
            <BigButton disabled={busy || !online || !part || !Number(n)} onClick={submit}>{mode === "issue" ? m("issue") : m("giveBack")}</BigButton>
          </div>
        </div>
      )}
    </div>
  );
}
