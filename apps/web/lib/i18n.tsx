"use client";

// Bilingual interface support (English / Bahasa Melayu) — CO-RFP-IT-001 §7.2.
// Status names and workflow action labels come bilingual from GET /config;
// this dictionary covers the chrome (navigation, headings, common labels).

import { createContext, useContext, useEffect, useState } from "react";

export type Lang = "en" | "ms";

const DICT = {
  command: { en: "Command", ms: "Papan Pemuka" },
  jobs: { en: "JTS Job Register", ms: "Daftar Kerja JTS" },
  procurement: { en: "Demands & Procurement", ms: "Permohonan & Perolehan" },
  ov: { en: "Outside Vendor", ms: "Vendor Luar" },
  registers: { en: "Suppliers & Vendors", ms: "Pembekal & Vendor" },
  fod: { en: "FOD & Quality", ms: "FOD & Kualiti" },
  invoicing: { en: "Invoicing & Revenue", ms: "Invois & Hasil" },
  aogRoa: { en: "AOG / ROA Priority", ms: "Keutamaan AOG / ROA" },
  operations: { en: "Operations", ms: "Operasi" },
  supplyChain: { en: "Supply Chain", ms: "Rantaian Bekalan" },
  finance: { en: "Finance", ms: "Kewangan" },
  quality: { en: "Quality", ms: "Kualiti" },
  administration: { en: "Administration", ms: "Pentadbiran" },
  reports: { en: "Reports & Exports", ms: "Laporan & Eksport" },
  settings: { en: "Settings", ms: "Tetapan" },
  workflow: { en: "Workflow Editor", ms: "Penyunting Aliran Kerja" },
  users: { en: "Users", ms: "Pengguna" },
  attachments: { en: "Attachments", ms: "Lampiran" },
  documents: { en: "Documents", ms: "Dokumen" },
  signOut: { en: "Sign out", ms: "Log keluar" },
  status: { en: "Status", ms: "Status" },
  location: { en: "Location", ms: "Lokasi" },
  actions: { en: "Available actions", ms: "Tindakan tersedia" },
  auditTrail: { en: "Audit trail", ms: "Jejak audit" },
  records: { en: "Records on file", ms: "Rekod difailkan" },
  search: { en: "Search…", ms: "Cari…" },
  noActions: { en: "No actions for your role at this stage", ms: "Tiada tindakan untuk peranan anda pada peringkat ini" },
  submit: { en: "Submit", ms: "Hantar" },
  daysInStatus: { en: "days in status", ms: "hari dalam status" },
  processOwner: { en: "Process owner", ms: "Pemilik proses" },
} as const;

export type DictKey = keyof typeof DICT;

const LangCtx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: DictKey) => string }>({
  lang: "en",
  setLang: () => {},
  t: (k) => DICT[k].en,
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    const saved = window.localStorage.getItem("erp.lang") as Lang | null;
    if (saved === "ms" || saved === "en") setLangState(saved);
  }, []);
  const setLang = (l: Lang) => {
    setLangState(l);
    window.localStorage.setItem("erp.lang", l);
  };
  const t = (k: DictKey) => DICT[k][lang];
  return <LangCtx.Provider value={{ lang, setLang, t }}>{children}</LangCtx.Provider>;
}

export function useLang() {
  return useContext(LangCtx);
}
