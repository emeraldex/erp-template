"use client";

import { useEffect, useState } from "react";
import { WorkflowConfig } from "./types";
import { getWithFallback } from "./api";

let cached: WorkflowConfig | null = null;
const STORE_KEY = "erp.config";

/** The last config seen at this address, so screens keep the organisation's words offline. */
function saved(): WorkflowConfig | null {
  try { const raw = window.localStorage.getItem(STORE_KEY); return raw ? (JSON.parse(raw) as WorkflowConfig) : null; } catch { return null; }
}

/**
 * FR-02 — the client renders status pills, action buttons and mandatory-field
 * forms from GET /config. Change a workflow rule on the server and the UI
 * changes without recoding.
 */
export function useConfig(): WorkflowConfig | null {
  const [cfg, setCfg] = useState<WorkflowConfig | null>(cached);
  useEffect(() => {
    if (cached) return;
    getWithFallback<WorkflowConfig>("/config", "config")
      .then((r) => {
        cached = r.data;
        setCfg(r.data);
        try { window.localStorage.setItem(STORE_KEY, JSON.stringify(r.data)); } catch { /* full or private */ }
      })
      .catch(() => {
        // Offline (or signed out): fall back to the last copy, if any.
        const s = saved();
        if (s) { cached = s; setCfg(s); }
      });
  }, []);
  return cfg;
}
