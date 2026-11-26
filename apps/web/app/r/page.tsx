"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { resizePhoto } from "@/lib/images";
import { initialLang, portal, PortalError, PortalInfo, PT, rememberLang, saveRequest, savedRequests, SavedRequest } from "@/lib/portal";

type Lang = "en" | "ms";
const box = "w-full rounded-lg border hairline bg-ink-deep px-3 py-3 text-base text-fg outline-none transition-colors focus:border-trace";

export default function RequestPage() {
  return (
    <Suspense fallback={null}>
      <RequestForm />
    </Suspense>
  );
}

/** The public request form: phone-first, no account, English or Bahasa Melayu. */
function RequestForm() {
  const pointCode = useSearchParams().get("p");
  const [lang, setLangState] = useState<Lang>("en");
  const t = (k: keyof typeof PT) => PT[k][lang];
  const setLang = (l: Lang) => { setLangState(l); rememberLang(l); };
  const [info, setInfo] = useState<PortalInfo | null>(null);
  const [failure, setFailure] = useState<"unavailable" | "offline" | null>(null);
  const [f, setF] = useState({ description: "", site: "", place: "", category: "", urgent: false, name: "", email: "", phone: "", accessCode: "", website: "" });
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ id: string | null; token: string | null } | null>(null);
  const [mine, setMine] = useState<SavedRequest[]>([]);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLangState(initialLang());
    setMine(savedRequests());
    portal.info(pointCode).then((i) => {
      setInfo(i);
      if (i.sites.length === 1) setF((x) => ({ ...x, site: i.sites[0].key }));
    }).catch((e) => setFailure(e instanceof PortalError && e.status === 0 ? "offline" : "unavailable"));
  }, [pointCode]);
  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);

  async function addPhoto(file: File) {
    const blob = await resizePhoto(file);
    setPhotos((p) => [...p, { blob, url: URL.createObjectURL(blob) }].slice(0, info?.maxPhotos ?? 3));
  }

  async function send() {
    if (!info) return;
    setBusy(true); setErrors([]);
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) form.append(k, String(v));
    form.set("urgent", f.urgent ? "true" : "false");
    form.append("lang", lang);
    if (info.point) form.append("p", info.point.code);
    photos.forEach((p, i) => form.append("photos", p.blob, `photo-${i + 1}.jpg`));
    try {
      const r = await portal.submit(form);
      if (r.id && r.track) saveRequest(r.id, r.track);
      setDone({ id: r.id, token: r.track });
      window.scrollTo({ top: 0 });
    } catch (e) {
      const err = e as PortalError;
      setErrors(err.status === 0 ? [t("offline")] : err.errors.length ? err.errors : [err.message]);
    } finally { setBusy(false); }
  }

  const header = (
    <header className="flex items-start justify-between gap-3 border-b hairline px-4 pb-4 pt-6">
      <div className="min-w-0">
        <p className="mono text-[11px] uppercase tracking-widest text-steel">{info?.org ?? " "}</p>
        <h1 className="display text-3xl font-bold leading-tight">{t("title")}</h1>
      </div>
      <div className="flex shrink-0 overflow-hidden rounded-md border hairline" role="group" aria-label="Language">
        {(["en", "ms"] as const).map((l) => (
          <button key={l} onClick={() => setLang(l)} className={`mono px-3 py-2 text-xs ${lang === l ? "bg-brand text-white" : "text-steel"}`} aria-pressed={lang === l}>
            {l === "en" ? "EN" : "BM"}
          </button>
        ))}
      </div>
    </header>
  );

  if (failure) return <main className="mx-auto min-h-dvh max-w-xl">{header}<p className="px-4 py-10 text-base text-steel">{t(failure)}</p></main>;
  if (!info) return <main className="mx-auto min-h-dvh max-w-xl">{header}</main>;

  if (done) {
    const link = done.token ? `/r/track#${done.token}` : null;
    const full = link && typeof window !== "undefined" ? `${window.location.origin}${link}` : "";
    return (
      <main className="mx-auto min-h-dvh max-w-xl pb-10">
        {header}
        <section className="space-y-4 px-4 py-6">
          <h2 className="display text-2xl font-bold text-phosphor">{done.id ? t("thanks") : t("thanksPlain")}</h2>
          {done.id && link && (
            <>
              <div className="rounded-lg border hairline bg-panel px-4 py-3">
                <p className="text-sm text-steel">{t("reference")}</p>
                <p className="mono text-2xl text-fg">{done.id}</p>
              </div>
              <p className="text-base text-steel">{t("keepLink")}</p>
              <Link href={link} className="block rounded-lg bg-brand px-4 py-3 text-center text-base font-semibold text-white">{t("follow")}</Link>
              <CopyButton text={full} label={t("copy")} done={t("copied")} />
            </>
          )}
          <button onClick={() => { setDone(null); setF((x) => ({ ...x, description: "", urgent: false })); setPhotos([]); setMine(savedRequests()); }} className="block w-full rounded-lg border hairline px-4 py-3 text-base text-steel">
            {t("another")}
          </button>
        </section>
      </main>
    );
  }

  if (!info.open) return <main className="mx-auto min-h-dvh max-w-xl">{header}<p className="px-4 py-10 text-base text-steel">{t("closed")}</p></main>;
  const intro = (lang === "ms" ? info.introMs || info.intro : info.intro) || t("intro");
  const label = (e: { label: string; labelMs: string }) => (lang === "ms" ? e.labelMs || e.label : e.label);
  const ready = f.description.trim().length >= 5 && f.name.trim().length >= 2 && (f.email.trim() || f.phone.trim()) && (!info.needsCode || f.accessCode.trim()) && (info.point || info.sites.length <= 1 || f.site);

  return (
    <main className="mx-auto min-h-dvh max-w-xl pb-12">
      {header}
      <form className="space-y-6 px-4 py-5" onSubmit={(e) => { e.preventDefault(); if (ready && !busy) void send(); }} noValidate>
        <p className="whitespace-pre-line text-base text-steel">{intro}</p>

        {info.point && (
          <div className="rounded-lg border border-trace/40 bg-trace/10 px-4 py-3">
            <p className="text-sm text-steel">{t("location")}</p>
            <p className="text-lg text-fg">{info.point.label}</p>
            {info.point.siteLabel && <p className="text-sm text-steel">{info.point.siteLabel}</p>}
          </div>
        )}

        <label className="block">
          <span className="mb-1.5 block text-base font-medium">{t("what")} *</span>
          <textarea rows={4} maxLength={1000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t("whatHint")} className={box} />
        </label>

        {!info.point && (
          <fieldset className="space-y-3">
            <legend className="mb-1.5 text-base font-medium">{t("where")}</legend>
            {info.sites.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-sm text-steel">{t("site")} *</span>
                <select value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} className={box}>
                  <option value="">{t("chooseSite")}</option>
                  {info.sites.map((s) => <option key={s.key} value={s.key}>{label(s)}</option>)}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm text-steel">{t("place")}</span>
              <input value={f.place} maxLength={120} onChange={(e) => setF({ ...f, place: e.target.value })} className={box} />
            </label>
          </fieldset>
        )}

        {info.categories.length > 0 && (
          <label className="block">
            <span className="mb-1.5 block text-base font-medium">{t("type")}</span>
            <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={box}>
              <option value="">{t("notSure")}</option>
              {info.categories.map((c) => <option key={c.key} value={c.key}>{label(c)}</option>)}
            </select>
          </label>
        )}

        <label className="flex items-start gap-3 rounded-lg border hairline px-4 py-3">
          <input type="checkbox" checked={f.urgent} onChange={(e) => setF({ ...f, urgent: e.target.checked })} className="mt-1 h-5 w-5 accent-[var(--c-red)]" />
          <span className="text-base">{t("urgent")}</span>
        </label>

        <div>
          <p className="mb-1.5 text-base font-medium">{t("photos")}</p>
          <input ref={picker} type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void addPhoto(file); e.target.value = ""; }} />
          <div className="flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={p.url} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-24 w-24 rounded-lg border hairline object-cover" />
                <button type="button" onClick={() => setPhotos(photos.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 rounded-full bg-ink-deep px-2 py-0.5 text-xs text-brand-bright" aria-label={t("remove")}>✕</button>
              </div>
            ))}
            {photos.length < info.maxPhotos && (
              <button type="button" onClick={() => picker.current?.click()} className="h-24 w-24 rounded-lg border border-dashed hairline text-sm text-steel">📷<br />{t("addPhoto")}</button>
            )}
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-1.5 text-base font-medium">{t("you")}</legend>
          <label className="block">
            <span className="mb-1 block text-sm text-steel">{t("name")} *</span>
            <input value={f.name} maxLength={80} autoComplete="name" onChange={(e) => setF({ ...f, name: e.target.value })} className={box} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-steel">{t("email")}</span>
            <input type="email" inputMode="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={box} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-steel">{t("phone")}</span>
            <input type="tel" inputMode="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={box} />
          </label>
          <p className="text-sm text-dim">{t("contactHint")}</p>
        </fieldset>

        {info.needsCode && (
          <label className="block">
            <span className="mb-1 block text-base font-medium">{t("code")} *</span>
            <input value={f.accessCode} autoCapitalize="characters" onChange={(e) => setF({ ...f, accessCode: e.target.value })} className={box} />
            <span className="mt-1 block text-sm text-dim">{t("codeHint")}</span>
          </label>
        )}

        {/* Left empty by people; automated form-fillers fill it in. */}
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} name="website" /></label>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-brand-bright/40 bg-brand-bright/10 px-4 py-3 text-base text-brand-bright" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <button type="submit" disabled={!ready || busy} className="w-full rounded-lg bg-brand px-4 py-4 text-lg font-semibold text-white disabled:opacity-40">
          {busy ? t("sending") : t("send")}
        </button>
        <p className="text-center text-sm text-dim">{t("privacy")}</p>
      </form>

      {mine.length > 0 && (
        <section className="border-t hairline px-4 py-5">
          <p className="mb-2 text-sm text-steel">{t("onDevice")}</p>
          <ul className="space-y-1.5">
            {mine.map((r) => (
              <li key={r.id}><Link href={`/r/track#${r.token}`} className="mono text-base text-trace">{r.id}</Link> <span className="text-sm text-dim">{r.at.slice(0, 10)}</span></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

function CopyButton({ text, label, done }: { text: string; label: string; done: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)); }} className="block w-full rounded-lg border hairline px-4 py-3 text-base text-steel">
      {copied ? `✓ ${done}` : label}
    </button>
  );
}
