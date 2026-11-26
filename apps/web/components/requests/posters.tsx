"use client";

import { useCallback, useEffect, useState } from "react";
import { api, download } from "@/lib/api";
import type { RequestPoint } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, StatusPill, Table, Td, Tr } from "@/components/ui";

const field = "mono rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";

/** "Report a problem" QR posters for places, and stickers made from the asset register. */
export function PostersView() {
  const { dict, terms, lang } = useVocab();
  const [rows, setRows] = useState<RequestPoint[] | null>(null);
  const [form, setForm] = useState({ label: "", site: "" });
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.get<RequestPoint[]>("/requests/points").then(setRows).catch((e) => setMsg({ ok: false, text: (e as Error).message })); }, []);
  useEffect(() => { load(); }, [load]);
  const chosen = (rows ?? []).filter((p) => pick[p.code] && p.active).map((p) => p.code);

  async function add() {
    setBusy(true); setMsg(null);
    try {
      const p = await api.post<RequestPoint>("/requests/points", form);
      setForm({ label: "", site: form.site });
      setPick((x) => ({ ...x, [p.code]: true }));
      setMsg({ ok: true, text: `Added “${p.label}”. Tick it and print.` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }

  async function toggle(p: RequestPoint) {
    try { await api.patch(`/requests/points/${p.code}`, { active: !p.active }); load(); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  }

  const print = (format: "poster" | "stickers") =>
    download(`/requests/points/posters?codes=${chosen.join(",")}&format=${format}`, `request-${format}.pdf`).catch((e) => setMsg({ ok: false, text: (e as Error).message }));

  return (
    <>
      <div className="panel ticked fade-up mb-5 p-5">
        <p className="eyebrow mb-1">Add a place</p>
        <p className="mb-3 text-sm text-steel">
          A poster's QR code opens the request form with the place filled in, and needs no access code. For {terms.assets.toLowerCase()},
          use <b>Request stickers</b> on the {terms.assets.toLowerCase()} page.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block flex-1"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">Place</span>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Level 3 — east toilets" className={`${field} w-full`} />
          </label>
          <label className="block w-56"><span className="mono mb-1 block text-[10px] tracking-widest text-dim">{terms.site}</span>
            <select value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} className={`${field} w-full`}>
              <option value="">—</option>
              {dict("site").map((s) => <option key={s.key} value={s.key}>{lang === "ms" && s.labelMs ? s.labelMs : s.label}</option>)}
            </select>
          </label>
          <Button disabled={busy || form.label.trim().length < 2} onClick={add}>Add place</Button>
        </div>
      </div>
      {msg && <p className={`mb-4 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
      {rows && rows.length === 0 ? <EmptyState title="No posters yet" hint="Add the places where people should be able to report a problem." /> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button disabled={!chosen.length} onClick={() => print("poster")}>Print {chosen.length || ""} A4 poster{chosen.length === 1 ? "" : "s"}</Button>
            <Button variant="ghost" disabled={!chosen.length} onClick={() => print("stickers")}>Print as stickers</Button>
          </div>
          <div className="panel fade-up">
            <Table head={["", "Place", terms.site, terms.asset, "Requests", "Status", ""]}>
              {(rows ?? []).map((p) => (
                <Tr key={p.code}>
                  <Td>{p.active && <input type="checkbox" aria-label={`Print ${p.label}`} checked={!!pick[p.code]} onChange={(e) => setPick({ ...pick, [p.code]: e.target.checked })} />}</Td>
                  <Td>{p.label}<span className="mono ml-2 text-[10px] text-dim">{p.code}</span></Td>
                  <Td className="mono text-xs text-steel">{p.siteLabel || "—"}</Td>
                  <Td className="mono text-xs text-steel">{p.assetTag ?? "—"}</Td>
                  <Td className="mono text-xs tabular-nums">{p.requests}</Td>
                  <Td><StatusPill value={p.active ? "ON" : "OFF"} tone={p.active ? "good" : "neutral"} /></Td>
                  <Td><button onClick={() => toggle(p)} className="mono text-[10.5px] tracking-widest text-steel hover:text-trace">{p.active ? "SWITCH OFF" : "SWITCH ON"}</button></Td>
                </Tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </>
  );
}
