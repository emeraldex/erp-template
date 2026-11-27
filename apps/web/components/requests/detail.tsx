"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api, fetchBlob } from "@/lib/api";
import type { Asset, ServiceRequest } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, Panel, StatusPill } from "@/components/ui";

export const REQUEST_TONE = { NEW: "warn", ACCEPTED: "good", DECLINED: "neutral", CANCELLED: "neutral" } as const;
export const SOURCE_LABEL = { PORTAL: "Portal", POSTER: "QR poster", STAFF: "Logged by staff" } as const;
const field = "mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");

/** One request: what was reported, by whom, photos, duplicates, and the triage actions. */
export function RequestDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { dict, label, modules, terms, lang } = useVocab();
  const [r, setR] = useState<ServiceRequest | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"accept" | "merge" | "decline" | null>(null);
  const [accept, setAccept] = useState({ assetId: "", category: "", site: "", jobType: "", component: "", assetDown: false });
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [mergeJob, setMergeJob] = useState("");
  const [decline, setDecline] = useState({ reason: "", spam: false });
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const name = (e: { label: string; labelMs: string }) => (lang === "ms" && e.labelMs ? e.labelMs : e.label);

  const load = useCallback(() => {
    api.get<ServiceRequest>(`/requests/${encodeURIComponent(id)}`).then((x) => {
      setR(x);
      setAccept({ assetId: x.asset?.id ?? "", category: x.category, site: x.site, jobType: "", component: "", assetDown: false });
    }).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [id]);
  useEffect(() => { setR(null); setMsg(null); setMode(null); setMessage(""); load(); }, [load]);
  useEffect(() => { if (mode === "accept" && modules.assets && !assets) api.get<Asset[]>("/assets").then(setAssets).catch(() => setAssets([])); }, [mode, modules.assets, assets]);

  async function run(fn: () => Promise<ServiceRequest>, ok: string) {
    setBusy(true); setMsg(null);
    try {
      setR(await fn());
      setMsg({ ok: true, text: ok });
      setMode(null);
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  if (!r) return <Panel className="p-5"><p className="eyebrow">{msg?.text ?? "LOADING…"}</p></Panel>;
  const open = r.status === "NEW";
  const canMessage = r.status === "NEW" || r.status === "ACCEPTED";

  return (
    <Panel ticked className="fade-up p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="mono text-xs text-trace">{r.id} · {SOURCE_LABEL[r.source]} · {when(r.createdAt)}</p>
          <h2 className="display text-xl font-bold">{r.place || r.asset?.name || r.siteLabel || "Request"}</h2>
          <p className="mono text-[10.5px] text-steel">{[r.asset && `${r.asset.tag} · ${r.asset.name}`, r.siteLabel, r.categoryLabel].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill value={r.merged ? "ADDED TO WORK" : r.spam ? "SPAM" : r.status} tone={REQUEST_TONE[r.status]} />
          {r.urgent && <StatusPill value="URGENT" tone="bad" />}
        </div>
      </div>

      <p className="whitespace-pre-line text-base text-fg">{r.description}</p>
      <PhotoStrip ids={r.photoIds} />

      <div className="mt-4 rounded border hairline bg-ink-deep/40 px-3 py-2 text-sm">
        <p className="text-fg">{r.requesterName}<span className="mono ml-2 text-[10px] text-dim">{r.lang === "ms" ? "BM" : "EN"}</span></p>
        <p className="mono text-xs text-steel">
          {r.requesterEmail && <a href={`mailto:${r.requesterEmail}`} className="text-trace hover:underline">{r.requesterEmail}</a>}
          {r.requesterEmail && r.requesterPhone && " · "}
          {r.requesterPhone && <a href={`tel:${r.requesterPhone.replace(/[^+0-9]/g, "")}`} className="text-trace hover:underline">{r.requesterPhone}</a>}
          {!r.requesterEmail && !r.requesterPhone && "no contact details"}
        </p>
        {r.trackLink && (
          <p className="mt-1 mono text-[10.5px] text-dim">
            Their tracking link: <button onClick={() => { void navigator.clipboard?.writeText(r.trackLink!).then(() => setCopied(true)); }} className="text-steel hover:text-trace">{copied ? "COPIED" : "COPY"}</button>
            {!r.requesterEmail && " — read it out or text it to them; they have no email updates"}
          </p>
        )}
      </div>

      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}

      {r.jobId && (
        <p className="mt-3 text-sm">
          {r.merged ? "Added to" : "Became"} <Link href={`/jobs/${r.jobId}`} className="mono text-trace hover:underline">{r.jobId}</Link>
          {r.decidedBy && <span className="mono ml-2 text-[10.5px] text-dim">by {r.decidedBy} · {r.decidedAt && when(r.decidedAt)}</span>}
        </p>
      )}
      {r.status === "DECLINED" && <p className="mt-3 text-sm text-steel">Declined{r.decidedBy ? ` by ${r.decidedBy}` : ""}: {r.declineReason}</p>}
      {r.status === "CANCELLED" && <p className="mt-3 text-sm text-steel">Cancelled by the requester.</p>}
      {r.rating !== null && (
        <p className="mt-2 text-sm"><span className="text-amber">{"★".repeat(r.rating)}</span><span className="text-dim">{"★".repeat(5 - r.rating)}</span> {r.ratingComment && <span className="text-steel">“{r.ratingComment}”</span>}</p>
      )}

      {open && (r.duplicates.jobs.length > 0 || r.duplicates.requests.length > 0) && (
        <div className="mt-4 rounded border border-amber/40 bg-amber/5 px-3 py-2">
          <p className="eyebrow mb-1 text-amber">Possibly already reported</p>
          {r.duplicates.jobs.map((j) => (
            <p key={j.id} className="flex items-center justify-between gap-2 text-sm">
              <span><Link href={`/jobs/${j.id}`} className="mono text-xs text-trace hover:underline">{j.id}</Link> {j.component} <span className="mono text-[10px] text-dim">{label("status:JOB", j.status)}</span></span>
              <button disabled={busy} onClick={() => run(() => api.post<ServiceRequest>(`/requests/${r.id}/merge`, { jobId: j.id }), `Added to ${j.id}; the requester has been told.`)} className="mono shrink-0 text-[10.5px] tracking-widest text-steel hover:text-trace">ADD TO THIS</button>
            </p>
          ))}
          {r.duplicates.requests.map((d) => (
            <p key={d.id} className="text-sm text-steel"><Link href={`/requests?id=${d.id}`} className="mono text-xs text-trace hover:underline">{d.id}</Link> {d.description}</p>
          ))}
        </div>
      )}

      {open && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {([["accept", `Accept → new ${terms.job.toLowerCase()}`], ["merge", `Add to a ${terms.job.toLowerCase()}`], ["decline", "Decline"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setMode(mode === k ? null : k)}
                className={`mono rounded-md border px-2.5 py-1.5 text-[10.5px] tracking-widest ${mode === k ? "border-trace bg-trace/10 text-trace" : "hairline text-steel hover:text-fg"}`}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          {mode === "accept" && (
            <div className="mt-3 grid gap-2 rounded border hairline bg-ink-deep/40 p-3 sm:grid-cols-2">
              {modules.assets && (
                <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">{terms.asset} (optional)</span>
                  <select value={accept.assetId} onChange={(e) => setAccept({ ...accept, assetId: e.target.value })} className={field}>
                    <option value="">— none: use the place —</option>
                    {(assets ?? []).filter((a) => a.status !== "RETIRED").map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name} · {label("site", a.site)}</option>)}
                  </select>
                  {accept.assetId && (
                    <span className="mt-2 flex items-center gap-2 text-sm text-fg">
                      <input type="checkbox" checked={accept.assetDown} onChange={(e) => setAccept({ ...accept, assetDown: e.target.checked })} className="accent-[var(--c-red)]" />
                      Out of action — record downtime until the work is done
                    </span>
                  )}
                </label>
              )}
              {!accept.assetId && (
                <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">What is worked on</span>
                  <input value={accept.component} onChange={(e) => setAccept({ ...accept, component: e.target.value })} placeholder={r.place || r.description.slice(0, 60)} className={field} />
                </label>
              )}
              <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Category</span>
                <select value={accept.category} onChange={(e) => setAccept({ ...accept, category: e.target.value })} className={field}>
                  <option value="">—</option>
                  {dict("category").map((c) => <option key={c.key} value={c.key}>{name(c)}</option>)}
                </select>
              </label>
              {!accept.assetId && (
                <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">{terms.site}</span>
                  <select value={accept.site} onChange={(e) => setAccept({ ...accept, site: e.target.value })} className={field}>
                    <option value="">—</option>
                    {dict("site").map((s) => <option key={s.key} value={s.key}>{name(s)}</option>)}
                  </select>
                </label>
              )}
              {dict("jobType").length > 0 && (
                <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Type of work</span>
                  <select value={accept.jobType} onChange={(e) => setAccept({ ...accept, jobType: e.target.value })} className={field}>
                    <option value="">Default</option>
                    {dict("jobType").map((j) => <option key={j.key} value={j.key}>{name(j)}</option>)}
                  </select>
                </label>
              )}
              <div className="sm:col-span-2">
                <Button disabled={busy || !accept.category || (!accept.assetId && !accept.site)} onClick={() => run(
                  () => api.post<ServiceRequest>(`/requests/${r.id}/accept`, Object.fromEntries(Object.entries(accept).filter(([, v]) => v))),
                  "Accepted — the work order is registered and the requester has been told.",
                )}>Accept and register</Button>
              </div>
            </div>
          )}
          {mode === "merge" && (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded border hairline bg-ink-deep/40 p-3">
              <label className="block flex-1"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">{terms.job} number (open)</span>
                <input value={mergeJob} onChange={(e) => setMergeJob(e.target.value.toUpperCase().trim())} placeholder="HD-2026-0001" className={field} />
              </label>
              <Button disabled={busy || !mergeJob} onClick={() => run(() => api.post<ServiceRequest>(`/requests/${r.id}/merge`, { jobId: mergeJob }), `Added to ${mergeJob}; the requester has been told.`)}>Add</Button>
            </div>
          )}
          {mode === "decline" && (
            <div className="mt-3 space-y-2 rounded border hairline bg-ink-deep/40 p-3">
              <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Reason — the requester sees this</span>
                <textarea rows={2} value={decline.reason} onChange={(e) => setDecline({ ...decline, reason: e.target.value })} placeholder="e.g. This is the landlord's responsibility — please call building management on …" className={field} />
              </label>
              <label className="flex items-center gap-2 text-sm text-steel">
                <input type="checkbox" checked={decline.spam} onChange={(e) => setDecline({ ...decline, spam: e.target.checked })} />
                Spam or abuse — delete the photos and contact details, send nothing
              </label>
              <Button variant="danger" disabled={busy || (!decline.spam && !decline.reason.trim())} onClick={() => run(() => api.post<ServiceRequest>(`/requests/${r.id}/decline`, decline), decline.spam ? "Removed as spam." : "Declined — the requester has been told why.")}>Decline</Button>
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        <p className="eyebrow mb-2">Messages with the requester</p>
        {r.messages.length === 0 && <p className="text-sm text-dim">None yet.</p>}
        <ul className="space-y-1.5">
          {r.messages.map((m, i) => (
            <li key={i} className={`rounded px-3 py-2 text-sm ${m.from === "TEAM" ? "border hairline bg-panel-2/40" : "bg-trace/10"}`}>
              <p className="mono text-[10px] text-dim">{m.from === "TEAM" ? `${m.by} (team)` : m.by} · {when(m.at)}</p>
              <p className="whitespace-pre-line text-fg">{m.body}</p>
            </li>
          ))}
        </ul>
        {canMessage && (
          <div className="mt-2 flex gap-2">
            <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask a question or give an update — they see it as from your organisation" className={field} />
            <Button disabled={busy || message.trim().length < 2} onClick={() => run(async () => { const x = await api.post<ServiceRequest>(`/requests/${r.id}/messages`, { body: message.trim() }); setMessage(""); return x; }, r.requesterEmail ? "Sent — they have been emailed." : "Sent — they will see it on their tracking page.")}>Send</Button>
          </div>
        )}
      </div>

      {!open && (r.requesterEmail || r.requesterPhone) && (
        <div className="mt-4 border-t hairline pt-3">
          <Button variant="ghost" disabled={busy} onClick={() => { if (window.confirm("Erase this requester's name, email and phone? Their tracking link stops working. This cannot be undone.")) void run(() => api.post<ServiceRequest>(`/requests/${r.id}/erase`, {}), "Contact details erased."); }}>Erase contact details</Button>
        </div>
      )}
    </Panel>
  );
}

/** Thumbnails of the requester's photos, fetched with the staff session. */
function PhotoStrip({ ids }: { ids: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    const made: string[] = [];
    for (const id of ids) {
      fetchBlob(`/attachments/file/${id}`).then((b) => {
        const u = URL.createObjectURL(b);
        made.push(u);
        if (live) setUrls((x) => ({ ...x, [id]: u }));
      }).catch(() => {});
    }
    return () => { live = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [ids.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ids.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {ids.map((id) => (
        <a key={id} href={urls[id]} target="_blank" rel="noreferrer" className="block h-24 w-24 overflow-hidden rounded border hairline bg-ink-deep">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {urls[id] && <img src={urls[id]} alt="Photo from the requester" className="h-full w-full object-cover" />}
        </a>
      ))}
    </div>
  );
}
