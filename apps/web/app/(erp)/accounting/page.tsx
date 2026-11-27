"use client";

import { useCallback, useEffect, useState } from "react";
import { api, download } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, PageHeader, Panel, Table, Td, Tr } from "@/components/ui";

type Counts = { new: number; exported: number };
type Preview = { from: string; to: string; currency: string; sales: Counts; receipts: Counts; purchases: Counts };
type Batch = { id: string; from: string; to: string; includeExported: boolean; createdBy: string; createdAt: string; sales: number; receipts: number; purchases: number };
type Codes = {
  receivables: string; bank: string; outputTax: string; taxCode: string; purchases: string; stock: string; revenueDefault: string;
  revenueByStream: Record<string, string>; streams: { id: string; label: string }[];
};

const field = "mono rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";
const iso = (d: Date) => d.toISOString().slice(0, 10);
function lastMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return { from: iso(first), to: iso(last) };
}
const SHEETS = [["sales", "Sales"], ["receipts", "Receipts"], ["purchases", "Purchases"]] as const;
const CODE_FIELDS = [
  ["receivables", "Trade receivables"], ["bank", "Bank"], ["outputTax", "Output tax"], ["taxCode", "Tax code"],
  ["revenueDefault", "Revenue (default)"], ["purchases", "Purchases / expense"], ["stock", "Stock (inventory)"],
] as const;

