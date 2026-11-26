"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { initialLang, portal, PortalError, PT, rememberLang, saveRequest, Stage, TrackView } from "@/lib/portal";

type Lang = "en" | "ms";
const box = "w-full rounded-lg border hairline bg-ink-deep px-3 py-3 text-base text-fg outline-none transition-colors focus:border-trace";
const STEPS: { stage: Stage; key: keyof typeof PT }[] = [
  { stage: "received", key: "received" }, { stage: "accepted", key: "accepted" }, { stage: "in_progress", key: "inProgress" },
  { stage: "waiting", key: "waiting" }, { stage: "done", key: "done" },
];

/**
 * Where a request stands, for the person who sent it. The token is in the
 * address's fragment (#…), which browsers never send to servers.
 */
export default function TrackPage() {
  const [token, setToken] = useState<string | null>(null);
  const [lang, setLangState] = useState<Lang>("en");
  const t = (k: keyof typeof PT) => PT[k][lang];
  const setLang = (l: Lang) => { setLangState(l); rememberLang(l); };
  const [v, setV] = useState<TrackView | null>(null);
  const [failure, setFailure] = useState<"notFound" | "offline" | null>(null);
  const [msg, setMsg] = useState("");
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (tok: string, first = false) => {
    try {
      const view = await portal.track(tok);
      setV(view); setFailure(null);
      if (first) {
        saveRequest(view.id, tok);
        try { if (!window.localStorage.getItem("erp.portal.lang")) setLangState(view.lang); } catch { setLangState(view.lang); }
      }
    } catch (e) {
      setFailure(e instanceof PortalError && e.status === 0 ? "offline" : "notFound");
    }
  }, []);

  useEffect(() => {
    setLangState(initialLang());
    const tok = decodeURIComponent(window.location.hash.slice(1));
    setToken(tok || null);
    if (tok) void load(tok, true); else setFailure("notFound");
  }, [load]);

  async function act(fn: () => Promise<TrackView>, after?: () => void) {
    setBusy(true); setError(null);
    try { setV(await fn()); after?.(); }
    catch (e) { const err = e as PortalError; setError(err.status === 0 ? t("offline") : err.message); }
    finally { setBusy(false); }
  }

  const header = (
    <header className="flex items-start justify-between gap-3 border-b hairline px-4 pb-4 pt-6">
      <div className="min-w-0">
        <p className="mono text-[11px] uppercase tracking-widest text-steel">{v?.org ?? " "}</p>
        <h1 className="display text-3xl font-bold leading-tight">{t("yourRequest")}</h1>
        {v && <p className="mono text-base text-trace">{v.id}</p>}
      </div>
      <div className="flex shrink-0 overflow-hidden rounded-md border hairline" role="group" aria-label="Language">
        {(["en", "ms"] as const).map((l) => (
          <button key={l} onClick={() => setLang(l)} className={`mono px-3 py-2 text-xs ${lang === l ? "bg-brand text-white" : "text-steel"}`} aria-pressed={lang === l}>{l === "en" ? "EN" : "BM"}</button>
        ))}
      </div>
    </header>
  );

  if (failure) {
    return (
      <main className="mx-auto min-h-dvh max-w-xl">
        {header}
        <p className="px-4 py-8 text-base text-steel">{t(failure)}</p>
        <p className="px-4"><Link href="/r" className="text-base text-trace">{t("title")} →</Link></p>
      </main>
    );
  }
  if (!v || !token) return <main className="mx-auto min-h-dvh max-w-xl">{header}</main>;

  const current = STEPS.findIndex((s) => s.stage === v.stage);
  const closed = v.stage === "declined" || v.stage === "cancelled";

  return (
    <main className="mx-auto min-h-dvh max-w-xl pb-12">
      {header}

      <section className="border-b hairline px-4 py-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm text-steel">{t("progress")}</p>
          <button onClick={() => void load(token)} className="mono text-xs text-steel">↻ {t("refresh")}</button>
        </div>
        {closed ? (
          <div className="rounded-lg border hairline px-4 py-3">
            <p className="text-lg font-semibold">{v.stageLabel[lang]}</p>
            {v.declineReason && <p className="mt-1 text-base text-steel">{t("reason")}: {v.declineReason}</p>}
          </div>
        ) : (
          <ol className="space-y-2" aria-label={t("progress")}>
            {STEPS.map((s, i) => (
              <li key={s.stage} className="flex items-center gap-3" aria-current={i === current ? "step" : undefined}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm ${i < current ? "border-phosphor bg-phosphor/20 text-phosphor" : i === current ? "border-trace bg-trace/20 text-trace" : "hairline text-dim"}`}>
                  {i < current ? "✓" : i + 1}
                </span>
                <span className={`text-base ${i === current ? "font-semibold text-fg" : i < current ? "text-steel" : "text-dim"}`}>{t(s.key)}</span>
              </li>
            ))}
          </ol>
        )}
        {!closed && <p className="mt-3 text-base text-steel">{v.stageLabel[lang]}</p>}
      </section>

      <section className="space-y-1 border-b hairline px-4 py-5">
        <p className="text-sm text-steel">{t("sent")} {new Date(v.createdAt).toLocaleString(lang === "ms" ? "ms-MY" : "en-GB")}{v.urgent ? ` · ${t("urgentTag")}` : ""}</p>
        <p className="whitespace-pre-line text-base text-fg">{v.description}</p>
        <p className="text-sm text-steel">{[v.asset, v.place, v.site, v.category].filter(Boolean).join(" · ")}</p>
        {v.photos > 0 && <p className="text-sm text-dim">📷 {v.photos} {t("photosSent")}</p>}
      </section>

      {v.canRate && (
        <section className="border-b hairline px-4 py-5">
          <p className="mb-2 text-lg font-semibold">{t("rateTitle")}</p>
          <div className="mb-3 flex gap-1" role="radiogroup" aria-label={t("rateTitle")}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} role="radio" aria-checked={stars === n} aria-label={`${n}`} onClick={() => setStars(n)} className={`text-4xl leading-none ${n <= stars ? "text-amber" : "text-dim"}`}>★</button>
            ))}
          </div>
          <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("rateComment")} className={box} />
          <button disabled={!stars || busy} onClick={() => act(() => portal.rate(token, stars, comment))} className="mt-3 w-full rounded-lg bg-brand px-4 py-3 text-base font-semibold text-white disabled:opacity-40">{t("rateSend")}</button>
        </section>
      )}
      {v.rating !== null && (
        <section className="border-b hairline px-4 py-5">
          <p className="text-base text-phosphor">{t("rated")}</p>
          <p className="text-2xl text-amber" aria-label={`${v.rating} / 5`}>{"★".repeat(v.rating)}<span className="text-dim">{"★".repeat(5 - v.rating)}</span></p>
          {v.ratingComment && <p className="text-base text-steel">{v.ratingComment}</p>}
        </section>
      )}

      <section className="px-4 py-5">
        <p className="mb-3 text-lg font-semibold">{t("messages")}</p>
        {v.messages.length === 0 && v.canMessage && <p className="mb-3 text-base text-dim">{t("noMessages")}</p>}
        <ul className="space-y-2">
          {v.messages.map((m, i) => (
            <li key={i} className={`max-w-[85%] rounded-lg px-3 py-2 ${m.from === "REQUESTER" ? "ml-auto bg-trace/15" : "border hairline bg-panel"}`}>
              <p className="text-xs text-steel">{m.from === "REQUESTER" ? t("you2") : m.by} · {new Date(m.at).toLocaleString(lang === "ms" ? "ms-MY" : "en-GB", { dateStyle: "short", timeStyle: "short" })}</p>
              <p className="whitespace-pre-line text-base text-fg">{m.body}</p>
            </li>
          ))}
        </ul>
        {v.canMessage && (
          <div className="mt-3">
            <textarea rows={3} maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("reply")} className={box} />
            <button disabled={msg.trim().length < 2 || busy} onClick={() => act(() => portal.message(token, msg.trim()), () => setMsg(""))} className="mt-2 w-full rounded-lg border hairline px-4 py-3 text-base text-fg disabled:opacity-40">{t("sendMessage")}</button>
          </div>
        )}
        {error && <p className="mt-3 rounded-lg border border-brand-bright/40 bg-brand-bright/10 px-3 py-2 text-base text-brand-bright" role="alert">{error}</p>}
      </section>

      {v.canCancel && (
        <section className="px-4 pb-6">
          <button disabled={busy} onClick={() => { if (window.confirm(t("confirmCancel"))) void act(() => portal.cancel(token)); }} className="w-full rounded-lg border border-brand-bright/40 px-4 py-3 text-base text-brand-bright">{t("cancel")}</button>
        </section>
      )}
      <p className="px-4 text-center"><Link href="/r" className="text-sm text-trace">{t("another")}</Link></p>
    </main>
  );
}
