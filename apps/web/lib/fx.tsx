"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { currencyCode, currencySymbol, fmtMoney } from "@/lib/format";
import { useVocab } from "@/lib/vocab";

/** One currency with a rate: organisation-currency units for one unit of it. */
export interface RateInfo {
  code: string; name: string; symbol: string; decimals: number;
  rate: number | null; effectiveFrom: string | null; inverse: number | null; stale: boolean; ageDays: number | null;
  history: { id: number; effectiveFrom: string; rate: number; enteredBy: string; enteredAt: string }[];
}
export interface Rates {
  base: string; staleDays: number; jumpLimitPct: number;
  currencies: RateInfo[];
  available: { code: string; name: string; symbol: string; decimals: number }[];
}

let cache: Promise<Rates> | null = null;
const listeners = new Set<(r: Rates) => void>();

/** The exchange-rate table, fetched once per page load (and again after it is changed). */
export function loadRates(): Promise<Rates> {
  cache ??= api.get<Rates>("/fx/rates").catch((e) => { cache = null; throw e; });
  return cache;
}
export function setRates(r: Rates) {
  cache = Promise.resolve(r);
  listeners.forEach((l) => l(r));
}

export function useRates(): Rates | null {
  const [r, setR] = useState<Rates | null>(null);
  useEffect(() => {
    let live = true;
    loadRates().then((x) => live && setR(x)).catch(() => {});
    listeners.add(setR);
    return () => { live = false; listeners.delete(setR); };
  }, []);
  return r;
}

/** Currencies a form may offer: the organisation's plus those with a rate in force. */
export function offered(r: Rates | null): string[] {
  return [currencyCode(), ...(r?.currencies ?? []).filter((c) => c.rate !== null).map((c) => c.code)];
}

/** "US$ 1,080.00" in any currency. */
export function fmtIn(n: number, c: { symbol: string; decimals: number }): string {
  return `${n < 0 ? "-" : ""}${c.symbol} ${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals })}`;
}

/** An amount in its own currency, with the organisation-currency amount beside it when they differ. */
export function Dual({ amount, currency, base, rate, className = "" }: { amount?: number; currency?: string; base: number; rate?: number; className?: string }) {
  const rates = useRates();
  if (!currency || currency === currencyCode() || amount === undefined) return <span className={`mono ${className}`}>{fmtMoney(base)}</span>;
  const c = rates?.available.find((x) => x.code === currency) ?? { symbol: currency, decimals: 2 };
  return (
    <span className={`mono ${className}`}>
      {fmtIn(amount, c)} <span className="text-dim">= {fmtMoney(base)}{rate ? ` at ${rate}` : ""}</span>
    </span>
  );
}

export interface MoneyValue { amount: string; currency: string; rate: string; confirm: boolean }

/**
 * An amount, its currency and (for people who keep rates) the rate. Shows the
 * conversion with the rate's date, warns when the rate is old, and asks for a
 * tick when a typed rate is far from the table's — the server refuses it
 * otherwise. With one currency on offer it is a plain amount field.
 */
export function MoneyInput({ value, onChange, lockedCurrency, className, disabled, label = "Amount" }: {
  value: MoneyValue; onChange: (v: MoneyValue) => void; lockedCurrency?: string; className: string; disabled?: boolean; label?: string;
}) {
  const rates = useRates();
  const { can } = useVocab();
  const codes = offered(rates);
  const cur = (lockedCurrency ?? value.currency) || currencyCode();
  const info = rates?.currencies.find((c) => c.code === cur);
  const foreign = cur !== currencyCode();
  const amount = Number(value.amount.replace(/,/g, ""));
  const typed = value.rate.trim() ? Number(value.rate) : NaN;
  const rate = Number.isFinite(typed) && typed > 0 ? typed : info?.rate ?? null;
  const far = Number.isFinite(typed) && info?.rate ? Math.abs(typed - info.rate) / info.rate > (rates?.jumpLimitPct ?? 20) / 100 : false;
  const set = (patch: Partial<MoneyValue>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <input inputMode="decimal" value={value.amount} disabled={disabled} onChange={(e) => set({ amount: e.target.value })} className={className} aria-label={label} />
        {(codes.length > 1 || foreign) && (
          <select value={cur} disabled={disabled || !!lockedCurrency} onChange={(e) => set({ currency: e.target.value === currencyCode() ? "" : e.target.value, rate: "", confirm: false })}
            className={`${className} !w-24 shrink-0`} aria-label={`${label} currency`}>
            {[...new Set([...codes, cur])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>
      {foreign && (
        <div className="text-[11px] text-steel">
          {rate !== null && Number.isFinite(amount) && value.amount.trim()
            ? <span className="mono">= {currencySymbol()} {(amount * rate).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} at {rate}</span>
            : <span className="mono">{cur} 1 = {currencySymbol()} {rate ?? "—"}</span>}
          {info?.effectiveFrom && !value.rate.trim() && <span className="text-dim"> · rate of {info.effectiveFrom}</span>}
          {info?.stale && !value.rate.trim() && <span className="text-amber"> · this rate is {info.ageDays} days old — ask finance to update it</span>}
          {!info?.rate && <span className="text-brand-bright"> · no rate for {cur} — ask finance to add one</span>}
        </div>
      )}
      {foreign && can("fx.manage") && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-steel">
          <input inputMode="decimal" value={value.rate} disabled={disabled} onChange={(e) => set({ rate: e.target.value, confirm: false })}
            placeholder={info?.rate ? `Rate (${info.rate})` : "Rate"} className={`${className} !w-32`} aria-label={`${label} rate`} />
          <span>{value.rate.trim() ? `${cur} 1 = ${currencySymbol()} ${value.rate}${typed > 0 ? ` · ${currencySymbol()} 1 = ${cur} ${(1 / typed).toFixed(4)}` : ""}` : "leave empty to use the table rate"}</span>
          {far && (
            <label className="flex items-center gap-1.5 text-amber">
              <input type="checkbox" checked={value.confirm} onChange={(e) => set({ confirm: e.target.checked })} /> far from the table rate — I have checked it
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/** Step-form keys for a money field: `<key>`, `<key>Currency`, `<key>Rate`, `<key>RateConfirm`. */
export function moneyFromFields(values: Record<string, string>, key: string): MoneyValue {
  return { amount: values[key] ?? "", currency: values[`${key}Currency`] ?? "", rate: values[`${key}Rate`] ?? "", confirm: values[`${key}RateConfirm`] === "true" };
}
/**
 * The currency shown is always sent with an amount (so an amount typed in
 * Ringgit is never read as the quotation's currency); with no amount, nothing
 * is sent and the server uses what it already knows.
 */
export function moneyToFields(values: Record<string, string>, key: string, m: MoneyValue, lockedCurrency?: string): Record<string, string> {
  const next: Record<string, string> = { ...values, [key]: m.amount };
  const has = m.amount.trim() !== "";
  const currency = lockedCurrency ?? (m.currency || currencyCode());
  for (const [k, v] of [[`${key}Currency`, has ? currency : ""], [`${key}Rate`, has ? m.rate.trim() : ""], [`${key}RateConfirm`, has && m.confirm ? "true" : ""]] as const) {
    if (v) next[k] = v; else delete next[k];
  }
  return next;
}