/** Hand invoices, payments and purchases to the accounting system in batches; nothing is exported twice unless asked. */
export default function AccountingPage() {
  const { can, modules } = useVocab();
  const [period, setPeriod] = useState(lastMonth);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [repeat, setRepeat] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = modules.invoicing && can("accounting.export");

  const loadPreview = useCallback(() => {
    if (!period.from || !period.to) return;
    api.get<Preview>(`/accounting/preview?from=${period.from}&to=${period.to}`).then(setPreview).catch((e) => { setPreview(null); setMsg({ ok: false, text: (e as Error).message }); });
  }, [period]);
  const loadBatches = useCallback(() => { api.get<Batch[]>("/accounting/exports").then(setBatches).catch(() => setBatches([])); }, []);
  useEffect(() => { if (allowed) loadPreview(); }, [allowed, loadPreview]);
  useEffect(() => { if (allowed) loadBatches(); }, [allowed, loadBatches]);

  if (!allowed) return <EmptyState title="Accounting export" hint="This needs invoicing to be on and permission to export to accounting." />;

  async function create() {
    setBusy(true); setMsg(null);
    try {
      const b = await api.post<Batch>("/accounting/exports", { ...period, includeExported: repeat });
      setMsg({ ok: true, text: `${b.id} recorded: ${b.sales} invoices, ${b.receipts} payments, ${b.purchases} purchases. Download it below.` });
      setRepeat(false); loadPreview(); loadBatches();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  const get = (b: Batch, format: "xlsx" | "csv", sheet?: string) =>
    download(`/accounting/exports/${encodeURIComponent(b.id)}/file${format === "csv" ? `?format=csv&sheet=${sheet}` : ""}`, `${b.id}${sheet ? `-${sheet}` : ""}.${format}`)
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));

  const total = preview ? (repeat ? preview.sales.new + preview.sales.exported + preview.receipts.new + preview.receipts.exported + preview.purchases.new + preview.purchases.exported : preview.sales.new + preview.receipts.new + preview.purchases.new) : 0;

  return (
    <div>
      <PageHeader eyebrow="Finance · batches for your accounting system" title="Accounting export" />
      {msg && <p className={`mb-4 rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>{msg.text}</p>}

      <Panel ticked className="fade-up mb-5 p-5">
        <p className="eyebrow mb-1">New batch</p>
        <p className="mb-4 text-sm text-steel">
          A batch holds the tax invoices raised, the payments received and the goods ordered in the period, with your account codes, as an Excel workbook or one CSV per sheet that most accounting systems can import.
          Each item goes into one batch only, so the same invoice is never posted twice.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">FROM</span>
            <input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} className={field} /></label>
          <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">TO</span>
            <input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} className={field} /></label>
        </div>
        {preview && (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {SHEETS.map(([k, l]) => (
              <div key={k} className="rounded border hairline bg-ink-deep/40 px-3 py-2">
                <p className="mono text-[10px] tracking-widest text-steel">{l.toUpperCase()}</p>
                <p className="mono text-base text-fg">{preview[k].new} new</p>
                <p className="mono text-[10px] text-dim">{preview[k].exported ? `${preview[k].exported} in an earlier batch` : "none exported before"}</p>
              </div>
            ))}
          </div>
        )}
        <label className="mt-4 flex items-center gap-2 text-sm text-fg">
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} className="accent-[var(--c-red)]" />
          Include items already exported (only if the earlier batch was lost or rejected)
        </label>
        <div className="mt-4"><Button disabled={busy || !preview || total === 0} onClick={create}>{total ? `Create batch · ${total} item${total === 1 ? "" : "s"}` : "Nothing new to export"}</Button></div>
      </Panel>

      <Panel className="fade-up d2 mb-5">
        <p className="eyebrow px-4 pt-4">Batches</p>
        {batches && batches.length === 0 ? <p className="px-4 py-6 text-sm text-dim">No batches yet.</p> : (
          <Table head={["Batch", "Period", "Invoices", "Payments", "Purchases", "By", "Download"]}>
            {(batches ?? []).map((b) => (
              <Tr key={b.id}>
                <Td><span className="mono text-xs text-trace">{b.id}</span>{b.includeExported && <span className="mono ml-2 text-[10px] text-amber">REPEAT</span>}</Td>
                <Td><span className="mono text-xs">{b.from} → {b.to}</span></Td>
                <Td className="mono">{b.sales}</Td>
                <Td className="mono">{b.receipts}</Td>
                <Td className="mono">{b.purchases}</Td>
                <Td><span className="text-xs">{b.createdBy}</span><span className="mono block text-[10px] text-dim">{fmtDateTime(b.createdAt)}</span></Td>
                <Td>
                  <span className="flex flex-wrap gap-2">
                    <button className="mono text-[10px] tracking-widest text-trace hover:underline" onClick={() => get(b, "xlsx")}>EXCEL</button>
                    {SHEETS.map(([k, l]) => <button key={k} className="mono text-[10px] tracking-widest text-steel hover:text-trace" onClick={() => get(b, "csv", k)}>{l.toUpperCase()} CSV</button>)}
                  </span>
                </Td>
              </Tr>
            ))}
          </Table>
        )}
      </Panel>

      <AccountCodes />
    </div>
  );
}

function AccountCodes() {
  const [c, setC] = useState<Codes | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<Codes>("/accounting/settings").then(setC).catch(() => {}); }, []);
  if (!c) return null;
  async function save() {
    setBusy(true); setMsg(null);
    try {
      const { streams: _streams, ...body } = c!;
      void _streams;
      setC(await api.put<Codes>("/accounting/settings", { ...body, revenueByStream: Object.fromEntries(Object.entries(body.revenueByStream).filter(([, v]) => v.trim())) }));
      setMsg({ ok: true, text: "Saved. New batches use these codes; earlier batches keep theirs." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  return (
    <Panel className="fade-up d3 p-5">
      <p className="eyebrow mb-1">Account codes</p>
      <p className="mb-4 text-sm text-steel">The codes from your chart of accounts that each line is posted to. Revenue can differ by invoicing stream; otherwise the default is used.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {CODE_FIELDS.map(([k, l]) => (
          <label key={k} className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{l.toUpperCase()}</span>
            <input value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} className={`${field} w-full`} /></label>
        ))}
      </div>
      {c.streams.length > 1 && (
        <>
          <p className="mono mb-1 mt-4 text-[10.5px] tracking-widest text-steel">REVENUE BY STREAM</p>
          <div className="grid gap-3 sm:grid-cols-4">
            {c.streams.map((s) => (
              <label key={s.id} className="block"><span className="mb-1 block text-xs text-fg">{s.label}</span>
                <input value={c.revenueByStream[s.id] ?? ""} placeholder={c.revenueDefault} onChange={(e) => setC({ ...c, revenueByStream: { ...c.revenueByStream, [s.id]: e.target.value } })} className={`${field} w-full`} /></label>
            ))}
          </div>
        </>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={busy} onClick={save}>Save codes</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}
