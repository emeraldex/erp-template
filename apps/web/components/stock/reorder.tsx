"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ReorderLine } from "@/lib/types";
import { useVocab } from "@/lib/vocab";
import { Button, EmptyState, Table, Td, Tr } from "@/components/ui";
import { errText, money, Msg, Notice, qty } from "./common";

const keyOf = (l: ReorderLine) => `${l.partId}|${l.store}`;

/** Everything at or below its reorder point, with a suggested quantity, and one tap to raise the purchase requests. */
export function ReorderView({ canManage }: { canManage: boolean }) {
  const { label, terms } = useVocab();
  const [rows, setRows] = useState<ReorderLine[] | null>(null);
  const [pick, setPick] = useState<Record<string, boolean>>({});
  const [amount, setAmount] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get<ReorderLine[]>("/stock/reorder").then((r) => {
      setRows(r);
      setPick(Object.fromEntries(r.filter((l) => !l.openRequest).map((l) => [keyOf(l), true])));
      setAmount(Object.fromEntries(r.map((l) => [keyOf(l), String(l.suggested)])));
    }).catch((e) => setMsg({ ok: false, text: errText(e) }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const chosen = (rows ?? []).filter((l) => pick[keyOf(l)] && !l.openRequest);

  async function raise() {
    setBusy(true); setMsg(null);
    try {
      const { raised } = await api.post<{ raised: string[] }>("/stock/reorder", { items: chosen.map((l) => ({ partId: l.partId, store: l.store, qty: Number(amount[keyOf(l)]) })) });
      setMsg({ ok: true, text: `Raised ${raised.length} purchase request${raised.length === 1 ? "" : "s"}: ${raised.join(", ")}. They go through quotations and ordering like any other, and close when received into stock.` });
      load();
    } catch (e) {
      setMsg({ ok: false, text: errText(e) });
    } finally { setBusy(false); }
  }

  if (rows && rows.length === 0) {
    return <EmptyState title="Nothing to reorder" hint="Every store is above its reorder points. Set reorder points on each part's store to be alerted here." />;
  }

  return (
    <>
      <Notice msg={msg} />
      <div className="panel fade-up">
        <Table head={["", "Part", "Store", "On hand", "Reorder at", "Order", "Est. cost", "Request"]}>
          {(rows ?? []).map((l) => {
            const k = keyOf(l);
            return (
              <Tr key={k}>
                <Td>{canManage && !l.openRequest && <input type="checkbox" aria-label={`Order ${l.partNo}`} checked={!!pick[k]} onChange={(e) => setPick({ ...pick, [k]: e.target.checked })} />}</Td>
                <Td>
                  <Link href={`/stock?part=${encodeURIComponent(l.partId)}`} className="mono text-xs text-trace hover:underline">{l.partNo}</Link>
                  <span className="ml-2">{l.name}</span>
                </Td>
                <Td className="mono text-xs text-steel">{l.storeLabel}{l.bin && <span className="text-dim"> · {l.bin}</span>}</Td>
                <Td className={`mono text-xs tabular-nums ${l.qty === 0 ? "text-brand-bright" : "text-amber"}`}>{qty(l.qty)} {label("unit", l.unit)}</Td>
                <Td className="mono text-xs tabular-nums text-steel">{qty(l.reorderPoint)}</Td>
                <Td>
                  {canManage && !l.openRequest ? (
                    <input inputMode="decimal" aria-label={`Quantity of ${l.partNo}`} value={amount[k] ?? ""} onChange={(e) => setAmount({ ...amount, [k]: e.target.value })}
                      className="mono w-20 rounded-md border hairline bg-ink-deep px-2 py-1 text-xs text-fg outline-none focus:border-trace" />
                  ) : <span className="mono text-xs text-steel">{qty(l.suggested)}</span>}
                </Td>
                <Td className="mono text-xs tabular-nums text-steel">{money((Number(amount[k]) || 0) * l.avgCost)}</Td>
                <Td className="mono text-xs">
                  {l.openRequest ? <Link href={`/demands?id=${encodeURIComponent(l.openRequest)}`} className="text-trace hover:underline">{l.openRequest}</Link> : <span className="text-dim">—</span>}
                </Td>
              </Tr>
            );
          })}
        </Table>
      </div>
      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busy || chosen.length === 0} onClick={raise}>Raise {chosen.length} purchase request{chosen.length === 1 ? "" : "s"}</Button>
          <p className="text-xs text-dim">One request per line, for the store, without a {terms.job.toLowerCase()}. Lines with a request already open are left out.</p>
        </div>
      )}
    </>
  );
}
