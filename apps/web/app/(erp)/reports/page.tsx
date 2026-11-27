"use client";

import { useSession } from "@/lib/use-session";
import { useState } from "react";
import { api, download } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useVocab } from "@/lib/vocab";
import { Button, PageHeader, Panel } from "@/components/ui";

type Format = "xlsx" | "csv";
interface ReportDef {
  key: string;
  title: string;
  description: string;
  path: string;
  /** Permission needed to run it. */
  capability: string;
  /** Only shown when this module is on. */
  module?: "invoicing" | "stock" | "requests" | "labour" | "assets";
  /** Aviation-only reports. */
  aviationOnly?: boolean;
  period: boolean;
  formats: Format[];
  entity?: boolean;
}

const REPORTS: ReportDef[] = [
  { key: "sales", title: "Sales Performance Report", description: "Every invoice drafted in the period with tax, status, payment and days outstanding, plus a per-stream summary (FR-14).", path: "/reports/sales-performance", capability: "reports.billing", module: "invoicing", period: true, formats: ["xlsx", "csv"] },
  { key: "epay", title: "e-Payment submission (ACD)", description: "The ACD-stream file for the customer's e-Payment system, flagging invoices not yet keyed into the SPR.", path: "/reports/e-payment", capability: "reports.payments", module: "invoicing", aviationOnly: true, period: true, formats: ["csv", "xlsx"] },
  { key: "outstanding", title: "Outstanding payments", description: "Unpaid invoices by age: 0–30, 31–60, 61–90 and over 90 days.", path: "/reports/outstanding", capability: "reports.billing", module: "invoicing", period: false, formats: ["xlsx", "csv"] },
  { key: "stockValue", title: "Stock valuation", description: "Every part held, per store and bin, at its moving-average cost, with totals per store.", path: "/reports/stock-valuation", capability: "stock.manage", module: "stock", period: false, formats: ["xlsx", "csv"] },
  { key: "partsUsage", title: "Parts usage", description: "Parts issued to work orders in the period, net of returns — by part and by work order and asset, with cost.", path: "/reports/parts-usage", capability: "stock.manage", module: "stock", period: true, formats: ["xlsx", "csv"] },
  { key: "requests", title: "Requests and satisfaction", description: "Requests from the portal, QR posters and callers in the period: outcome, work order, hours to decide, days to complete and rating, with a summary by site and type.", path: "/reports/requests", capability: "requests.manage", module: "requests", period: true, formats: ["xlsx", "csv"] },
  { key: "labour", title: "Labour hours and cost", description: "Time logged in the period by person and by work order, with hours, entries and cost at the rates in force when the time was logged.", path: "/reports/labour", capability: "labour.manage", module: "labour", period: true, formats: ["xlsx", "csv"] },
  { key: "reliability", title: "Asset reliability", description: "Per asset, type and site: failures, downtime, availability, mean time to repair and between failures, preventive work done on time, and maintenance cost.", path: "/reports/reliability", capability: "reports.maintenance", module: "assets", period: true, formats: ["xlsx", "csv"] },
  { key: "audit", title: "Audit trail", description: "Every recorded action in the period — who, role, what and the fields entered (FR-04 / FR-12).", path: "/reports/audit", capability: "reports.audit", period: true, formats: ["xlsx", "csv"], entity: true },
  { key: "retention", title: "Record retention", description: "Closed jobs with their archive and retain-until dates; records past retention are flagged for review, never deleted.", path: "/retention/report", capability: "reports.audit", period: false, formats: ["xlsx", "csv"] },
];

const firstOfMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10); };
const today = () => new Date().toISOString().slice(0, 10);
const inputClass = "mono rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";

export default function ReportsPage() {
  const { t } = useLang();
  const [from, setFrom] = useState(firstOfMonth());
  const [to, setTo] = useState(today());
  const [entity, setEntity] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { aviation, can, modules } = useVocab();
  const allowed = REPORTS.filter((r) => can(r.capability) && (!r.module || modules[r.module]) && (!r.aviationOnly || aviation));

  async function run(r: ReportDef, format: Format) {
    setBusy(`${r.key}-${format}`);
    setMsg(null);
    const q = new URLSearchParams({ format, ...(r.period ? { from, to } : {}), ...(r.entity && entity ? { entity } : {}) });
    try {
      await download(`${r.path}?${q}`, `${r.key}.${format}`);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function adminRun(path: string, label: string) {
    setBusy(path);
    setMsg(null);
    try {
      const res = await api.post<Record<string, number>>(path, {});
      setMsg({ ok: true, text: `${label}: ${Object.entries(res).map(([k, v]) => `${k} ${v}`).join(" · ")}` });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <PageHeader eyebrow="FR-12 · FR-14 · exports open in Excel" title={t("reports")} />

      <Panel ticked className="fade-up mb-5 flex flex-wrap items-end gap-3 p-4">
        <label className="block">
          <span className="mono mb-1 block text-[10px] tracking-widest text-steel">From</span>
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mono mb-1 block text-[10px] tracking-widest text-steel">To</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
        <p className="mono pb-2 text-[10.5px] text-dim">Applies to reports with a period · up to three years</p>
      </Panel>

      {msg && (
        <p className={`mb-4 rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 bg-phosphor/5 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>
          {msg.text}
        </p>
      )}

      {allowed.length === 0 && <p className="text-sm text-dim">Your role has no reports. Billing, finance, quality and management roles do.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {allowed.map((r, i) => (
          <Panel key={r.key} className={`fade-up d${Math.min(i + 1, 5)} flex flex-col p-5`}>
            <p className="display text-lg font-bold text-fg">{r.title}</p>
            <p className="mt-1 flex-1 text-sm text-steel">{r.description}</p>
            {r.entity && (
              <label className="mt-3 block">
                <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Record type</span>
                <select value={entity} onChange={(e) => setEntity(e.target.value)} className={inputClass}>
                  <option value="">All records</option>
                  {["JOB", "DEMAND", "OV", "INVOICE", "PARTNER", "FOD", "PRIORITY"].map((e) => <option key={e} value={e}>{aviation || e !== "FOD" ? e : "INCIDENT"}</option>)}
                </select>
              </label>
            )}
            <div className="mt-4 flex gap-2">
              {r.formats.map((f) => (
                <Button key={f} variant={f === r.formats[0] ? "primary" : "ghost"} disabled={!!busy} onClick={() => run(r, f)}>
                  {busy === `${r.key}-${f}` ? "PREPARING…" : f.toUpperCase()}
                </Button>
              ))}
            </div>
          </Panel>
        ))}
      </div>

      {can("org.admin") && (
        <Panel className="fade-up mt-6 p-5">
          <p className="eyebrow mb-1">Background jobs</p>
          <p className="mb-3 text-sm text-steel">These run on a schedule. Run them now to see the effect straight away.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={!!busy} onClick={() => adminRun("/alerts/run", "SLA alerts")}>Check SLA alerts now</Button>
            <Button variant="ghost" disabled={!!busy} onClick={() => adminRun("/retention/archive", "Archiving")}>Archive closed jobs now</Button>
            {modules.pm && <Button variant="ghost" disabled={!!busy} onClick={() => adminRun("/pm/run", "Preventive maintenance")}>Raise due maintenance now</Button>}
          </div>
        </Panel>
      )}
    </div>
  );
}
