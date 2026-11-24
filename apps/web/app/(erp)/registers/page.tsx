"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useMemo, useState } from "react";
import { api, getWithFallback } from "@/lib/api";
import { Partner, PartnerType, Rating } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { Button, FormChip, OfflineNotice, PageHeader, Panel, StatusPill, Table, Td, Tr } from "@/components/ui";
import { AuditTrail } from "@/components/workflow";

const RATING_LABEL: Record<Rating, { label: string; tone: "good" | "info" | "bad" }> = {
  3: { label: "GOOD (3)", tone: "good" },
  2: { label: "SUITABLE-CAPABLE (2)", tone: "info" },
  1: { label: "NOT SUITABLE (1)", tone: "bad" },
};

const STATUS_TONE: Record<string, "neutral" | "info" | "warn" | "good" | "bad"> = {
  APPLIED: "neutral", UNDER_EVALUATION: "info", JTP_APPROVED: "warn", REGISTERED: "good", DROPPED: "bad",
};

export default function RegistersPage() {
  const { t } = useLang();
  const [rows, setRows] = useState<Partner[]>([]);
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<PartnerType>("SUPPLIER");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [car, setCar] = useState({ ref: "", reason: "" });
  const [reassess, setReassess] = useState({ rating: "3", nonConformances: "0", factorsEvaluated: "20", monitoringRef: "" });

  const user = useSession()?.user;
  const canQuality = user?.role === "QUALITY" || user?.role === "ADMIN";
  const canPurchasing = user?.role === "PURCHASING" || user?.role === "PCE" || user?.role === "ADMIN";

  useEffect(() => {
    getWithFallback<Partner[]>("/registers/partners", "partners")
      .then((r) => { setRows(r.data); setOffline(r.offline); })
      .catch(console.error);
  }, []);

  const patch = (u: Partner) => setRows((p) => p.map((x) => (x.id === u.id ? u : x)));
  const filtered = useMemo(() => rows.filter((p) => p.type === tab), [rows, tab]);
  const open = filtered.find((p) => p.id === openId);

  async function act(path: string, body: object) {
    setBusy(true); setError(null);
    try {
      patch(await api.post<Partner>(path, body));
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  // QP.13 §reassessment — performance = (non-conformances ÷ factors evaluated) × 100%
  const perfPct = (p: Partner) => p.factorsEvaluated ? Math.round((p.nonConformances / p.factorsEvaluated) * 1000) / 10 : 0;

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader eyebrow="QP.13 Suppliers · QP.34 Sub-contractors · JTP approval · 3-year reassessment" title={t("registers")} />
      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      <div className="fade-up mb-4 flex gap-2">
        {(["SUPPLIER", "SUBCONTRACTOR"] as const).map((tp) => (
          <button
            key={tp}
            onClick={() => { setTab(tp); setOpenId(null); }}
            className={`mono rounded-full border px-3.5 py-1.5 text-[10.5px] tracking-widest transition-colors ${
              tab === tp ? "border-brand bg-brand/15 text-fg" : "hairline text-steel hover:border-steel/50 hover:text-fg"
            }`}
          >
            {tp === "SUPPLIER" ? "SUPPLIERS · F224" : "SUB-CONTRACTORS · AVL / MSN / F229"}
          </button>
        ))}
      </div>

      <div className="panel fade-up d2">
        <Table head={["ID", "Name", "Country", "Certifications", "Lists", "Rating", "Perf %", "Reassess due", "CARs", "Status"]}>
          {filtered.map((p) => {
            const due = p.nextReassessment && p.nextReassessment <= "2026-12-31";
            return (
              <Tr key={p.id} onClick={() => setOpenId(openId === p.id ? null : p.id)}>
                <Td className="mono text-xs text-trace">{p.id}</Td>
                <Td>{p.name}</Td>
                <Td className="mono text-xs text-steel">{p.country}</Td>
                <Td className="mono text-xs text-steel">{p.certifications.join(" · ")}</Td>
                <Td className="mono text-xs text-steel">{p.lists.join(" · ") || "—"}</Td>
                <Td>{p.rating ? <StatusPill value={RATING_LABEL[p.rating].label} tone={RATING_LABEL[p.rating].tone} /> : <span className="text-dim">—</span>}</Td>
                <Td className={`mono text-xs tabular-nums ${perfPct(p) > 20 ? "text-amber" : "text-phosphor"}`}>{perfPct(p)}%</Td>
                <Td className={`mono text-xs ${due ? "text-amber" : "text-steel"}`}>{p.nextReassessment ?? "—"}</Td>
                <Td className={`mono text-xs tabular-nums ${p.cars.length >= 2 ? "text-brand-bright" : p.cars.length ? "text-amber" : "text-steel"}`}>{p.cars.length}</Td>
                <Td><StatusPill value={p.status} tone={STATUS_TONE[p.status]} /></Td>
              </Tr>
            );
          })}
        </Table>
      </div>

      {open && (
        <Panel ticked className="fade-up mt-4 p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="mono text-xs text-trace">{open.id}</p>
              <p className="display text-xl font-bold">{open.name}</p>
              <p className="mono mt-0.5 text-[10.5px] tracking-widest text-steel">
                Non-conformances {open.nonConformances} ÷ factors {open.factorsEvaluated} × 100% = {perfPct(open)}%
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {open.evaluationRef && <FormChip formNo={open.type === "SUPPLIER" ? "F225" : "F228"} refNo={open.evaluationRef} />}
              {open.siteAuditRef && <FormChip formNo="F225A" refNo={open.siteAuditRef} />}
              {open.cars.map((c) => <FormChip key={c.ref} formNo="F516" refNo={c.ref} />)}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              {canQuality && open.status !== "DROPPED" && (
                <div className="rounded-md border hairline bg-ink-deep/40 p-4">
                  <p className="eyebrow mb-2">Issue CAR (F516) — 2nd CAR drops the partner from the lists</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <input placeholder="F516 ref" value={car.ref} onChange={(e) => setCar({ ...car, ref: e.target.value })} className="mono w-36 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                    <input placeholder="Reason" value={car.reason} onChange={(e) => setCar({ ...car, reason: e.target.value })} className="mono min-w-52 flex-1 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                    <Button variant="danger" disabled={busy || !car.ref || !car.reason} onClick={() => { act(`/registers/partners/${open.id}/car`, car); setCar({ ref: "", reason: "" }); }}>
                      Issue CAR
                    </Button>
                  </div>
                </div>
              )}

              {canPurchasing && open.status === "REGISTERED" && (
                <div className="rounded-md border hairline bg-ink-deep/40 p-4">
                  <p className="eyebrow mb-2">3-year reassessment ({open.type === "SUPPLIER" ? "F226" : "F230"}) — quality · delivery/TAT · capability · quantity</p>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="block">
                      <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Rating</span>
                      <select value={reassess.rating} onChange={(e) => setReassess({ ...reassess, rating: e.target.value })} className="mono rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                        <option value="3">GOOD (3)</option>
                        <option value="2">SUITABLE-CAPABLE (2)</option>
                        <option value="1">NOT SUITABLE (1)</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Non-conf.</span>
                      <input value={reassess.nonConformances} onChange={(e) => setReassess({ ...reassess, nonConformances: e.target.value })} className="mono w-20 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                    </label>
                    <label className="block">
                      <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Factors</span>
                      <input value={reassess.factorsEvaluated} onChange={(e) => setReassess({ ...reassess, factorsEvaluated: e.target.value })} className="mono w-20 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                    </label>
                    <label className="block">
                      <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Monitoring ref</span>
                      <input value={reassess.monitoringRef} onChange={(e) => setReassess({ ...reassess, monitoringRef: e.target.value })} className="mono w-36 rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                    </label>
                    <Button
                      disabled={busy || !reassess.monitoringRef}
                      onClick={() =>
                        act(`/registers/partners/${open.id}/reassess`, {
                          rating: Number(reassess.rating) as Rating,
                          nonConformances: Number(reassess.nonConformances),
                          factorsEvaluated: Number(reassess.factorsEvaluated),
                          monitoringRef: reassess.monitoringRef,
                        })
                      }
                    >
                      Record reassessment
                    </Button>
                  </div>
                </div>
              )}

              {open.cars.length > 0 && (
                <div>
                  <p className="eyebrow mb-2">Corrective Action Requests</p>
                  <ul className="space-y-1.5">
                    {open.cars.map((c) => (
                      <li key={c.ref} className="rounded border border-amber/25 bg-amber/5 px-3 py-2 text-sm">
                        <span className="mono mr-2 text-xs text-amber">{c.ref} · {c.date}</span>
                        {c.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              <AuditTrail audit={open.audit} />
            </div>
          </div>
        </Panel>
      )}
    </div>
  );
}
