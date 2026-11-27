"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { BigButton, MHeader, Notice, Section } from "@/components/m/ui";
import { api, ApiError } from "@/lib/api";
import { useM } from "@/lib/m-text";
import { useField } from "@/lib/offline/field";
import type { Asset, Job } from "@/lib/types";
import { useVocab } from "@/lib/vocab";

export default function AssetScreen() {
  return (
    <Suspense fallback={null}>
      <AssetView />
    </Suspense>
  );
}

/** One asset on the phone: meters, open work, next maintenance, history, and "report a problem". */
function AssetView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const f = useField();
  const m = useM();
  const { cfg, terms, label, dict, can } = useVocab();
  const [a, setA] = useState<Asset | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [form, setForm] = useState({ problem: "", originUnit: "", category: "", assetDown: false });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id || !f.db) return;
    try {
      const data = await api.get<Asset>(`/assets/${encodeURIComponent(id)}`);
      await f.db.set(`asset:${id}`, data);
      setA(data); setFromCache(false);
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0) { setError(e.message); return; }
      setA((await f.db.get<Asset>(`asset:${id}`)) ?? null); setFromCache(true);
    }
  }, [id, f.db]);
  useEffect(() => { void load(); }, [load]);

  async function submitReport() {
    setBusy(true); setError(null);
    try {
      const job = await api.post<Job>("/jobs", {
        assetId: id, originUnit: form.originUnit || "Reported from phone",
        category: form.category || dict("category")[0]?.key || "",
        ...(form.assetDown ? { assetDown: true } : {}),
      });
      if (form.problem.trim()) await api.post(`/jobs/${encodeURIComponent(job.id)}/notes`, { text: form.problem.trim() });
      router.push(`/m/job?id=${encodeURIComponent(job.id)}`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!a) {
    return (
      <div>
        <MHeader title={terms.asset} back />
        {error ? <Notice tone="bad">{error}</Notice> : fromCache ? <Notice>{m("noCopy")}</Notice> : <p className="px-4 py-10 text-center text-steel">{m("loading")}</p>}
      </div>
    );
  }
  const schedules = Array.isArray(a.schedules) ? a.schedules : [];
  const jobs = a.jobs ?? [];
  const final = (s: string) => !!cfg?.jobStatusMeta?.[s]?.final;
  const open = jobs.filter((j) => !final(j.status));

  return (
    <div>
      <MHeader title={a.tag} back />
      {fromCache && <Notice>{m("savedCopy")}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="border-b hairline px-4 py-4">
        <p className="text-xl font-semibold">{a.name}</p>
        <p className="text-sm text-steel">{[label("assetType", a.type), label("site", a.site), a.location].filter(Boolean).join(" · ")}</p>
        <p className="text-sm text-steel">{[a.make, a.model, a.serialNo && `S/N ${a.serialNo}`].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 text-sm">{a.status.replaceAll("_", " ")} · {a.criticality}</p>
      </div>

      {can("jobs.register") && a.status !== "RETIRED" && (
        <Section title={m("reportProblem")}>
          {!report ? (
            <BigButton tone="ghost" disabled={!f.online} onClick={() => setReport(true)}>⚠ {m("reportProblem")}</BigButton>
          ) : (
            <div className="space-y-2">
              <textarea rows={3} value={form.problem} onChange={(e) => setForm({ ...form, problem: e.target.value })} placeholder={m("whatIsWrong")}
                className="w-full rounded-lg border hairline bg-ink-deep px-3 py-2 text-base outline-none focus:border-trace" />
              <input value={form.originUnit} onChange={(e) => setForm({ ...form, originUnit: e.target.value })} placeholder={m("reportedBy")}
                className="min-h-[48px] w-full rounded-lg border hairline bg-ink-deep px-3 text-base outline-none focus:border-trace" />
              {dict("category").length > 0 && (
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="min-h-[48px] w-full rounded-lg border hairline bg-ink-deep px-3 text-base">
                  {dict("category").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              )}
              <label className="flex min-h-[48px] items-center gap-3 rounded-lg border hairline bg-ink-deep px-3 text-base">
                <input type="checkbox" checked={form.assetDown} onChange={(e) => setForm({ ...form, assetDown: e.target.checked })} className="h-5 w-5 accent-[var(--c-red)]" />
                {m("outOfAction")}
              </label>
              <BigButton disabled={busy || !f.online || !form.problem.trim()} onClick={submitReport}>{m("send")}</BigButton>
            </div>
          )}
          {!f.online && <p className="mt-2 text-xs text-steel">{m("needsConnection")}</p>}
        </Section>
      )}

      {a.meters.length > 0 && (
        <Section title={m("meters")}>
          {a.meters.map((mt) => (
            <p key={mt.key} className="text-base">{mt.label}: <span className="mono">{mt.value.toLocaleString()} {mt.unit}</span>
              <span className="ml-2 text-xs text-dim">{mt.readAt?.slice(0, 10)}</span></p>
          ))}
        </Section>
      )}

      <Section title={m("openWork")}>
        {open.length === 0 ? <p className="text-sm text-steel">—</p> : (
          <ul className="space-y-2">
            {open.map((j) => (
              <li key={j.id}><Link href={`/m/job?id=${encodeURIComponent(j.id)}`} className="flex min-h-[48px] items-center justify-between rounded-lg border hairline px-3">
                <span className="mono text-trace">{j.id}</span><span className="text-sm text-steel">{label("status:JOB", j.status)}</span>
              </Link></li>
            ))}
          </ul>
        )}
      </Section>

      {schedules.length > 0 && (
        <Section title={m("nextPm")}>
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li key={s.id} className="text-sm">
                <p className="text-base text-fg">{s.title}</p>
                <p className="text-steel">{s.nextDueAt?.slice(0, 10)}{s.nextDueMeter != null ? ` · @${s.nextDueMeter}` : ""}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={m("history")}>
        <ul className="space-y-1">
          {jobs.filter((j) => final(j.status)).slice(0, 20).map((j) => (
            <li key={j.id} className="text-sm"><span className="mono text-steel">{j.id}</span> · {j.psDate} · {label("jobType", j.jobType)}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
