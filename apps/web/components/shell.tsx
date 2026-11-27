"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, DEMO_MODE, getSession, loginPath, onConnectionChange, setSession, Session } from "@/lib/api";
import { DictKey, useLang } from "@/lib/i18n";
import type { Modules } from "@/lib/types";
import { DEFAULT_TERMS, useVocab } from "@/lib/vocab";
import { setFullSite } from "@/lib/phone";
import { clearFieldCache, unsentCount } from "@/lib/offline/db";
import { NotificationBell } from "./notifications";
import { BrandLogo, ThemeSwitch, useBrand } from "@/lib/brand";

type TermKey = keyof typeof DEFAULT_TERMS;
interface NavItem {
  href: string;
  label: DictKey;
  /** The organisation's own word for it, when it has one. */
  term?: TermKey;
  /** Procedure reference, shown for the aviation configuration. */
  code: string;
  /** Short tag shown otherwise. */
  tag: string;
  module?: keyof Modules;
  /** Hidden from people without this permission. */
  capability?: string;
}

const NAV: { group: DictKey; items: NavItem[] }[] = [
  {
    group: "operations",
    items: [
      { href: "/dashboard", label: "command", code: "OPS", tag: "OPS" },
      { href: "/requests", label: "requests", code: "REQ", tag: "REQ", module: "requests", capability: "requests.manage" },
      { href: "/jobs", label: "jobs", term: "jobRegister", code: "JTS", tag: "WO" },
      { href: "/assets", label: "assets", term: "assets", code: "AST", tag: "AST", module: "assets" },
      { href: "/pm", label: "pm", term: "pm", code: "PM", tag: "PM", module: "pm" },
      { href: "/aog", label: "aogRoa", term: "priority", code: "QP.56", tag: "PRI", module: "priority" },
      { href: "/ov", label: "ov", term: "vendorRepairs", code: "QP.33", tag: "VR", module: "vendorRepair" },
    ],
  },
  {
    group: "supplyChain",
    items: [
      { href: "/stock", label: "stock", code: "STK", tag: "STK", module: "stock" },
      { href: "/demands", label: "procurement", term: "demands", code: "QP.14", tag: "PO", module: "procurement" },
      { href: "/registers", label: "registers", term: "registers", code: "QP.13", tag: "SUP", module: "registers" },
    ],
  },
  {
    group: "finance",
    items: [{ href: "/invoicing", label: "invoicing", code: "QP.51", tag: "INV", module: "invoicing" }],
  },
  {
    group: "quality",
    items: [{ href: "/fod", label: "fod", term: "incidents", code: "QP.46", tag: "HSE", module: "incidents" }],
  },
  {
    group: "administration",
    items: [
      { href: "/reports", label: "reports", code: "FR-14", tag: "RPT" },
      { href: "/users", label: "users", code: "IAM", tag: "IAM", capability: "org.admin" },
      { href: "/workflow", label: "workflow", code: "FR-02", tag: "WF", capability: "workflow.edit" },
      { href: "/settings", label: "settings", code: "ADM", tag: "ADM" },
    ],
  },
];

function CompanyMark() {
  const { aviation, cfg } = useVocab();
  const brand = useBrand();
  if (brand?.logo) {
    return (
      <Link href="/dashboard" className="flex flex-col gap-1.5 px-5 py-5">
        <BrandLogo className="h-10 max-w-[180px]" />
        <p className="eyebrow leading-none">{(cfg?.pack?.name ?? "MAINTENANCE").toUpperCase()}</p>
      </Link>
    );
  }
  return (
    <Link href="/dashboard" className="flex items-center gap-3 px-5 py-5">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <rect x="4" y="4" width="24" height="24" rx="3" fill="none" stroke="var(--c-red)" strokeWidth="2.5" />
        <path d="M10 11.5h12M10 16h12M10 20.5h7" fill="none" stroke="var(--c-text)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <div>
        <p className="display text-lg font-bold leading-none text-fg">COMPANY</p>
        <p className="eyebrow leading-none">{aviation ? "SERVICES · AMO" : (cfg?.pack?.name ?? "MAINTENANCE").toUpperCase()}</p>
      </div>
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r hairline bg-ink-deep/80 backdrop-blur md:flex">
      <SidebarContent />
    </aside>
  );
}

