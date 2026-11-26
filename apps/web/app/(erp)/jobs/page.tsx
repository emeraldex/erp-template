"use client";

import { useSession } from "@/lib/use-session";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, download, getWithFallback } from "@/lib/api";
import { Asset, Job, JobStatus } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, MetaPill, OfflineNotice, PageHeader, Table, Td, Tr } from "@/components/ui";

const input = "mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";

export default function JobsPage() {
  const router = useRouter();
  const { cfg, terms, modules, dict, label, can, ref, aviation } = useVocab();
  const { lang, t } = useLang();
  const [rows, setRows] = useState<Job[]>([]);
  const [offline, setOffline] = useState(false);
  const [filter, setFilter] = useState<JobStatus | "ALL">("ALL");
  const [onlyMine, setOnlyMine] = useState(false);
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    component: "", partNo: "", serialNo: "", category: "", originUnit: "", repairUnit: "", assetId: "", jobType: "",
  });
  const [assets, setAssets] = useState<Asset[]>([]);

  const me = useSession()?.user.id;
  const canRegister = can("jobs.register");
  // Aviation screens stay as they were unless the organisation starts assigning work.
  const showAssignee = !aviation || rows.some((j) => j.assigneeId);
  // The organisation's lists, with sensible first choices.
  const categories = dict("category");
  const sites = dict("site");
  const jobTypes = dict("jobType");
  const asset = assets.find((a) => a.id === form.assetId);
  useEffect(() => {
    if (showNew && modules.assets && !assets.length) api.get<Asset[]>("/assets").then(setAssets).catch(() => { /* register without an asset */ });
  }, [showNew, modules.assets, assets.length]);

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
          (!onlyMine || j.assigneeId === me) &&
          (q === "" ||
            `${j.id} ${j.component} ${j.partNo} ${j.serialNo} ${j.originUnit} ${j.repairUnit}`
              .toLowerCase()
              .includes(q.toLowerCase())),
      ),
    [rows, filter, q, onlyMine, me],
  );

  async function register() {
    setError(null);
    try {
      const body = Object.fromEntries(Object.entries({
        ...form,
        category: form.category || categories[0]?.key || "",
        repairUnit: form.repairUnit || asset?.site || sites[0]?.key || "",
      }).filter(([, v]) => v !== ""));
      const job = await api.post<Job>("/jobs", body);
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
        eyebrow={aviation ? "QP.44 · Job Tracking System" : `${terms.jobs} · ${cfg?.pack?.name ?? ""}`}
        title={aviation ? t("jobs") : terms.jobRegister}
        actions={
          <>
            {filtered.length > 0 && (
              <Button variant="ghost" onClick={() => download(`/job-cards?ids=${filtered.slice(0, 100).map((j) => encodeURIComponent(j.id)).join(",")}`, "job-cards.pdf").catch((e) => setError((e as Error).message))}>
                Print cards ({Math.min(filtered.length, 100)})
              </Button>
            )}
            <label className="mono flex cursor-pointer items-center gap-2 text-[10.5px] tracking-widest text-steel">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} className="accent-[var(--c-red)]" />
              SHOW ARCHIVED
            </label>
            {canRegister && (
              <Button onClick={() => setShowNew(!showNew)} variant={showNew ? "ghost" : "primary"}>
                {showNew ? "Cancel" : `+ Register ${terms.job.toLowerCase()}`}
              </Button>
            )}
          </>
        }
      />

      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      {showNew && (
        <div className="panel ticked fade-up mb-6 p-5">
          <p className="eyebrow mb-3">{aviation ? "Stage 1 — register job · receiving inspection per QP.20 · owner: Logistic (StS/StP)" : `New ${terms.job.toLowerCase()} — starts at ${cfg ? label("status:JOB", Object.keys(cfg.jobStatusMeta)[0]) : "the first status"}`}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {modules.assets && (
              <label className="block sm:col-span-3">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{terms.asset} (optional — fills in the details below)</span>
                <select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })} className={input}>
                  <option value="">— not in the register —</option>
                  {assets.filter((a) => a.status !== "RETIRED").map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name} · {label("site", a.site)}</option>)}
                </select>
              </label>
            )}
            {(
              [
                ["component", terms.component, asset?.name],
                ["partNo", aviation ? "Part number" : "Make / model", asset?.model],
                ["serialNo", aviation ? "Serial number" : "Serial / tag", asset?.tag],
                ["originUnit", terms.originUnit, undefined],
              ] as const
            ).map(([k, text, fromAsset]) => (
              <label key={k} className="block">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{text}{fromAsset === undefined ? " *" : ""}</span>
                <input
                  value={form[k]}
                  placeholder={fromAsset ?? ""}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  className={input}
                />
              </label>
            ))}
            {categories.length > 0 && (
              <label className="block">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Category{ref(" (QP.17 / QP.17A)")}</span>
                <select value={form.category || categories[0].key} onChange={(e) => setForm({ ...form, category: e.target.value })} className={input}>
                  {categories.map((c) => <option key={c.key} value={c.key}>{lang === "ms" && c.labelMs ? c.labelMs : c.label}</option>)}
                </select>
              </label>
            )}
            {jobTypes.length > 0 && (
              <label className="block">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Type of work</span>
                <select value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })} className={input}>
                  <option value="">{label("jobType", "CORRECTIVE")}</option>
                  {jobTypes.filter((j) => j.key !== "CORRECTIVE").map((j) => <option key={j.key} value={j.key}>{lang === "ms" && j.labelMs ? j.labelMs : j.label}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{aviation ? "Repair unit / branch" : terms.site}</span>
              <select value={form.repairUnit || asset?.site || sites[0]?.key || ""} onChange={(e) => setForm({ ...form, repairUnit: e.target.value })} className={input}>
                {sites.map((b) => <option key={b.key} value={b.key}>{aviation ? b.key : b.label}</option>)}
              </select>
            </label>
          </div>
          <div className="mt-4">
            <Button
              disabled={!form.originUnit || (!asset && (!form.component || !form.partNo || !form.serialNo))}
              onClick={register}
            >
              Register — assign {terms.jobNo.replace(/\.$/, "")}
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
        {showAssignee && (
          <button
            onClick={() => setOnlyMine(!onlyMine)}
            className={`mono rounded-full border px-3 py-1 text-[10.5px] tracking-widest transition-colors ${
              onlyMine ? "border-trace bg-trace/15 text-fg" : "hairline text-steel hover:border-steel/50 hover:text-fg"
            }`}
          >
            MINE
          </button>
        )}
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
        <EmptyState title={`No ${terms.jobs.toLowerCase()} match`} hint="Adjust the status filter or clear the search." />
      ) : (
        <div className="panel fade-up d2">
          <Table head={[aviation ? "PS / Job" : terms.jobNo, terms.component, aviation ? "Part / Serial" : "Model / Tag", "Cat", terms.originUnit, terms.site, ...(showAssignee ? ["Assigned to"] : []), t("status"), t("location"), "Days"]}>
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
                <Td className="mono text-xs text-steel">{aviation ? (j.category === "MILITARY" ? "MIL" : j.category) : label("category", j.category)}</Td>
                <Td className="mono text-xs text-steel">{j.originUnit}</Td>
                <Td className="mono text-xs text-steel">{aviation ? j.repairUnit : label("site", j.repairUnit)}</Td>
                {showAssignee && <Td className="text-xs text-steel">{j.assigneeName ?? <span className="text-dim">—</span>}</Td>}
                <Td><MetaPill status={j.status} meta={cfg?.jobStatusMeta?.[j.status]} lang={lang} /></Td>
                <Td className="mono text-xs text-steel">{aviation ? j.location : label("location", j.location)}</Td>
                <Td className="mono text-xs tabular-nums text-steel">{daysIn(j.statusSince)}</Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
