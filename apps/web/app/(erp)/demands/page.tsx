"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getSession, getWithFallback } from "@/lib/api";
import { Demand, DemandStatus, Partner, Quotation } from "@/lib/types";
import { useConfig } from "@/lib/use-config";
import { useLang } from "@/lib/i18n";
import { fmtMYR } from "@/lib/format";
import { Button, MetaPill, OfflineNotice, PageHeader, Panel } from "@/components/ui";
import { AuditTrail, RecordsList, TransitionActions } from "@/components/workflow";

export default function DemandsPage() {
  const cfg = useConfig();
  const { lang, t } = useLang();
  const [rows, setRows] = useState<Demand[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [offline, setOffline] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState({ supplierId: "", priceMYR: "", eddDays: "" });

  const user = getSession()?.user;

  useEffect(() => {
    getWithFallback<Demand[]>("/demands", "demands")
      .then((r) => { setRows(r.data); setOffline(r.offline); })
      .catch(console.error);
    getWithFallback<Partner[]>("/registers/partners", "partners")
      .then((r) => setPartners(r.data.filter((p) => p.type === "SUPPLIER" && p.status === "REGISTERED")))
      .catch(console.error);
  }, []);

  const patch = (updated: Demand) => setRows((p) => p.map((x) => (x.id === updated.id ? updated : x)));

  async function transition(id: string, to: DemandStatus, fields: Record<string, string>) {
    setBusy(true); setError(null);
    try {
      patch(await api.patch<Demand>(`/demands/${id}/transition`, { to, fields }));
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  async function addQuotation(dm: Demand) {
    const supplier = partners.find((p) => p.id === quote.supplierId);
    if (!supplier) return;
    setBusy(true); setError(null);
    try {
      const q: Quotation = {
        supplierId: supplier.id, supplier: supplier.name,
        priceMYR: Number(quote.priceMYR), eddDays: Number(quote.eddDays),
      };
      patch(await api.post<Demand>(`/demands/${dm.id}/quotations`, q));
      setQuote({ supplierId: "", priceMYR: "", eddDays: "" });
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader eyebrow="QP.14 · Parts Procurement & Verification" title={t("procurement")} />
      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      <div className="space-y-4">
        {rows.map((dm, i) => {
          const open = openId === dm.id;
          const meta = cfg?.demandStatusMeta;
          return (
            <Panel key={dm.id} ticked={dm.status === "RFQ_ISSUED"} className={`fade-up d${Math.min(i + 1, 5)} p-5`}>
              <button className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setOpenId(open ? null : dm.id)}>
                <div>
                  <p className="mono text-xs text-trace">
                    {dm.id}
                    <Link href={`/jobs/${dm.jobId}`} className="ml-3 text-steel hover:text-trace" onClick={(e) => e.stopPropagation()}>
                      ↳ {dm.jobId}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm">
                    {dm.partDescription} <span className="mono text-xs text-steel">· {dm.partNo} × {dm.qty} · {dm.branch}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {dm.quotations.length > 0 && (
                    <span className={`mono text-[10.5px] tracking-widest ${dm.quotations.length >= 3 ? "text-phosphor" : "text-amber"}`}>
                      {dm.quotations.length}/3 QUOTES
                    </span>
                  )}
                  <MetaPill status={dm.status} meta={meta?.[dm.status]} lang={lang} />
                  <span className="mono text-xs text-dim">{open ? "▲" : "▼"}</span>
                </div>
              </button>

              {open && (
                <div className="fade-up mt-4 border-t hairline pt-4">
                  {/* quotation board */}
                  {(dm.quotations.length > 0 || dm.status === "RFQ_ISSUED") && (
                    <div className="mb-4">
                      <p className="eyebrow mb-2">Quotation comparison · min. 3 before F221 evaluation</p>
                      {dm.quotations.length > 0 && (
                        <div className="mb-3 grid gap-2 sm:grid-cols-3">
                          {dm.quotations.map((q) => {
                            const selected = dm.evaluation?.selectedSupplierId === q.supplierId;
                            const cheapest = q.priceMYR === Math.min(...dm.quotations.map((x) => x.priceMYR));
                            return (
                              <div key={q.supplierId} className={`rounded-md border p-3 ${selected ? "border-phosphor/50 bg-phosphor/5" : "hairline bg-ink-deep/40"}`}>
                                <p className="text-sm">{q.supplier}</p>
                                <p className="display mt-1 text-lg font-bold">{fmtMYR(q.priceMYR)}</p>
                                <p className="mono text-[10.5px] tracking-widest text-steel">
                                  EDD {q.eddDays}D {cheapest && <span className="text-phosphor">· LOWEST</span>} {selected && <span className="text-phosphor">· SELECTED</span>}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {dm.status === "RFQ_ISSUED" && user && (user.role === "PURCHASING" || user.role === "ADMIN") && (
                        <div className="flex flex-wrap items-end gap-2 rounded-md border hairline bg-ink-deep/40 p-3">
                          <label className="block">
                            <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Approved supplier (F224)</span>
                            <select value={quote.supplierId} onChange={(e) => setQuote({ ...quote, supplierId: e.target.value })} className="mono rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                              <option value="">Select…</option>
                              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Price (MYR)</span>
                            <input value={quote.priceMYR} onChange={(e) => setQuote({ ...quote, priceMYR: e.target.value })} className="mono w-28 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                          </label>
                          <label className="block">
                            <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">EDD (days)</span>
                            <input value={quote.eddDays} onChange={(e) => setQuote({ ...quote, eddDays: e.target.value })} className="mono w-20 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                          </label>
                          <Button variant="ghost" disabled={busy || !quote.supplierId || !quote.priceMYR || !quote.eddDays} onClick={() => addQuotation(dm)}>
                            + Record quotation
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {dm.stockCheck && (
                    <p className="mono mb-4 text-[10.5px] tracking-widest text-steel">
                      F244 {dm.stockCheck.f244Ref} · {dm.stockCheck.available ? `STOCK AT ${dm.stockCheck.holdingUnit}` : "NIL STOCK"}
                      {dm.poRef && ` · PO ${dm.poRef}`}
                      {dm.discrepancy && <span className="text-amber"> · F217 {dm.discrepancy.f217Ref}</span>}
                    </p>
                  )}

                  {cfg && user && (
                    <TransitionActions
                      status={dm.status}
                      rules={cfg.demandTransitions}
                      meta={cfg.demandStatusMeta}
                      userRole={user.role}
                      busy={busy}
                      onTransition={(to, fields) => transition(dm.id, to, fields)}
                    />
                  )}

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <RecordsList records={dm.records} />
                    <AuditTrail audit={dm.audit} />
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
