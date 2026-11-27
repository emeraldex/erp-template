"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { fmtDateTime, fmtMoney } from "@/lib/format";
import { Button, Panel } from "@/components/ui";

type Spell = { id: number; fromAt: string; toAt: string | null; jobId: string | null; reason: string; hours: number };
type Reliability = {
  from: string; to: string; months: number; failures: number; downtimeHours: number; availabilityPct: number | null;
  mttrHours: number | null; mtbfHours: number | null; pmCompliancePct: number | null;
  pm: { due: number; onTime: number; late: number; notDone: number; meterOnly: number };
  cost: number | null; down: boolean; downtime: Spell[];
};

const when = fmtDateTime;
const hrs = (n: number | null) => (n === null ? "—" : n >= 48 ? `${Math.round(n / 24)} d` : `${n} h`);

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border hairline bg-ink-deep/40 px-3 py-2">
      <p className="mono text-[10px] tracking-widest text-steel">{label}</p>
      <p className="mono text-base text-fg">{value}</p>
      {hint && <p className="mono text-[10px] text-dim">{hint}</p>}
    </div>
  );
}

/** The last twelve months for one asset: failures, downtime, availability, repair time, preventive compliance and cost, with its downtime history. */
export function AssetReliability({ id, tick }: { id: string; tick: number }) {
  const [r, setR] = useState<Reliability | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => { api.get<Reliability>(`/assets/${encodeURIComponent(id)}/reliability`).then(setR).catch(() => setR(null)); }, [id, tick]);
  if (!r) return null;
  const spells = all ? r.downtime : r.downtime.slice(0, 5);
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow">Reliability · last {r.months} months</p>
        {r.down && <span className="mono text-[10px] tracking-widest text-amber">OUT OF ACTION NOW</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Figure label="FAILURES" value={String(r.failures)} />
        <Figure label="AVAILABILITY" value={r.availabilityPct === null ? "—" : `${r.availabilityPct}%`} hint={`${r.downtimeHours} h out of action`} />
        <Figure label="MEAN TIME TO REPAIR" value={hrs(r.mttrHours)} />
        <Figure label="MEAN TIME BETWEEN FAILURES" value={hrs(r.mtbfHours)} />
        <Figure label="PREVENTIVE ON TIME" value={r.pmCompliancePct === null ? "—" : `${r.pmCompliancePct}%`} hint={r.pm.due ? `${r.pm.onTime} of ${r.pm.due} due${r.pm.notDone ? ` · ${r.pm.notDone} not done` : ""}` : "none due"} />
        {r.cost !== null && <Figure label="COST" value={fmtMoney(r.cost)} hint="parts, purchases, repairs, labour" />}
      </div>
      {r.downtime.length > 0 && (
        <>
          <p className="mono mb-1 mt-3 text-[10px] tracking-widest text-steel">OUT OF ACTION</p>
          <ul className="space-y-1">
            {spells.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="mono text-steel">{when(s.fromAt)} → {s.toAt ? when(s.toAt) : <span className="text-amber">still out</span>}</span>
                <span className="text-fg">{s.jobId ? <Link className="mono text-trace hover:underline" href={`/jobs/${s.jobId}`}>{s.jobId}</Link> : s.reason} <span className="mono text-dim">· {s.hours} h</span></span>
              </li>
            ))}
          </ul>
          {r.downtime.length > 5 && <button className="mono mt-1 text-[10px] tracking-widest text-steel hover:text-trace" onClick={() => setAll(!all)}>{all ? "SHOW LESS" : `SHOW ALL ${r.downtime.length}`}</button>}
        </>
      )}
    </div>
  );
}

type ImportResult = { dryRun: boolean; rows: number; created: string[]; updated: string[]; meters: number; errors: { row: number; message: string }[] };
const TEMPLATE = "tag,name,type,site,location,make,model,serialNo,criticality,status,parentTag,commissionedOn,meterKey,meterLabel,meterUnit,meterValue\r\nAHU-01,Air handling unit 1,AHU,HQ,Plant room,Daikin,AHU-X,SN123,HIGH,IN_SERVICE,,2024-01-15,RUNHRS,Run hours,h,1200\r\n";

/** Load or update the register from a spreadsheet saved as CSV: checked first, then imported in one go. */
export function AssetImport({ onDone }: { onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function send(f: File, dryRun: boolean) {
    const form = new FormData();
    form.append("file", f);
    return api.upload<ImportResult>(`/assets/import${dryRun ? "?dryRun=1" : ""}`, form);
  }
  async function choose(f: File | null) {
    setFile(f); setCheck(null); setMsg(null);
    if (!f) return;
    setBusy(true);
    try { setCheck(await send(f, true)); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  async function run() {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const r = await send(file, false);
      setMsg({ ok: true, text: `Imported: ${r.created.length} added, ${r.updated.length} updated${r.meters ? `, ${r.meters} meter${r.meters === 1 ? "" : "s"}` : ""}.` });
      setCheck(null); setFile(null); if (ref.current) ref.current.value = "";
      onDone();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }
  function template() {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "asset-import-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel className="fade-up mb-5 p-5">
      <p className="eyebrow mb-1">Import from a spreadsheet</p>
      <p className="mb-3 text-sm text-steel">Save the sheet as CSV with a header row. Rows are matched by tag: new tags are added, existing ones updated. Types and sites can be the code or the name. A parent can be in the same file. Nothing changes unless every row is good.</p>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={ref} type="file" accept=".csv,text/csv" onChange={(e) => choose(e.target.files?.[0] ?? null)} className="text-xs text-steel file:mr-3 file:rounded-md file:border file:border-[var(--c-line)] file:bg-ink-deep file:px-3 file:py-1.5 file:text-xs file:text-fg" aria-label="CSV file" />
        <Button variant="ghost" onClick={template}>Download template</Button>
      </div>
      {busy && <p className="eyebrow mt-3">CHECKING…</p>}
      {check && (
        <div className="mt-3 text-sm">
          <p className="text-fg">{check.rows} row{check.rows === 1 ? "" : "s"}: {check.created.length} new, {check.updated.length} to update{check.meters ? `, ${check.meters} with a meter` : ""}.</p>
          {check.errors.length > 0 ? (
            <>
              <p className="mt-2 text-brand-bright">{check.errors.length} problem{check.errors.length === 1 ? "" : "s"} — fix the file and choose it again:</p>
              <ul className="mono mt-1 max-h-48 overflow-y-auto text-xs text-steel">
                {check.errors.map((e, i) => <li key={i}>Row {e.row}: {e.message}</li>)}
              </ul>
            </>
          ) : (
            <div className="mt-3"><Button disabled={busy} onClick={run}>Import {check.rows} row{check.rows === 1 ? "" : "s"}</Button></div>
          )}
        </div>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
    </Panel>
  );
}
