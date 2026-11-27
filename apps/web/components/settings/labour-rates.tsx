"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { currencySymbol } from "@/lib/format";
import { Button, Panel } from "@/components/ui";

type Rates = {
  currency: string; defaultRate: number | null; roleRates: Record<string, number>;
  roles: { key: string; label: string; rate: number | null }[];
  people: { id: string; name: string; role: string; hourlyRate: number | null; effective: number | null }[];
};
const input = "mono w-24 rounded-md border hairline bg-ink-deep px-2 py-1.5 text-xs text-fg outline-none focus:border-trace";
const num = (v: string) => (v.trim() === "" ? null : Number(v));

/** Cost per hour: the organisation's default, each role's, and anyone's own. Logged time keeps the rate it was logged at. */
export function LabourRatesPanel() {
  const [r, setR] = useState<Rates | null>(null);
  const [def, setDef] = useState("");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [people, setPeople] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const take = (x: Rates) => {
    setR(x);
    setDef(x.defaultRate === null ? "" : String(x.defaultRate));
    setRoles(Object.fromEntries(x.roles.map((ro) => [ro.key, ro.rate === null ? "" : String(ro.rate)])));
    setPeople(Object.fromEntries(x.people.map((p) => [p.id, p.hourlyRate === null ? "" : String(p.hourlyRate)])));
  };
  useEffect(() => { api.get<Rates>("/labour/rates").then(take).catch(() => {}); }, []);
  if (!r) return null;

  async function save() {
    setBusy(true); setMsg(null);
    try {
      let next = await api.put<Rates>("/labour/rates", { defaultRate: num(def), roleRates: Object.fromEntries(Object.entries(roles).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, Number(v)])) });
      for (const p of r!.people) {
        const was = p.hourlyRate === null ? "" : String(p.hourlyRate);
        if ((people[p.id] ?? "") !== was) next = await api.put<Rates>(`/labour/people/${encodeURIComponent(p.id)}/rate`, { hourlyRate: num(people[p.id] ?? "") });
      }
      take(next);
      setMsg({ ok: true, text: "Saved. New time is costed at these rates; time already logged keeps its rate." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <Panel className="fade-up d4 mt-5 p-5">
      <p className="eyebrow mb-1">Labour rates · cost per hour ({currencySymbol()})</p>
      <p className="mb-4 text-sm text-steel">A person's own rate is used first, then their role's, then the default. Leave empty to fall back. Only people who manage labour see rates and labour cost.</p>
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <label className="block"><span className="mono mb-1 block text-[10px] tracking-widest text-steel">DEFAULT</span>
            <input inputMode="decimal" value={def} onChange={(e) => setDef(e.target.value)} className={input} aria-label="Default rate" /></label>
          <p className="mono mb-1 mt-4 text-[10px] tracking-widest text-steel">BY ROLE</p>
          {r.roles.filter((ro) => ro.key !== "ADMIN").map((ro) => (
            <label key={ro.key} className="mb-1.5 flex items-center justify-between gap-2 text-sm">
              <span className="text-fg">{ro.label}</span>
              <input inputMode="decimal" value={roles[ro.key] ?? ""} onChange={(e) => setRoles({ ...roles, [ro.key]: e.target.value })} className={input} aria-label={`Rate for ${ro.label}`} />
            </label>
          ))}
        </div>
        <div className="lg:col-span-2">
          <p className="mono mb-1 text-[10px] tracking-widest text-steel">PEOPLE (OWN RATE · IN USE)</p>
          <div className="max-h-80 overflow-y-auto">
            {r.people.map((p) => (
              <label key={p.id} className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate text-fg">{p.name} <span className="mono text-[10px] text-dim">{p.role}</span></span>
                <span className="flex shrink-0 items-center gap-2">
                  <input inputMode="decimal" value={people[p.id] ?? ""} onChange={(e) => setPeople({ ...people, [p.id]: e.target.value })} className={input} aria-label={`Own rate for ${p.name}`} />
                  <span className="mono w-16 text-right text-xs text-steel">{p.effective === null ? "—" : p.effective}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={busy} onClick={save}>Save rates</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}
