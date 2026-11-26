"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getWithFallback } from "@/lib/api";
import { Job, Kpis, PmSchedule } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { useConfig } from "@/lib/use-config";
import { useLang } from "@/lib/i18n";
import { fmtMYR } from "@/lib/format";
import { OfflineNotice, Panel, MetaPill } from "@/components/ui";
import { RadarScope, RadarLegend } from "@/components/radar-scope";
import { StatCard } from "@/components/stat-card";
import { Bars } from "@/components/charts";

export default function DashboardPage() {
  const cfg = useConfig();
  const { lang } = useLang();
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [offline, setOffline] = useState(false);
  const [pmDue, setPmDue] = useState<PmSchedule[] | null>(null);
  const { aviation, terms, modules, isFinal, ref } = useVocab();

  useEffect(() => {
    getWithFallback<Kpis>("/dashboard/kpis", "kpis")
      .then((r) => { setKpis(r.data); setOffline(r.offline); })
      .catch(console.error);
    getWithFallback<Job[]>("/jobs", "jobs")
      .then((r) => setJobs(r.data))
      .catch(console.error);
  }, []);
  useEffect(() => {
    if (modules.pm) api.get<PmSchedule[]>("/pm/schedules?due=1").then(setPmDue).catch(() => setPmDue(null));
  }, [modules.pm]);

  if (!kpis) return <p className="eyebrow py-20 text-center">LOADING…</p>;

  const distribution = kpis.byStatus.filter((s) => s.count > 0 && !isFinal("JOB", s.status));
  const J = terms.jobs.toUpperCase();
  const ticker = [
    `OPEN ${J} ${kpis.openJobs}`, `WIP ${kpis.wip}`,
    modules.priority && `${aviation ? "AOG/ROA" : "PRIORITY"} ${kpis.aogOpen}`,
    `AWAITING CUSTOMER ${kpis.awaitingCustomer}`, `AT VENDOR ${kpis.atVendor}`, `SLA BREACHES ${kpis.slaBreaches}`,
    modules.pm && pmDue && `PM DUE ${pmDue.length}`,
    modules.invoicing && `OPEN INVOICES ${kpis.openInvoices}`, modules.invoicing && `REVENUE ${fmtMYR(kpis.revenueBilledMYR)}`,
    modules.invoicing && `TAX ${fmtMYR(kpis.gstCollectedMYR)}`,
    modules.incidents && `${aviation ? "FOD" : "INCIDENTS"} OPEN ${kpis.openFod}`, modules.tools && `TOOLS OUT ${kpis.toolsUnaccounted}`,
    modules.registers && `PARTNERS DUE REASSESSMENT ${kpis.partnersDueReassessment}`, `AVG ${terms.job.toUpperCase()} AGE ${kpis.avgJobAgeDays}D`,
  ].filter(Boolean).join(" · ") + " · ";

  return (
    <div>
      <OfflineNotice show={offline} />

      {/* telemetry ticker */}
      <div className="fade-up mb-6 overflow-hidden rounded-md border hairline bg-ink-deep/60">
        <div className="ticker mono whitespace-nowrap py-1.5 text-[10.5px] tracking-widest text-steel">
          {ticker.repeat(2)}
        </div>
      </div>

      <div className={`mb-6 grid grid-cols-2 gap-3 ${modules.stock && kpis.lowStock != null ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <StatCard label={`Open ${terms.jobs.toLowerCase()}`} value={kpis.openJobs} delayClass="d1" />
        <StatCard label="Work in progress" value={kpis.wip} delayClass="d2" />
        <StatCard
          label="SLA breaches"
          value={kpis.slaBreaches}
          tone={kpis.slaBreaches ? "critical" : "good"}
          delayClass="d3"
        />
        {modules.pm && pmDue && !aviation ? (
          <StatCard label={`${terms.pm} due`} value={pmDue.length} tone={pmDue.some((p) => p.overdue) ? "critical" : "good"} delayClass="d4" />
        ) : modules.priority ? (
          <StatCard
            label={aviation ? "AOG / ROA open · QP.56" : `${terms.priority} open`}
            value={kpis.aogOpen}
            tone={kpis.aogOpen ? "critical" : "good"}
            delayClass="d4"
          />
        ) : (
          <StatCard label="Awaiting customer" value={kpis.awaitingCustomer} delayClass="d4" />
        )}
        {modules.stock && kpis.lowStock != null && (
          <Link href="/stock?view=reorder" className="block">
            <StatCard label="Low stock" value={kpis.lowStock} tone={kpis.lowStock ? "critical" : "good"} delayClass="d4" />
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel ticked className="fade-up d2 p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Operations radar · open {terms.jobs.toLowerCase()} by {terms.site.toLowerCase()}</p>
          </div>
          <RadarScope jobs={jobs} cfg={cfg} />
          <div className="mt-3 flex justify-center">
            <RadarLegend />
          </div>
        </Panel>

        <Panel className="fade-up d3 p-5">
          <p className="eyebrow mb-4">{aviation ? "JTS status distribution" : `${terms.job} status distribution`}</p>
          <ul className="space-y-2.5">
            {distribution.map((s) => {
              const max = Math.max(...distribution.map((x) => x.count));
              return (
                <li key={s.status}>
                  <div className="mb-1 flex items-center justify-between">
                    <MetaPill status={s.status} meta={cfg?.jobStatusMeta?.[s.status]} lang={lang} />
                    <span className="mono text-xs tabular-nums text-steel">{s.count}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-ink-deep">
                    <div
                      className="draw-bar h-full rounded-full bg-gradient-to-r from-brand to-brand-bright"
                      style={{ width: `${(s.count / max) * 100}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>

        <div className="space-y-4">
          <Panel ticked={kpis.slaBreaches > 0} className="fade-up d4 p-5">
            <p className="eyebrow mb-3">SLA breach board{ref(" · FR-10")}</p>
            {kpis.breaches.length === 0 ? (
              <p className="text-sm text-phosphor">{aviation ? "All milestones inside QP timers." : "All milestones inside their timers."}</p>
            ) : (
              <ul className="space-y-2.5">
                {kpis.breaches.map((b) => (
                  <li key={`${b.entity}-${b.ref}`} className="rounded-md border border-brand-bright/25 bg-brand-bright/5 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={b.entity === "JOB" ? `/jobs/${b.ref}` : b.entity === "DEMAND" ? "/demands" : b.entity === "INVOICE" ? "/invoicing" : "/ov"}
                        className="mono text-xs text-brand-bright hover:underline"
                      >
                        {b.ref}
                      </Link>
                      <span className="mono text-[10px] tracking-widest text-brand-bright">+{b.daysOver}D OVER</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-steel">{b.detail}</p>
                    <p className="mono mt-0.5 text-[10px] tracking-widest text-dim">{b.rule} · {b.source}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel className="fade-up d5 p-5">
            <p className="eyebrow mb-3">Weekly {aviation ? "job" : terms.job.toLowerCase()} closures</p>
            <Bars data={kpis.weeklyClosures} label={`${terms.jobs} closed per week`} />
          </Panel>
        </div>
      </div>

      {/* QP.56 priority overlay + QP.51 revenue */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        {modules.priority && <Panel ticked={kpis.aogOpen > 0} className="fade-up p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">{aviation ? "AOG / ROA / Critical priority board · COL · FR-15" : `${terms.priority} board`}</p>
            <Link href="/aog" className="mono text-[10px] tracking-widest text-steel hover:text-trace">{aviation ? "QP.56 · MANAGE ON COL →" : "MANAGE →"}</Link>
          </div>
          {kpis.priorityBoard.length === 0 ? (
            <p className="text-sm text-phosphor">{aviation ? "No component currently flagged AOG / ROA / Critical." : `No ${terms.job.toLowerCase()} is currently prioritised.`}</p>
          ) : (
            <ul className="space-y-2">
              {kpis.priorityBoard.map((p) => (
                <li key={p.jobId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand-bright/25 bg-brand-bright/5 px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <MetaPill status={p.type} meta={cfg?.priorityMeta?.[p.type]} lang={lang} />
                    <Link href={`/jobs/${p.jobId}`} className="mono text-xs text-brand-bright hover:underline">{p.jobId}</Link>
                    <span className="text-xs text-steel">{p.component}</span>
                  </div>
                  <span className="mono text-[10px] tracking-widest text-dim">
                    ROUTE {cfg?.repairRouteMeta?.[p.route]?.[lang] ?? p.route} · {aviation ? "COL" : "REF"} {p.colRef}{p.edd ? ` · EDD ${p.edd}` : ""} · {p.daysOpen}D OPEN
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>}

        {modules.invoicing && <Panel className="fade-up p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">Revenue & billing{ref(" · QP.51 · FR-14")}</p>
            <Link href="/invoicing" className="mono text-[10px] tracking-widest text-steel hover:text-trace">→</Link>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="mono text-[10.5px] tracking-widest text-steel">BILLED (incl. tax)</span>
              <span className="mono text-sm text-phosphor">{fmtMYR(kpis.revenueBilledMYR)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="mono text-[10.5px] tracking-widest text-steel">TAX COLLECTED</span>
              <span className="mono text-sm text-trace">{fmtMYR(kpis.gstCollectedMYR)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="mono text-[10.5px] tracking-widest text-steel">OUTSTANDING</span>
              <span className={`mono text-sm ${kpis.outstandingMYR ? "text-amber" : "text-phosphor"}`}>{fmtMYR(kpis.outstandingMYR)}</span>
            </div>
            <div className="flex items-center justify-between border-t hairline pt-3">
              <span className="mono text-[10.5px] tracking-widest text-steel">OPEN INVOICES</span>
              <span className="mono text-sm text-fg">{kpis.openInvoices}</span>
            </div>
          </div>
        </Panel>}
      </div>
    </div>
  );
}
