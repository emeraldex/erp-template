"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getSession, getWithFallback } from "@/lib/api";
import { Invoice, InvoiceStatus, InvoiceStream, Job } from "@/lib/types";
import { useConfig } from "@/lib/use-config";
import { useLang } from "@/lib/i18n";
import { fmtMYR } from "@/lib/format";
import { Button, MetaPill, OfflineNotice, PageHeader, Panel, StatusPill } from "@/components/ui";
import { AuditTrail, RecordsList, StageRail, TransitionActions } from "@/components/workflow";

const INV_RAIL: InvoiceStatus[] = [
  "DRAFTED", "CERTIFIED", "TAX_RAISED", "CORRECTNESS_CHECK", "SUBMITTED", "PAID",
];

const STREAM_TONE: Record<InvoiceStream, "info" | "warn" | "good" | "neutral"> = {
  PBC: "warn", BRANCH_REPAIR: "info", COE_MRA: "neutral", ACD: "good",
};

export default function InvoicingPage() {
  const cfg = useConfig();
  const { lang, t } = useLang();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [offline, setOffline] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ stream: "BRANCH_REPAIR" as InvoiceStream, jobId: "", period: "", amountMYR: "" });

  const user = getSession()?.user;
  const canRaise = ["BILLING", "PCE", "FINANCE", "ADMIN"].includes(user?.role ?? "");

  useEffect(() => {
    getWithFallback<Invoice[]>("/invoicing", "invoices")
      .then((r) => { setRows(r.data); setOffline(r.offline); if (r.data[0]) setOpenId(r.data[0].id); })
      .catch(console.error);
    getWithFallback<Job[]>("/jobs", "jobs").then((r) => setJobs(r.data)).catch(console.error);
  }, []);

  const streamDef = useMemo(
    () => cfg?.invoiceStreams.find((s) => s.id === form.stream),
    [cfg, form.stream],
  );

  async function transition(id: string, to: InvoiceStatus, fields: Record<string, string>) {
    setBusy(true); setError(null);
    try {
      const updated = await api.patch<Invoice>(`/invoicing/${id}/transition`, { to, fields });
      setRows((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  async function create() {
    setBusy(true); setError(null);
    try {
      const created = await api.post<Invoice>("/invoicing", {
        stream: form.stream,
        jobId: form.jobId || undefined,
        period: form.period || undefined,
        amountMYR: form.amountMYR ? Number(form.amountMYR) : undefined,
      });
      setRows((p) => [created, ...p]);
      setOpenId(created.id);
      setShowNew(false);
      setForm({ stream: "BRANCH_REPAIR", jobId: "", period: "", amountMYR: "" });
    } catch (e) {
      setError(offline ? "Creating needs the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader
        eyebrow="QP.51 · Multi-stream billing · +6% GST · correctness gate → CPU (Finance) · FR-13 / FR-14"
        title={t("invoicing")}
        actions={canRaise ? (
          <Button onClick={() => setShowNew(!showNew)} variant={showNew ? "ghost" : "primary"}>
            {showNew ? "Cancel" : "+ Raise invoice"}
          </Button>
        ) : undefined}
      />
      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      {showNew && (
        <div className="panel ticked fade-up mb-6 p-5">
          <p className="eyebrow mb-3">Open a billing record — the applicable stream sets the document set & deadlines</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Invoicing stream</span>
              <select
                value={form.stream}
                onChange={(e) => setForm({ ...form, stream: e.target.value as InvoiceStream })}
                className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace"
              >
                {(cfg?.invoiceStreams ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            {streamDef?.perJob ? (
              <label className="block">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Job (PS no)</span>
                <select
                  value={form.jobId}
                  onChange={(e) => setForm({ ...form, jobId: e.target.value })}
                  className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace"
                >
                  <option value="">— select —</option>
                  {jobs.filter((j) => j.status === "SERVICEABLE" || j.status === "DELIVERED").map((j) => (
                    <option key={j.id} value={j.id}>{j.id} · {j.component}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">PBC period (YYYY-MM)</span>
                <input value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })} placeholder="2026-07"
                  className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
              </label>
            )}
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Amount before GST (MYR)</span>
              <input value={form.amountMYR} onChange={(e) => setForm({ ...form, amountMYR: e.target.value })}
                className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
            </label>
            <div className="flex items-end">
              <Button disabled={busy || (streamDef?.perJob ? !form.jobId : !form.period)} onClick={create}>
                Draft invoice
              </Button>
            </div>
          </div>
          {streamDef && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p className="eyebrow mb-1.5">Document set · {streamDef.customer}</p>
                <div className="flex flex-wrap gap-1.5">
                  {streamDef.docSet.map((d) => (
                    <span key={d} className="mono rounded border hairline bg-ink-deep/50 px-2 py-1 text-[10px] text-steel">{d}</span>
                  ))}
                </div>
              </div>
              <div>
                <p className="eyebrow mb-1.5">Deadlines</p>
                <ul className="space-y-0.5">
                  {streamDef.deadlines.map((dl) => (
                    <li key={dl.label} className="mono text-[10.5px] text-steel"><span className="text-amber">{dl.label}</span> — {dl.note}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        {rows.map((inv, i) => {
          const open = openId === inv.id;
          const def = cfg?.invoiceStreams.find((s) => s.id === inv.stream);
          return (
            <Panel key={inv.id} ticked={inv.status === "CORRECTNESS_CHECK" || inv.status === "REJECTED"} className={`fade-up d${Math.min(i + 1, 5)} p-5`}>
              <button className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setOpenId(open ? null : inv.id)}>
                <div>
                  <p className="mono text-xs text-trace">
                    {inv.id}
                    {inv.jobId && (
                      <Link href={`/jobs/${inv.jobId}`} className="ml-3 text-steel hover:text-trace" onClick={(e) => e.stopPropagation()}>
                        ↳ {inv.jobId}
                      </Link>
                    )}
                    {inv.period && <span className="ml-3 text-steel">· {inv.period}</span>}
                  </p>
                  <p className="mt-0.5 text-sm">
                    <StatusPill value={def?.label ?? inv.stream} tone={STREAM_TONE[inv.stream]} />
                    <span className="mono ml-2 text-xs text-steel">→ {inv.customer}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="mono text-[10.5px] tracking-widest text-steel">
                    {fmtMYR(inv.amountMYR)} <span className="text-dim">+ GST {fmtMYR(inv.gstMYR)}</span> = <span className="text-fg">{fmtMYR(inv.totalMYR)}</span>
                    {inv.outstanding && inv.status !== "PAID" && <span className="ml-2 text-amber">· OUTSTANDING</span>}
                  </span>
                  <MetaPill status={inv.status} meta={cfg?.invoiceStatusMeta?.[inv.status]} lang={lang} />
                  <span className="mono text-xs text-dim">{open ? "▲" : "▼"}</span>
                </div>
              </button>

              {open && (
                <div className="fade-up mt-4 border-t hairline pt-4">
                  {cfg && (
                    <div className="mb-4">
                      <StageRail order={INV_RAIL} current={inv.status} meta={cfg.invoiceStatusMeta} branches={["REJECTED"]} />
                    </div>
                  )}

                  {/* GST + correctness gate summary */}
                  <div className="mb-4 grid gap-2 sm:grid-cols-4">
                    <div className="rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                      <p className="eyebrow">Before GST</p>
                      <p className="mono text-sm text-fg">{fmtMYR(inv.amountMYR)}</p>
                    </div>
                    <div className="rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                      <p className="eyebrow">GST @ {inv.gstRate}%</p>
                      <p className="mono text-sm text-trace">{fmtMYR(inv.gstMYR)}</p>
                    </div>
                    <div className="rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                      <p className="eyebrow">Total (F311)</p>
                      <p className="mono text-sm text-phosphor">{fmtMYR(inv.totalMYR)}</p>
                    </div>
                    <div className={`rounded-md border px-3 py-2 ${inv.correctnessBy ? "border-phosphor/40" : "hairline"}`}>
                      <p className="eyebrow">Correctness gate</p>
                      <p className="mono text-[11px] text-steel">{inv.correctnessBy ?? "— pending —"}</p>
                    </div>
                  </div>

                  {/* stream document set */}
                  {def && (
                    <div className="mb-4">
                      <p className="eyebrow mb-1.5">{def.label} · document set · deadlines</p>
                      <div className="mb-1.5 flex flex-wrap gap-1.5">
                        {def.docSet.map((d) => (
                          <span key={d} className="mono rounded border hairline bg-ink-deep/50 px-2 py-1 text-[10px] text-steel">{d}</span>
                        ))}
                      </div>
                      <p className="mono text-[10.5px] text-dim">{def.deadlines.map((d) => d.label).join(" · ")}</p>
                    </div>
                  )}

                  {inv.ctcRef && (
                    <p className="mb-3 mono text-[10.5px] tracking-widest text-steel">
                      CTC {inv.ctcRef}{inv.customerSignRef && ` · SIGNED ${inv.customerSignRef}`}{inv.salesPerfRef && ` · SPR/E-PAYMENT ${inv.salesPerfRef}`}{inv.paymentRef && ` · PAID ${inv.paymentRef}`}
                    </p>
                  )}

                  {cfg && user && (
                    <TransitionActions
                      status={inv.status}
                      rules={cfg.invoiceTransitions}
                      meta={cfg.invoiceStatusMeta}
                      userRole={user.role}
                      busy={busy}
                      onTransition={(to, fields) => transition(inv.id, to, fields)}
                    />
                  )}

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <RecordsList records={inv.records} />
                    <AuditTrail audit={inv.audit} />
                  </div>
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
