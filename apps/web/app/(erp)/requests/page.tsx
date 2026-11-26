"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import type { ServiceRequest, ServiceRequestSummary } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, PageHeader, StatusPill, Table, Td, Tr } from "@/components/ui";
import { RequestDetail, REQUEST_TONE, SOURCE_LABEL } from "@/components/requests/detail";
import { PostersView } from "@/components/requests/posters";

type Tab = "NEW" | "ACCEPTED" | "DECLINED" | "ALL" | "POSTERS";
const TABS: [Tab, string][] = [["NEW", "NEW"], ["ACCEPTED", "ACCEPTED"], ["DECLINED", "DECLINED"], ["ALL", "ALL"], ["POSTERS", "QR POSTERS"]];
const field = "mono rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";
const blank = { description: "", place: "", site: "", category: "", urgent: false, name: "", email: "", phone: "" };

export default function RequestsPage() {
  return (
    <Suspense fallback={<p className="eyebrow py-20 text-center">LOADING…</p>}>
      <Requests />
    </Suspense>
  );
}

/** The help desk's inbox of problems reported through the portal, QR posters and callers. */
function Requests() {
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("id");
  const tab = (params.get("tab") as Tab) || "NEW";
  const { cfg, modules, can, dict, terms, lang } = useVocab();
  const [rows, setRows] = useState<ServiceRequestSummary[] | null>(null);
  const [q, setQ] = useState("");
  const [logging, setLogging] = useState(false);
  const [form, setForm] = useState(blank);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (tab === "POSTERS") return;
    api.get<ServiceRequestSummary[]>(`/requests?status=${tab}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`).then(setRows).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, [tab, q]);
  useEffect(() => { const timer = setTimeout(load, q ? 250 : 0); return () => clearTimeout(timer); }, [load, q]);

  const go = (next: { tab?: Tab; id?: string | null }) => {
    const p = new URLSearchParams();
    const t = next.tab ?? tab;
    if (t !== "NEW") p.set("tab", t);
    const id = next.id === undefined ? openId : next.id;
    if (id) p.set("id", id);
    router.push(`/requests${p.toString() ? `?${p}` : ""}`);
  };

  async function log() {
    setBusy(true); setMsg(null);
    try {
      const r = await api.post<ServiceRequest>("/requests", form);
      setLogging(false); setForm(blank); load();
      go({ id: r.id, tab: "NEW" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  if (cfg && !modules.requests) return <p className="py-20 text-center text-sm text-dim">The request portal is switched off for this organisation (Settings → modules).</p>;
  if (cfg && !can("requests.manage")) return <p className="py-20 text-center text-sm text-dim">Your role does not triage requests.</p>;
  const name = (e: { label: string; labelMs: string }) => (lang === "ms" && e.labelMs ? e.labelMs : e.label);

  return (
    <div>
      <PageHeader
        eyebrow="Portal · QR posters · callers — triage into work"
        title="Requests"
        actions={tab !== "POSTERS" && <Button variant={logging ? "ghost" : "primary"} onClick={() => setLogging(!logging)}>{logging ? "Cancel" : "+ Log a request"}</Button>}
      />
      <div className="fade-up mb-4 flex flex-wrap gap-1 border-b hairline pb-2">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => go({ tab: k, id: null })} className={`mono rounded-md px-3 py-1.5 text-[11px] tracking-widest ${tab === k ? "bg-trace/15 text-trace" : "text-steel hover:text-fg"}`}>{l}</button>
        ))}
      </div>
      {msg && <p className={`mb-4 rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>{msg.text}</p>}

      {logging && (
        <div className="panel ticked fade-up mb-6 p-5">
          <p className="eyebrow mb-1">Log a request for a caller</p>
          <p className="mb-3 text-sm text-steel">For someone who phoned or walked in. They get the same tracking link and emails (if they give an address).</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="block sm:col-span-4"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">What is wrong *</span>
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={`${field} w-full`} /></label>
            <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">{terms.site}</span>
              <select value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} className={`${field} w-full`}>
                <option value="">—</option>
                {dict("site").map((s) => <option key={s.key} value={s.key}>{name(s)}</option>)}
              </select></label>
            <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Place</span>
              <input value={form.place} onChange={(e) => setForm({ ...form, place: e.target.value })} className={`${field} w-full`} /></label>
            <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Type</span>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={`${field} w-full`}>
                <option value="">—</option>
                {dict("category").map((c) => <option key={c.key} value={c.key}>{name(c)}</option>)}
              </select></label>
            <label className="flex items-end gap-2 pb-2 text-sm text-steel"><input type="checkbox" checked={form.urgent} onChange={(e) => setForm({ ...form, urgent: e.target.checked })} /> Urgent / safety</label>
            <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Caller's name *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${field} w-full`} /></label>
            <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Phone</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`${field} w-full`} /></label>
            <label className="block sm:col-span-2"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Email</span>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`${field} w-full`} /></label>
          </div>
          <div className="mt-4"><Button disabled={busy || form.description.trim().length < 5 || form.name.trim().length < 2 || (!form.email.trim() && !form.phone.trim())} onClick={log}>Log request</Button></div>
        </div>
      )}

      {tab === "POSTERS" ? <PostersView /> : (
        <>
          <div className="fade-up d1 mb-4 flex">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search reference, words, name, email, phone, work order…" className={`${field} ml-auto w-80`} />
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            <div className={openId ? "lg:col-span-3" : "lg:col-span-5"}>
              {rows && rows.length === 0 ? (
                <EmptyState title={tab === "NEW" ? "Nothing waiting" : "No requests here"} hint={tab === "NEW" ? "New requests from the portal and QR posters appear here." : "Try another tab or search."} />
              ) : (
                <div className="panel fade-up d2">
                  <Table head={["Request", "What", "Where", "From", tab === "NEW" ? "Waiting" : "Outcome", ""]}>
                    {(rows ?? []).map((r) => (
                      <Tr key={r.id} onClick={() => go({ id: r.id })}>
                        <Td className="mono whitespace-nowrap text-xs text-trace">{r.id}</Td>
                        <Td>
                          <span className="line-clamp-2 text-sm">{r.description}</span>
                          <span className="mono text-[10px] text-dim">{r.requesterName}{r.photos ? ` · 📷 ${r.photos}` : ""}{r.awaitingReply ? " · replied" : ""}</span>
                        </Td>
                        <Td className="mono text-xs text-steel">{[r.place, r.siteLabel].filter(Boolean).join(" · ") || "—"}</Td>
                        <Td className="mono whitespace-nowrap text-xs text-steel">{SOURCE_LABEL[r.source]}</Td>
                        <Td className="mono whitespace-nowrap text-xs text-steel">
                          {r.status === "NEW" ? age(r.createdAt) : r.jobId ?? (r.status === "CANCELLED" ? "cancelled" : "declined")}
                          {r.rating !== null && <span className="ml-2 text-amber">{r.rating}★</span>}
                        </Td>
                        <Td>
                          <span className="flex flex-col items-end gap-1">
                            {r.urgent && <StatusPill value="URGENT" tone="bad" />}
                            {tab === "ALL" && <StatusPill value={r.status} tone={REQUEST_TONE[r.status]} />}
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </Table>
                </div>
              )}
            </div>
            {openId && <div className="lg:col-span-2"><RequestDetail id={openId} onChanged={load} /></div>}
          </div>
        </>
      )}
    </div>
  );
}

/** "12 min", "3 h", "2 d" since it came in. */
function age(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return mins < 60 ? `${mins} min` : mins < 48 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
}
