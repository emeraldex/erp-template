"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BigButton, MHeader, Notice, Section } from "@/components/m/ui";
import { PhoneJobParts } from "@/components/m/job-parts";
import { PhoneRequester } from "@/components/m/requester";
import { PhoneTime } from "@/components/m/time";
import { StepForm, stepComplete } from "@/components/step-form";
import { api } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useM } from "@/lib/m-text";
import { pendingFor, useField, type JobPack } from "@/lib/offline/field";
import type { ChecklistItem, Job } from "@/lib/types";
import { useSession } from "@/lib/use-session";
import { useVocab } from "@/lib/vocab";

export default function JobScreen() {
  return (
    <Suspense fallback={null}>
      <JobView />
    </Suspense>
  );
}

function JobView() {
  const id = useSearchParams().get("id") ?? "";
  const f = useField();
  const m = useM();
  const { lang } = useLang();
  const me = useSession()?.user;
  const { terms, label, modules, can } = useVocab();
  const [pack, setPack] = useState<JobPack | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ticks show at once, before the phone has finished saving them.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const r = await f.loadPack(id);
      setPack(r.data); setFromCache(r.fromCache); setTicks({});
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id, f.loadPack]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (f.ready) void load(); }, [f.ready, load]);
  // Reload once queued changes for this job have been sent.
  const pending = useMemo(() => pendingFor(f.outbox, id), [f.outbox, id]);
  const pendingCount = pending.length;
  const prev = useRef(pendingCount);
  useEffect(() => {
    if (prev.current > 0 && pendingCount === 0 && f.online) void load();
    prev.current = pendingCount;
  }, [pendingCount, f.online, load]);

  if (!id) return <Notice tone="bad">No work order given.</Notice>;
  if (!pack) {
    return (
      <div>
        <MHeader title={id} back />
        {error ? <Notice tone="bad">{error}</Notice> : fromCache ? <Notice>{m("noCopy")}</Notice> : <p className="px-4 py-10 text-center text-steel">{m("loading")}</p>}
      </div>
    );
  }

  const job = pack.job;
  const locked = pack.locked;
  // Show queued changes straight away, marked as waiting.
  const checks = applyPendingChecks(job.checklist ?? [], pending).map((c) => (c.key in ticks ? { ...c, done: ticks[c.key], pending: true } : c));
  const pendingNotes = pending.filter((p) => p.type === "note").map((p) => ({ id: p.id, text: String(p.payload.text), failed: p.state === "failed" }));
  const pendingPhotos = pending.filter((p) => p.type === "photo");
  const photos = pack.attachments.filter((a) => a.kind === "photo" || a.contentType.startsWith("image/"));
  const notes = job.audit.filter((a) => a.action.startsWith("Note: ")).reverse();
  const queue = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
  };

  async function online(fn: () => Promise<Job>, ok?: string) {
    setBusy(true); setError(null); setMsg(null);
    try {
      await fn();
      await load();
      if (ok) setMsg(ok);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <MHeader title={job.id} back />
      {fromCache && <Notice>{m("savedCopy")} ({new Date(pack.fetchedAt).toLocaleString()})</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}
      {msg && <Notice tone="good">{msg}</Notice>}

      <div className="border-b hairline px-4 py-4">
        <p className="text-xl font-semibold text-fg">{job.component}</p>
        <p className="text-sm text-steel">{[job.serialNo, label("site", job.repairUnit), label("location", job.location)].filter(Boolean).join(" · ")}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full border hairline px-3 py-1">{label("status:JOB", job.status)}</span>
          {job.priority?.state === "OPEN" && <span className="rounded-full bg-brand-bright/15 px-3 py-1 text-brand-bright">{job.priority.type}</span>}
          {job.jobType && <span className="rounded-full bg-ink-deep px-3 py-1 text-steel">{label("jobType", job.jobType)}</span>}
        </div>
        <p className="mt-3 text-sm text-steel">
          {m("assignedTo")}: <span className="text-fg">{job.assigneeName ?? m("nobody")}</span>
        </p>
        {!locked && !job.assigneeId && pack.steps.length > 0 && (
          <div className="mt-3">
            <BigButton disabled={busy || !f.online} onClick={() => online(() => api.post<Job>(`/jobs/${encodeURIComponent(job.id)}/claim`, {}), `${terms.job} ${job.id}`)}>
              {m("pickUp")}
            </BigButton>
            {!f.online && <p className="mt-1 text-xs text-steel">{m("needsConnection")}</p>}
          </div>
        )}
      </div>

      {locked && <Notice>{m("locked")}</Notice>}

      {modules.requests && <PhoneRequester jobId={job.id} title={m("requester")} />}

      {pack.pm?.instructions && (
        <Section title={m("instructions")}>
          <p className="text-sm font-medium text-fg">{pack.pm.title}</p>
          <p className="mt-1 whitespace-pre-line text-base text-steel">{pack.pm.instructions}</p>
        </Section>
      )}

      {pack.asset && (
        <Section title={terms.asset} right={<Link href={`/m/asset?id=${encodeURIComponent(pack.asset.id)}`} className="text-sm text-trace">{pack.asset.tag} ›</Link>}>
          <p className="text-base text-fg">{pack.asset.name}</p>
          <p className="text-sm text-steel">{[pack.asset.make, pack.asset.model, pack.asset.location].filter(Boolean).join(" · ")}</p>
          {pack.asset.meters.map((mt) => (
            <MeterRow key={mt.key} meter={mt} disabled={locked}
              pending={pending.filter((p) => p.type === "meter" && p.payload.key === mt.key).map((p) => ({ value: Number(p.payload.value), failed: p.state === "failed" }))}
              onRecord={(value) => queue(() => f.queue("meter", job.id, { assetId: pack.asset!.id, key: mt.key, value }))} />
          ))}
        </Section>
      )}

      {checks.length > 0 && (
        <Section title={`${m("checklist")} · ${checks.filter((c) => c.done).length}/${checks.length} ${m("checklistDone")}`}>
          <ul className="space-y-2">
            {checks.map((c) => (
              <li key={c.key}>
                <label className={`flex min-h-[52px] items-center gap-3 rounded-lg border px-3 py-2 ${c.pending ? "border-amber/40" : "hairline"} bg-panel/50`}>
                  <input type="checkbox" checked={c.done} disabled={locked}
                    onChange={(e) => {
                      const done = e.target.checked;
                      setTicks((t) => ({ ...t, [c.key]: done }));
                      void queue(() => f.queue("checklist", job.id, { key: c.key, done }));
                    }}
                    className="h-6 w-6 shrink-0 accent-[var(--c-red)]" />
                  <span className={`flex-1 text-base ${c.done ? "text-steel line-through" : "text-fg"}`}>
                    {c.label}{c.required && !c.done && <span className="text-brand-bright"> *</span>}
                  </span>
                  {c.pending && <span className="text-xs text-amber">↑</span>}
                </label>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {modules.labour && (can("labour.log") || can("labour.manage")) && (
        <Section title={m("time")}>
          <PhoneTime jobId={job.id} locked={locked} />
        </Section>
      )}

      {modules.stock && (
        <Section title={m("parts")}>
          <PhoneJobParts jobId={job.id} parts={pack.parts} online={f.online} locked={locked} onChanged={() => void load()} />
        </Section>
      )}

      <Section title={m("photos")}>
        <PhotoTaker disabled={locked} onPhoto={(file, caption) => queue(() => f.queuePhoto(job.id, file, caption))} />
        {(photos.length > 0 || pendingPhotos.length > 0) && (
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {pendingPhotos.map((p) => <PendingThumb key={p.id} blob={p.payload.blob as Blob} failed={p.state === "failed"} />)}
            {photos.map((a) => (
              <li key={a.id} className="flex aspect-square flex-col justify-end rounded-lg border hairline bg-ink-deep p-2 text-xs text-steel">
                <span className="line-clamp-2">{a.caption ?? a.filename}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={m("notes")}>
        {!locked && <NoteBox onSave={(text) => queue(() => f.queue("note", job.id, { text }))} />}
        <ul className="mt-3 space-y-2">
          {pendingNotes.map((n) => (
            <li key={n.id} className={`rounded-lg border px-3 py-2 text-base ${n.failed ? "border-brand-bright/50" : "border-amber/40"}`}>
              {n.text} <span className={`text-xs ${n.failed ? "text-brand-bright" : "text-amber"}`}>· {n.failed ? m("failed") : m("waitingToSend")}</span>
            </li>
          ))}
          {notes.map((n, i) => (
            <li key={i} className="rounded-lg border hairline px-3 py-2">
              <p className="text-base text-fg">{n.action.slice(6)}</p>
              <p className="text-xs text-dim">{n.by} · {n.at.slice(0, 16).replace("T", " ")}</p>
            </li>
          ))}
        </ul>
      </Section>

      {!locked && (
        <Section title={m("nextSteps")}>
          {!f.online && <p className="mb-3 text-sm text-amber">{m("needsConnection")}</p>}
          {pack.steps.length === 0 ? (
            <p className="text-sm text-steel">{m("noSteps")}</p>
          ) : (
            <Steps pack={pack} disabled={busy || !f.online} lang={lang}
              onTake={(to, fields) => online(() => api.patch<Job>(`/jobs/${encodeURIComponent(job.id)}/transition`, { to, fields }))} />
          )}
        </Section>
      )}

      <Section title={m("timeline")}>
        <ol className="space-y-2">
          {[...job.audit].reverse().slice(0, 15).map((a, i) => (
            <li key={i} className="text-sm">
              <p className="text-fg">{a.action}</p>
              <p className="text-xs text-dim">{a.by} · {a.at.slice(0, 16).replace("T", " ")}</p>
            </li>
          ))}
        </ol>
        {me && <p className="mt-3 text-xs text-dim">{me.name}</p>}
      </Section>
    </div>
  );
}

/** Checklist with queued ticks applied on top, so the screen shows what the technician did. */
function applyPendingChecks(list: ChecklistItem[], pending: ReturnType<typeof pendingFor>) {
  const out = list.map((c) => ({ ...c, pending: false }));
  for (const p of pending.filter((x) => x.type === "checklist")) {
    const c = out.find((x) => x.key === p.payload.key);
    if (c && p.payload.done !== undefined) { c.done = !!p.payload.done; c.pending = true; }
  }
  return out;
}

function MeterRow({ meter, pending, onRecord, disabled }: {
  meter: { key: string; label: string; unit: string; value: number; readAt: string | null };
  pending: { value: number; failed: boolean }[]; onRecord: (v: number) => void; disabled: boolean;
}) {
  const m = useM();
  const [v, setV] = useState("");
  const last = pending.at(-1);
  return (
    <div className="mt-3 rounded-lg border hairline bg-panel/50 p-3">
      <p className="text-base">
        {meter.label}: <span className="mono text-fg">{(last?.value ?? meter.value).toLocaleString()} {meter.unit}</span>
        {last && <span className={`ml-2 text-xs ${last.failed ? "text-brand-bright" : "text-amber"}`}>{last.failed ? m("failed") : m("waitingToSend")}</span>}
      </p>
      {!disabled && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); const n = Number(v); if (v && Number.isFinite(n)) { onRecord(n); setV(""); } }}>
          <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={m("newReading")}
            className="mono min-h-[48px] min-w-0 flex-1 rounded-lg border hairline bg-ink-deep px-3 text-base text-fg outline-none focus:border-trace" />
          <BigButton type="submit" disabled={!v}>{m("record")}</BigButton>
        </form>
      )}
    </div>
  );
}

function PhotoTaker({ onPhoto, disabled }: { onPhoto: (f: File, caption: string) => void; disabled: boolean }) {
  const m = useM();
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  if (disabled) return null;
  return (
    <div className="space-y-2">
      <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder={m("caption")}
        className="min-h-[48px] w-full rounded-lg border hairline bg-ink-deep px-3 text-base text-fg outline-none focus:border-trace" />
      <BigButton tone="ghost" onClick={() => input.current?.click()}>📷 {m("addPhoto")}</BigButton>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) { onPhoto(file, caption.trim()); setCaption(""); } }} />
    </div>
  );
}

function PendingThumb({ blob, failed }: { blob: Blob; failed: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <li className={`relative aspect-square overflow-hidden rounded-lg border ${failed ? "border-brand-bright/60" : "border-amber/50"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url && <img src={url} alt="" className="h-full w-full object-cover" />}
      <span className={`absolute bottom-1 right-1 rounded bg-ink/80 px-1.5 text-xs ${failed ? "text-brand-bright" : "text-amber"}`}>↑</span>
    </li>
  );
}

function NoteBox({ onSave }: { onSave: (text: string) => void }) {
  const m = useM();
  const [text, setText] = useState("");
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { onSave(text.trim()); setText(""); } }}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder={m("addNote")}
        className="w-full rounded-lg border hairline bg-ink-deep px-3 py-2 text-base text-fg outline-none focus:border-trace" />
      <BigButton type="submit" disabled={!text.trim()}>{m("save")}</BigButton>
    </form>
  );
}

function Steps({ pack, disabled, onTake, lang }: {
  pack: JobPack; disabled: boolean; lang: "en" | "ms"; onTake: (to: string, fields: Record<string, string>) => Promise<void>;
}) {
  const m = useM();
  const [open, setOpen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const step = pack.steps.find((s) => s.to === open);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {pack.steps.map((s) => (
          <BigButton key={s.to} tone={open === s.to ? "primary" : "ghost"} disabled={disabled}
            onClick={() => {
              setValues({});
              if (!s.requires.length) { void onTake(s.to, {}); setOpen(null); }
              else setOpen(open === s.to ? null : s.to);
            }}>
            {lang === "ms" ? s.labelMs : s.label}
          </BigButton>
        ))}
      </div>
      {step && step.requires.length > 0 && (
        <div className="space-y-3 rounded-lg border hairline bg-panel/50 p-3">
          <p className="text-sm text-steel">→ {step.toLabel}</p>
          <StepForm large fields={step.requires} values={values} onChange={setValues} entity="job" entityId={pack.job.id} disabled={disabled} />
          <BigButton disabled={disabled || !stepComplete(step.requires, values)} onClick={async () => { await onTake(step.to, values); setOpen(null); }}>
            {m("submit")}
          </BigButton>
        </div>
      )}
    </div>
  );
}
