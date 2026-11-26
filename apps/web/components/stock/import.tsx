"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { ImportResult } from "@/lib/types";
import { Button } from "@/components/ui";
import { errText, Msg, Notice } from "./common";

const COLUMNS = "partNo, name, unit, group, manufacturer, mfrPartNo, store, bin, qty, unitCost, reorderPoint, reorderQty";
const SAMPLE = `partNo,name,unit,group,manufacturer,mfrPartNo,store,bin,qty,unitCost,reorderPoint,reorderQty
FLT-001,Oil filter,EA,,Sakura,C-1101,MAIN,A-01,24,18.50,6,24
`;

/** Load the catalogue from a spreadsheet: check first, then import all rows or none. */
export function ImportPanel({ onDone }: { onDone: () => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const r = await api.upload<ImportResult>(`/stock/import${dryRun ? "?dryRun=1" : ""}`, form);
      if (dryRun) setCheck(r);
      else {
        setCheck(null); setFile(null);
        setMsg({ ok: true, text: `Imported ${r.rows} row${r.rows === 1 ? "" : "s"}: ${r.created.length} new part${r.created.length === 1 ? "" : "s"}, ${r.updated.length} updated, ${r.openings} opening balance${r.openings === 1 ? "" : "s"}.` });
        onDone();
      }
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally { setBusy(false); }
  }

  function sample() {
    const url = URL.createObjectURL(new Blob([SAMPLE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "parts-import-template.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="panel ticked fade-up mb-6 p-5">
      <p className="eyebrow mb-2">Import from a spreadsheet</p>
      <p className="mb-3 text-sm text-steel">
        Save the sheet as CSV with a header row. Columns (only <span className="mono">partNo</span> is required; a new part also needs a name):{" "}
        <span className="mono text-xs text-fg">{COLUMNS}</span>. Stores, units and groups may be given by code or name.
        Parts are matched by part number. Opening stock goes in only where that part has no history in that store — after that, use a count.
        Up to 2,000 rows and 1 MB per file. <button onClick={sample} className="text-trace hover:underline">Download a template</button>.
      </p>
      <input ref={picker} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setCheck(null); setMsg(null); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => picker.current?.click()}>{file ? "Choose another file" : "Choose CSV file"}</Button>
        {file && <span className="mono text-xs text-steel">{file.name} · {Math.ceil(file.size / 1024)} KB</span>}
        <Button disabled={!file || busy} onClick={() => send(true)}>Check</Button>
      </div>
      <div className="mt-3"><Notice msg={msg} /></div>
      {check && (
        <div className="rounded border hairline bg-ink-deep/40 p-3">
          <p className="text-sm">
            {check.rows} row{check.rows === 1 ? "" : "s"}: {check.created.length} new part{check.created.length === 1 ? "" : "s"}, {check.updated.length} to update,
            {" "}{check.levels} store setting{check.levels === 1 ? "" : "s"}, {check.openings} opening balance{check.openings === 1 ? "" : "s"}.
          </p>
          {check.errors.length > 0 ? (
            <>
              <p className="mt-2 text-sm text-brand-bright">{check.errors.length} problem{check.errors.length === 1 ? "" : "s"} — fix the file and check again. Nothing is imported while any row has a problem.</p>
              <ul className="mono mt-1 max-h-60 space-y-0.5 overflow-y-auto text-xs">
                {check.errors.map((e, i) => <li key={i}><span className="text-steel">Row {e.row}:</span> {e.message}</li>)}
              </ul>
            </>
          ) : (
            <div className="mt-3 flex items-center gap-3">
              <Button disabled={busy} onClick={() => send(false)}>Import {check.rows} row{check.rows === 1 ? "" : "s"}</Button>
              <span className="text-xs text-dim">All rows are good.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
