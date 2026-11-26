"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { JobRequester } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button } from "@/components/ui";

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** On a work order: who reported it through the portal, how to reach them, messages and their rating. */
export function JobRequesters({ jobId }: { jobId: string }) {
  const { can } = useVocab();
  const [rows, setRows] = useState<JobRequester[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canMessage = can("requests.manage");
  const load = useCallback(() => { api.get<JobRequester[]>(`/jobs/${encodeURIComponent(jobId)}/requests`).then(setRows).catch(() => setRows([])); }, [jobId]);
  useEffect(() => { load(); }, [load]);

  async function send(id: string) {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/requests/${id}/messages`, { body: draft[id].trim() });
      setDraft({ ...draft, [id]: "" });
      setMsg({ ok: true, text: "Sent to the requester." });
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  if (!rows?.length) return null;
  return (
    <div>
      <p className="eyebrow mb-2">Requester{rows.length > 1 ? `s (${rows.length})` : ""}</p>
      {msg && <p className={`mb-2 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded border hairline bg-ink-deep/40 px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm text-fg">
                {r.requesterName}
                {r.urgent && <span className="mono ml-2 text-[10px] text-brand-bright">URGENT</span>}
                <span className="mono ml-2 text-[10.5px] text-steel">
                  {r.requesterPhone && <a href={`tel:${r.requesterPhone.replace(/[^+0-9]/g, "")}`} className="text-trace hover:underline">{r.requesterPhone}</a>}
                  {r.requesterPhone && r.requesterEmail && " · "}
                  {r.requesterEmail && <a href={`mailto:${r.requesterEmail}`} className="text-trace hover:underline">{r.requesterEmail}</a>}
                </span>
              </p>
              {canMessage
                ? <Link href={`/requests?tab=ALL&id=${r.id}`} className="mono text-[10.5px] text-trace hover:underline">{r.id}</Link>
                : <span className="mono text-[10.5px] text-dim">{r.id}</span>}
            </div>
            {r.rating !== null && (
              <p className="mt-1 text-sm"><span className="text-amber">{"★".repeat(r.rating)}</span><span className="text-dim">{"★".repeat(5 - r.rating)}</span> {r.ratingComment && <span className="text-steel">“{r.ratingComment}”</span>}</p>
            )}
            {r.doneNotified && r.rating === null && <p className="mono mt-1 text-[10.5px] text-dim">Told the work is done — no rating yet</p>}
            {r.messages.length > 0 && (
              <ul className="mt-2 space-y-1">
                {r.messages.map((m, i) => (
                  <li key={i} className="text-sm"><span className="mono text-[10px] text-dim">{m.from === "TEAM" ? `${m.by} (team)` : m.by} · {when(m.at)}</span> <span className="text-fg">{m.body}</span></li>
                ))}
              </ul>
            )}
            {canMessage && (
              <div className="mt-2 flex gap-2">
                <input value={draft[r.id] ?? ""} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} placeholder="Message the requester…" className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-1.5 text-xs text-fg outline-none focus:border-trace" />
                <Button variant="ghost" disabled={busy || (draft[r.id] ?? "").trim().length < 2} onClick={() => send(r.id)}>Send</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
