"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { currencyCode, currencySymbol } from "@/lib/format";
import { Rates, setRates, useRates } from "@/lib/fx";
import { Button, Panel } from "@/components/ui";

const input = "mono rounded-md border hairline bg-ink-deep px-2 py-1.5 text-xs text-fg outline-none focus:border-trace";
const today = () => new Date().toISOString().slice(0, 10);

/** The organisation's exchange-rate table: what one unit of each currency is worth in its own. */
export function ExchangeRatesPanel() {
  const rates = useRates();
  const [form, setForm] = useState({ currency: "USD", effectiveFrom: today(), rate: "" });
  const [jumped, setJumped] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rates) return null;
  const typed = Number(form.rate);

  async function save(confirm = false) {
    setBusy(true); setMsg(null);
    try {
      setRates(await api.put<Rates>("/fx/rates", { ...form, rate: typed, confirm }));
      setMsg({ ok: true, text: `Saved: ${form.currency} 1 = ${currencySymbol()} ${typed} from ${form.effectiveFrom}. Recorded transactions keep their own rate.` });
      setForm({ ...form, rate: "" }); setJumped(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === "RATE_JUMP") setJumped(e.message);
      else setMsg({ ok: false, text: (e as Error).message });
    } finally { setBusy(false); }
  }
  async function remove(id: number) {
    setBusy(true); setMsg(null);
    try { setRates(await api.del<Rates>(`/fx/rates/${id}`)); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <Panel className="fade-up d4 mt-5 p-5">
      <p className="eyebrow mb-1">Exchange rates · against {currencyCode()}</p>
      <p className="mb-4 text-sm text-steel">
        Quotations, purchases, vendor repairs and invoices can be in these currencies. Each uses the rate in force on its date, and keeps it:
        changing or removing a rate never alters what is already recorded. Purchases are fixed at the rate on the day the goods arrive; invoices when the tax invoice is raised.
      </p>
      {rates.currencies.length === 0 ? <p className="mb-4 text-sm text-dim">No rates yet — until there are, everything is in {currencyCode()} only.</p> : (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b hairline">{["Currency", "Rate", "Inverse", "From", ""].map((h) => <th key={h} className="eyebrow px-2 py-2 font-normal">{h}</th>)}</tr></thead>
            <tbody>
              {rates.currencies.map((c) => (
                <tr key={c.code} className="border-b hairline align-top">
                  <td className="px-2 py-2"><span className="mono text-fg">{c.code}</span> <span className="text-xs text-dim">{c.name}</span></td>
                  <td className="mono px-2 py-2 text-fg">{c.rate === null ? <span className="text-dim">from a later date</span> : `${c.code} 1 = ${currencySymbol()} ${c.rate}`}</td>
                  <td className="mono px-2 py-2 text-xs text-steel">{c.inverse ? `${currencySymbol()} 1 = ${c.code} ${c.inverse}` : "—"}</td>
                  <td className="mono px-2 py-2 text-xs">{c.effectiveFrom ?? "—"}{c.stale && <span className="ml-1 text-amber">· {c.ageDays} days old</span>}</td>
                  <td className="px-2 py-2 text-right">
                    <button className="mono text-[10px] tracking-widest text-steel hover:text-trace" onClick={() => setOpen(open === c.code ? null : c.code)}>{open === c.code ? "HIDE" : `HISTORY (${c.history.length})`}</button>
                    {open === c.code && (
                      <ul className="mt-2 space-y-1 text-left">
                        {c.history.map((h) => (
                          <li key={h.id} className="mono flex items-center justify-between gap-3 text-[11px] text-steel">
                            <span>{h.effectiveFrom} · {h.rate} · {h.enteredBy}</span>
                            <button disabled={busy} onClick={() => remove(h.id)} className="text-steel hover:text-brand-bright" aria-label={`Remove the ${c.code} rate of ${h.effectiveFrom}`}>✕</button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">CURRENCY</span>
          <select value={form.currency} onChange={(e) => { setForm({ ...form, currency: e.target.value }); setJumped(null); }} className={input}>
            {rates.available.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          </select></label>
        <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">FROM</span>
          <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className={input} /></label>
        <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">{form.currency} 1 = {currencySymbol()}</span>
          <input inputMode="decimal" value={form.rate} onChange={(e) => { setForm({ ...form, rate: e.target.value }); setJumped(null); }} className={`${input} w-32`} aria-label="Rate" /></label>
        <Button disabled={busy || !(typed > 0)} onClick={() => save()}>Save rate</Button>
      </div>
      {typed > 0 && <p className="mono mt-2 text-[11px] text-steel">{form.currency} 1 = {currencySymbol()} {typed} · {currencySymbol()} 1 = {form.currency} {(1 / typed).toFixed(4)}</p>}
      {jumped && (
        <div className="mt-3 rounded border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-amber">
          <p className="mb-2">{jumped}</p>
          <Button disabled={busy} onClick={() => save(true)}>It is right — save it</Button>
        </div>
      )}
      {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</p>}
    </Panel>
  );
}
