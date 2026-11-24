"use client";

import { useEffect, useState } from "react";
import { WorkflowConfig } from "./types";
import { getWithFallback } from "./api";

let cached: WorkflowConfig | null = null;

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
      .then((r) => { cached = r.data; setCfg(r.data); })
      .catch(() => { /* surfaced by the connection banner / auth redirect */ });
  }, []);
  return cfg;
}
