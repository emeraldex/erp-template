"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { StockCount, StockCountLine } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, Panel, StatusPill, Table, Td, Tr } from "@/components/ui";
import { errText, field, input, Labelled, money, Msg, Notice, qty } from "./common";

const TONE = { OPEN: "warn", POSTED: "good", CANCELLED: "neutral" } as const;

/** Stocktakes: start one for a store, enter what is on the shelves, then post the differences. */
export function CountsView({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("count");
  const { dict, lang } = useVocab();
  const [rows, setRows] = useState<StockCount[] | null>(null);
  const [start, setStart] = useState({ store: "", group: "", note: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const name = (e: { label: string; labelMs: string }) => (lang === "ms" && e.labelMs ? e.labelMs : e.label);

  const load = useCallback(() => {
    api.get<StockCount[]>("/stock/counts").then(setRows).catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function begin() {
    setBusy(true); setMsg(null);
    try {
      const c = await api.post<StockCount>("/stock/counts", { store: start.store || dict("store")[0]?.key, ...(start.group ? { group: start.group } : {}), note: start.note });
      setStart({ store: "", group: "", note: "" }); load();
      router.push(`/stock?view=counts&count=${encodeURIComponent(c.id)}`);
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally { setBusy(false); }
  }

  if (openId) return <CountSheet id={openId} canManage={canManage} onBack={() => { router.push("/stock?view=counts"); load(); }} />;

  return (
    <>
      <Notice msg={msg} />
      {canManage && (
        <div className="panel ticked fade-up mb-5 p-5">
          <p className="eyebrow mb-3">Start a count</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <Labelled label="Store">
              <select value={start.store} onChange={(e) => setStart({ ...start, store: e.target.value })} className={input}>
                {dict("store").map((s) => <option key={s.key} value={s.key}>{name(s)}</option>)}
              </select>
            </Labelled>
            <Labelled label="Only one group (optional)">
              <select value={start.group} onChange={(e) => setStart({ ...start, group: e.target.value })} className={input}>
                <option value="">All parts held</option>
                {dict("partGroup").map((g) => <option key={g.key} value={g.key}>{name(g)}</option>)}
              </select>
            </Labelled>
            <Labelled label="Note" className="sm:col-span-2"><input value={start.note} onChange={(e) => setStart({ ...start, note: e.target.value })} placeholder="Year-end, cycle count aisle B…" className={input} /></Labelled>
          </div>
          <p className="mt-3 text-xs text-dim">The count takes a snapshot of what the system says is there. Work can carry on while you count: parts issued in the meantime are kept when the count is posted.</p>
          <div className="mt-3"><Button disabled={busy} onClick={begin}>Start count</Button></div>
        </div>
      )}
      {rows && rows.length === 0 ? <EmptyState title="No counts yet" hint={canManage ? "Start one above." : "Stores staff start counts."} /> : (
        <div className="panel fade-up d1">
          <Table head={["Count", "Store", "Lines", "Started", "Posted", "Status"]}>
            {(rows ?? []).map((c) => (
              <Tr key={c.id} onClick={() => router.push(`/stock?view=counts&count=${encodeURIComponent(c.id)}`)}>
                <Td className="mono text-xs text-trace">{c.id}{c.note && <span className="ml-2 text-dim">{c.note}</span>}</Td>
                <Td className="mono text-xs text-steel">{c.storeLabel}</Td>
                <Td className="mono text-xs tabular-nums text-steel">{typeof c.lines === "number" ? c.lines : c.lines.length}</Td>
                <Td className="mono text-[11px] text-steel">{c.startedAt.slice(0, 10)} · {c.startedBy}</Td>
                <Td className="mono text-[11px] text-steel">{c.postedAt ? `${c.postedAt.slice(0, 10)} · ${c.postedBy}` : "—"}</Td>
                <Td><StatusPill value={c.status} tone={TONE[c.status]} /></Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
    </>
  );
}

/** One count: a keyboard-friendly sheet — type a quantity, Enter moves to the next line. */
function CountSheet({ id, canManage, onBack }: { id: string; canManage: boolean; onBack: () => void }) {
  const { label } = useVocab();
  const [c, setC] = useState<StockCount | null>(null);
  const [entry, setEntry] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const take = (next: StockCount) => {
    setC(next);
    setEntry(Object.fromEntries((next.lines as StockCountLine[]).map((l) => [l.partId, l.countedQty == null ? "" : String(l.countedQty)])));
  };
  const load = useCallback(() => {
    api.get<StockCount>(`/stock/counts/${encodeURIComponent(id)}`).then(take).catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const lines = useMemo(() => (c && Array.isArray(c.lines) ? c.lines : []), [c]);
  const shown = lines.filter((l) => !q || `${l.partNo} ${l.name} ${l.bin}`.toLowerCase().includes(q.toLowerCase()));
  const open = c?.status === "OPEN" && canManage;
  const changed = lines.filter((l) => (entry[l.partId] ?? "") !== (l.countedQty == null ? "" : String(l.countedQty)));

  async function save(): Promise<boolean> {
    if (!changed.length) return true;
    try {
      take(await api.patch<StockCount>(`/stock/counts/${encodeURIComponent(id)}`, {
        lines: changed.map((l) => ({ partId: l.partId, countedQty: entry[l.partId] === "" ? null : Number(entry[l.partId]) })),
      }));
      return true;
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
      return false;
    }
  }

  async function act(kind: "save" | "post" | "cancel") {
    setBusy(true); setMsg(null);
    try {
      if (kind === "cancel") {
        if (!window.confirm("Cancel this count? Nothing will change in stock.")) return;
        take(await api.post<StockCount>(`/stock/counts/${encodeURIComponent(id)}/cancel`, {}));
        setMsg({ ok: true, text: "Count cancelled." });
        return;
      }
      if (!(await save())) return;
      if (kind === "save") { setMsg({ ok: true, text: "Saved." }); return; }
      const posted = await api.post<StockCount>(`/stock/counts/${encodeURIComponent(id)}/post`, {});
      take(posted);
      setMsg({ ok: true, text: `Count posted: ${posted.counted} line${posted.counted === 1 ? "" : "s"} counted, difference ${money(posted.differenceValue ?? 0)}.` });
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally { setBusy(false); }
  }

  function nextOnEnter(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    document.querySelector<HTMLInputElement>(`[data-count-row="${i + 1}"]`)?.focus();
  }

  if (!c) return <Panel className="p-5"><p className="eyebrow">{msg?.text ?? "LOADING…"}</p></Panel>;
  const counted = lines.filter((l) => (entry[l.partId] ?? "") !== "").length;
  const diffValue = lines.reduce((s, l) => {
    const v = entry[l.partId];
    return v === "" || v === undefined || Number.isNaN(Number(v)) ? s : s + (Number(v) - l.systemQty) * l.avgCost;
  }, 0);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <button onClick={onBack} className="mono text-[10.5px] tracking-widest text-steel hover:text-trace">← ALL COUNTS</button>
          <h2 className="display text-xl font-bold">{c.id} · {c.storeLabel}</h2>
          <p className="mono text-[11px] text-steel">
            Started {c.startedAt.slice(0, 16).replace("T", " ")} by {c.startedBy}{c.note && ` · ${c.note}`}
            {c.postedAt && ` · posted ${c.postedAt.slice(0, 16).replace("T", " ")} by ${c.postedBy}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="mono text-xs text-steel">{counted}/{lines.length} counted · difference <span className={diffValue < 0 ? "text-amber" : "text-fg"}>{money(diffValue)}</span></p>
          <StatusPill value={c.status} tone={TONE[c.status]} />
        </div>
      </div>
      <Notice msg={msg} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find part or bin…" className={`${field} w-64`} />
        {open && (
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" disabled={busy || !changed.length} onClick={() => act("save")}>Save{changed.length ? ` (${changed.length})` : ""}</Button>
            <Button disabled={busy || counted === 0} onClick={() => act("post")}>Post count</Button>
            <Button variant="danger" disabled={busy} onClick={() => act("cancel")}>Cancel count</Button>
          </div>
        )}
      </div>
      <div className="panel fade-up">
        <Table head={["Bin", "Part", "System", "Counted", "Difference", "Value", "Now"]}>
          {shown.map((l, i) => {
            const v = entry[l.partId] ?? "";
            const diff = v === "" || Number.isNaN(Number(v)) ? null : Math.round((Number(v) - l.systemQty) * 1000) / 1000;
            return (
              <Tr key={l.partId}>
                <Td className="mono text-xs text-steel">{l.bin || "—"}</Td>
                <Td><span className="mono text-xs text-trace">{l.partNo}</span> <span className="text-sm">{l.name}</span></Td>
                <Td className="mono text-xs tabular-nums text-steel">{qty(l.systemQty)} {label("unit", l.unit)}</Td>
                <Td>
                  {open ? (
                    <input data-count-row={i} inputMode="decimal" aria-label={`Counted ${l.partNo}`} value={v}
                      onChange={(e) => setEntry({ ...entry, [l.partId]: e.target.value })} onKeyDown={(e) => nextOnEnter(e, i)}
                      className="mono w-24 rounded-md border hairline bg-ink-deep px-2 py-1 text-xs text-fg outline-none focus:border-trace" />
                  ) : <span className="mono text-xs tabular-nums">{l.countedQty == null ? "—" : qty(l.countedQty)}</span>}
                </Td>
                <Td className={`mono text-xs tabular-nums ${diff == null || diff === 0 ? "text-dim" : diff < 0 ? "text-amber" : "text-phosphor"}`}>{diff == null ? "—" : `${diff > 0 ? "+" : ""}${qty(diff)}`}</Td>
                <Td className="mono text-xs tabular-nums text-steel">{diff == null ? "—" : money(diff * l.avgCost)}</Td>
                <Td className="mono text-xs tabular-nums text-dim" >{qty(l.onHand)}</Td>
              </Tr>
            );
          })}
        </Table>
      </div>
      <p className="mt-3 text-xs text-dim">“Now” is what the store holds at the moment. Posting adds each difference to it, so issues made since the count started are kept. Lines left empty are not changed.</p>
    </>
  );
}
