"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BigButton, MHeader, Section } from "@/components/m/ui";
import { api, setSession } from "@/lib/api";
import { useLang } from "@/lib/i18n";
import { useM } from "@/lib/m-text";
import { useField } from "@/lib/offline/field";
import { setFullSite } from "@/lib/phone";
import { useSession } from "@/lib/use-session";

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function MoreScreen() {
  const router = useRouter();
  const f = useField();
  const m = useM();
  const { lang, setLang } = useLang();
  const me = useSession()?.user;
  const [usage, setUsage] = useState<string | null>(null);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage !== undefined ? `${(e.usage / 1024 / 1024).toFixed(1)} MB` : null)).catch(() => {});
    setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
    const onPrompt = (e: Event) => { e.preventDefault(); setInstall(e as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const waiting = f.outbox.filter((i) => i.state === "pending");
  const failed = f.outbox.filter((i) => i.state === "failed");
  const describe = (type: string, p: Record<string, unknown>) =>
    type === "note" ? `“${String(p.text).slice(0, 60)}”` : type === "meter" ? `${p.key} ${p.value}` : type === "checklist" ? `☑ ${p.key}` : `📷 ${p.caption || p.filename}`;

  async function signOut() {
    if (f.outbox.length && !window.confirm(`${f.outbox.length} ${m("unsentWarning")}`)) return;
    await f.clearCache();
    await api.logout().catch(() => {});
    setSession(null);
    router.replace("/login");
  }

  return (
    <div>
      <MHeader title={m("more")} />
      {me && <p className="px-4 pt-4 text-base">{me.name} <span className="text-sm text-steel">· {me.role} · {me.branch}</span></p>}

      <Section title={m("language")}>
        <div className="grid grid-cols-2 gap-2">
          {(["en", "ms"] as const).map((l) => (
            <button key={l} onClick={() => setLang(l)} className={`min-h-[48px] rounded-lg border text-base ${lang === l ? "border-brand bg-brand/20" : "hairline text-steel"}`}>
              {l === "en" ? "English" : "Bahasa Melayu"}
            </button>
          ))}
        </div>
      </Section>

      <div id="sync" />
      <Section title={m("sync")}>
        <p className="text-sm text-steel">
          {waiting.length} {m("waiting")} · {failed.length} {m("failed")}
          {f.lastSync && <> · {m("lastSent")} {new Date(f.lastSync).toLocaleTimeString()}</>}
        </p>
        {f.needsSignIn && <p className="mt-2 text-sm text-amber">{m("signInAgain")}</p>}
        <div className="mt-3"><BigButton tone="ghost" disabled={f.syncing || !f.outbox.length} onClick={() => void f.sync()}>{f.syncing ? m("sending") : m("syncNow")}</BigButton></div>
        {failed.length > 0 && (
          <ul className="mt-3 space-y-2">
            {failed.map((i) => (
              <li key={i.id} className="rounded-lg border border-brand-bright/50 p-3">
                <p className="text-sm text-fg">{i.jobId} · {describe(i.type, i.payload)}</p>
                <p className="text-sm text-brand-bright">{i.lastError}</p>
                <div className="mt-2 flex gap-2">
                  <BigButton tone="ghost" onClick={() => void f.retry(i.id)}>{m("retry")}</BigButton>
                  <BigButton tone="danger" onClick={() => { if (window.confirm(m("confirmDiscard"))) void f.discard(i.id); }}>{m("discard")}</BigButton>
                </div>
              </li>
            ))}
          </ul>
        )}
        {waiting.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-steel">
            {waiting.map((i) => <li key={i.id}>↑ {i.jobId} · {describe(i.type, i.payload)}</li>)}
          </ul>
        )}
      </Section>

      <Section title={m("storage")}>
        {usage && <p className="mb-2 text-sm text-steel">{usage}</p>}
        <BigButton tone="ghost" onClick={async () => { await f.clearCache(); setUsage(null); }}>{m("removeData")}</BigButton>
      </Section>

      <Section title={m("install")}>
        {installed ? <p className="text-sm text-phosphor">{m("installed")}</p> : install ? (
          <BigButton onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>{m("installNow")}</BigButton>
        ) : <p className="text-sm text-steel">{ios ? m("installIos") : m("installIos").replace(/^On iPhone: [^.]*\. ?|^Pada iPhone: [^.]*\. ?/, "")}</p>}
      </Section>

      <div className="space-y-3 px-4 py-4">
        <BigButton tone="ghost" onClick={() => { setFullSite(true); router.push("/dashboard"); }}>{m("fullSite")}</BigButton>
        <BigButton tone="danger" onClick={signOut}>{m("signOut")}</BigButton>
      </div>
    </div>
  );
}
