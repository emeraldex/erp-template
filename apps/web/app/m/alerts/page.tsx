"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MHeader, Notice } from "@/components/m/ui";
import { api } from "@/lib/api";
import { useM } from "@/lib/m-text";
import type { AppNotification } from "@/lib/types";

/** The person's alerts: assignments and SLA warnings. Links open the phone screens. */
export default function AlertsScreen() {
  const m = useM();
  const [data, setData] = useState<{ unread: number; items: AppNotification[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api.get<{ unread: number; items: AppNotification[] }>("/notifications").then(setData).catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => { load(); }, [load]);
  const phoneLink = (link?: string) => link?.replace(/^\/jobs\/(.+)$/, (_, id) => `/m/job?id=${id}`);

  return (
    <div>
      <MHeader title={m("alerts")} />
      {error && <Notice tone="bad">{error}</Notice>}
      {data && data.unread > 0 && (
        <div className="px-4 pt-3">
          <button onClick={() => api.post("/notifications/read-all", {}).then(load).catch(() => {})} className="min-h-[44px] w-full rounded-lg border hairline text-steel">
            {m("markAllRead")}
          </button>
        </div>
      )}
      {data && data.items.length === 0 && <p className="px-4 py-12 text-center text-steel">{m("noAlerts")}</p>}
      <ul className="space-y-2 px-4 py-3">
        {(data?.items ?? []).map((n) => {
          const body = (
            <div className={`rounded-xl border px-4 py-3 ${n.read ? "hairline" : "border-trace/50 bg-trace/5"}`}>
              <p className="text-base text-fg">{n.title}</p>
              <p className="text-sm text-steel">{n.body}</p>
              <p className="mt-1 text-xs text-dim">{n.createdAt.slice(0, 16).replace("T", " ")}</p>
            </div>
          );
          const href = phoneLink(n.link);
          return (
            <li key={n.id}>
              {href ? <Link href={href} onClick={() => { if (!n.read) api.post(`/notifications/${n.id}/read`, {}).catch(() => {}); }}>{body}</Link> : body}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
