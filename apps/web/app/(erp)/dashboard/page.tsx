"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getWithFallback } from "@/lib/api";
import { Job, Kpis } from "@/lib/types";
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

  useEffect(() => {
    getWithFallback<Kpis>("/dashboard/kpis", "kpis")
      .then((r) => { setKpis(r.data); setOffline(r.offline); })
      .catch(console.error);
    getWithFallback<Job[]>("/jobs", "jobs")
      .then((r) => setJobs(r.data))
      .catch(console.error);
  }, []);

  if (!kpis) return <p className="eyebrow py-20 text-center">LOADING…</p>;

  const distribution = kpis.byStatus.filter((s) => s.count > 0 && s.status !== "CLOSED");

  return (
    <div>
      <OfflineNotice show={offline} />

      {/* telemetry ticker */}
      <div className="fade-up mb-6 overflow-hidden rounded-md border hairline bg-ink-deep/60">
        <div className="ticker mono whitespace-nowrap py-1.5 text-[10.5px] tracking-widest text-steel">
          {`OPEN JOBS ${kpis.openJobs} · WIP ${kpis.wip} · AOG/ROA ${kpis.aogOpen} · AWAITING CUSTOMER ${kpis.awaitingCustomer} · AT VENDOR ${kpis.atVendor} · SLA BREACHES ${kpis.slaBreaches} · OPEN INVOICES ${kpis.openInvoices} · REVENUE ${fmtMYR(kpis.revenueBilledMYR)} · GST ${fmtMYR(kpis.gstCollectedMYR)} · FOD OPEN ${kpis.openFod} · TOOLS OUT ${kpis.toolsUnaccounted} · PARTNERS DUE REASSESSMENT ${kpis.partnersDueReassessment} · AVG JOB AGE ${kpis.avgJobAgeDays}D · `.repeat(2)}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open jobs" value={kpis.openJobs} delayClass="d1" />
        <StatCard label="Work in progress" value={kpis.wip} delayClass="d2" />
        <StatCard
          label="SLA breaches"
          value={kpis.slaBreaches}
          tone={kpis.slaBreaches ? "critical" : "good"}
          delayClass="d3"
        />
        <StatCard
          label="AOG / ROA open · QP.56"
          value={kpis.aogOpen}
          tone={kpis.aogOpen ? "critical" : "good"}
          delayClass="d4"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel ticked className="fade-up d2 p-5">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">Operations radar · open jobs by branch</p>
          </div>
          <RadarScope jobs={jobs} cfg={cfg} />
          <div className="mt-3 flex justify-center">
            <RadarLegend />
          </div>
        </Panel>

        <Panel className="fade-up d3 p-5">
          <p className="eyebrow mb-4">JTS status distribution</p>
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
            <p className="eyebrow mb-3">SLA breach board · FR-10</p>
            {kpis.breaches.length === 0 ? (
              <p className="text-sm text-phosphor">All milestones inside QP timers.</p>
            ) : (
              <ul className="space-y-2.5">
                {kpis.breaches.map((b) => (
                  <li key={`${b.entity}-${b.ref}`} className="rounded-md border border-brand-bright/25 bg-brand-bright/5 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={b.entity === "JOB" ? `/jobs/${b.ref}` : b.entity === "DEMAND" ? "/demands" : "/ov"}
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
            <p className="eyebrow mb-3">Weekly job closures</p>
            <Bars data={kpis.weeklyClosures} label="Jobs closed per week" />
          </Panel>
        </div>
      </div>

      {/* QP.56 priority overlay + QP.51 revenue */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Panel ticked={kpis.aogOpen > 0} className="fade-up p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">AOG / ROA / Critical priority board · COL · FR-15</p>
            <Link href="/aog" className="mono text-[10px] tracking-widest text-steel hover:text-trace">QP.56 · MANAGE ON COL →</Link>
          </div>
          {kpis.priorityBoard.length === 0 ? (
            <p className="text-sm text-phosphor">No component currently flagged AOG / ROA / Critical.</p>
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
                    ROUTE {cfg?.repairRouteMeta?.[p.route]?.[lang] ?? p.route} · COL {p.colRef}{p.edd ? ` · EDD ${p.edd}` : ""} · {p.daysOpen}D OPEN
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="fade-up p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="eyebrow">Revenue & billing · QP.51 · FR-14</p>
            <Link href="/invoicing" className="mono text-[10px] tracking-widest text-steel hover:text-trace">→</Link>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="mono text-[10.5px] tracking-widest text-steel">BILLED (incl. GST)</span>
              <span className="mono text-sm text-phosphor">{fmtMYR(kpis.revenueBilledMYR)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="mono text-[10.5px] tracking-widest text-steel">GST @ 6%</span>
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
        </Panel>
      </div>
    </div>
  );
}
