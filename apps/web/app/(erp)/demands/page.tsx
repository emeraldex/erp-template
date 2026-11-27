"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getWithFallback } from "@/lib/api";
import { Demand, DemandStatus, Part, Partner } from "@/lib/types";
import { useConfig } from "@/lib/use-config";
import { useVocab } from "@/lib/vocab";
import { useLang } from "@/lib/i18n";
import { fmtMYR, fmtMoney } from "@/lib/format";
import { Dual, MoneyInput, MoneyValue } from "@/lib/fx";
import { Button, MetaPill, OfflineNotice, PageHeader, Panel } from "@/components/ui";
import { AuditTrail, RecordsList, TransitionActions } from "@/components/workflow";

export default function DemandsPage() {
  const cfg = useConfig();
  const { aviation, terms, can, ref, modules, label } = useVocab();
  // Quotations can be recorded in the statuses the organisation marked for it.
  const quoting = (status: string) => !!cfg?.demandStatusMeta?.[status]?.acceptsQuotations;
  const { lang, t } = useLang();
  const [rows, setRows] = useState<Demand[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [offline, setOffline] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState({ supplierId: "", eddDays: "" });
  const [price, setPrice] = useState<MoneyValue>({ amount: "", currency: "", rate: "", confirm: false });
  const [show, setShow] = useState<"all" | "job" | "stock">("all");
  const [stockOf, setStockOf] = useState<Record<string, Part | null>>({});

  const user = useSession()?.user;

  useEffect(() => {
    getWithFallback<Demand[]>("/demands", "demands")
      .then((r) => { setRows(r.data); setOffline(r.offline); })
      .catch(console.error);
    getWithFallback<Partner[]>("/registers/partners", "partners")
      .then((r) => setPartners(r.data.filter((p) => p.type === "SUPPLIER" && p.status === "REGISTERED")))
      .catch(console.error);
  }, []);

  // Open the request named in the link (?id=…), e.g. from a part's page.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setOpenId(id);
  }, []);
  useEffect(() => {
    if (!openId || !rows.length) return;
    document.getElementById(`demand-${openId}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [openId, rows.length]);

  // What the store holds of a catalogue part, for the request that is open.
  const opened = rows.find((d) => d.id === openId);
  useEffect(() => {
    const partId = opened?.partId;
    if (!partId || !modules.stock || partId in stockOf) return;
    api.get<Part>(`/stock/parts/${encodeURIComponent(partId)}`)
      .then((p) => setStockOf((m) => ({ ...m, [partId]: p })))
      .catch(() => setStockOf((m) => ({ ...m, [partId]: null })));
  }, [opened?.partId, modules.stock, stockOf]);

  const shown = rows.filter((d) => show === "all" || (show === "stock" ? !d.jobId : !!d.jobId));

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
      patch(await api.post<Demand>(`/demands/${dm.id}/quotations`, {
        supplierId: supplier.id, supplier: supplier.name, eddDays: Number(quote.eddDays),
        price: Number(price.amount.replace(/,/g, "")), currency: price.currency,
        ...(price.rate.trim() ? { rate: Number(price.rate), confirm: price.confirm } : {}),
      }));
      setQuote({ supplierId: "", eddDays: "" });
      setPrice({ amount: "", currency: "", rate: "", confirm: false });
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader eyebrow={aviation ? "QP.14 · Parts Procurement & Verification" : "Parts requests, quotations and purchase orders"} title={aviation ? t("procurement") : terms.demands} />
      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}
      {modules.stock && (
        <div className="mb-4 flex flex-wrap items-center gap-1">
          {([["all", "ALL"], ["job", `FOR ${terms.jobs.toUpperCase()}`], ["stock", "FOR STOCK"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setShow(k)} className={`mono rounded-md px-3 py-1.5 text-[11px] tracking-widest ${show === k ? "bg-trace/15 text-trace" : "text-steel hover:text-fg"}`}>{l}</button>
          ))}
          <Link href="/stock?view=reorder" className="mono ml-auto text-[11px] tracking-widest text-steel hover:text-trace">REORDER LIST →</Link>
        </div>
      )}

      <div className="space-y-4">
        {shown.map((dm, i) => {
          const open = openId === dm.id;
          const meta = cfg?.demandStatusMeta;
          const held = dm.partId ? stockOf[dm.partId] : undefined;
          return (
            <div key={dm.id} id={`demand-${dm.id}`} className="scroll-mt-20"><Panel ticked={quoting(dm.status)} className={`fade-up d${Math.min(i + 1, 5)} p-5`}>
              <button className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setOpenId(open ? null : dm.id)}>
                <div>
                  <p className="mono text-xs text-trace">
                    {dm.id}
                    {dm.jobId ? (
                      <Link href={`/jobs/${dm.jobId}`} className="ml-3 text-steel hover:text-trace" onClick={(e) => e.stopPropagation()}>
                        ↳ {dm.jobId}
                      </Link>
                    ) : (
                      <span className="ml-3 text-amber">↳ FOR STOCK{dm.forStore ? ` · ${label("store", dm.forStore).toUpperCase()}` : ""}</span>
                    )}
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
                  {(dm.quotations.length > 0 || quoting(dm.status)) && (
                    <div className="mb-4">
                      <p className="eyebrow mb-2">{aviation ? "Quotation comparison · min. 3 before F221 evaluation" : "Quotation comparison"}</p>
                      {dm.quotations.length > 0 && (
                        <div className="mb-3 grid gap-2 sm:grid-cols-3">
                          {dm.quotations.map((q) => {
                            const selected = dm.evaluation?.selectedSupplierId === q.supplierId;
                            const cheapest = q.priceMYR === Math.min(...dm.quotations.map((x) => x.priceMYR));
                            return (
                              <div key={q.supplierId} className={`rounded-md border p-3 ${selected ? "border-phosphor/50 bg-phosphor/5" : "hairline bg-ink-deep/40"}`}>
                                <p className="text-sm">{q.supplier}</p>
                                <p className="display mt-1 text-lg font-bold">{q.currency ? `${q.currency} ${q.price?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : fmtMYR(q.priceMYR)}</p>
                                {q.currency && <p className="mono text-[10.5px] text-steel">= {fmtMoney(q.priceMYR)} at {q.fxRate}</p>}
                                <p className="mono text-[10.5px] tracking-widest text-steel">
                                  EDD {q.eddDays}D {cheapest && <span className="text-phosphor">· LOWEST</span>} {selected && <span className="text-phosphor">· SELECTED</span>}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {quoting(dm.status) && user && can("procurement.quote") && (
                        <div className="flex flex-wrap items-end gap-2 rounded-md border hairline bg-ink-deep/40 p-3">
                          <label className="block">
                            <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Approved supplier{ref(" (F224)")}</span>
                            <select value={quote.supplierId} onChange={(e) => {
                              setQuote({ ...quote, supplierId: e.target.value });
                              // Their usual currency, if they have one.
                              const usual = partners.find((p) => p.id === e.target.value)?.currency;
                              setPrice((m) => ({ ...m, currency: usual ?? "", rate: "", confirm: false }));
                            }} className="mono rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                              <option value="">Select…</option>
                              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                          </label>
                          <div className="block">
                            <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Price (whole request)</span>
                            <MoneyInput value={price} onChange={setPrice} label="Price" className="mono w-28 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                          </div>
                          <label className="block">
                            <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">EDD (days)</span>
                            <input value={quote.eddDays} onChange={(e) => setQuote({ ...quote, eddDays: e.target.value })} className="mono w-20 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                          </label>
                          <Button variant="ghost" disabled={busy || !quote.supplierId || !price.amount || !quote.eddDays} onClick={() => addQuotation(dm)}>
                            + Record quotation
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {dm.partId && modules.stock && (
                    <p className="mono mb-4 text-[11px] text-steel">
                      CATALOGUE PART <Link href={`/stock?part=${encodeURIComponent(dm.partId)}`} className="text-trace hover:underline">{dm.partNo}</Link>
                      {held && (
                        <> · in stock: {held.levels.filter((l) => l.qty > 0).map((l) => `${l.qty} ${label("unit", held.unit)} in ${l.storeLabel}`).join(", ") || "none"}</>
                      )}
                      {dm.unitCost != null && <> · received{dm.forStore ? ` into ${label("store", dm.forStore)}` : ""} at {fmtMYR(dm.unitCost)} each</>}
                      {dm.purchase && <> · bought for <Dual amount={dm.purchase.amount} currency={dm.purchase.currency} base={dm.purchase.amountBase} rate={dm.purchase.rate} /> (rate on receipt)</>}
                    </p>
                  )}

                  {dm.stockCheck && (
                    <p className="mono mb-4 text-[10.5px] tracking-widest text-steel">
                      {aviation ? `F244 ${dm.stockCheck.f244Ref} · ` : ""}{dm.stockCheck.available ? `STOCK AT ${dm.stockCheck.holdingUnit}` : "NIL STOCK"}
                      {dm.poRef && ` · PO ${dm.poRef}`}
                      {dm.discrepancy && <span className="text-amber"> · {aviation ? "F217" : "DISCREPANCY"} {dm.discrepancy.f217Ref}</span>}
                    </p>
                  )}

                  {cfg && user && (
                    <TransitionActions
                      entity="demand"
                      entityId={dm.id}
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
            </Panel></div>
          );
        })}
      </div>
    </div>
  );
}
