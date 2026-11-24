"use client";

import { useEffect, useState } from "react";
import { WorkflowConfig } from "./types";
import { mock } from "./mock-data";

let cached: WorkflowConfig | null = null;

/**
 * FR-02 — the client renders status pills, action buttons and mandatory-field
 * forms from GET /config. Change a workflow rule on the server and the UI
 * changes without recoding. Falls back to the bundled sample offline.
 */
export function useConfig(): WorkflowConfig | null {
  const [cfg, setCfg] = useState<WorkflowConfig | null>(cached);
  useEffect(() => {
    if (cached) return;
    const base = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
    fetch(`${base}/config`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((c: WorkflowConfig) => { cached = c; setCfg(c); })
      .catch(() => { cached = mock.config as WorkflowConfig; setCfg(cached); });
  }, []);
  return cfg;
}
