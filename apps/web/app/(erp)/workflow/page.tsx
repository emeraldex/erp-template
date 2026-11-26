"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useSession } from "@/lib/use-session";
import { useVocab } from "@/lib/vocab";
import type { DictEntry, Phase } from "@/lib/types";
import { Button, PageHeader, Panel } from "@/components/ui";

type Field = { key: string; label: string; formNo?: string };
type Effect = { type: string; params?: Record<string, unknown> };
type Rule = { from: string; to: string; label: string; labelMs: string; roles: string[]; requires: Field[]; setLocation?: string; effects?: Effect[] };
type ParamDef = { name: string; label: string; type: "field" | "number" | "location" | "jobStatus" | "text"; required?: boolean };
type ActionDef = { type: string; kind: string; label: string; description: string; params: ParamDef[]; needs: string[] };
type KindSnap = {
  kind: "JOB" | "DEMAND" | "OV" | "INVOICE"; initial: string; statuses: string[]; statusMeta: Record<string, { en: string }>;
  transitions: Rule[]; version: string; protected: { from: string; to: string; fields: { key: string; by: string }[] }[];
  actions: ActionDef[];
};
type Sla = { id: string; entity: KindSnap["kind"]; status: string; days: number; rule: string; source: string };
type Stream = { id: string; label: string; labelMs: string; customer: string; docSet: string[]; deadlines: { label: string; note: string }[]; version: string };
type Snapshot = {
  roles: string[]; locations: string[]; kinds: KindSnap[]; sla: { rules: Sla[]; version: string }; streams: Stream[];
  dictionaries: Record<string, { entries: DictEntry[]; version: string }>;
};
type Change = { id: string; at: string; by: string; role: string; area: string; summary: string };

type Tab = "JOB" | "DEMAND" | "OV" | "INVOICE" | "LISTS" | "ROLES" | "SLA" | "STREAMS" | "HISTORY";

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

