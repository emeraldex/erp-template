"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useField } from "@/lib/offline/field";
import type { JobRequester } from "@/lib/types";

/**
 * Who reported this work through the request portal, with a number to call.
 * Fetched when online and kept on the phone for when the signal drops.
 */
export function PhoneRequester({ jobId, title }: { jobId: string; title: string }) {
  const f = useField();
  const [rows, setRows] = useState<JobRequester[]>([]);
  useEffect(() => {
    if (!f.db) return;
    const key = `requesters:${jobId}`;
    let live = true;
    f.db.get<JobRequester[]>(key).then((cached) => { if (live && cached) setRows(cached); }).catch(() => {});
    if (f.online) {
      api.get<JobRequester[]>(`/jobs/${encodeURIComponent(jobId)}/requests`)
        .then(async (r) => { if (live) setRows(r); await f.db?.set(key, r); })
        .catch(() => {});
    }
    return () => { live = false; };
  }, [jobId, f.db, f.online]);
  if (!rows.length) return null;
  return (
    <div className="border-b hairline px-4 py-4">
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base text-fg">{r.requesterName}{r.urgent && <span className="ml-2 text-xs text-brand-bright">URGENT</span>}</p>
              <p className="line-clamp-2 text-sm text-steel">{r.description}</p>
            </div>
            {r.requesterPhone && (
              <a href={`tel:${r.requesterPhone.replace(/[^+0-9]/g, "")}`} className="shrink-0 rounded-lg border border-trace/50 px-4 py-3 text-base text-trace" aria-label={`Call ${r.requesterName}`}>📞 {r.requesterPhone}</a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
