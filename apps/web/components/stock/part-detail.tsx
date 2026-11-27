"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, download } from "@/lib/api";
import type { Part, StockLevel } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { currencySymbol } from "@/lib/format";
import { Button, Panel, StatusPill } from "@/components/ui";
import { errText, input, Labelled, money, MOVEMENT_LABEL, Msg, qty } from "./common";

type Action = "receive" | "issue" | "return" | "adjust" | "transfer";
const ACTIONS: { key: Action; label: string; cap: string }[] = [
  { key: "issue", label: "Issue to work order", cap: "stock.issue" },
  { key: "return", label: "Return from work order", cap: "stock.issue" },
  { key: "receive", label: "Receive", cap: "stock.manage" },
  { key: "adjust", label: "Adjust", cap: "stock.manage" },
  { key: "transfer", label: "Transfer", cap: "stock.manage" },
];

/** One part: stock in each store, what changed and why, and the actions people may take. */
export function PartDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { dict, label, can, terms, lang } = useVocab();
  const canManage = can("stock.manage");
  const [p, setP] = useState<Part | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [f, setF] = useState({ store: "", to: "", qty: "", unitCost: "", reason: "", jobId: "" });
  const [editing, setEditing] = useState<string | null>(null);
  const [lv, setLv] = useState({ bin: "", reorderPoint: "", reorderQty: "" });
  const [details, setDetails] = useState<{ name: string; description: string; manufacturer: string; mfrPartNo: string; group: string } | null>(null);

  const load = useCallback(() => {
    api.get<Part>(`/stock/parts/${encodeURIComponent(id)}`).then(setP).catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, [id]);
  useEffect(() => { setP(null); setMsg(null); setAction(null); setEditing(null); setDetails(null); load(); }, [load]);

  const stores = dict("store");
  const storeName = (k: string) => label("store", k);
  const name = (e: { label: string; labelMs: string }) => (lang === "ms" && e.labelMs ? e.labelMs : e.label);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      setAction(null); setF({ store: "", to: "", qty: "", unitCost: "", reason: "", jobId: "" });
      load(); onChanged();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally { setBusy(false); }
  }

  function submit() {
    if (!p) return;
    const store = f.store || p.levels.find((l) => l.qty > 0)?.store || stores[0]?.key;
    const n = Number(f.qty);
    const unit = label("unit", p.unit);
    switch (action) {
      case "receive":
        return run(() => api.post("/stock/receive", { partId: p.id, store, qty: n, unitCost: Number(f.unitCost), reason: f.reason }), `Received ${f.qty} ${unit} into ${storeName(store)}.`);
      case "issue":
        return run(() => api.post("/stock/issue", { partId: p.id, store, qty: n, jobId: f.jobId.trim() }), `Issued ${f.qty} ${unit} to ${f.jobId.trim()}.`);
      case "return":
        return run(() => api.post("/stock/return", { partId: p.id, store, qty: n, jobId: f.jobId.trim() }), `Took back ${f.qty} ${unit} from ${f.jobId.trim()}.`);
      case "adjust":
        return run(() => api.post("/stock/adjust", { partId: p.id, store, qty: n, reason: f.reason }), `Adjusted ${storeName(store)} by ${n > 0 ? "+" : ""}${f.qty} ${unit}.`);
      case "transfer":
        return run(() => api.post("/stock/transfer", { partId: p.id, from: store, to: f.to, qty: n }), `Moved ${f.qty} ${unit} from ${storeName(store)} to ${storeName(f.to)}.`);
    }
  }

  function editLevel(l: StockLevel | null, store: string) {
    setEditing(store);
    setLv({ bin: l?.bin ?? "", reorderPoint: l?.reorderPoint != null ? String(l.reorderPoint) : "", reorderQty: l?.reorderQty != null ? String(l.reorderQty) : "" });
  }

  function saveLevel(store: string) {
    if (!p) return;
    void run(async () => {
      await api.put(`/stock/parts/${encodeURIComponent(p.id)}/levels/${encodeURIComponent(store)}`, {
        bin: lv.bin, reorderPoint: lv.reorderPoint === "" ? null : Number(lv.reorderPoint), reorderQty: lv.reorderQty === "" ? null : Number(lv.reorderQty),
      });
      setEditing(null);
    }, `Saved ${storeName(store)} settings.`);
  }

  if (!p) return <Panel className="p-5"><p className="eyebrow">{msg?.text ?? "LOADING…"}</p></Panel>;
  const allowed = ACTIONS.filter((a) => can(a.cap) && (a.key !== "transfer" || stores.length > 1));
  const notHeld = stores.filter((s) => !p.levels.some((l) => l.store === s.key));
  const ready = !!f.qty && (action !== "receive" || (f.unitCost !== "" && !!f.reason)) && (action !== "adjust" || !!f.reason)
    && (action !== "transfer" || !!f.to) && ((action !== "issue" && action !== "return") || !!f.jobId.trim());

  return (
    <Panel ticked className="fade-up p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="mono text-xs text-trace">{p.partNo} · {p.id}</p>
          <h2 className="display text-xl font-bold">{p.name}</h2>
          <p className="mono text-[10.5px] text-steel">
            {[label("unit", p.unit), p.group && label("partGroup", p.group), p.manufacturer, p.mfrPartNo && `MPN ${p.mfrPartNo}`].filter(Boolean).join(" · ")}
          </p>
          {p.description && <p className="mt-1 text-sm text-steel">{p.description}</p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          {!p.active && <StatusPill value="INACTIVE" tone="neutral" />}
          {p.low && <StatusPill value="LOW" tone="warn" />}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2 text-center">
        {[["On hand", `${qty(p.onHand)} ${label("unit", p.unit)}`], ["Average cost", money(p.avgCost)], ["Value", money(p.value)]].map(([k, v]) => (
          <div key={k} className="rounded border hairline bg-ink-deep/40 px-2 py-2">
            <p className="mono text-[9.5px] tracking-widest text-dim">{k.toUpperCase()}</p>
            <p className="mono text-sm tabular-nums text-fg">{v}</p>
          </div>
        ))}
      </div>
      {msg && <p className={`mb-3 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}

      <p className="eyebrow mb-2">Stores</p>
      {p.levels.length === 0 && <p className="mb-2 text-sm text-dim">Not held in any store yet.</p>}
      <div className="space-y-1.5">
        {p.levels.map((l) => (
          <div key={l.store} className="rounded border hairline bg-ink-deep/40 px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {l.storeLabel}{l.bin && <span className="mono ml-2 text-[10.5px] text-steel">BIN {l.bin}</span>}
              </p>
              <p className="mono text-sm tabular-nums">
                {qty(l.qty)} <span className="text-[10.5px] text-dim">{label("unit", p.unit)}</span>
                {l.low && <span className="ml-2"><StatusPill value="LOW" tone="warn" /></span>}
              </p>
            </div>
            <p className="mono text-[10px] text-dim">
              {l.reorderPoint != null ? `reorder at ${qty(l.reorderPoint)}${l.reorderQty ? `, order ${qty(l.reorderQty)}` : ""}` : "no reorder point"}
              {l.countedAt && ` · counted ${l.countedAt.slice(0, 10)}`}
              {canManage && editing !== l.store && <button onClick={() => editLevel(l, l.store)} className="ml-2 text-steel hover:text-trace">EDIT</button>}
            </p>
            {editing === l.store && <LevelForm lv={lv} setLv={setLv} busy={busy} onSave={() => saveLevel(l.store)} onCancel={() => setEditing(null)} />}
          </div>
        ))}
        {canManage && notHeld.length > 0 && (
          editing && notHeld.some((s) => s.key === editing) ? (
            <div className="rounded border hairline bg-ink-deep/40 px-3 py-2">
              <p className="text-sm">{storeName(editing)}</p>
              <LevelForm lv={lv} setLv={setLv} busy={busy} onSave={() => saveLevel(editing)} onCancel={() => setEditing(null)} />
            </div>
          ) : (
            <select value="" onChange={(e) => e.target.value && editLevel(null, e.target.value)} className={`${input} text-steel`} aria-label="Set up in another store">
              <option value="">+ Bin and reorder point in another store…</option>
              {notHeld.map((s) => <option key={s.key} value={s.key}>{name(s)}</option>)}
            </select>
          )
        )}
      </div>

      {allowed.length > 0 && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {allowed.map((a) => (
              <button key={a.key} onClick={() => setAction(action === a.key ? null : a.key)}
                className={`mono rounded-md border px-2.5 py-1.5 text-[10.5px] tracking-widest transition-colors ${action === a.key ? "border-trace bg-trace/10 text-trace" : "hairline text-steel hover:text-fg"}`}>
                {a.label.toUpperCase()}
              </button>
            ))}
          </div>
          {action && (
            <div className="mt-3 grid gap-2 rounded border hairline bg-ink-deep/40 p-3 sm:grid-cols-2">
              <Labelled label={action === "transfer" ? "From store" : "Store"}>
                <select value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })} className={input}>
                  <option value="">{storeName(p.levels.find((l) => l.qty > 0)?.store || stores[0]?.key || "")}</option>
                  {stores.map((s) => <option key={s.key} value={s.key}>{name(s)}</option>)}
                </select>
              </Labelled>
              {action === "transfer" && (
                <Labelled label="To store">
                  <select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={input}>
                    <option value="">—</option>
                    {stores.map((s) => <option key={s.key} value={s.key}>{name(s)}</option>)}
                  </select>
                </Labelled>
              )}
              <Labelled label={action === "adjust" ? "Change (+ to add, − to take away)" : `Quantity (${label("unit", p.unit)})`}>
                <input inputMode="decimal" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} className={input} />
              </Labelled>
              {(action === "issue" || action === "return") && (
                <Labelled label={`${terms.job} no.`}><input value={f.jobId} onChange={(e) => setF({ ...f, jobId: e.target.value })} placeholder="WO-2026-0001" className={input} /></Labelled>
              )}
              {action === "receive" && (
                <Labelled label={`Unit cost (${currencySymbol()})`}><input inputMode="decimal" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} className={input} /></Labelled>
              )}
              {(action === "receive" || action === "adjust") && (
                <Labelled label={action === "receive" ? "Where it came from" : "Reason"} className="sm:col-span-2">
                  <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={action === "receive" ? "Opening stock, free issue, delivery note…" : "Damaged, found, write-off…"} className={input} />
                </Labelled>
              )}
              {action === "receive" && <p className="text-xs text-dim sm:col-span-2">Purchases normally arrive through their purchase request; use this for stock that did not.</p>}
              <div className="sm:col-span-2"><Button disabled={busy || !ready} onClick={submit}>{ACTIONS.find((a) => a.key === action)!.label}</Button></div>
            </div>
          )}
        </div>
      )}

      {(p.requests ?? []).length > 0 && (
        <div className="mt-4">
          <p className="eyebrow mb-2">Open purchase requests</p>
          <ul className="space-y-1">
            {p.requests!.map((r) => (
              <li key={r.id} className="mono text-xs">
                <Link href={`/demands?id=${encodeURIComponent(r.id)}`} className="text-trace hover:underline">{r.id}</Link>
                <span className="text-steel"> · {qty(r.qty)} · {r.jobId ? `for ${r.jobId}` : `for ${storeName(r.forStore ?? "")}`} · {label("status:DEMAND", r.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="eyebrow mb-2">Ledger · latest 50</p>
        {(p.movements ?? []).length === 0 ? <p className="text-sm text-dim">No movements yet.</p> : (
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <tbody>
                {p.movements!.map((m) => (
                  <tr key={m.id} className="border-b hairline last:border-0 align-top">
                    <td className="mono py-1.5 pr-2 text-[10px] text-dim">{m.at.slice(0, 16).replace("T", " ")}</td>
                    <td className="py-1.5 pr-2">
                      {MOVEMENT_LABEL[m.type] ?? m.type} <span className="mono text-[10px] text-dim">{storeName(m.store)}</span>
                      <p className="mono text-[10px] text-dim">
                        {m.jobId && <Link href={`/jobs/${m.jobId}`} className="text-trace hover:underline">{m.jobId}</Link>}
                        {m.demandId && <Link href={`/demands?id=${encodeURIComponent(m.demandId)}`} className="text-trace hover:underline">{m.demandId}</Link>}
                        {m.countId && <Link href={`/stock?view=counts&count=${encodeURIComponent(m.countId)}`} className="text-trace hover:underline">{m.countId}</Link>}
                        {(m.jobId || m.demandId || m.countId) && m.reason ? " · " : ""}{m.reason}{` · ${m.by}`}
                      </p>
                    </td>
                    <td className={`mono py-1.5 pr-2 text-right tabular-nums ${m.qty < 0 ? "text-amber" : "text-phosphor"}`}>{m.qty > 0 ? "+" : ""}{qty(m.qty)}</td>
                    <td className="mono py-1.5 text-right tabular-nums text-steel">{qty(m.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t hairline pt-3">
        <Button variant="ghost" onClick={() => download(`/stock/labels?ids=${encodeURIComponent(p.id)}`, "part-label.pdf").catch((e) => setMsg({ ok: false, text: errText(e) }))}>Print label</Button>
        {canManage && !details && (
          <Button variant="ghost" onClick={() => setDetails({ name: p.name, description: p.description, manufacturer: p.manufacturer, mfrPartNo: p.mfrPartNo, group: p.group })}>Edit details</Button>
        )}
        {canManage && (
          <Button variant="ghost" disabled={busy} onClick={() => run(() => api.patch(`/stock/parts/${encodeURIComponent(p.id)}`, { active: !p.active }), p.active ? "Part made inactive — it no longer appears in pickers." : "Part active again.")}>
            {p.active ? "Make inactive" : "Make active"}
          </Button>
        )}
      </div>
      {details && (
        <div className="mt-3 grid gap-2 rounded border hairline bg-ink-deep/40 p-3 sm:grid-cols-2">
          {(["name", "manufacturer", "mfrPartNo", "description"] as const).map((k) => (
            <Labelled key={k} label={{ name: "Name", manufacturer: "Manufacturer", mfrPartNo: "Manufacturer's part no.", description: "Description" }[k]}>
              <input value={details[k]} onChange={(e) => setDetails({ ...details, [k]: e.target.value })} className={input} />
            </Labelled>
          ))}
          <Labelled label="Group">
            <select value={details.group} onChange={(e) => setDetails({ ...details, group: e.target.value })} className={input}>
              <option value="">—</option>
              {dict("partGroup").map((g) => <option key={g.key} value={g.key}>{name(g)}</option>)}
            </select>
          </Labelled>
          <div className="flex gap-2 sm:col-span-2">
            <Button disabled={busy || !details.name} onClick={() => run(async () => { await api.patch(`/stock/parts/${encodeURIComponent(p.id)}`, details); setDetails(null); }, "Details saved.")}>Save</Button>
            <Button variant="ghost" onClick={() => setDetails(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function LevelForm({ lv, setLv, busy, onSave, onCancel }: {
  lv: { bin: string; reorderPoint: string; reorderQty: string };
  setLv: (v: { bin: string; reorderPoint: string; reorderQty: string }) => void;
  busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5">
      <Labelled label="Bin"><input value={lv.bin} onChange={(e) => setLv({ ...lv, bin: e.target.value })} className={input} /></Labelled>
      <Labelled label="Reorder at"><input inputMode="decimal" value={lv.reorderPoint} onChange={(e) => setLv({ ...lv, reorderPoint: e.target.value })} className={input} /></Labelled>
      <Labelled label="Order qty"><input inputMode="decimal" value={lv.reorderQty} onChange={(e) => setLv({ ...lv, reorderQty: e.target.value })} className={input} /></Labelled>
      <div className="col-span-3 flex gap-2">
        <Button disabled={busy} onClick={onSave}>Save</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
