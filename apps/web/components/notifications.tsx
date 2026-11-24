"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { AppNotification } from "@/lib/types";

/** Topbar bell: SLA alerts for the signed-in user (FR-10). Refreshes every minute. */
export function NotificationBell() {
  const [data, setData] = useState<{ unread: number; items: AppNotification[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.get<{ unread: number; items: AppNotification[] }>("/notifications").then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const read = (n: AppNotification) => {
    if (!n.read) api.post(`/notifications/${n.id}/read`, {}).then(load).catch(() => {});
    setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ""}`}
        className="relative rounded border hairline px-2.5 py-1.5 text-steel transition-colors hover:border-steel/50 hover:text-fg"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {data.unread > 0 && (
          <span className="mono absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10px] leading-[18px] text-white">
            {data.unread > 99 ? "99+" : data.unread}
          </span>
        )}
      </button>
      {open && (
        <div className="panel absolute right-0 z-30 mt-2 w-[360px] max-w-[calc(100vw-2rem)] p-0 shadow-xl">
          <div className="flex items-center justify-between border-b hairline px-4 py-2.5">
            <p className="eyebrow">Alerts</p>
            {data.unread > 0 && (
              <button onClick={() => api.post("/notifications/read-all", {}).then(load).catch(() => {})} className="mono text-[10px] tracking-widest text-steel hover:text-trace">
                MARK ALL READ
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {data.items.length === 0 && <li className="px-4 py-6 text-center text-sm text-dim">No alerts.</li>}
            {data.items.map((n) => {
              const body = (
                <>
                  <p className={`text-sm ${n.read ? "text-steel" : "text-fg"}`}>
                    {!n.read && <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${n.kind === "sla.breached" ? "bg-brand-bright" : "bg-amber"}`} />}
                    {n.title}
                  </p>
                  <p className="mono mt-0.5 text-[10.5px] text-dim">{n.body}</p>
                  <p className="mono mt-0.5 text-[10px] text-dim">{n.createdAt.slice(0, 16).replace("T", " ")}</p>
                </>
              );
              return (
                <li key={n.id} className="border-b hairline last:border-0">
                  {n.link ? (
                    <Link href={n.link} onClick={() => read(n)} className="block px-4 py-3 hover:bg-panel-2">{body}</Link>
                  ) : (
                    <button onClick={() => read(n)} className="block w-full px-4 py-3 text-left hover:bg-panel-2">{body}</button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
