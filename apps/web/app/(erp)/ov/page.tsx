"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getWithFallback } from "@/lib/api";
import { OvRepair, OvStatus } from "@/lib/types";
import { useConfig } from "@/lib/use-config";
import { railOf, useVocab } from "@/lib/vocab";
import { useLang } from "@/lib/i18n";
import { fmtMYR } from "@/lib/format";
import { MetaPill, OfflineNotice, PageHeader, Panel } from "@/components/ui";
import { AuditTrail, RecordsList, StageRail, TransitionActions } from "@/components/workflow";

export default function OvPage() {
  const cfg = useConfig();
  const { aviation, terms } = useVocab();
  const rail = railOf(cfg?.ovStatusMeta);
  const { lang, t } = useLang();
  const [rows, setRows] = useState<OvRepair[]>([]);
  const [offline, setOffline] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const user = useSession()?.user;

  useEffect(() => {
    getWithFallback<OvRepair[]>("/ov", "ov")
      .then((r) => { setRows(r.data); setOffline(r.offline); if (r.data[0]) setOpenId(r.data[0].id); })
      .catch(console.error);
  }, []);

  async function transition(id: string, to: OvStatus, fields: Record<string, string>) {
    setBusy(true); setError(null);
    try {
      const updated = await api.patch<OvRepair>(`/ov/${id}/transition`, { to, fields });
      setRows((p) => p.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader eyebrow={aviation ? "QP.33 · Beyond in-house capability — dual customer approvals" : "Repairs sent to vendors and OEMs"} title={aviation ? t("ov") : terms.vendorRepairs} />
      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      <div className="space-y-4">
        {rows.map((ov, i) => {
          const open = openId === ov.id;
          return (
            <Panel key={ov.id} ticked={ov.status === "F134_SUBMITTED" || ov.status === "COST_ADVISED"} className={`fade-up d${Math.min(i + 1, 5)} p-5`}>
              <button className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setOpenId(open ? null : ov.id)}>
                <div>
                  <p className="mono text-xs text-trace">
                    {ov.id}
                    <Link href={`/jobs/${ov.jobId}`} className="ml-3 text-steel hover:text-trace" onClick={(e) => e.stopPropagation()}>
                      ↳ {ov.jobId}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm">
                    {ov.vendorName ?? "Vendor not yet identified"}
                    <span className="mono ml-2 text-xs text-steel">F135 {ov.defectReportRef} · AM75 {ov.am75Ref}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {ov.costMYR != null && (
                    <span className="mono text-[10.5px] tracking-widest text-steel">
                      {fmtMYR(ov.costMYR)} · EDD {ov.eddDays}D {ov.aboveIndent && <span className="text-amber">· ABOVE INDENT</span>}
                    </span>
                  )}
                  <MetaPill status={ov.status} meta={cfg?.ovStatusMeta?.[ov.status]} lang={lang} />
                  <span className="mono text-xs text-dim">{open ? "▲" : "▼"}</span>
                </div>
              </button>

              {open && (
                <div className="fade-up mt-4 border-t hairline pt-4">
                  {cfg && (
                    <div className="mb-4">
                      <StageRail order={rail.order} current={ov.status} meta={cfg.ovStatusMeta} branches={rail.branches} />
                    </div>
                  )}

                  {/* dual customer-approval gates highlighted */}
                  <div className="mb-4 flex flex-wrap gap-2">
                    <span className={`mono rounded border px-2.5 py-1 text-[10px] tracking-widest ${
                      ["APPROVED", "PO_ISSUED", "AT_VENDOR", "COST_ADVISED", "QUOTE_APPROVED", "RECEIVED_BACK", "RETURNED"].includes(ov.status)
                        ? "border-phosphor/40 text-phosphor" : ov.status === "REJECTED" ? "border-brand-bright/40 text-brand-bright" : "hairline text-dim"
                    }`}>
                      GATE 1 · F134 REPAIR AUTHORITY {ov.f134Ref ? `(${ov.f134Ref})` : ""}
                    </span>
                    <span className={`mono rounded border px-2.5 py-1 text-[10px] tracking-widest ${
                      ["QUOTE_APPROVED", "RECEIVED_BACK", "RETURNED"].includes(ov.status)
                        ? "border-phosphor/40 text-phosphor" : "hairline text-dim"
                    }`}>
                      GATE 2 · PRICE QUOTATION (F119{ov.f119Ref ? ` ${ov.f119Ref}` : ""})
                    </span>
                  </div>

                  {cfg && user && (
                    <TransitionActions
                      status={ov.status}
                      rules={cfg.ovTransitions}
                      meta={cfg.ovStatusMeta}
                      userRole={user.role}
                      busy={busy}
                      onTransition={(to, fields) => transition(ov.id, to, fields)}
                    />
                  )}

                  <div className="mt-5 grid gap-5 lg:grid-cols-2">
                    <RecordsList records={ov.records} />
                    <AuditTrail audit={ov.audit} />
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
