"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getWithFallback } from "@/lib/api";
import { Job, PriorityType, RepairRoute } from "@/lib/types";
import { useConfig } from "@/lib/use-config";
import { useLang } from "@/lib/i18n";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, MetaPill, OfflineNotice, PageHeader, Panel, StatusPill } from "@/components/ui";
import { AuditTrail } from "@/components/workflow";

export default function AogPage() {
  const cfg = useConfig();
  const { lang, t } = useLang();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [raiseFor, setRaiseFor] = useState<string>("");
  const { aviation, terms, dict, can, isFinal } = useVocab();
  const TYPES = dict("priority").map((p) => p.key);
  const ROUTES = dict("route").map((p) => p.key);
  const [form, setForm] = useState({ type: "" as PriorityType, quantity: "1", route: "" as RepairRoute, suffixK: false, colRef: "", edd: "", remark: "" });
  const [edit, setEdit] = useState<{ route: RepairRoute; edd: string; remark: string } | null>(null);

  const user = useSession()?.user;
  void user;
  const canManage = can("priority.raise");
  const canClose = can("priority.close");
  const COL = aviation ? "COL " : "";

  useEffect(() => {
    getWithFallback<Job[]>("/jobs", "jobs")
      .then((r) => { setJobs(r.data); setOffline(r.offline); })
      .catch(console.error);
  }, []);

  const patch = (u: Job) => setJobs((p) => p.map((x) => (x.id === u.id ? u : x)));
  const open = useMemo(() => jobs.filter((j) => j.priority?.state === "OPEN"), [jobs]);
  const closed = useMemo(() => jobs.filter((j) => j.priority && j.priority.state === "CLOSED"), [jobs]);
  const eligible = useMemo(() => jobs.filter((j) => !j.priority?.state && !isFinal("JOB", j.status)), [jobs, isFinal]);

  async function raise() {
    setBusy(true); setError(null);
    try {
      const updated = await api.post<Job>(`/jobs/${raiseFor}/priority`, {
        type: form.type || TYPES[0], quantity: Number(form.quantity), route: form.route || ROUTES[0],
        suffixK: form.suffixK, colRef: form.colRef, edd: form.edd || undefined, remark: form.remark || undefined,
      });
      patch(updated); setOpenId(updated.id); setRaiseFor("");
      setForm({ type: "", quantity: "1", route: "", suffixK: false, colRef: "", edd: "", remark: "" });
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  async function act(id: string, path: string, body: object, method: "post" | "patch") {
    setBusy(true); setError(null);
    try {
      patch(await api[method]<Job>(path, body));
      setEdit(null);
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  function PriorityCard({ j }: { j: Job }) {
    const p = j.priority!;
    const routeMeta = cfg?.repairRouteMeta?.[p.route];
    const isOpen = openId === j.id;
    return (
      <Panel ticked={p.state === "OPEN"} className="p-5">
        <button className="flex w-full flex-wrap items-center justify-between gap-3 text-left" onClick={() => setOpenId(isOpen ? null : j.id)}>
          <div>
            <p className="mono text-xs text-trace">
              <span className="mr-2">{p.colRef}</span>
              <Link href={`/jobs/${j.id}`} className="text-steel hover:text-trace" onClick={(e) => e.stopPropagation()}>↳ {j.id}</Link>
            </p>
            <p className="mt-0.5 text-sm">{j.component} <span className="mono text-xs text-steel">· qty {p.quantity} · {j.originUnit}</span></p>
          </div>
          <div className="flex items-center gap-2">
            {p.suffixK && <span className="mono rounded border border-amber/40 px-2 py-0.5 text-[10px] tracking-widest text-amber">SUFFIX K</span>}
            <MetaPill status={p.type} meta={cfg?.priorityMeta?.[p.type]} lang={lang} />
            <StatusPill value={p.state} tone={p.state === "OPEN" ? "warn" : "neutral"} />
            <span className="mono text-xs text-dim">{isOpen ? "▲" : "▼"}</span>
          </div>
        </button>

        {isOpen && (
          <div className="fade-up mt-4 border-t hairline pt-4">
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <div className="rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                <p className="eyebrow">{aviation ? "Repair route" : "Expedite route"}</p>
                <p className="mono text-[11px] text-fg">{routeMeta?.[lang] ?? p.route}</p>
              </div>
              <div className="rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                <p className="eyebrow">EDD</p>
                <p className="mono text-[11px] text-steel">{p.edd ?? "—"}</p>
              </div>
              <div className="rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                <p className="eyebrow">Job status</p>
                <p className="mono text-[11px] text-steel">{cfg?.jobStatusMeta?.[j.status]?.[lang] ?? j.status}</p>
              </div>
              <div className="rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                <p className="eyebrow">Raised</p>
                <p className="mono text-[11px] text-steel">{p.raisedAt.slice(0, 10)} · {p.raisedBy}</p>
              </div>
            </div>

            {routeMeta && <p className="mb-3 mono text-[10.5px] text-dim">ROUTE ACTION — {routeMeta.note}</p>}
            {p.remark && (
              <p className="mb-3 rounded border hairline bg-ink-deep/40 px-3 py-2 text-xs text-steel">
                <span className="mono text-[10px] tracking-widest text-dim">{COL}REMARK · </span>{p.remark}
              </p>
            )}
            {p.state === "CLOSED" && (
              <p className="mb-3 mono text-[10.5px] tracking-widest text-phosphor">
                CLOSED {p.closedAt?.slice(0, 10)} · {p.closeReason === "DELIVERED" ? "DELIVERED" : "DOWNGRADED TO NORMAL"}
              </p>
            )}

            {p.state === "OPEN" && canManage && (
              <div className="mb-4 rounded-md border hairline bg-ink-deep/40 p-4">
                <p className="eyebrow mb-2">Update {COL}remark / EDD / route</p>
                <div className="flex flex-wrap items-end gap-2">
                  <label className="block">
                    <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Route</span>
                    <select
                      value={(edit?.route ?? p.route)}
                      onChange={(e) => setEdit({ route: e.target.value as RepairRoute, edd: edit?.edd ?? p.edd ?? "", remark: edit?.remark ?? p.remark ?? "" })}
                      className="mono rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace"
                    >
                      {ROUTES.map((r) => <option key={r} value={r}>{cfg?.repairRouteMeta?.[r]?.en ?? r}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mono mb-1 block text-[10px] tracking-widest text-steel">EDD</span>
                    <input type="date" value={edit?.edd ?? p.edd ?? ""} onChange={(e) => setEdit({ route: edit?.route ?? p.route, edd: e.target.value, remark: edit?.remark ?? p.remark ?? "" })}
                      className="mono rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                  </label>
                  <label className="block min-w-52 flex-1">
                    <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Remark</span>
                    <input value={edit?.remark ?? p.remark ?? ""} onChange={(e) => setEdit({ route: edit?.route ?? p.route, edd: edit?.edd ?? p.edd ?? "", remark: e.target.value })}
                      className="mono w-full rounded-md border hairline bg-panel px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                  </label>
                  <Button variant="ghost" disabled={busy} onClick={() => act(j.id, `/jobs/${j.id}/priority`, {
                    route: (edit?.route ?? p.route), edd: (edit?.edd ?? p.edd), remark: (edit?.remark ?? p.remark),
                  }, "patch")}>{aviation ? "Update COL" : "Update"}</Button>
                </div>
              </div>
            )}

            {p.state === "OPEN" && canClose && (
              <div className="mb-4 flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => act(j.id, `/jobs/${j.id}/priority/close`, { reason: "DELIVERED" }, "post")}>
                  Close — delivered
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => act(j.id, `/jobs/${j.id}/priority/close`, { reason: "DOWNGRADED" }, "post")}>
                  Downgrade to normal
                </Button>
              </div>
            )}

            <AuditTrail audit={p.audit} />
          </div>
        )}
      </Panel>
    );
  }

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader
        eyebrow={aviation ? "QP.56 · COL AOG/ROA column · expedite CoE/OV/POOLEX/AW · FR-15" : "Expedite urgent work across the organisation"}
        title={aviation ? t("aogRoa") : terms.priority}
        actions={canManage ? (
          <Button onClick={() => setRaiseFor(raiseFor ? "" : (eligible[0]?.id ?? ""))} variant={raiseFor ? "ghost" : "primary"} disabled={!eligible.length}>
            {raiseFor ? "Cancel" : "+ Raise priority"}
          </Button>
        ) : undefined}
      />
      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      {raiseFor && (
        <div className="panel ticked fade-up mb-6 p-5">
          <p className="eyebrow mb-3">{aviation ? "Upgrade a component to priority — Mgr PC / CsE identify by P/N, Description or S/N against the COL listing" : `Raise the priority of a ${terms.job.toLowerCase()}`}</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <label className="block lg:col-span-2">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{aviation ? "Component (job)" : terms.job}</span>
              <select value={raiseFor} onChange={(e) => setRaiseFor(e.target.value)} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                {eligible.map((j) => <option key={j.id} value={j.id}>{j.id} · {j.component} ({j.partNo})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Status</span>
              <select value={form.type || TYPES[0]} onChange={(e) => setForm({ ...form, type: e.target.value as PriorityType })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                {TYPES.map((tp) => <option key={tp} value={tp}>{aviation ? tp : cfg?.priorityMeta?.[tp]?.[lang] ?? tp}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Qty</span>
              <input value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{aviation ? "Repair route" : "Expedite route"}</span>
              <select value={form.route || ROUTES[0]} onChange={(e) => setForm({ ...form, route: e.target.value as RepairRoute })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                {ROUTES.map((r) => <option key={r} value={r}>{cfg?.repairRouteMeta?.[r]?.en ?? r}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{aviation ? "COL ref *" : "Reference (call log / ticket) *"}</span>
              <input value={form.colRef} onChange={(e) => setForm({ ...form, colRef: e.target.value })} placeholder={aviation ? "COL-AOG-2026-0xx" : ""} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
            </label>
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">EDD</span>
              <input type="date" value={form.edd} onChange={(e) => setForm({ ...form, edd: e.target.value })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
            </label>
          </div>
          <div className="mt-3 flex items-center gap-3">
            {aviation && (
              <label className="mono flex items-center gap-2 text-[11px] tracking-widest text-steel">
                <input type="checkbox" checked={form.suffixK} onChange={(e) => setForm({ ...form, suffixK: e.target.checked })} />
                CRITICAL — repair suffix &apos;K&apos;
              </label>
            )}
            <Button disabled={busy || !raiseFor || !form.colRef} onClick={raise}>{aviation ? "Insert into COL AOG/ROA column" : "Raise priority"}</Button>
          </div>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <p className="eyebrow">Open priorities · {open.length}</p>
        {aviation && <span className="mono text-[10.5px] tracking-widest text-dim">COMPANY ONLINE (COL) · AOG/ROA COLUMN</span>}
      </div>
      {open.length === 0 ? (
        <EmptyState title="No open priority items" hint={aviation ? "No component is currently flagged AOG / ROA / Critical." : `No ${terms.job.toLowerCase()} is currently prioritised.`} />
      ) : (
        <div className="space-y-4">
          {open.map((j) => <PriorityCard key={j.id} j={j} />)}
        </div>
      )}

      {closed.length > 0 && (
        <>
          <p className="eyebrow mb-2 mt-8">Closed / downgraded · {closed.length}</p>
          <div className="space-y-4">
            {closed.map((j) => <PriorityCard key={j.id} j={j} />)}
          </div>
        </>
      )}
    </div>
  );
}
