"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getWithFallback } from "@/lib/api";
import { Branch, Job, JobStatus } from "@/lib/types";
import { useConfig } from "@/lib/use-config";
import { useLang } from "@/lib/i18n";
import { Button, EmptyState, MetaPill, OfflineNotice, PageHeader, Table, Td, Tr } from "@/components/ui";

const BRANCHES: Branch[] = ["HQ", "CENTRAL", "EAST", "NORTH", "NORTHEAST", "OFFSHORE"];

export default function JobsPage() {
  const router = useRouter();
  const cfg = useConfig();
  const { lang, t } = useLang();
  const [rows, setRows] = useState<Job[]>([]);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<JobStatus | "ALL">("ALL");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    component: "", partNo: "", serialNo: "",
    category: "MILITARY" as "MILITARY" | "NAS",
    originUnit: "", repairUnit: "CENTRAL" as Branch,
  });

  const role = useSession()?.user.role;
  const canRegister = role === "STORES" || role === "ADMIN";

  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    getWithFallback<Job[]>(showArchived ? "/jobs?archived=include" : "/jobs", "jobs")
      .then((r) => { setRows(r.data); setOffline(r.offline); })
      .catch(console.error);
  }, [showArchived]);

  const statuses = (cfg ? (Object.keys(cfg.jobStatusMeta) as JobStatus[]) : []).filter((s) =>
    rows.some((j) => j.status === s),
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (j) =>
          (filter === "ALL" || j.status === filter) &&
          (q === "" ||
            `${j.id} ${j.component} ${j.partNo} ${j.serialNo} ${j.originUnit} ${j.repairUnit}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [rows, filter, q],
  );

  async function register() {
    setError(null);
    try {
      const job = await api.post<Job>("/jobs", form);
      setRows([job, ...rows]);
      setShowNew(false);
      router.push(`/jobs/${job.id}`);
    } catch (e) {
      setError(offline ? "Registering needs the live API — start apps/api." : (e as Error).message);
    }
  }

  const daysIn = (since: string) => Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000);

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader
        eyebrow="QP.44 · Job Tracking System"
        title={t("jobs")}
        actions={
          <>
            <label className="mono flex cursor-pointer items-center gap-2 text-[10.5px] tracking-widest text-steel">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[var(--c-red)]" />
              SHOW ARCHIVED
            </label>
            {canRegister && (
              <Button onClick={() => setShowNew(!showNew)} variant={showNew ? "ghost" : "primary"}>
                {showNew ? "Cancel" : "+ Register job"}
              </Button>
            )}
          </>
        }
      />

      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      {showNew && (
        <div className="panel ticked fade-up mb-6 p-5">
          <p className="eyebrow mb-3">Stage 1 — register job · receiving inspection per QP.20 · owner: Logistic (StS/StP)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["component", "Component description"],
                ["partNo", "Part number"],
                ["serialNo", "Serial number"],
                ["originUnit", "Origin unit (Customer)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{label} *</span>
                <input
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace"
                />
              </label>
            ))}
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Item category (QP.17 / QP.17A)</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as "MILITARY" | "NAS" })}
                className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace"
              >
                <option value="MILITARY">MILITARY</option>
                <option value="NAS">NON-AIRBORNE (NAS)</option>
              </select>
            </label>
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Repair unit / branch</span>
              <select
                value={form.repairUnit}
                onChange={(e) => setForm({ ...form, repairUnit: e.target.value as Branch })}
                className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace"
              >
                {BRANCHES.map((b) => <option key={b}>{b}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4">
            <Button
              disabled={!form.component || !form.partNo || !form.serialNo || !form.originUnit}
              onClick={register}
            >
              Register — assign PS number
            </Button>
          </div>
        </div>
      )}

      <div className="fade-up d1 mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("ALL")}
          className={`mono rounded-full border px-3 py-1 text-[10.5px] tracking-widest transition-colors ${
            filter === "ALL" ? "border-brand bg-brand/15 text-fg" : "hairline text-steel hover:border-steel/50 hover:text-fg"
          }`}
        >
          ALL
        </button>
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`mono rounded-full border px-3 py-1 text-[10.5px] tracking-widest transition-colors ${
              filter === s ? "border-brand bg-brand/15 text-fg" : "hairline text-steel hover:border-steel/50 hover:text-fg"
            }`}
          >
            {cfg?.jobStatusMeta[s][lang] ?? s}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search")}
          className="mono ml-auto w-64 rounded-md border hairline bg-ink-deep px-3 py-1.5 text-xs text-fg outline-none transition-colors focus:border-trace"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No jobs match" hint="Adjust the status filter or clear the search." />
      ) : (
        <div className="panel fade-up d2">
          <Table head={["PS / Job", "Component", "Part / Serial", "Cat", "Origin unit", "Branch", t("status"), t("location"), "Days"]}>
            {filtered.map((j) => (
              <Tr key={j.id} onClick={() => router.push(`/jobs/${j.id}`)}>
                <Td className="mono text-xs text-trace">
                  {j.id}
                  {j.archivedAt && <span className="ml-2 rounded border border-steel/40 px-1.5 py-0.5 text-[9px] tracking-widest text-steel">ARCHIVED</span>}
                </Td>
                <Td>
                  {j.component}
                  {j.priority?.state === "OPEN" && (
                    <span className="mono ml-2 rounded border border-brand-bright/50 bg-brand-bright/10 px-1.5 py-0.5 text-[9px] tracking-widest text-brand-bright pulse-aog">
                      {j.priority.type}{j.priority.suffixK ? " · K" : ""}
                    </span>
                  )}
                </Td>
                <Td className="mono text-xs text-steel">{j.partNo} · {j.serialNo}</Td>
                <Td className="mono text-xs text-steel">{j.category === "MILITARY" ? "MIL" : "NAS"}</Td>
                <Td className="mono text-xs text-steel">{j.originUnit}</Td>
                <Td className="mono text-xs text-steel">{j.repairUnit}</Td>
                <Td><MetaPill status={j.status} meta={cfg?.jobStatusMeta?.[j.status]} lang={lang} /></Td>
                <Td className="mono text-xs text-steel">{j.location}</Td>
                <Td className="mono text-xs tabular-nums text-steel">{daysIn(j.statusSince)}</Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
