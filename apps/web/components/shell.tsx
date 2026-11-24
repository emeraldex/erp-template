"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, DEMO_MODE, getSession, onConnectionChange, setSession, Session } from "@/lib/api";
import { DictKey, useLang } from "@/lib/i18n";
import { NotificationBell } from "./notifications";

const NAV: { group: DictKey; items: { href: string; label: DictKey; code: string }[] }[] = [
  {
    group: "operations",
    items: [
      { href: "/dashboard", label: "command", code: "OPS" },
      { href: "/jobs", label: "jobs", code: "JTS" },
      { href: "/aog", label: "aogRoa", code: "QP.56" },
      { href: "/ov", label: "ov", code: "QP.33" },
    ],
  },
  {
    group: "supplyChain",
    items: [
      { href: "/demands", label: "procurement", code: "QP.14" },
      { href: "/registers", label: "registers", code: "QP.13" },
    ],
  },
  {
    group: "finance",
    items: [{ href: "/invoicing", label: "invoicing", code: "QP.51" }],
  },
  {
    group: "quality",
    items: [{ href: "/fod", label: "fod", code: "QP.46" }],
  },
  {
    group: "administration",
    items: [
      { href: "/reports", label: "reports", code: "FR-14" },
      { href: "/settings", label: "settings", code: "ADM" },
    ],
  },
];

function CompanyMark() {
  return (
    <Link href="/dashboard" className="flex items-center gap-3 px-5 py-5">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect x="4" y="4" width="24" height="24" rx="3" fill="none" stroke="var(--c-red)" strokeWidth="2.5" />
        <path d="M10 11.5h12M10 16h12M10 20.5h7" fill="none" stroke="var(--c-text)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div>
        <p className="display text-lg font-bold leading-none text-fg">COMPANY</p>
        <p className="eyebrow leading-none">SERVICES · AMO</p>
      </div>
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useLang();
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r hairline bg-ink-deep/80 backdrop-blur md:flex">
      <CompanyMark />
      <nav className="mt-2 flex-1 space-y-6 px-3">
        {NAV.map((g) => (
          <div key={g.group}>
            <p className="eyebrow mb-2 px-2">{t(g.group)}</p>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`group flex items-center justify-between rounded-md px-3 py-2 text-sm transition-all duration-200 ${
                        active
                          ? "border-l-2 border-brand bg-panel-2 pl-2.5 text-fg"
                          : "text-steel hover:bg-panel/70 hover:text-fg"
                      }`}
                    >
                      <span>{t(item.label)}</span>
                      <span
                        className={`mono text-[10px] tracking-widest transition-colors ${
                          active ? "text-brand-bright" : "text-dim group-hover:text-steel"
                        }`}
                      >
                        {item.code}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <p className="eyebrow px-5 py-4">CO-RFP-IT-001 · Prototype</p>
    </aside>
  );
}

export function Topbar() {
  const router = useRouter();
  const { lang, setLang } = useLang();
  const [session, setLocal] = useState<Session | null>(null);
  const [clock, setClock] = useState("");
  const [link, setLink] = useState<"ok" | "unreachable">("ok");
  useEffect(() => onConnectionChange(setLink), []);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setLocal(s);
    // Confirm the cookie session is still live and refresh the cached profile;
    // a 401 here sends the user back to sign in.
    api.me()
      .then(({ user }) => {
        setSession({ user });
        setLocal({ user });
        if (user.mustChangePassword) router.replace("/change-password");
      })
      .catch(() => { /* handled by the API client (redirect / banner) */ });
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-MY", { hour12: false, timeZone: "Asia/Kuala_Lumpur" }) + " MYT",
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [router]);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b hairline bg-ink/85 px-6 py-3 backdrop-blur">
      <div className="flex items-center gap-3">
        {link === "ok" ? (
          <span className="mono flex items-center gap-1.5 text-[10.5px] tracking-widest text-phosphor">
            <span className="blip h-1.5 w-1.5 rounded-full bg-phosphor" />
            SYSTEM NOMINAL
          </span>
        ) : (
          <span className="mono flex items-center gap-1.5 text-[10.5px] tracking-widest text-amber">
            <span className="h-1.5 w-1.5 rounded-full bg-amber" />
            SERVER UNREACHABLE
          </span>
        )}
        <span className="mono hidden text-[10.5px] tracking-widest text-dim sm:inline">{clock}</span>
      </div>
      <div className="flex items-center gap-4">
        {/* Bilingual toggle — §7.2 */}
        <div className="mono flex overflow-hidden rounded border hairline text-[10.5px] tracking-widest">
          {(["en", "ms"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={`px-2 py-1 transition-colors ${
                lang === l ? "bg-brand/20 text-fg" : "text-dim hover:text-steel"
              }`}
            >
              {l === "en" ? "EN" : "BM"}
            </button>
          ))}
        </div>
        {session && (
          <>
            <div className="text-right">
              <p className="text-sm leading-tight text-fg">{session.user.name}</p>
              <p className="mono text-[10px] tracking-widest text-dim">
                {session.user.designation} · {session.user.role} · {session.user.branch}
              </p>
            </div>
            <NotificationBell />
            <button
              onClick={() => router.push("/change-password")}
              className="mono hidden rounded border hairline px-2.5 py-1.5 text-[10.5px] tracking-widest text-steel transition-colors hover:border-steel/50 hover:text-fg sm:inline"
            >
              {lang === "ms" ? "KATA LALUAN" : "PASSWORD"}
            </button>
            <button
              onClick={async () => {
                await api.logout().catch(() => { /* already signed out server-side */ });
                setSession(null);
                router.replace("/login");
              }}
              className="mono rounded border hairline px-2.5 py-1.5 text-[10.5px] tracking-widest text-steel transition-colors hover:border-brand-bright/50 hover:text-brand-bright"
            >
              {lang === "ms" ? "LOG KELUAR" : "SIGN OUT"}
            </button>
          </>
        )}
      </div>
    </header>
  );
}

/** App-wide notice when the API cannot be reached (or when running on demo data). */
export function ConnectionBanner() {
  const [state, setState] = useState<"ok" | "unreachable">("ok");
  useEffect(() => onConnectionChange(setState), []);
  if (state === "ok") return null;
  return (
    <div role="alert" className="mono border-b border-amber/40 bg-amber/10 px-6 py-2 text-center text-xs tracking-wider text-amber">
      {DEMO_MODE
        ? "DEMO MODE — the server is not reachable, so bundled sample data is shown. Changes will not be saved."
        : "CANNOT REACH THE SERVER — data shown may be out of date and changes will not be saved. Retrying on your next action."}
    </div>
  );
}
