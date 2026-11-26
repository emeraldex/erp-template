"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MHeader, Notice } from "@/components/m/ui";
import { useM } from "@/lib/m-text";
import { useField, type MyWork, type WorkCard } from "@/lib/offline/field";
import { useVocab } from "@/lib/vocab";

/** My work: assigned to me, and free work at my site that my role can take. */
export default function MyWorkPage() {
  const f = useField();
  const m = useM();
  const { terms, label } = useVocab();
  const [tab, setTab] = useState<"mine" | "available">("mine");
  const [data, setData] = useState<MyWork | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await f.loadMyWork();
      setData(r.data); setFromCache(r.fromCache);
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, [f.loadMyWork]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (f.ready) void load(); }, [f.ready, load]);

  const list = data?.[tab] ?? [];
  const pending = (id: string) => f.outbox.filter((i) => i.jobId === id).length;

  return (
    <div>
      <MHeader title={m("myWork")} />
      <div className="sticky top-[57px] z-10 grid grid-cols-2 gap-2 border-b hairline bg-ink/95 px-4 py-2.5 backdrop-blur">
        {(["mine", "available"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`min-h-[44px] rounded-lg border text-base ${tab === t ? "border-brand bg-brand/20 text-fg" : "hairline text-steel"}`}>
            {m(t)} {data ? `(${data[t].length})` : ""}
          </button>
        ))}
      </div>
      {fromCache && <Notice>{data ? m("savedCopy") : m("noCopy")}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {loading && !data && <p className="px-4 py-10 text-center text-steel">{m("loading")}</p>}
      {data && list.length === 0 && (
        <p className="px-4 py-12 text-center text-steel">{tab === "mine" ? m("nothingMine") : m("nothingAvailable")}</p>
      )}
      <ul className="space-y-3 px-4 py-4">
        {list.map((c) => <Card key={c.id} c={c} pending={pending(c.id)} siteLabel={label("site", c.site)} locationLabel={label("location", c.location)} jobWord={terms.job} />)}
      </ul>
      {data && (
        <div className="px-4 pb-6">
          <button onClick={() => void load()} disabled={loading} className="min-h-[44px] w-full rounded-lg border hairline text-steel disabled:opacity-50">
            {loading ? m("loading") : m("refresh")}
          </button>
        </div>
      )}
    </div>
  );
}

function Card({ c, pending, siteLabel, locationLabel, jobWord }: { c: WorkCard; pending: number; siteLabel: string; locationLabel: string; jobWord: string }) {
  const m = useM();
  const overdue = c.sla && c.sla.overdueBy > 0;
  return (
    <li>
      <Link href={`/m/job?id=${encodeURIComponent(c.id)}`}
        className={`block rounded-xl border bg-panel/70 p-4 active:bg-panel-2 ${c.priority ? "border-brand-bright/60" : overdue ? "border-amber/50" : "hairline"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="mono text-sm text-trace">{c.id}</p>
            <p className="mt-0.5 truncate text-lg font-semibold text-fg">{c.component}</p>
            <p className="truncate text-sm text-steel">{[c.asset?.tag ?? c.serialNo, siteLabel, locationLabel].filter(Boolean).join(" · ")}</p>
          </div>
          <span className="shrink-0 rounded-full border hairline px-2.5 py-1 text-xs text-steel">{c.statusLabel}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {c.priority && <span className="rounded-full bg-brand-bright/15 px-2.5 py-1 text-brand-bright">{c.priority}</span>}
          {overdue && <span className="rounded-full bg-amber/15 px-2.5 py-1 text-amber">{c.sla!.overdueBy}d {m("overdue")}</span>}
          {c.checklist.total > 0 && (
            <span className="rounded-full bg-ink-deep px-2.5 py-1 text-steel">☑ {c.checklist.done}/{c.checklist.total}</span>
          )}
          {pending > 0 && <span className="rounded-full bg-amber/15 px-2.5 py-1 text-amber">↑ {pending} {m("waitingToSend")}</span>}
          {!c.assignee && <span className="rounded-full bg-trace/15 px-2.5 py-1 text-trace">{jobWord} · {m("pickUp")}</span>}
        </div>
      </Link>
    </li>
  );
}
