"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api, download } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { Asset } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, MetaPill, PageHeader, Panel, StatusPill, Table, Td, Tr } from "@/components/ui";

const field = "mono rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";
const input = `${field} w-full`;
const STATUS_TONE = { IN_SERVICE: "good", OUT_OF_SERVICE: "warn", RETIRED: "neutral" } as const;
const CRIT_TONE = { HIGH: "bad", MEDIUM: "warn", LOW: "neutral" } as const;
const blank = { tag: "", name: "", type: "", site: "", location: "", make: "", model: "", serialNo: "", criticality: "MEDIUM", parentId: "", meterKey: "", meterLabel: "", meterUnit: "", meterValue: "" };

export default function AssetsPage() {
  return (
    <Suspense fallback={<p className="eyebrow py-20 text-center">LOADING…</p>}>
      <AssetsRegister />
    </Suspense>
  );
}

/** The asset register: everything the organisation maintains, its meters and maintenance history. */
function AssetsRegister() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("id");
  const { lang } = useLang();
  const { cfg, terms, dict, label, can, modules } = useVocab();
  const [rows, setRows] = useState<Asset[] | null>(null);
  const [q, setQ] = useState("");
  const [site, setSite] = useState("");
  const [type, setType] = useState("");
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = can("assets.manage");

  const load = useCallback(() => {
    api.get<Asset[]>("/assets").then(setRows).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => (rows ?? []).filter((a) =>
    (!site || a.site === site) && (!type || a.type === type) &&
    (!q || `${a.tag} ${a.name} ${a.make} ${a.model} ${a.serialNo} ${a.location}`.toLowerCase().includes(q.toLowerCase()))), [rows, site, type, q]);

  async function create() {
    setBusy(true); setMsg(null);
    try {
      const types = dict("assetType"); const sites = dict("site");
      const a = await api.post<Asset>("/assets", {
        tag: form.tag, name: form.name, type: form.type || types[0]?.key, site: form.site || sites[0]?.key,
        location: form.location, make: form.make, model: form.model, serialNo: form.serialNo, criticality: form.criticality,
        ...(form.parentId ? { parentId: form.parentId } : {}),
        ...(form.meterKey ? { meters: [{ key: form.meterKey, label: form.meterLabel || form.meterKey, unit: form.meterUnit, value: Number(form.meterValue || 0) }] } : {}),
      });
      setAdding(false); setForm(blank); load();
      router.push(`/assets?id=${encodeURIComponent(a.id)}`);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  if (cfg && !modules.assets) return <p className="py-20 text-center text-sm text-dim">The asset register is switched off for this organisation (Settings → modules).</p>;

  return (
    <div>
      <PageHeader
        eyebrow="Register · hierarchy · meters · maintenance history"
        title={terms.assets}
        actions={
          <>
            {shown.length > 0 && (
              <Button variant="ghost" onClick={() => download(`/assets/labels?ids=${shown.slice(0, 100).map((a) => encodeURIComponent(a.id)).join(",")}`, "asset-labels.pdf").catch((e) => setMsg({ ok: false, text: (e as Error).message }))}>
                Print labels ({Math.min(shown.length, 100)})
              </Button>
            )}
            {shown.length > 0 && modules.requests && can("requests.manage") && (
              <Button variant="ghost" onClick={async () => {
                try {
                  const { codes } = await api.post<{ codes: string[] }>("/requests/points/assets", { assetIds: shown.slice(0, 100).map((a) => a.id) });
                  await download(`/requests/points/posters?codes=${codes.join(",")}&format=stickers`, "request-stickers.pdf");
                } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
              }}>
                Request stickers ({Math.min(shown.length, 100)})
              </Button>
            )}
            {canManage && <Button onClick={() => setAdding(!adding)} variant={adding ? "ghost" : "primary"}>{adding ? "Cancel" : `+ Add ${terms.asset.toLowerCase()}`}</Button>}
          </>
        }
      />
      {msg && <p className={`mb-4 rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>{msg.text}</p>}

      {adding && (
        <div className="panel ticked fade-up mb-6 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            {([["tag", "Tag / registration *"], ["name", "Name *"], ["make", "Make"], ["model", "Model"], ["serialNo", "Serial no."], ["location", "Where on site"]] as const).map(([k, l]) => (
              <label key={k} className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{l}</span>
                <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className={input} /></label>
            ))}
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={input}>
                {dict("assetType").map((t) => <option key={t.key} value={t.key}>{lang === "ms" && t.labelMs ? t.labelMs : t.label}</option>)}
              </select></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{terms.site}</span>
              <select value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} className={input}>
                {dict("site").map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Criticality</span>
              <select value={form.criticality} onChange={(e) => setForm({ ...form, criticality: e.target.value })} className={input}>
                {["HIGH", "MEDIUM", "LOW"].map((c) => <option key={c}>{c}</option>)}
              </select></label>
            <label className="block"><span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Part of</span>
              <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className={input}>
                <option value="">—</option>
                {(rows ?? []).map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name}</option>)}
              </select></label>
          </div>
          <p className="mono mb-2 mt-4 text-[10.5px] tracking-widest text-steel">METER (OPTIONAL) — E.G. ODOMETER km, HOURS h</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <input placeholder="Key (ODOMETER)" value={form.meterKey} onChange={(e) => setForm({ ...form, meterKey: e.target.value.toUpperCase() })} className={input} />
            <input placeholder="Label (Odometer)" value={form.meterLabel} onChange={(e) => setForm({ ...form, meterLabel: e.target.value })} className={input} />
            <input placeholder="Unit (km)" value={form.meterUnit} onChange={(e) => setForm({ ...form, meterUnit: e.target.value })} className={input} />
            <input placeholder="Current reading" value={form.meterValue} onChange={(e) => setForm({ ...form, meterValue: e.target.value })} className={input} />
          </div>
          <div className="mt-4"><Button disabled={busy || !form.tag || !form.name} onClick={create}>Add to register</Button></div>
        </div>
      )}

      <div className="fade-up d1 mb-4 flex flex-wrap items-center gap-2">
        <select value={site} onChange={(e) => setSite(e.target.value)} className={`${field} w-48`}>
          <option value="">All {terms.sites.toLowerCase()}</option>
          {dict("site").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className={`${field} w-48`}>
          <option value="">All types</option>
          {dict("assetType").map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tag, name, model…" className={`${field} ml-auto w-64`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className={openId ? "lg:col-span-3" : "lg:col-span-5"}>
          {rows && shown.length === 0 ? (
            <EmptyState title={`No ${terms.assets.toLowerCase()} match`} hint={canManage ? `Add your first ${terms.asset.toLowerCase()} above.` : "Adjust the filters."} />
          ) : (
            <div className="panel fade-up d2">
              <Table head={["Tag", "Name", "Type", terms.site, "Meter", "Open", "Status"]}>
                {shown.map((a) => (
                  <Tr key={a.id} onClick={() => router.push(`/assets?id=${encodeURIComponent(a.id)}`)}>
                    <Td className="mono text-xs text-trace">{a.tag}</Td>
                    <Td>{a.name}<span className="mono ml-2 text-[10.5px] text-dim">{[a.make, a.model].filter(Boolean).join(" ")}</span></Td>
                    <Td className="mono text-xs text-steel">{label("assetType", a.type)}</Td>
                    <Td className="mono text-xs text-steel">{label("site", a.site)}</Td>
                    <Td className="mono text-xs tabular-nums text-steel">{a.meters[0] ? `${a.meters[0].value.toLocaleString()} ${a.meters[0].unit}` : "—"}</Td>
                    <Td className="mono text-xs tabular-nums text-steel">{a.openJobs ?? 0}</Td>
                    <Td><StatusPill value={a.status.replaceAll("_", " ")} tone={STATUS_TONE[a.status]} /></Td>
                  </Tr>
                ))}
              </Table>
            </div>
          )}
        </div>
        {openId && <div className="lg:col-span-2"><AssetDetail id={openId} canManage={canManage} onChanged={load} /></div>}
      </div>
    </div>
  );
}

function AssetDetail({ id, canManage, onChanged }: { id: string; canManage: boolean; onChanged: () => void }) {
  const { cfg, terms, label, can, modules, lang } = useVocab();
  const [a, setA] = useState<Asset | null>(null);
  const [reading, setReading] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<Asset>(`/assets/${encodeURIComponent(id)}`).then(setA).catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, [id]);
  useEffect(() => { setA(null); setMsg(null); load(); }, [load]);

  async function record(key: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await api.post<{ value: number; unit: string; raised: string[] }>(`/assets/${encodeURIComponent(id)}/meters/${key}/readings`, { value: Number(reading[key]) });
      setMsg({ ok: true, text: `Recorded ${res.value} ${res.unit}.${res.raised.length ? ` Maintenance due — raised ${res.raised.join(", ")}.` : ""}` });
      setReading({ ...reading, [key]: "" }); load(); onChanged();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  async function setStatus(status: string) {
    setBusy(true);
    try { await api.patch(`/assets/${encodeURIComponent(id)}`, { status }); load(); onChanged(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    finally { setBusy(false); }
  }

  if (!a) return <Panel className="p-5"><p className="eyebrow">{msg?.text ?? "LOADING…"}</p></Panel>;
  const children = Array.isArray(a.children) ? a.children : [];
  const schedules = Array.isArray(a.schedules) ? a.schedules : [];

  return (
    <Panel ticked className="fade-up p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="mono text-xs text-trace">{a.tag} · {a.id}</p>
          <h2 className="display text-xl font-bold">{a.name}</h2>
          <p className="mono text-[10.5px] text-steel">{label("assetType", a.type)} · {label("site", a.site)}{a.location ? ` · ${a.location}` : ""}</p>
          {a.parent && <p className="mono text-[10.5px] text-steel">Part of <Link className="text-trace" href={`/assets?id=${encodeURIComponent(a.parent.id)}`}>{a.parent.tag} · {a.parent.name}</Link></p>}
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusPill value={a.status.replaceAll("_", " ")} tone={STATUS_TONE[a.status]} />
          <StatusPill value={`${a.criticality} CRITICALITY`} tone={CRIT_TONE[a.criticality]} />
        </div>
      </div>
      <p className="mono text-[10.5px] text-dim">{[a.make, a.model, a.serialNo && `S/N ${a.serialNo}`, a.commissionedOn && `in service ${a.commissionedOn}`].filter(Boolean).join(" · ")}</p>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}

      {a.meters.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow mb-2">Meters</p>
          {a.meters.map((m) => (
            <div key={m.key} className="mb-2 flex flex-wrap items-center gap-2 rounded border hairline bg-ink-deep/40 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{m.label}: <span className="mono text-fg">{m.value.toLocaleString()} {m.unit}</span></p>
                <p className="mono text-[10px] text-dim">{m.readAt ? `read ${m.readAt.slice(0, 16).replace("T", " ")}` : "no reading yet"}</p>
              </div>
              {can("meters.record") && (
                <>
                  <input value={reading[m.key] ?? ""} onChange={(e) => setReading({ ...reading, [m.key]: e.target.value })} placeholder="New reading" className="mono w-28 rounded-md border hairline bg-ink-deep px-2 py-1.5 text-xs text-fg outline-none focus:border-trace" />
                  <Button disabled={busy || !reading[m.key]} onClick={() => record(m.key)}>Record</Button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {modules.pm && (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="eyebrow">{terms.pm}</p>
            <Link href={`/pm?assetId=${encodeURIComponent(a.id)}`} className="mono text-[10px] tracking-widest text-steel hover:text-trace">{canManage ? "PLAN →" : "VIEW →"}</Link>
          </div>
          {schedules.length === 0 ? <p className="text-sm text-dim">No schedules yet.</p> : (
            <ul className="space-y-1.5">
              {schedules.map((s) => (
                <li key={s.id} className="rounded border hairline bg-ink-deep/40 px-3 py-2">
                  <p className="text-sm">{s.title}{!s.active && <span className="mono ml-2 text-[10px] text-dim">PAUSED</span>}</p>
                  <p className="mono text-[10px] text-dim">
                    {[s.intervalDays && `every ${s.intervalDays} d`, s.intervalMeter && `every ${s.intervalMeter} ${s.meterKey}`].filter(Boolean).join(" or ")}
                    {s.nextDueAt && ` · next ${s.nextDueAt.slice(0, 10)}`}{s.nextDueMeter != null && ` · at ${s.nextDueMeter}`}
                    {s.openJobId && <> · open <Link className="text-trace" href={`/jobs/${s.openJobId}`}>{s.openJobId}</Link></>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {children.length > 0 && (
        <div className="mt-4">
          <p className="eyebrow mb-2">Made up of</p>
          <ul className="space-y-1">
            {children.map((c) => <li key={c.id}><Link className="mono text-xs text-trace hover:underline" href={`/assets?id=${encodeURIComponent(c.id)}`}>{c.tag}</Link> <span className="text-sm">{c.name}</span></li>)}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="eyebrow mb-2">{terms.jobs} · history</p>
        {(a.jobs ?? []).length === 0 ? <p className="text-sm text-dim">None yet.</p> : (
          <ul className="space-y-1">
            {(a.jobs ?? []).map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2">
                <span><Link className="mono text-xs text-trace hover:underline" href={`/jobs/${j.id}`}>{j.id}</Link> <span className="mono text-[10px] text-dim">{j.psDate} · {label("jobType", j.jobType)}</span></span>
                <MetaPill status={j.status} meta={cfg?.jobStatusMeta?.[j.status]} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {canManage && (
        <div className="mt-4 flex flex-wrap gap-2 border-t hairline pt-3">
          {a.status !== "IN_SERVICE" && <Button variant="ghost" disabled={busy} onClick={() => setStatus("IN_SERVICE")}>Back in service</Button>}
          {a.status === "IN_SERVICE" && <Button variant="ghost" disabled={busy} onClick={() => setStatus("OUT_OF_SERVICE")}>Out of service</Button>}
          {a.status !== "RETIRED" && <Button variant="ghost" disabled={busy} onClick={() => setStatus("RETIRED")}>Retire</Button>}
        </div>
      )}
    </Panel>
  );
}
