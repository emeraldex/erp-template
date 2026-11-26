"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useM } from "@/lib/m-text";
import { useField } from "@/lib/offline/field";

/** Sticky title bar with an optional back button and the sync chip. */
export function MHeader({ title, back }: { title: string; back?: boolean }) {
  const router = useRouter();
  const m = useM();
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b hairline bg-ink/95 px-4 py-3 backdrop-blur">
      {back && (
        <button onClick={() => router.back()} aria-label={m("back")} className="-ml-1 rounded-md px-2 py-1 text-2xl leading-none text-steel">‹</button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-fg">{title}</h1>
      <SyncChip />
    </header>
  );
}

/** "All sent" · "3 waiting" · "Offline since 10:42" — tap to send now. */
export function SyncChip() {
  const f = useField();
  const m = useM();
  const waiting = f.outbox.filter((i) => i.state === "pending").length;
  const failed = f.outbox.length - waiting;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  let text: string = m("allSent");
  let tone = "border-phosphor/40 text-phosphor";
  if (!f.online) { text = `${m("offlineSince")} ${time(f.offlineSince ?? new Date().toISOString())}`; tone = "border-amber/50 text-amber"; }
  if (f.syncing) { text = m("sending"); tone = "border-trace/50 text-trace"; }
  else if (waiting) { text = `${waiting} ${m("waiting")}${!f.online ? " · offline" : ""}`; tone = "border-amber/50 text-amber"; }
  if (failed) { text = `${failed} ${m("failed")}`; tone = "border-brand-bright/60 text-brand-bright"; }
  return (
    <Link href="/m/more#sync" onClick={() => { void f.sync(); }} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${tone}`} aria-live="polite">
      {text}
    </Link>
  );
}

const TABS = [
  { href: "/m", label: "myWork", icon: "M4 6h16M4 12h16M4 18h10" },
  { href: "/m/assets", label: "assets", icon: "M3 7l9-4 9 4-9 4-9-4zm0 5l9 4 9-4M3 17l9 4 9-4" },
  { href: "/m/alerts", label: "alerts", icon: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" },
  { href: "/m/more", label: "more", icon: "M5 12h.01M12 12h.01M19 12h.01" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const m = useM();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t hairline bg-ink-deep/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {TABS.map((t) => {
        const active = t.href === "/m" ? pathname === "/m" || pathname.startsWith("/m/job") : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-xs ${active ? "text-fg" : "text-steel"}`}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={active ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.icon} />
            </svg>
            {m(t.label)}
          </Link>
        );
      })}
    </nav>
  );
}

export function Section({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-b hairline px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function BigButton({ children, onClick, disabled, tone = "primary", type = "button" }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; tone?: "primary" | "ghost" | "danger"; type?: "button" | "submit";
}) {
  const cls = tone === "primary" ? "border-brand bg-brand text-white" : tone === "danger" ? "border-brand-bright/60 text-brand-bright" : "hairline text-fg";
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`min-h-[48px] rounded-lg border px-4 text-base font-medium transition-opacity disabled:opacity-40 ${cls}`}>
      {children}
    </button>
  );
}

export function Notice({ children, tone = "warn" }: { children: React.ReactNode; tone?: "warn" | "bad" | "good" }) {
  const cls = tone === "bad" ? "border-brand-bright/50 bg-brand-bright/10 text-brand-bright" : tone === "good" ? "border-phosphor/40 bg-phosphor/10 text-phosphor" : "border-amber/40 bg-amber/10 text-amber";
  return <p className={`mx-4 my-3 rounded-lg border px-3 py-2.5 text-sm ${cls}`}>{children}</p>;
}

/** Registers the service worker (production builds) and offers a reload when a new version is ready. */
export function AppUpdates() {
  const m = useM();
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const sw = reg.installing;
        sw?.addEventListener("statechange", () => {
          if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
        });
      });
    }).catch(() => { /* the app still works online */ });
  }, []);
  if (!waiting) return null;
  return (
    <div className="fixed inset-x-3 bottom-20 z-40 flex items-center justify-between gap-3 rounded-lg border border-trace/50 bg-panel px-4 py-3 text-sm shadow-xl">
      <span>{m("updateReady")}</span>
      <button className="rounded-md border border-trace/60 px-3 py-1.5 text-trace" onClick={() => waiting.postMessage("SKIP_WAITING")}>{m("reload")}</button>
    </div>
  );
}
