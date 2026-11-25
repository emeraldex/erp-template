"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Asset, PmSchedule } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, PageHeader, StatusPill, Table, Td, Tr } from "@/components/ui";

const field = "mono rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";
const input = `${field} w-full`;

export default function PmPage() {
  return (
    <Suspense fallback={<p className="eyebrow py-20 text-center">LOADING…</p>}>
      <PmPlanner />
    </Suspense>
  );
}

/** Preventive maintenance: what is due, what is coming, and the schedules behind it. */
function PmPlanner() {
  const params = useSearchParams();
  const { cfg, terms, modules, dict, label, can } = useVocab();
  const [rows, setRows] = useState<PmSchedule[] | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [view, setView] = useState<"due" | "all">("due");
  const [adding, setAdding] = useState(!!params.get("assetId"));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    assetId: params.get("assetId") ?? "", title: "", intervalDays: "", meterKey: "", intervalMeter: "", leadDays: "7", leadMeter: "0",
    category: "", firstDue: "", checklist: "", instructions: "",
  });
  const canManage = can("assets.manage");

  const load = useCallback(() => {
    api.get<PmSchedule[]>(`/pm/schedules${params.get("assetId") ? `?assetId=${encodeURIComponent(params.get("assetId")!)}` : ""}`)
      .then(setRows).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [params]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (canManage) api.get<Asset[]>("/assets").then(setAssets).catch(() => {}); }, [canManage]);

  const asset = assets.find((a) => a.id === form.assetId);
  const now = Date.now();
  const shown = useMemo(() => (rows ?? []).filter((s) => view === "all" || (s.active && (s.overdue || s.openJobId ||
    (s.nextDueAt && new Date(s.nextDueAt).getTime() - (s.leadDays + 30) * 86_400_000 <= now)))), [rows, view, now]);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      const s = await api.post<PmSchedule>("/pm/schedules", {
        assetId: form.assetId, title: form.title,
        ...(form.intervalDays ? { intervalDays: Number(form.intervalDays) } : {}),
        ...(form.meterKey ? { meterKey: form.meterKey, intervalMeter: Number(form.intervalMeter), leadMeter: Number(form.leadMeter || 0) } : {}),
        leadDays: Number(form.leadDays || 0), ...(form.category ? { category: form.category } : {}),
        ...(form.firstDue ? { firstDue: form.firstDue } : {}), instructions: form.instructions,
        checklist: form.checklist.split("\n").map((l) => l.trim()).filter(Boolean).map((label) => ({ label })),
      });
      setMsg({ ok: true, text: `${s.id} created.${s.openJobId ? ` Already due — raised ${s.openJobId}.` : ""}` });
      setAdding(false); load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  async function act(path: string, body: object, ok: (r: { raised?: string[] }) => string) {
    setBusy(true); setMsg(null);
    try { const r = await api.post<{ raised?: string[] }>(path, body); setMsg({ ok: true, text: ok(r) }); load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  if (cfg && !modules.pm) return <p className="py-20 text-center text-sm text-dim">Preventive maintenance is switched off for this organisation (Settings → modules).</p>;

  return (
    <div>
      <PageHeader
        eyebrow="Calendar and meter-based schedules · jobs raised automatically when due"
        title={terms.pm}
        actions={canManage ? (
          <>
            <Button variant="ghost" disabled={busy} onClick={() => act("/pm/run", {}, (r) => r.raised?.length ? `Raised ${r.raised.join(", ")}.` : "Nothing new is due.")}>Raise due now</Button>
            <Button onClick={() => setAdding(!adding)} variant={adding ? "ghost" : "primary"}>{adding ? "Cancel" : "+ New schedule"}</Button>
          </>
        ) : undefined}
      />
      {msg && <p className={`mb-4 rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>{msg.text}</p>}

      {adding && canManage && (
        <div className="panel ticked fade-up mb-6 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{terms.asset} *</span>
              <select value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value, meterKey: "" })} className={input}>
                <option value="">— choose —</option>
                {assets.filter((a) => a.status !== "RETIRED").map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name}</option>)}
              </select></label>
            <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Title *</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Quarterly service" className={input} /></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Every … days</span>
              <input value={form.intervalDays} onChange={(e) => setForm({ ...form, intervalDays: e.target.value })} placeholder="90" className={input} /></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">…or every (meter)</span>
              <select value={form.meterKey} onChange={(e) => setForm({ ...form, meterKey: e.target.value })} className={input} disabled={!asset?.meters.length}>
                <option value="">{asset?.meters.length ? "— no meter —" : "asset has no meter"}</option>
                {asset?.meters.map((m) => <option key={m.key} value={m.key}>{m.label} ({m.unit}, now {m.value})</option>)}
              </select></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Meter interval</span>
              <input value={form.intervalMeter} disabled={!form.meterKey} onChange={(e) => setForm({ ...form, intervalMeter: e.target.value })} placeholder="10000" className={input} /></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">First due (optional)</span>
              <input type="date" value={form.firstDue} onChange={(e) => setForm({ ...form, firstDue: e.target.value })} className={input} /></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Raise … days early</span>
              <input value={form.leadDays} onChange={(e) => setForm({ ...form, leadDays: e.target.value })} className={input} /></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">…or … meter units early</span>
              <input value={form.leadMeter} disabled={!form.meterKey} onChange={(e) => setForm({ ...form, leadMeter: e.target.value })} className={input} /></label>
            <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Category</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={input}>
                <option value="">—</option>
                {dict("category").map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select></label>
            <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Checklist (one check per line — all required)</span>
              <textarea rows={4} value={form.checklist} onChange={(e) => setForm({ ...form, checklist: e.target.value })} className={input} /></label>
            <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Instructions</span>
              <textarea rows={4} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className={input} /></label>
          </div>
          <div className="mt-4"><Button disabled={busy || !form.assetId || !form.title || (!form.intervalDays && !form.meterKey)} onClick={create}>Create schedule</Button></div>
        </div>
      )}

      <div className="mb-4 flex gap-1.5">
        {(["due", "all"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`mono rounded border px-3 py-1.5 text-[10.5px] tracking-widest ${view === v ? "border-brand bg-brand/15 text-fg" : "hairline text-steel hover:text-fg"}`}>
            {v === "due" ? "DUE & NEXT 30 DAYS" : "ALL SCHEDULES"}
          </button>
        ))}
      </div>

      {rows && shown.length === 0 ? (
        <EmptyState title={view === "due" ? "Nothing due in the next 30 days" : "No schedules yet"} hint={canManage ? "Create a schedule for an asset above." : "Schedules are set up by people who manage assets."} />
      ) : (
        <div className="panel fade-up">
          <Table head={["Schedule", terms.asset, "Interval", "Next due", "Open", "", ""]}>
            {shown.map((s) => (
              <Tr key={s.id}>
                <Td><span className="mono text-xs text-trace">{s.id}</span> <span className="text-sm">{s.title}</span>{s.category && <span className="mono ml-2 text-[10px] text-dim">{label("category", s.category)}</span>}</Td>
                <Td><Link href={`/assets?id=${encodeURIComponent(s.assetId)}`} className="mono text-xs text-trace hover:underline">{s.asset?.tag}</Link> <span className="text-xs text-steel">{s.asset?.name}</span></Td>
                <Td className="mono text-xs text-steel">{[s.intervalDays && `${s.intervalDays} d`, s.intervalMeter && `${s.intervalMeter} ${s.meterUnit ?? s.meterKey}`].filter(Boolean).join(" / ")}</Td>
                <Td className="mono text-xs text-steel">
                  {s.nextDueAt?.slice(0, 10)}{s.nextDueMeter != null && ` · @${s.nextDueMeter.toLocaleString()}${s.meterValue != null ? ` (now ${s.meterValue.toLocaleString()})` : ""}`}
                </Td>
                <Td>{s.openJobId ? <Link href={`/jobs/${s.openJobId}`} className="mono text-xs text-trace hover:underline">{s.openJobId}</Link> : <span className="text-dim">—</span>}</Td>
                <Td>{!s.active ? <StatusPill value="PAUSED" /> : s.overdue ? <StatusPill value="OVERDUE" tone="bad" /> : s.openJobId ? <StatusPill value="RAISED" tone="info" /> : <StatusPill value="SCHEDULED" tone="good" />}</Td>
                <Td>
                  {canManage && !s.openJobId && s.active && (
                    <button disabled={busy} onClick={() => { const reason = window.prompt("Why skip this cycle?"); if (reason) act(`/pm/schedules/${s.id}/skip`, { reason }, () => `${s.id}: cycle skipped.`); }}
                      className="mono text-[10px] tracking-widest text-steel hover:text-fg">SKIP</button>
                  )}
                </Td>
              </Tr>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}
