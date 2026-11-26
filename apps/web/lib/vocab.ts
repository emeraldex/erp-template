"use client";

import { useLang } from "./i18n";
import { useConfig } from "./use-config";
import { useSession } from "./use-session";
import type { DictEntry, Modules, StatusMeta, Terms, WorkflowConfig } from "./types";

/** The words the original (aviation) configuration uses — the fallback before /config loads. */
export const DEFAULT_TERMS: Terms = {
  job: "Job", jobs: "Jobs", jobNo: "PS no.", jobRegister: "JTS Job Register", component: "Component",
  originUnit: "Origin unit", site: "Branch", sites: "Branches", demand: "Spares demand", demands: "Demands & Procurement",
  vendorRepair: "Outside vendor repair", vendorRepairs: "Outside Vendor", priority: "AOG / ROA Priority",
  incident: "FOD incident", incidents: "FOD & Quality", registers: "Suppliers & Vendors",
  asset: "Asset", assets: "Assets", pm: "Preventive maintenance",
};

const ALL_MODULES: Modules = {
  procurement: true, vendorRepair: true, priority: true, incidents: true, tools: true, training: true,
  invoicing: true, registers: true, assets: false, pm: false, stock: false, requests: false,
};

export type WorkflowKind = "JOB" | "DEMAND" | "OV" | "INVOICE";

const META_KEY: Record<WorkflowKind, keyof WorkflowConfig> = {
  JOB: "jobStatusMeta", DEMAND: "demandStatusMeta", OV: "ovStatusMeta", INVOICE: "invoiceStatusMeta",
};

/** Keys of statuses that sit on the main progress line, in workflow order; the rest are branches. */
export function railOf(meta: Record<string, StatusMeta> | undefined): { order: string[]; branches: string[] } {
  const keys = Object.keys(meta ?? {});
  const flagged = keys.some((k) => meta![k].branch !== undefined);
  // Without explicit flags: problem statuses and alternative endings are branches.
  const firstFinal = keys.find((k) => meta![k].final);
  const isBranch = (k: string) => flagged ? !!meta![k].branch : meta![k].tone === "bad" || (!!meta![k].final && k !== firstFinal);
  return { order: keys.filter((k) => !isBranch(k)), branches: keys.filter(isBranch) };
}

/**
 * Everything a screen needs to speak the organisation's language: its terms,
 * which modules are on, its lists (sites, categories, roles…), its statuses
 * and what the signed-in person may do.
 */
export function useVocab() {
  const cfg = useConfig();
  const session = useSession();
  const { lang } = useLang();
  const aviation = !cfg?.pack || cfg.pack.id === "aviation";
  const terms: Terms = { ...DEFAULT_TERMS, ...(cfg?.terms ?? {}) };
  const modules: Modules = { ...ALL_MODULES, ...(cfg?.modules ?? {}) };

  const dict = (kind: string, activeOnly = true): DictEntry[] =>
    (cfg?.dictionary?.[kind] ?? []).filter((e) => !activeOnly || e.active);
  const label = (kind: string, key: string | undefined): string => {
    if (!key) return "";
    const e = (cfg?.dictionary?.[kind] ?? []).find((x) => x.key === key);
    return e ? (lang === "ms" && e.labelMs ? e.labelMs : e.label) : key;
  };
  const statusMeta = (kind: WorkflowKind): Record<string, StatusMeta> =>
    ((cfg?.[META_KEY[kind]] as Record<string, StatusMeta> | undefined) ?? {});
  const isFinal = (kind: WorkflowKind, key: string) => !!statusMeta(kind)[key]?.final;
  const phaseOf = (kind: WorkflowKind, key: string) => statusMeta(kind)[key]?.phase;

  /** May the signed-in person do this? (ADMIN may do everything.) */
  const can = (capability: string): boolean =>
    session?.user.role === "ADMIN" || !!session?.user.capabilities?.includes(capability);

  /** A procedure citation (QP.44…) — only the aviation configuration has these. */
  const ref = (text: string): string => (aviation ? text : "");

  return { cfg, session, lang, aviation, terms, modules, dict, label, statusMeta, isFinal, phaseOf, can, ref };
}
