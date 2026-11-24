"use client";

import { useEffect, useState } from "react";
import { api, getSession, getWithFallback } from "@/lib/api";
import { FodIncident, Tool, TrainingRecord } from "@/lib/types";
import { useLang } from "@/lib/i18n";
import { Button, OfflineNotice, PageHeader, Panel, StatusPill, Table, Td, Tr } from "@/components/ui";

const AREA_TONE = { AWARENESS: "info", CONTROL: "warn", CRITICAL: "bad" } as const;
const INC_TONE = { OPEN: "bad", UNDER_REVIEW: "warn", CLOSED: "good" } as const;
const TOOL_TONE = { IN: "good", OUT: "warn", MISSING: "bad" } as const;

export default function FodPage() {
  const { t } = useLang();
  const [incidents, setIncidents] = useState<FodIncident[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [training, setTraining] = useState<TrainingRecord[]>([]);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    partName: "", typeModel: "", serialNo: "", location: "",
    area: "CONTROL" as FodIncident["area"], discovered: "",
  });

  const user = getSession()?.user;

  useEffect(() => {
    getWithFallback<FodIncident[]>("/fod/incidents", "fodIncidents")
      .then((r) => { setIncidents(r.data); setOffline(r.offline); })
      .catch(console.error);
    getWithFallback<Tool[]>("/fod/tools", "tools").then((r) => setTools(r.data)).catch(console.error);
    getWithFallback<TrainingRecord[]>("/fod/training", "training").then((r) => setTraining(r.data)).catch(console.error);
  }, []);

  async function report() {
    setBusy(true); setError(null);
    try {
      const inc = await api.post<FodIncident>("/fod/incidents", form);
      setIncidents([inc, ...incidents]);
      setShowNew(false);
      setForm({ partName: "", typeModel: "", serialNo: "", location: "", area: "CONTROL", discovered: "" });
    } catch (e) {
      setError(offline ? "Reporting needs the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  async function toolAction(tag: string, status: Tool["status"]) {
    setBusy(true); setError(null);
    try {
      const updated = await api.patch<Tool>(`/fod/tools/${tag}`, { status, holder: user?.name });
      setTools((p) => p.map((x) => (x.tag === updated.tag ? updated : x)));
    } catch (e) {
      setError(offline ? "Actions need the live API — start apps/api." : (e as Error).message);
    } finally { setBusy(false); }
  }

  const boards = [...new Set(tools.map((tl) => tl.board))];

  return (
    <div>
      <OfflineNotice show={offline} />
      <PageHeader
        eyebrow="QP.46 · Foreign Object Control & Quality Compliance"
        title={t("fod")}
        actions={<Button onClick={() => setShowNew(!showNew)} variant={showNew ? "ghost" : "primary"}>{showNew ? "Cancel" : "+ Report FOD incident"}</Button>}
      />
      {error && <p className="mb-4 rounded border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-sm text-brand-bright">{error}</p>}

      {showNew && (
        <div className="panel ticked fade-up mb-6 p-5">
          <p className="eyebrow mb-3">FOD incident / near-mishap — routed to the FOD Focal Point for trend analysis</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ["partName", "Part name / nomenclature"],
                ["typeModel", "Type / model"],
                ["serialNo", "Serial no"],
                ["location", "Location"],
                ["discovered", "Who / when / how discovered"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="block">
                <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">{label} *</span>
                <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace" />
              </label>
            ))}
            <label className="block">
              <span className="mono mb-1 block text-[10.5px] tracking-widest text-steel">Area designation</span>
              <select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value as FodIncident["area"] })} className="mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace">
                <option value="AWARENESS">FOD AWARENESS</option>
                <option value="CONTROL">FOD CONTROL</option>
                <option value="CRITICAL">FOD CRITICAL</option>
              </select>
            </label>
          </div>
          <div className="mt-4">
            <Button disabled={busy || Object.values(form).some((v) => !v)} onClick={report}>Submit to FOD Focal Point</Button>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="panel fade-up d1">
            <Table head={["Ref", "Date", "Part", "Area", "Location", "Reporter", "Status"]}>
              {incidents.map((inc) => (
                <Tr key={inc.id}>
                  <Td className="mono text-xs text-trace">{inc.id}</Td>
                  <Td className="mono text-xs text-steel">{inc.date}</Td>
                  <Td>
                    {inc.partName}
                    <span className="mono ml-2 text-xs text-steel">{inc.typeModel} · {inc.serialNo}</span>
                  </Td>
                  <Td><StatusPill value={inc.area} tone={AREA_TONE[inc.area]} /></Td>
                  <Td className="mono text-xs text-steel">{inc.location}</Td>
                  <Td className="mono text-xs text-steel">{inc.reporter}</Td>
                  <Td><StatusPill value={inc.status} tone={INC_TONE[inc.status]} /></Td>
                </Tr>
              ))}
            </Table>
          </div>

          <Panel className="fade-up d3 mt-4 p-5">
            <p className="eyebrow mb-3">FOD training records · initial + annual recurrent (QP.10)</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {training.map((tr, i) => {
                const due = tr.nextDue <= "2026-08-31";
                return (
                  <div key={i} className="flex items-center justify-between rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                    <div>
                      <p className="text-sm">{tr.person}</p>
                      <p className="mono text-[10px] tracking-widest text-dim">{tr.course.replaceAll("_", " ")}</p>
                    </div>
                    <p className={`mono text-[10.5px] tracking-widest ${due ? "text-amber" : "text-steel"}`}>
                      NEXT {tr.nextDue}{due && " ▲"}
                    </p>
                  </div>
                );
              })}
            </div>
          </Panel>
        </div>

        <Panel ticked={tools.some((tl) => tl.status === "MISSING")} className="fade-up d2 p-5">
          <p className="eyebrow mb-3">Tool / TPME accountability · shadow boards</p>
          <div className="space-y-4">
            {boards.map((b) => (
              <div key={b}>
                <p className="mono mb-1.5 text-[10.5px] tracking-widest text-steel">{b}</p>
                <ul className="space-y-1.5">
                  {tools.filter((tl) => tl.board === b).map((tl) => (
                    <li key={tl.tag} className="flex items-center justify-between gap-2 rounded-md border hairline bg-ink-deep/40 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{tl.name}</p>
                        <p className="mono text-[10px] tracking-widest text-dim">
                          {tl.tag}{tl.holder ? ` · ${tl.holder}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <StatusPill value={tl.status} tone={TOOL_TONE[tl.status]} />
                        {tl.status === "IN" && (
                          <button disabled={busy} onClick={() => toolAction(tl.tag, "OUT")} className="mono rounded border hairline px-2 py-1 text-[10px] tracking-widest text-steel hover:text-fg">OUT</button>
                        )}
                        {tl.status !== "IN" && (
                          <button disabled={busy} onClick={() => toolAction(tl.tag, "IN")} className="mono rounded border hairline px-2 py-1 text-[10px] tracking-widest text-steel hover:text-fg">IN</button>
                        )}
                        {tl.status === "OUT" && (
                          <button disabled={busy} onClick={() => toolAction(tl.tag, "MISSING")} className="mono rounded border border-brand-bright/40 px-2 py-1 text-[10px] tracking-widest text-brand-bright">TMR</button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
