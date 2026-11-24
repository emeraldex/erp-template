"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useSession } from "@/lib/use-session";
import { Button, PageHeader, Panel } from "@/components/ui";

type Field = { key: string; label: string; formNo?: string };
type Rule = { from: string; to: string; label: string; labelMs: string; roles: string[]; requires: Field[]; setLocation?: string };
type KindSnap = {
  kind: "JOB" | "DEMAND" | "OV" | "INVOICE"; initial: string; statuses: string[]; statusMeta: Record<string, { en: string }>;
  transitions: Rule[]; version: string; protected: { from: string; to: string; keys: string[] }[];
};
type Sla = { id: string; entity: KindSnap["kind"]; status: string; days: number; rule: string; source: string };
type Stream = { id: string; label: string; labelMs: string; customer: string; docSet: string[]; deadlines: { label: string; note: string }[]; version: string };
type Snapshot = { roles: string[]; locations: string[]; kinds: KindSnap[]; sla: { rules: Sla[]; version: string }; streams: Stream[] };
type Change = { id: string; at: string; by: string; role: string; area: string; summary: string };

const TABS = [
  ["JOB", "Jobs"], ["DEMAND", "Demands"], ["OV", "Outside vendor"], ["INVOICE", "Invoices"],
  ["SLA", "SLA timers"], ["STREAMS", "Invoicing streams"], ["HISTORY", "Change history"],
] as const;
type Tab = (typeof TABS)[number][0];

const input = "mono w-full rounded-md border hairline bg-ink-deep px-2.5 py-1.5 text-xs text-fg outline-none focus:border-trace disabled:opacity-50";

function Problems({ errors, warnings }: { errors: string[]; warnings: string[] }) {
  if (!errors.length && !warnings.length) return null;
  return (
    <div className="mb-4 space-y-1.5">
      {errors.map((e) => <p key={e} className="rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-1.5 text-xs text-brand-bright">✕ {e}</p>)}
      {warnings.map((w) => <p key={w} className="rounded border border-amber/40 bg-amber/10 px-3 py-1.5 text-xs text-amber">! {w}</p>)}
    </div>
  );
}