/** Below the md breakpoint: a menu button that opens the same navigation as a drawer. */
function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Menu" className="rounded border hairline px-2.5 py-1.5 text-steel md:hidden">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {/* In a portal: the top bar's backdrop blur would otherwise trap a fixed drawer inside it. */}
      {open && createPortal(
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <button aria-label="Close menu" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col overflow-y-auto border-r hairline bg-ink-deep">
            <SidebarContent mobile />
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
}

function SidebarContent({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const { t } = useLang();
  const { aviation, terms, modules, can, session } = useVocab();
  // Unchanged aviation words keep their Bahasa Melayu translation; an
  // organisation's own words are shown as it wrote them.
  const labelOf = (item: NavItem) => (item.term && terms[item.term] !== DEFAULT_TERMS[item.term] ? terms[item.term] : t(item.label));
  // How many portal requests are waiting, for the menu.
  const [waiting, setWaiting] = useState(0);
  const triage = modules.requests && !!session && can("requests.manage");
  useEffect(() => {
    if (!triage) return;
    const load = () => api.get<{ id: string }[]>("/requests?status=NEW").then((r) => setWaiting(r.length)).catch(() => {});
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [triage, pathname]);
  const nav = NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.module || modules[i.module]) && (!i.capability || !session || can(i.capability))),
  })).filter((g) => g.items.length);
  return (
    <>
      <CompanyMark />
      {mobile && (
        <Link href="/m" onClick={() => setFullSite(false)} className="mx-3 mb-2 rounded-md border border-trace/40 bg-trace/10 px-3 py-2.5 text-sm text-fg">
          📱 Phone app — my work
        </Link>
      )}
      <nav className="mt-2 flex-1 space-y-6 px-3">
        {nav.map((g) => (
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
                      <span>
                        {labelOf(item)}
                        {item.href === "/requests" && waiting > 0 && (
                          <span className="mono ml-2 rounded-full bg-brand px-1.5 py-0.5 text-[10px] text-white" aria-label={`${waiting} waiting`}>{waiting}</span>
                        )}
                      </span>
                      <span
                        className={`mono text-[10px] tracking-widest transition-colors ${
                          active ? "text-brand-bright" : "text-dim group-hover:text-steel"
                        }`}
                      >
                        {aviation ? item.code : item.tag}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <p className="eyebrow px-5 py-4">{aviation ? "CO-RFP-IT-001 · Prototype" : "Maintenance ERP"}</p>
    </>
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
      router.replace(loginPath());
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
    <header className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b hairline bg-ink/85 px-4 py-3 backdrop-blur sm:px-6">
      <div className="flex items-center gap-3">
        <MobileNav />
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
            <div className="hidden text-right sm:block">
              <p className="text-sm leading-tight text-fg">{session.user.name}</p>
              <p className="mono text-[10px] tracking-widest text-dim">
                {session.user.designation} · {session.user.role} · {session.user.branch}
              </p>
            </div>
            <NotificationBell />
            <ThemeSwitch className="mono hidden rounded border hairline px-2.5 py-1.5 text-[10.5px] tracking-widest text-steel transition-colors hover:border-steel/50 hover:text-fg sm:inline" />
            <button
              onClick={() => router.push("/change-password")}
              className="mono hidden rounded border hairline px-2.5 py-1.5 text-[10.5px] tracking-widest text-steel transition-colors hover:border-steel/50 hover:text-fg sm:inline"
            >
              {lang === "ms" ? "KATA LALUAN" : "PASSWORD"}
            </button>
            <button
              onClick={async () => {
                const unsent = session ? await unsentCount(session.user.id) : 0;
                if (unsent && !window.confirm(`${unsent} change(s) made on this phone have not been sent yet. They stay here and are sent when you sign in again. Sign out anyway?`)) return;
                if (session) await clearFieldCache(session.user.id);
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