function TransitionsEditor({ snap, roles, roleLabel, locations, onSaved }: { snap: KindSnap; roles: string[]; roleLabel: (k: string) => string; locations: string[]; onSaved: () => void }) {
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
        A step can also take <span className="text-fg">actions</span> — raise a parts request, record a meter reading, mark an invoice paid.
        Fields marked <span className="mono text-amber">NEEDED</span> are read by an action and must stay mandatory while it is there.
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
                  <select value={r.from} onChange={(e) => update(i, { from: e.target.value })} className={input}>
                    {snap.statuses.map((s) => <option key={s} value={s}>{name(s)}</option>)}
                  </select>
                </label>
                <span className="mono hidden pb-2 text-steel sm:block">→</span>
                <label className="block">
                  <span className="eyebrow mb-1 block">To</span>
                  <select value={r.to} onChange={(e) => update(i, { to: e.target.value })} className={input}>
                    {snap.statuses.map((s) => <option key={s} value={s}>{name(s)}</option>)}
                  </select>
                </label>
                <button onClick={() => setRules(rules.filter((_, j) => j !== i))} className="mono pb-2 text-[10.5px] tracking-widest text-steel hover:text-brand-bright" title={r.effects?.length ? "Removes the step and its actions" : undefined}>REMOVE</button>
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
                        {roleLabel(role)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-3">
                <span className="eyebrow mb-1 block">Mandatory fields</span>
                {r.requires.map((f, k) => {
                  const needed = (r.effects ?? []).some((e) => snap.actions.find((a) => a.type === e.type)?.needs.some((n) => e.params?.[n] === f.key));
                  const sys = needed || locked?.fields.some((x) => x.key === f.key && (r.effects ?? []).length > 0);
                  const setField = (patch: Partial<Field>) => update(i, { requires: r.requires.map((x, m) => (m === k ? { ...x, ...patch } : x)) });
                  return (
                    <div key={k} className="mb-1.5 grid grid-cols-[1fr_2fr_90px_auto] items-center gap-1.5">
                      <input value={f.key} disabled={sys} placeholder="key" onChange={(e) => setField({ key: e.target.value })} className={input} />
                      <input value={f.label} placeholder="Label shown to the user" onChange={(e) => setField({ label: e.target.value })} className={input} />
                      <input value={f.formNo ?? ""} placeholder="Form no." onChange={(e) => setField({ formNo: e.target.value || undefined })} className={input} />
                      {sys ? <span className="mono text-[9px] tracking-widest text-amber">NEEDED</span> : (
                        <button onClick={() => update(i, { requires: r.requires.filter((_, m) => m !== k) })} className="mono text-[10px] text-steel hover:text-brand-bright">✕</button>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => update(i, { requires: [...r.requires, { key: "", label: "" }] })} className="mono text-[10.5px] tracking-widest text-steel hover:text-trace">+ FIELD</button>
              </div>
              <ActionsEditor rule={r} catalogue={snap.actions} locations={locations} onChange={(effects) => update(i, { effects })} />
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


/** The actions a step takes, picked from the catalogue for this workflow. */
function ActionsEditor({ rule, catalogue, locations, onChange }: { rule: Rule; catalogue: ActionDef[]; locations: string[]; onChange: (e: Effect[]) => void }) {
  const effects = rule.effects ?? [];
  const set = (i: number, e: Effect) => onChange(effects.map((x, j) => (j === i ? e : x)));
  return (
    <div className="mt-3">
      <span className="eyebrow mb-1 block">Actions</span>
      {effects.map((e, i) => {
        const def = catalogue.find((a) => a.type === e.type);
        const params = (e.params ?? {}) as Record<string, unknown>;
        const setParam = (name: string, v: string) => set(i, { ...e, params: { ...params, [name]: v === "" ? undefined : v } });
        return (
          <div key={i} className="mb-1.5 rounded border hairline bg-ink-deep/40 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-fg" title={def?.description}>{def?.label ?? e.type}</p>
              <button onClick={() => onChange(effects.filter((_, j) => j !== i))} className="mono text-[10px] text-steel hover:text-brand-bright">✕</button>
            </div>
            {e.type === "setAttributes" ? (
              <p className="mono mt-1 text-[10px] text-dim">{Object.entries(params).map(([k, v]) => `${k} ← ${String(v)}`).join(" · ") || "no fields copied"}</p>
            ) : (
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {def?.params.map((p) => (
                  <label key={p.name} className="block">
                    <span className="mono mb-0.5 block text-[9.5px] tracking-widest text-dim">{p.label}{p.required ? " *" : ""}</span>
                    {p.type === "location" ? (
                      <select value={String(params[p.name] ?? "")} onChange={(ev) => setParam(p.name, ev.target.value)} className={input}>
                        <option value="">—</option>
                        {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                    ) : p.type === "field" ? (
                      <select value={String(params[p.name] ?? "")} onChange={(ev) => setParam(p.name, ev.target.value)} className={input}>
                        <option value="">—</option>
                        {rule.requires.filter((f) => f.key).map((f) => <option key={f.key} value={f.key}>{f.label || f.key}</option>)}
                        {params[p.name] != null && params[p.name] !== "" && !rule.requires.some((f) => f.key === params[p.name]) && <option value={String(params[p.name])}>{String(params[p.name])} (optional field)</option>}
                      </select>
                    ) : (
                      <input value={String(params[p.name] ?? "")} onChange={(ev) => setParam(p.name, p.type === "text" ? ev.target.value.toUpperCase() : ev.target.value)} className={input} />
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <select value="" onChange={(e) => e.target.value && onChange([...effects, { type: e.target.value, params: {} }])} className={`${input} mt-1 w-64`}>
        <option value="">+ add an action…</option>
        {catalogue.filter((a) => a.type !== "setAttributes").map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
      </select>
    </div>
  );
}

const TONES = ["neutral", "info", "warn", "good", "bad"] as const;
const PHASES: Phase[] = ["new", "active", "waiting_parts", "waiting_customer", "external", "done", "closed"];
const PHASE_HELP: Record<Phase, string> = {
  new: "new / not started", active: "being worked on", waiting_parts: "waiting for parts", waiting_customer: "waiting for the customer",
  external: "with a vendor / contractor", done: "work done", closed: "closed",
};
const LIST_NAMES: Record<string, string> = {
  "status:JOB": "Work order statuses", "status:DEMAND": "Parts request statuses", "status:OV": "Vendor repair statuses", "status:INVOICE": "Invoice statuses",
  site: "Sites", location: "Locations", category: "Categories", priority: "Priority levels", route: "Expedite routes",
  incidentArea: "Incident types", course: "Training courses", jobType: "Types of work", assetType: "Asset types",
};

/** Statuses and the organisation's other lists. Entries are deactivated, never deleted. */
function ListsEditor({ dictionaries, onSaved }: { dictionaries: Snapshot["dictionaries"]; onSaved: () => void }) {
  const kinds = Object.keys(dictionaries).filter((k) => k !== "role");
  const [kind, setKind] = useState(kinds[0]);
  const list = dictionaries[kind];
  const [rows, setRows] = useState<DictEntry[]>(() => structuredClone(list?.entries ?? []));
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: string[] } | null>(null);
  useEffect(() => { setRows(structuredClone(dictionaries[kind]?.entries ?? [])); setMsg(null); }, [kind, dictionaries]);
  const isStatus = kind.startsWith("status:");
  const existing = new Set((list?.entries ?? []).map((e) => e.key));
  const update = (i: number, patch: Partial<DictEntry>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const meta = (i: number, patch: Record<string, unknown>) => update(i, { meta: { ...rows[i].meta, ...patch } });
  const move = (i: number, d: -1 | 1) => { const n = [...rows]; [n[i], n[i + d]] = [n[i + d], n[i]]; setRows(n); };

  async function save() {
    setMsg(null);
    try {
      await api.put(`/workflow/dictionary/${encodeURIComponent(kind)}`, { version: list.version, entries: rows });
      setMsg({ ok: true, text: "Saved — in effect now." });
      onSaved();
    } catch (e) {
      const err = e as ApiError & { errors?: string[] };
      setMsg({ ok: false, text: err.message });
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={`${input} w-64`}>
          {kinds.map((k) => <option key={k} value={k}>{LIST_NAMES[k] ?? k}</option>)}
        </select>
        <p className="text-sm text-steel">
          {isStatus ? "The first status is where new records start. The phase says what a status means, so dashboards, locking and alerts work whatever it is called." : "Used in drop-downs across the system."}
          {" "}Entries in use can be made inactive, not deleted.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="eyebrow text-left">
              {["", "Key", "Label (EN)", "Label (BM)", ...(isStatus ? ["Colour", "Phase", "Final", "Off main line"] : []), "Active"].map((h) => <th key={h} className="pb-2 pr-2">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="align-middle">
                <td className="pb-1.5 pr-1.5 whitespace-nowrap">
                  <button disabled={i === 0} onClick={() => move(i, -1)} className="mono px-1 text-steel disabled:opacity-30">↑</button>
                  <button disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="mono px-1 text-steel disabled:opacity-30">↓</button>
                </td>
                <td className="w-40 pb-1.5 pr-1.5"><input value={r.key} disabled={existing.has(r.key)} onChange={(e) => update(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") })} className={input} /></td>
                <td className="pb-1.5 pr-1.5"><input value={r.label} onChange={(e) => update(i, { label: e.target.value })} className={input} /></td>
                <td className="pb-1.5 pr-1.5"><input value={r.labelMs} onChange={(e) => update(i, { labelMs: e.target.value })} className={input} /></td>
                {isStatus && (
                  <>
                    <td className="w-24 pb-1.5 pr-1.5"><select value={String(r.meta.tone ?? "neutral")} onChange={(e) => meta(i, { tone: e.target.value })} className={input}>{TONES.map((t) => <option key={t}>{t}</option>)}</select></td>
                    <td className="w-44 pb-1.5 pr-1.5"><select value={String(r.meta.phase ?? "active")} onChange={(e) => meta(i, { phase: e.target.value })} className={input}>{PHASES.map((p) => <option key={p} value={p}>{PHASE_HELP[p]}</option>)}</select></td>
                    <td className="pb-1.5 pr-1.5 text-center"><input type="checkbox" checked={!!r.meta.final} onChange={(e) => meta(i, { final: e.target.checked })} className="accent-[var(--c-red)]" /></td>
                    <td className="pb-1.5 pr-1.5 text-center"><input type="checkbox" checked={!!r.meta.branch} onChange={(e) => meta(i, { branch: e.target.checked })} className="accent-[var(--c-red)]" /></td>
                  </>
                )}
                <td className="pb-1.5 text-center"><input type="checkbox" checked={r.active} onChange={(e) => update(i, { active: e.target.checked })} className="accent-[var(--c-red)]" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setRows([...rows, { key: "", label: "", labelMs: "", meta: isStatus ? { tone: "info", phase: "active" } : {}, active: true }])}>+ Add entry</Button>
        <Button onClick={save}>Save list</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}

/** Roles and what each may do — administrators only, since it grants access. */
function RolesEditor({ roles, capabilities, onSaved }: { roles: Snapshot["dictionaries"][string]; capabilities: Record<string, string>; onSaved: () => void }) {
  const [rows, setRows] = useState<DictEntry[]>(() => structuredClone(roles.entries));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const existing = new Set(roles.entries.map((e) => e.key));
  const caps = Object.entries(capabilities);
  const has = (r: DictEntry, c: string) => ((r.meta.capabilities as string[] | undefined) ?? []).includes(c);
  const toggle = (i: number, c: string) => setRows(rows.map((r, j) => {
    if (j !== i) return r;
    const list = (r.meta.capabilities as string[] | undefined) ?? [];
    return { ...r, meta: { ...r.meta, capabilities: list.includes(c) ? list.filter((x) => x !== c) : [...list, c] } };
  }));
  async function save() {
    setMsg(null);
    try {
      await api.put("/workflow/roles", { version: roles.version, entries: rows });
      setMsg({ ok: true, text: "Saved — people get the new access at their next page load." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  }
  return (
    <div>
      <p className="mb-3 text-sm text-steel">
        Which steps a role owns is set on each workflow step. Here you decide what else it may do. ADMIN always holds everything.
      </p>
      <div className="mb-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 rounded border hairline bg-ink-deep/40 p-1.5">
            <input value={r.key} disabled={existing.has(r.key)} placeholder="KEY" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_") } : x)))} className={`${input} w-28`} />
            <input value={r.label} placeholder="Title" onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={input} />
            <input type="checkbox" title="Active" disabled={r.key === "ADMIN"} checked={r.active} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))} className="accent-[var(--c-red)]" />
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="text-xs">
          <thead>
            <tr>
              <th className="eyebrow pb-2 pr-3 text-left">Permission</th>
              {rows.map((r, i) => <th key={i} className="mono px-1.5 pb-2 text-center text-[9.5px] tracking-widest text-steel" title={r.label}>{r.key || "NEW"}</th>)}
            </tr>
          </thead>
          <tbody>
            {caps.map(([c, help]) => (
              <tr key={c} className="border-t hairline">
                <td className="py-1.5 pr-3">
                  <p className="mono text-[10.5px] text-fg">{c}</p>
                  <p className="text-[11px] text-dim">{help}</p>
                </td>
                {rows.map((r, i) => (
                  <td key={i} className="px-1.5 text-center">
                    <input type="checkbox" disabled={r.key === "ADMIN"} checked={r.key === "ADMIN" || has(r, c)} onChange={() => toggle(i, c)} className="accent-[var(--c-red)]" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => setRows([...rows, { key: "", label: "", labelMs: "", meta: { capabilities: [] }, active: true }])}>+ Add role</Button>
        <Button onClick={save}>Save roles</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
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
        <Button variant="ghost" onClick={() => setRules([...rules, { id: `SLA-${rules.length + 1}`, entity: "JOB", status: kinds.find((k) => k.kind === "JOB")?.statuses[0] ?? "", days: 5, rule: "", source: "" }])}>+ Add timer</Button>
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
  const { terms, modules, can, cfg, aviation } = useVocab();
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

  if (session && !can("workflow.edit")) return <p className="py-20 text-center text-sm text-dim">The workflow editor is for people allowed to change the workflow.</p>;
  if (!snap) return <p className="eyebrow py-20 text-center">{error ?? "LOADING…"}</p>;
  const kind = snap.kinds.find((k) => k.kind === tab);
  const roleLabel = (k: string) => snap.dictionaries.role?.entries.find((r) => r.key === k)?.label ?? k;
  const TABS: [Tab, string][] = ([
    ["JOB", terms.jobs], modules.procurement && ["DEMAND", terms.demands], modules.vendorRepair && ["OV", terms.vendorRepairs],
    modules.invoicing && ["INVOICE", "Invoices"], ["LISTS", "Statuses & lists"], can("org.admin") && ["ROLES", "Roles & permissions"],
    ["SLA", "SLA timers"], modules.invoicing && ["STREAMS", "Invoicing streams"], ["HISTORY", "Change history"],
  ] as ([Tab, string] | false)[]).filter((x): x is [Tab, string] => !!x);

  return (
    <div>
      <PageHeader eyebrow={`${aviation ? "FR-02 · " : ""}workflow as data · changes apply immediately and are logged`} title={t("workflow")} />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {TABS.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`mono rounded border px-3 py-1.5 text-[10.5px] tracking-widest transition-colors ${tab === key ? "border-brand bg-brand/15 text-fg" : "hairline text-steel hover:text-fg"}`}>
            {label.toUpperCase()}
          </button>
        ))}
      </div>
      {kind && <TransitionsEditor key={`${kind.kind}-${rev}`} snap={kind} roles={snap.roles} roleLabel={roleLabel} locations={snap.locations} onSaved={load} />}
      {tab === "LISTS" && <ListsEditor key={rev} dictionaries={snap.dictionaries} onSaved={load} />}
      {tab === "ROLES" && snap.dictionaries.role && <RolesEditor key={rev} roles={snap.dictionaries.role} capabilities={cfg?.capabilities ?? {}} onSaved={load} />}
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