function TransitionsEditor({ snap, roles, locations, onSaved }: { snap: KindSnap; roles: string[]; locations: string[]; onSaved: () => void }) {
  const [rules, setRules] = useState<Rule[]>(() => structuredClone(snap.transitions));
  const [check, setCheck] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string; conflict?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = useMemo(() => JSON.stringify(rules) !== JSON.stringify(snap.transitions), [rules, snap.transitions]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const name = (s: string) => snap.statusMeta[s]?.en ?? s;
  const lock = (r: Rule) => snap.protected.find((p) => p.from === r.from && p.to === r.to);

  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.post<{ errors: string[]; warnings: string[] }>(`/workflow/transitions/${snap.kind.toLowerCase()}/preview`, { transitions: rules })
        .then(setCheck).catch(() => {});
    }, 400);
    return () => clearTimeout(timer.current);
  }, [rules, snap.kind]);

  const update = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.put<{ warnings: string[] }>(`/workflow/transitions/${snap.kind.toLowerCase()}`, { version: snap.version, transitions: rules });
      setMsg({ ok: true, text: `Saved — in effect now.${res.warnings.length ? ` ${res.warnings.length} warning(s).` : ""}` });
      onSaved();
    } catch (e) {
      const err = e as ApiError;
      setMsg({ ok: false, text: err.message, conflict: err.status === 409 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-3 text-sm text-steel">
        Each row is a step a record can take from one status to another: who may take it, what they must enter, and (for jobs) where the item goes.
        Steps marked <span className="mono text-amber">SYSTEM</span> drive automatic actions and cannot be removed.
      </p>
      <Problems {...check} />
      <div className="space-y-3">
        {rules.map((r, i) => {
          const locked = lock(r);
          return (
            <Panel key={i} className="p-4">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
                <label className="block">
                  <span className="eyebrow mb-1 block">From</span>
                  <select value={r.from} disabled={!!locked} onChange={(e) => update(i, { from: e.target.value })} className={input}>
                    {snap.statuses.map((s) => <option key={s} value={s}>{name(s)}</option>)}
                  </select>
                </label>
                <span className="mono hidden pb-2 text-steel sm:block">→</span>
                <label className="block">
                  <span className="eyebrow mb-1 block">To</span>
                  <select value={r.to} disabled={!!locked} onChange={(e) => update(i, { to: e.target.value })} className={input}>
                    {snap.statuses.map((s) => <option key={s} value={s}>{name(s)}</option>)}
                  </select>
                </label>
                {locked ? (
                  <span className="mono pb-2 text-[10px] tracking-widest text-amber" title="Used by automatic actions">SYSTEM</span>
                ) : (
                  <button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="mono pb-2 text-[10.5px] tracking-widest text-steel hover:text-brand-bright">REMOVE</button>
                )}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block"><span className="eyebrow mb-1 block">Action label (EN)</span>
                  <input value={r.label} onChange={(e) => update(i, { label: e.target.value })} className={input} /></label>
                <label className="block"><span className="eyebrow mb-1 block">Label (BM)</span>
                  <input value={r.labelMs} onChange={(e) => update(i, { labelMs: e.target.value })} className={input} /></label>
              </div>
              <div className="mt-3">
                <span className="eyebrow mb-1 block">Owned by</span>
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((role) => {
                    const on = r.roles.includes(role);
                    return (
                      <button key={role} onClick={() => update(i, { roles: on ? r.roles.filter((x) => x !== role) : [...r.roles, role] })}
                        className={`mono rounded border px-2 py-1 text-[10px] tracking-widest transition-colors ${on ? "border-trace/60 bg-trace/15 text-fg" : "hairline text-dim hover:text-steel"}`}>
                        {role}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3">
                <span className="eyebrow mb-1 block">Mandatory fields</span>
                {r.requires.map((f, k) => {
                  const sys = locked?.keys.includes(f.key);
                  const setField = (patch: Partial<Field>) => update(i, { requires: r.requires.map((x, m) => (m === k ? { ...x, ...patch } : x)) });
                  return (
                    <div key={k} className="mb-1.5 grid grid-cols-[1fr_2fr_90px_auto] items-center gap-1.5">
                      <input value={f.key} disabled={sys} placeholder="key" onChange={(e) => setField({ key: e.target.value })} className={input} />
                      <input value={f.label} placeholder="Label shown to the user" onChange={(e) => setField({ label: e.target.value })} className={input} />
                      <input value={f.formNo ?? ""} placeholder="Form no." onChange={(e) => setField({ formNo: e.target.value || undefined })} className={input} />
                      {sys ? <span className="mono text-[9px] tracking-widest text-amber">SYSTEM</span> : (
                        <button onClick={() => update(i, { requires: r.requires.filter((_, m) => m !== k) })} className="mono text-[10px] text-steel hover:text-brand-bright">✕</button>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => update(i, { requires: [...r.requires, { key: "", label: "" }] })} className="mono text-[10.5px] tracking-widest text-steel hover:text-trace">+ FIELD</button>
              </div>
              {snap.kind === "JOB" && (
                <label className="mt-3 block w-48"><span className="eyebrow mb-1 block">Move item to</span>
                  <select value={r.setLocation ?? ""} onChange={(e) => update(i, { setLocation: e.target.value || undefined })} className={input}>
                    <option value="">— stays where it is —</option>
                    {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
              )}
            </Panel>
          );
        })}
      </div>
      <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-2 border-t hairline bg-ink/90 py-3 backdrop-blur">
        <Button variant="ghost" onClick={() => setRules([...rules, { from: snap.initial, to: snap.statuses[1], label: "", labelMs: "", roles: [], requires: [] }])}>+ Add step</Button>
        <Button disabled={!dirty || busy || check.errors.length > 0} onClick={save}>{busy ? "SAVING…" : "Save workflow"}</Button>
        {dirty && <Button variant="ghost" onClick={() => setRules(structuredClone(snap.transitions))}>Discard changes</Button>}
        {msg && (
          <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>
            {msg.text} {msg.conflict && <button onClick={onSaved} className="underline">Reload</button>}
          </span>
        )}
      </div>
    </div>
  );
}

function SlaEditor({ snap, kinds, onSaved }: { snap: Snapshot["sla"]; kinds: KindSnap[]; onSaved: () => void }) {
  const [rules, setRules] = useState<Sla[]>(() => structuredClone(snap.rules));
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  const update = (i: number, patch: Partial<Sla>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  async function save() {
    try {
      await api.put("/workflow/sla", { version: snap.version, rules });
      setMsg({ ok: true, text: "SLA timers saved — breaches and alerts use them now." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <div>
      <p className="mb-3 text-sm text-steel">How long a record may stay in a status before it shows on the breach board and alerts go out.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead><tr className="eyebrow text-left">{["Id", "Record", "Status", "Days", "Rule", "Source", ""].map((h) => <th key={h} className="pb-2 pr-2">{h}</th>)}</tr></thead>
          <tbody>
            {rules.map((r, i) => (
              <tr key={i} className="align-top">
                <td className="pb-1.5 pr-1.5"><input value={r.id} onChange={(e) => update(i, { id: e.target.value.toUpperCase() })} className={input} /></td>
                <td className="pb-1.5 pr-1.5"><select value={r.entity} onChange={(e) => update(i, { entity: e.target.value as Sla["entity"], status: kinds.find((k) => k.kind === e.target.value)!.statuses[0] })} className={input}>
                  {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.kind}</option>)}</select></td>
                <td className="pb-1.5 pr-1.5"><select value={r.status} onChange={(e) => update(i, { status: e.target.value })} className={input}>
                  {kinds.find((k) => k.kind === r.entity)?.statuses.map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                <td className="w-20 pb-1.5 pr-1.5"><input type="number" min={1} max={3650} value={r.days} onChange={(e) => update(i, { days: Number(e.target.value) })} className={input} /></td>
                <td className="pb-1.5 pr-1.5"><input value={r.rule} onChange={(e) => update(i, { rule: e.target.value })} className={input} /></td>
                <td className="w-28 pb-1.5 pr-1.5"><input value={r.source} onChange={(e) => update(i, { source: e.target.value })} className={input} /></td>
                <td className="pb-1.5"><button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="mono text-[10px] text-steel hover:text-brand-bright">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setRules([...rules, { id: `SLA-${rules.length + 1}`, entity: "JOB", status: "REGISTERED", days: 5, rule: "", source: "" }])}>+ Add timer</Button>
        <Button onClick={save}>Save SLA timers</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

function StreamEditor({ stream, onSaved }: { stream: Stream; onSaved: () => void }) {
  const [s, setS] = useState(stream);
  const [docs, setDocs] = useState(stream.docSet.join("\n"));
  const [deadlines, setDeadlines] = useState(stream.deadlines.map((d) => `${d.label} | ${d.note}`).join("\n"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function save() {
    try {
      await api.put(`/workflow/streams/${stream.id}`, {
        version: stream.version, label: s.label, labelMs: s.labelMs, customer: s.customer,
        docSet: docs.split("\n"), deadlines: deadlines.split("\n").map((l) => { const [label, ...note] = l.split("|"); return { label: label.trim(), note: note.join("|").trim() }; }),
      });
      setMsg({ ok: true, text: "Saved — new document packs use it." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <Panel className="p-4">
      <p className="mono mb-2 text-xs text-trace">{stream.id}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block"><span className="eyebrow mb-1 block">Name (EN)</span><input value={s.label} onChange={(e) => setS({ ...s, label: e.target.value })} className={input} /></label>
        <label className="block"><span className="eyebrow mb-1 block">Name (BM)</span><input value={s.labelMs} onChange={(e) => setS({ ...s, labelMs: e.target.value })} className={input} /></label>
        <label className="block"><span className="eyebrow mb-1 block">Billed to</span><input value={s.customer} onChange={(e) => setS({ ...s, customer: e.target.value })} className={input} /></label>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="block"><span className="eyebrow mb-1 block">Document set (one per line)</span><textarea rows={5} value={docs} onChange={(e) => setDocs(e.target.value)} className={input} /></label>
        <label className="block"><span className="eyebrow mb-1 block">Deadlines (label | note, one per line)</span><textarea rows={5} value={deadlines} onChange={(e) => setDeadlines(e.target.value)} className={input} /></label>
      </div>
      <div className="mt-2 flex items-center gap-2"><Button onClick={save}>Save stream</Button>{msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}</div>
    </Panel>
  );
}

export default function WorkflowPage() {
  const { t } = useLang();
  const session = useSession();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Change[]>([]);
  const [tab, setTab] = useState<Tab>("JOB");
  const [rev, setRev] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<Snapshot>("/workflow").then((s) => { setSnap(s); setRev((r) => r + 1); }).catch((e) => setError((e as Error).message));
    api.get<Change[]>("/workflow/history").then(setHistory).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const role = session?.user.role;
  if (role && role !== "ADMIN" && role !== "QUALITY") return <p className="py-20 text-center text-sm text-dim">The workflow editor is for administrators and the quality department.</p>;
  if (!snap) return <p className="eyebrow py-20 text-center">{error ?? "LOADING…"}</p>;
  const kind = snap.kinds.find((k) => k.kind === tab);

  return (
    <div>
      <PageHeader eyebrow="FR-02 · workflow as data · changes apply immediately and are logged" title={t("workflow")} />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`mono rounded border px-3 py-1.5 text-[10.5px] tracking-widest transition-colors ${tab === key ? "border-brand bg-brand/15 text-fg" : "hairline text-steel hover:text-fg"}`}>
            {label.toUpperCase()}
          </button>
        ))}
      </div>
      {kind && <TransitionsEditor key={`${kind.kind}-${rev}`} snap={kind} roles={snap.roles} locations={snap.locations} onSaved={load} />}
      {tab === "SLA" && <SlaEditor key={rev} snap={snap.sla} kinds={snap.kinds} onSaved={load} />}
      {tab === "STREAMS" && <div className="space-y-3">{snap.streams.map((s) => <StreamEditor key={`${s.id}-${rev}`} stream={s} onSaved={load} />)}</div>}
      {tab === "HISTORY" && (
        <Panel className="p-4">
          {history.length === 0 && <p className="text-sm text-dim">No changes yet.</p>}
          <ul className="divide-y divide-[var(--c-line)]">
            {history.map((h) => (
              <li key={h.id} className="py-2.5">
                <p className="text-sm text-fg">{h.summary}</p>
                <p className="mono text-[10.5px] text-dim">{h.at.slice(0, 16).replace("T", " ")} · {h.by} · {h.role} · {h.area}</p>
              </li>
            ))}
          </ul>
          <p className="mono mt-2 text-[10.5px] text-dim">Each entry keeps the full before/after rules for change control (GET /workflow/history).</p>
        </Panel>
      )}
    </div>
  );
}
