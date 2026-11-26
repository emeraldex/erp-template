"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, download } from "@/lib/api";
import type { Part } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, PageHeader, StatusPill, Table, Td, Tr } from "@/components/ui";
import { errText, field, input, Labelled, money, Msg, Notice, qty } from "@/components/stock/common";
import { PartDetail } from "@/components/stock/part-detail";
import { ReorderView } from "@/components/stock/reorder";
import { CountsView } from "@/components/stock/counts";
import { ImportPanel } from "@/components/stock/import";

const blank = { partNo: "", name: "", unit: "", group: "", manufacturer: "", mfrPartNo: "", description: "" };
type View = "parts" | "reorder" | "counts";

export default function StockPage() {
  return (
    <Suspense fallback={<p className="eyebrow py-20 text-center">LOADING…</p>}>
      <Stock />
    </Suspense>
  );
}

/** Parts and stock: the catalogue, what each store holds, reordering and counts. */
function Stock() {
  const router = useRouter();
  const params = useSearchParams();
  const view = (params.get("view") as View) || "parts";
  const { cfg, modules, can } = useVocab();
  const canManage = can("stock.manage");

  if (cfg && !modules.stock) {
    return <p className="py-20 text-center text-sm text-dim">Stock control is switched off for this organisation (Settings → modules).</p>;
  }

  const tab = (v: View, label: string) => (
    <button
      key={v}
      onClick={() => router.push(v === "parts" ? "/stock" : `/stock?view=${v}`)}
      className={`mono rounded-md px-3 py-1.5 text-[11px] tracking-widest transition-colors ${view === v ? "bg-trace/15 text-trace" : "text-steel hover:text-fg"}`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <PageHeader eyebrow="Catalogue · stores · ledger · reorder · counts" title="Parts & stock" />
      <div className="fade-up mb-4 flex flex-wrap gap-1 border-b hairline pb-2">
        {tab("parts", "PARTS")}
        {tab("reorder", "REORDER")}
        {tab("counts", "COUNTS")}
      </div>
      {view === "reorder" ? <ReorderView canManage={canManage} /> : view === "counts" ? <CountsView canManage={canManage} /> : <PartsView />}
    </div>
  );
}

function PartsView() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("part");
  const { dict, label, can, lang } = useVocab();
  const canManage = can("stock.manage");
  const [rows, setRows] = useState<Part[] | null>(null);
  const [q, setQ] = useState("");
  const [store, setStore] = useState("");
  const [group, setGroup] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [panel, setPanel] = useState<"add" | "import" | null>(null);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<Part[]>("/stock/parts").then(setRows).catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((p) =>
    (!group || p.group === group) &&
    (!store || p.levels.some((l) => l.store === store)) &&
    (!lowOnly || p.levels.some((l) => l.low && (!store || l.store === store))) &&
    (!q || `${p.partNo} ${p.name} ${p.manufacturer} ${p.mfrPartNo} ${p.description}`.toLowerCase().includes(q.toLowerCase()))), [rows, group, store, lowOnly, q]);

  const held = (p: Part) => (store ? p.levels.find((l) => l.store === store)?.qty ?? 0 : p.onHand);
  const totalValue = shown.reduce((s, p) => s + (store ? held(p) * p.avgCost : p.value), 0);
  const name = (e: { label: string; labelMs: string }) => (lang === "ms" && e.labelMs ? e.labelMs : e.label);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      const p = await api.post<Part>("/stock/parts", {
        partNo: form.partNo, name: form.name, unit: form.unit || dict("unit")[0]?.key, ...(form.group ? { group: form.group } : {}),
        manufacturer: form.manufacturer, mfrPartNo: form.mfrPartNo, description: form.description,
      });
      setPanel(null); setForm(blank); load();
      router.push(`/stock?part=${encodeURIComponent(p.id)}`);
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally { setBusy(false); }
  }

  function printLabels() {
    const ids = shown.slice(0, 100).map((p) => encodeURIComponent(p.id)).join(",");
    download(`/stock/labels?ids=${ids}${store ? `&store=${encodeURIComponent(store)}` : ""}`, "part-labels.pdf").catch((e) => setMsg({ ok: false, text: errText(e) }));
  }

  return (
    <>
      <div className="fade-up mb-4 flex flex-wrap items-center gap-2">
        {shown.length > 0 && (
          <Button variant="ghost" onClick={printLabels}>{store ? "Print bin labels" : "Print labels"} ({Math.min(shown.length, 100)})</Button>
        )}
        {canManage && (
          <>
            <Button variant="ghost" onClick={() => setPanel(panel === "import" ? null : "import")}>{panel === "import" ? "Close import" : "Import from spreadsheet"}</Button>
            <Button variant={panel === "add" ? "ghost" : "primary"} onClick={() => setPanel(panel === "add" ? null : "add")}>{panel === "add" ? "Cancel" : "+ Add part"}</Button>
          </>
        )}
      </div>
      <Notice msg={msg} />

      {panel === "add" && (
        <div className="panel ticked fade-up mb-6 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            {([["partNo", "Part number *"], ["name", "Name *"], ["manufacturer", "Manufacturer"], ["mfrPartNo", "Manufacturer's part no."]] as const).map(([k, l]) => (
              <Labelled key={k} label={l}><input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={input} /></Labelled>
            ))}
            <Labelled label="Unit">
              <select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={input}>
                {dict("unit").map((u) => <option key={u.key} value={u.key}>{name(u)}</option>)}
              </select>
            </Labelled>
            <Labelled label="Group">
              <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} className={input}>
                <option value="">—</option>
                {dict("partGroup").map((g) => <option key={g.key} value={g.key}>{name(g)}</option>)}
              </select>
            </Labelled>
            <Labelled label="Description" className="sm:col-span-2"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={input} /></Labelled>
          </div>
          <p className="mt-3 text-xs text-dim">Stock goes in afterwards: receive it on the part, buy it through a purchase request, or import opening stock.</p>
          <div className="mt-4"><Button disabled={busy || !form.partNo || !form.name} onClick={create}>Add to catalogue</Button></div>
        </div>
      )}
      {panel === "import" && <ImportPanel onDone={() => { load(); }} />}

      <div className="fade-up d1 mb-4 flex flex-wrap items-center gap-2">
        <select value={store} onChange={(e) => setStore(e.target.value)} className={`${field} w-48`} aria-label="Store">
          <option value="">All stores</option>
          {dict("store").map((s) => <option key={s.key} value={s.key}>{name(s)}</option>)}
        </select>
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={`${field} w-44`} aria-label="Group">
          <option value="">All groups</option>
          {dict("partGroup").map((g) => <option key={g.key} value={g.key}>{name(g)}</option>)}
        </select>
        <label className="mono flex items-center gap-1.5 text-[11px] tracking-widest text-steel">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> LOW ONLY
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search part no., name, maker…" className={`${field} ml-auto w-64`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className={openId ? "lg:col-span-3" : "lg:col-span-5"}>
          {rows && shown.length === 0 ? (
            <EmptyState title="No parts match" hint={canManage ? "Add parts one by one, or import your list from a spreadsheet." : "Adjust the filters."} />
          ) : (
            <div className="panel fade-up d2">
              <Table head={["Part no.", "Name", "Group", store ? "In store" : "On hand", "Avg cost", "Value", ""]}>
                {shown.map((p) => (
                  <Tr key={p.id} onClick={() => router.push(`/stock?part=${encodeURIComponent(p.id)}`)}>
                    <Td className="mono whitespace-nowrap text-xs text-trace">{p.partNo}</Td>
                    <Td>{p.name}{p.manufacturer && <span className="mono ml-2 text-[10.5px] text-dim">{p.manufacturer}</span>}</Td>
                    <Td className="mono text-xs text-steel">{p.group ? label("partGroup", p.group) : "—"}</Td>
                    <Td className="mono whitespace-nowrap text-xs tabular-nums">{qty(held(p))} <span className="text-dim">{label("unit", p.unit)}</span></Td>
                    <Td className="mono whitespace-nowrap text-xs tabular-nums text-steel">{money(p.avgCost)}</Td>
                    <Td className="mono whitespace-nowrap text-xs tabular-nums text-steel">{money(store ? held(p) * p.avgCost : p.value)}</Td>
                    <Td>{p.levels.some((l) => l.low && (!store || l.store === store)) && <StatusPill value="LOW" tone="warn" />}</Td>
                  </Tr>
                ))}
              </Table>
              {shown.length > 0 && (
                <p className="mono border-t hairline px-4 py-2 text-right text-[11px] text-steel">
                  {shown.length} part{shown.length === 1 ? "" : "s"} · value {money(totalValue)}
                  {" · "}<Link href="/stock?view=reorder" className="text-trace hover:underline">reorder list →</Link>
                </p>
              )}
            </div>
          )}
        </div>
        {openId && <div className="lg:col-span-2"><PartDetail id={openId} onChanged={load} /></div>}
      </div>
    </>
  );
}
