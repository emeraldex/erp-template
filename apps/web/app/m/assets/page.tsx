"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MHeader, Notice } from "@/components/m/ui";
import { api, ApiError } from "@/lib/api";
import { useM } from "@/lib/m-text";
import { useField } from "@/lib/offline/field";
import type { Asset } from "@/lib/types";
import { useVocab } from "@/lib/vocab";

/** Find an asset by tag or name (or point the phone's camera at its label). */
export default function AssetsScreen() {
  const f = useField();
  const m = useM();
  const { terms, label, modules } = useVocab();
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [q, setQ] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!f.db) return;
    api.get<Asset[]>("/assets").then(async (data) => {
      setRows(data); setFromCache(false);
      await f.db!.set("assets", data);
    }).catch(async (e) => {
      if (e instanceof ApiError && e.status !== 0) { setError(e.message); return; }
      setRows((await f.db!.get<Asset[]>("assets")) ?? []); setFromCache(true);
    });
  }, [f.db]);

  const shown = useMemo(() => (rows ?? []).filter((a) => !q || `${a.tag} ${a.name} ${a.location}`.toLowerCase().includes(q.toLowerCase())).slice(0, 100), [rows, q]);

  return (
    <div>
      <MHeader title={terms.assets} />
      {!modules.assets && <Notice>{terms.assets}: off</Notice>}
      {fromCache && <Notice>{m("savedCopy")}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      <div className="px-4 py-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={m("search")} type="search"
          className="min-h-[48px] w-full rounded-lg border hairline bg-ink-deep px-3 text-base outline-none focus:border-trace" />
      </div>
      <ul className="space-y-2 px-4 pb-4">
        {shown.map((a) => (
          <li key={a.id}>
            <Link href={`/m/asset?id=${encodeURIComponent(a.id)}`} className="block rounded-xl border hairline bg-panel/60 px-4 py-3">
              <p className="mono text-sm text-trace">{a.tag}</p>
              <p className="text-base text-fg">{a.name}</p>
              <p className="text-sm text-steel">{label("site", a.site)}{a.openJobs ? ` · ${a.openJobs} open` : ""}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
