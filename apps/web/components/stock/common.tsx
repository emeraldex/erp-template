"use client";

import type { ReactNode } from "react";
import { fmtMoney } from "@/lib/format";

export const field = "mono rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace";
export const input = `${field} w-full`;

export type Msg = { ok: boolean; text: string } | null;

export function Notice({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <p className={`mb-4 whitespace-pre-line rounded border px-3 py-2 text-sm ${msg.ok ? "border-phosphor/40 text-phosphor" : "border-brand-bright/40 bg-brand-bright/10 text-brand-bright"}`}>
      {msg.text}
    </p>
  );
}

export function Labelled({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{label}</span>
      {children}
    </label>
  );
}

/** A quantity without trailing zeros: 2, 2.5, 0.125. */
export const qty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });

/** An exact amount in the organisation's currency. */
export const money = (n: number) => fmtMoney(n);

export const MOVEMENT_LABEL: Record<string, string> = {
  OPENING: "Opening stock", RECEIPT: "Received", ISSUE: "Issued", RETURN: "Returned", ADJUST: "Adjusted",
  COUNT: "Count", TRANSFER_OUT: "Transferred out", TRANSFER_IN: "Transferred in",
};

export const errText = (e: unknown) => (e as Error).message;
