"use client";

import { useSession } from "@/lib/use-session";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, download, getWithFallback } from "@/lib/api";
import { ChecklistItem, Job, JobStatus, StaffMember } from "@/lib/types";
import { loadStaff } from "@/components/step-form";
import { railOf, useVocab } from "@/lib/vocab";
import { useConfig } from "@/lib/use-config";
import { useLang } from "@/lib/i18n";
import { Button, MetaPill, OfflineNotice, Panel } from "@/components/ui";
import { AuditTrail, RecordsList, StageRail, TransitionActions } from "@/components/workflow";
import { AttachmentsPanel } from "@/components/attachments";

export default function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const cfg = useConfig();
  const { lang, t } = useLang();
  const [job, setJob] = useState<Job | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showPriority, setShowPriority] = useState(false);
  const [pForm, setPForm] = useState({ type: "", route: "", quantity: "1", suffixK: false, colRef: "" });
  const [newCheck, setNewCheck] = useState("");

  const user = useSession()?.user;
  const { terms, modules, dict, label, can, ref, aviation, isFinal } = useVocab();
  const priorities = dict("priority");
  const routes = dict("route");
  const canManagePriority = modules.priority && can("priority.raise");
  const canClosePriority = can("priority.close");

  useEffect(() => {
    getWithFallback<Job[]>("/jobs", "jobs")
      .then((r) => {
        setOffline(r.offline);
        setJob(r.data.find((j) => j.id === id) ?? null);
      })
      .catch(console.error);
  }, [id]);

  async function transition(to: JobStatus, fields: Record<string, string>) {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<Job>(`/jobs/${job.id}/transition`, { to, fields });
      setJob(updated);
    } catch (e) {
      setError(offline ? "Transitions need the live API — start apps/api." : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function assignTo(userId: string | null) {
    if (!job) return;
    setBusy(true); setError(null);
    try { setJob(await api.patch<Job>(`/jobs/${job.id}/assignee`, { userId })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function pickUp() {
    if (!job) return;
    setBusy(true); setError(null);
    try { setJob(await api.post<Job>(`/jobs/${job.id}/claim`, {})); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function checklist(body: { items?: { key: string; done?: boolean }[]; add?: { label: string }[] }) {
    if (!job) return;
    setBusy(true); setError(null);
    try {
      setJob(await api.patch<Job>(`/jobs/${job.id}/checklist`, body));
      setNewCheck("");
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  async function priorityAction(method: "post" | "patch", path: string, body: object) {
    if (!job) return;
    setBusy(true); setError(null);
    try {
      setJob(await api[method]<Job>(path, body));
      setShowPriority(false);
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  if (job === undefined) return <p className="eyebrow py-20 text-center">LOADING…</p>;
  if (job === null)
    return (
      <p className="eyebrow py-20 text-center">
        {terms.job.toUpperCase()} NOT FOUND — <Link href="/jobs" className="text-trace">back to register</Link>
      </p>
    );

  const daysIn = Math.floor((Date.now() - new Date(job.statusSince).getTime()) / 86_400_000);
  const sla = cfg?.slaRules.find((r) => r.entity === "JOB" && r.status === job.status);
  const overdue = sla && daysIn > sla.days;
  const closed = isFinal("JOB", job.status);
  const rail = railOf(cfg?.jobStatusMeta);
  const checks: ChecklistItem[] = job.checklist ?? [];
  // Aviation screens stay as they were unless the organisation starts assigning work.
  const showAssignee = !aviation || !!job.assigneeId || can("jobs.assign");
  const myRoleActs = !!cfg?.jobTransitions.some((r) => r.from === job.status && (user?.role === "ADMIN" || r.roles.includes(user?.role ?? "")));

  return (
    <div>
      <OfflineNotice show={offline} />

      <div className="fade-up mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">
            <Link href="/jobs" className="hover:text-trace">{aviation ? t("jobs") : terms.jobRegister}</Link> · {aviation ? job.category : label("category", job.category)}
            {job.jobType && !aviation && <> · {label("jobType", job.jobType)}</>} · {job.originUnit} → {aviation ? job.repairUnit : label("site", job.repairUnit)}
          </p>
          <h1 className="display text-2xl font-bold">
            <span className="mono mr-3 text-lg text-trace">{job.id}</span>
            {job.component}
          </h1>
          <p className="mono mt-1 text-xs text-steel">
            {aviation ? `P/N ${job.partNo} · S/N ${job.serialNo}` : `${job.partNo} · ${job.serialNo}`} · received {job.psDate}
            {job.assetId && <> · <Link href={`/assets?id=${encodeURIComponent(job.assetId)}`} className="text-trace hover:underline">{terms.asset.toUpperCase()} {job.assetId}</Link></>}
            {job.pmScheduleId && <> · <Link href="/pm" className="text-trace hover:underline">{job.pmScheduleId}</Link></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="mono rounded border hairline px-2.5 py-1 text-[10.5px] tracking-widest text-steel">
            {t("location")}: {aviation ? job.location : label("location", job.location)}
          </span>
          <MetaPill status={job.status} meta={cfg?.jobStatusMeta?.[job.status]} lang={lang} />
          <Button variant="ghost" onClick={() => download(`/job-cards?ids=${encodeURIComponent(job.id)}`, `${job.id}-job-card.pdf`).catch((e) => setError((e as Error).message))}>
            Print {aviation ? "job" : terms.job.toLowerCase()} card
          </Button>
        </div>
      </div>

      {job.archivedAt && (
        <p className="fade-up mb-4 mono inline-block rounded border border-steel/40 bg-panel/60 px-3 py-1.5 text-[10.5px] tracking-widest text-steel">
          ARCHIVED {job.archivedAt.slice(0, 10)} · READ-ONLY · RETAINED WITH FULL AUDIT TRAIL (FR-12)
        </p>
      )}

      {/* lifecycle rail */}
      {cfg && (
        <div className="panel fade-up d1 mb-4 px-4 py-3.5">
          <StageRail order={rail.order} current={job.status} meta={cfg.jobStatusMeta} branches={rail.branches} />
        </div>
      )}

      {/* QP.56 AOG / ROA / Critical priority overlay (5.9) — FR-15 */}
      {job.priority?.state === "OPEN" && (
        <div className="fade-up mb-4 rounded-md border border-brand-bright/50 bg-brand-bright/10 px-4 py-3 pulse-aog">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <MetaPill status={job.priority.type} meta={cfg?.priorityMeta?.[job.priority.type]} lang={lang} />
              <span className="mono text-[10.5px] tracking-widest text-brand-bright">
                {aviation ? "COL" : "REF"} {job.priority.colRef} · QTY {job.priority.quantity} · ROUTE {cfg?.repairRouteMeta?.[job.priority.route]?.[lang] ?? job.priority.route}
                {job.priority.suffixK && " · SUFFIX K"}{job.priority.edd && ` · EDD ${job.priority.edd}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/aog" className="mono text-[10.5px] tracking-widest text-steel hover:text-trace">{aviation ? "MANAGE ON COL →" : "MANAGE →"}</Link>
              {canClosePriority && (
                <>
                  <Button disabled={busy} onClick={() => priorityAction("post", `/jobs/${job.id}/priority/close`, { reason: "DELIVERED" })}>Close — delivered</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => priorityAction("post", `/jobs/${job.id}/priority/close`, { reason: "DOWNGRADED" })}>Downgrade</Button>
                </>
              )}
            </div>
          </div>
          {job.priority.remark && <p className="mono mt-1.5 text-[10.5px] text-steel/90">{aviation ? "COL REMARK" : "REMARK"} · {job.priority.remark}</p>}
        </div>
      )}
      {job.priority?.state === "CLOSED" && (
        <p className="fade-up mb-4 mono inline-block rounded border border-phosphor/40 bg-phosphor/5 px-3 py-1.5 text-[10.5px] tracking-widest text-phosphor">
          {job.priority.type} PRIORITY CLOSED · {job.priority.closedAt?.slice(0, 10)} · {job.priority.closeReason === "DELIVERED" ? "DELIVERED" : "DOWNGRADED TO NORMAL"}
        </p>
      )}
      {!job.priority?.state && canManagePriority && !closed && priorities.length > 0 && (
        <div className="fade-up mb-4">
          {!showPriority ? (
            <button onClick={() => setShowPriority(true)} className="mono rounded border border-brand-bright/40 px-3 py-1.5 text-[10.5px] tracking-widest text-brand-bright transition-colors hover:bg-brand-bright/10">
              ⚠ {aviation ? "RAISE AOG / ROA / CRITICAL PRIORITY (QP.56)" : `RAISE ${terms.priority.toUpperCase()}`}
            </button>
          ) : (
            <div className="panel ticked p-4">
              <p className="eyebrow mb-3">{aviation ? "Upgrade to priority — insert into the COL AOG/ROA column" : "Raise the priority — expedite this work"}</p>
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <label className="block">
                  <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Status</span>
                  <select value={pForm.type || priorities[0]?.key} onChange={(e) => setPForm({ ...pForm, type: e.target.value })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                    {priorities.map((tp) => <option key={tp.key} value={tp.key}>{aviation ? tp.key : tp.label}</option>)}
                  </select>
                </label>
                <label className="block lg:col-span-2">
                  <span className="mono mb-1 block text-[10px] tracking-widest text-steel">{aviation ? "Repair route" : "How it is expedited"}</span>
                  <select value={pForm.route || routes[0]?.key} onChange={(e) => setPForm({ ...pForm, route: e.target.value })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                    {routes.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mono mb-1 block text-[10px] tracking-widest text-steel">Qty</span>
                  <input value={pForm.quantity} onChange={(e) => setPForm({ ...pForm, quantity: e.target.value })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                </label>
                <label className="block">
                  <span className="mono mb-1 block text-[10px] tracking-widest text-steel">{aviation ? "COL ref *" : "Reference (call log / ticket) *"}</span>
                  <input value={pForm.colRef} onChange={(e) => setPForm({ ...pForm, colRef: e.target.value })} placeholder={aviation ? "COL-AOG-2026-0xx" : ""} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
                </label>
              </div>
              <div className="mt-3 flex items-center gap-3">
                {aviation && (
                  <label className="mono flex items-center gap-2 text-[10.5px] tracking-widest text-steel">
                    <input type="checkbox" checked={pForm.suffixK} onChange={(e) => setPForm({ ...pForm, suffixK: e.target.checked })} /> SUFFIX K
                  </label>
                )}
                <Button variant="danger" disabled={busy || !pForm.colRef} onClick={() => priorityAction("post", `/jobs/${job.id}/priority`, { type: pForm.type || priorities[0]?.key, route: pForm.route || routes[0]?.key, quantity: Number(pForm.quantity), suffixK: pForm.suffixK, colRef: pForm.colRef })}>
                  Raise priority
                </Button>
                <button onClick={() => setShowPriority(false)} className="mono text-[10.5px] tracking-widest text-dim hover:text-steel">CANCEL</button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      {showAssignee && !job.archivedAt && (
        <div className="fade-up mb-4 flex flex-wrap items-center gap-3 rounded-md border hairline bg-panel/50 px-4 py-2.5">
          <span className="eyebrow">Assigned to</span>
          <span className="text-sm text-fg">{job.assigneeName ?? <span className="text-dim">nobody yet</span>}</span>
          {!closed && can("jobs.assign") && <AssignPicker current={job.assigneeId} disabled={busy} onPick={assignTo} />}
          {!closed && !job.assigneeId && myRoleActs && (
            <Button variant="ghost" disabled={busy} onClick={pickUp}>Pick up</Button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel ticked className="fade-up d2 p-5 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Stage control · process-owner gated{ref(" (FR-03)")}</p>
            <span className={`mono text-[10.5px] tracking-widest ${overdue ? "text-brand-bright" : "text-steel"}`}>
              {daysIn} {t("daysInStatus")}
              {sla && ` · SLA ${sla.days}D (${sla.source})`}
              {overdue && " · OVERDUE"}
            </span>
          </div>

          {cfg && user && (
            <TransitionActions
              entity="job"
              entityId={job.id}
              status={job.status}
              rules={cfg.jobTransitions}
              meta={cfg.jobStatusMeta}
              userRole={user.role}
              busy={busy}
              onTransition={transition}
            />
          )}

          {closed && (
            <p className="mt-4 rounded border hairline bg-ink-deep/40 px-3 py-2 text-sm text-dim">
              {aviation ? "Job" : terms.job} closed — editing locked{ref(" (QP.44 stage 10)")}. Records retained 5 years.
            </p>
          )}

          {(checks.length > 0 || (!closed && !job.archivedAt)) && (
            <div className="mt-6 border-t hairline pt-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="eyebrow">{t("checklist")}</p>
                {checks.length > 0 && (
                  <span className="mono text-[10.5px] tracking-widest text-steel">
                    {checks.filter((c) => c.done).length}/{checks.length} DONE · REQUIRED ITEMS GATE COMPLETION
                  </span>
                )}
              </div>
              <ul className="space-y-1.5">
                {checks.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={c.done}
                      disabled={busy || closed || !!job.archivedAt}
                      onChange={(e) => checklist({ items: [{ key: c.key, done: e.target.checked }] })}
                      className="mt-0.5 accent-[var(--c-red)]"
                    />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${c.done ? "text-steel line-through" : "text-fg"}`}>
                        {c.label}{c.required && !c.done && <span className="ml-1 text-brand-bright">*</span>}
                      </p>
                      {c.done && <p className="mono text-[10px] tracking-widest text-dim">{c.by} · {c.at?.slice(0, 16).replace("T", " ")}</p>}
                    </div>
                  </li>
                ))}
              </ul>
              {!closed && !job.archivedAt && (
                <div className="mt-2 flex gap-2">
                  <input value={newCheck} onChange={(e) => setNewCheck(e.target.value)} placeholder="Add a check…" className="mono flex-1 rounded-md border hairline bg-ink-deep px-3 py-1.5 text-xs text-fg outline-none focus:border-trace" />
                  <Button variant="ghost" disabled={busy || !newCheck.trim()} onClick={() => checklist({ add: [{ label: newCheck.trim() }] })}>Add</Button>
                </div>
              )}
            </div>
          )}

          <div className="mt-6">
            <RecordsList records={job.records} />
          </div>

          <div className="mt-6 border-t hairline pt-4">
            <AttachmentsPanel
              entity="JOB"
              entityId={job.id}
              canUpload={!closed}
              formNos={aviation ? ["F116", "F117", "F119", "F135", "F174", "F218", "F219", "AM 75"] : []}
            />
          </div>

          {(job.demandIds.length > 0 || job.ovId || (job.invoiceIds?.length ?? 0) > 0 || job.indentRef) && (
            <div className="mt-6 border-t hairline pt-4">
              <p className="eyebrow mb-2">Linked processes</p>
              <div className="flex flex-wrap gap-2">
                {job.demandIds.map((d) => (
                  <Link key={d} href="/demands" className="mono rounded border border-trace/40 px-2.5 py-1 text-[10.5px] tracking-widest text-trace hover:bg-trace/10">
                    {aviation ? "DEMAND" : terms.demand.toUpperCase()} {d}{ref(" · QP.14")}
                  </Link>
                ))}
                {job.ovId && (
                  <Link href="/ov" className="mono rounded border border-amber/40 px-2.5 py-1 text-[10.5px] tracking-widest text-amber hover:bg-amber/10">
                    {aviation ? "OV" : terms.vendorRepair.toUpperCase()} {job.ovId}{ref(" · QP.33")}
                  </Link>
                )}
                {(job.invoiceIds ?? []).map((inv) => (
                  <Link key={inv} href="/invoicing" className="mono rounded border border-phosphor/40 px-2.5 py-1 text-[10.5px] tracking-widest text-phosphor hover:bg-phosphor/10">
                    INVOICE {inv}{ref(" · QP.51")}
                  </Link>
                ))}
                {job.indentRef && (
                  <span className="mono rounded border hairline px-2.5 py-1 text-[10.5px] tracking-widest text-steel">
                    {aviation ? "CUSTOMER INDENT" : "APPROVAL / PO"} {job.indentRef}
                  </span>
                )}
              </div>
            </div>
          )}
        </Panel>

        <Panel className="fade-up d3 max-h-[560px] overflow-y-auto p-5">
          <AuditTrail audit={job.audit} />
        </Panel>
      </div>
    </div>
  );
}

/** Reassign or unassign — for people allowed to assign work. */
function AssignPicker({ current, disabled, onPick }: { current?: string; disabled: boolean; onPick: (userId: string | null) => void }) {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  useEffect(() => { loadStaff().then(setStaff).catch(() => {}); }, []);
  return (
    <select
      value={current ?? ""}
      disabled={disabled}
      onChange={(e) => onPick(e.target.value || null)}
      className="mono rounded-md border hairline bg-ink-deep px-2.5 py-1.5 text-xs text-fg outline-none focus:border-trace"
    >
      <option value="">— unassigned —</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.role}</option>)}
    </select>
  );
}
