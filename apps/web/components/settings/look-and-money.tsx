"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { loadBrand, logoUrl, setThemeChoice, useBrand, type ThemeChoice } from "@/lib/brand";
import { Button, Panel } from "@/components/ui";

const inputClass = "mono w-full rounded-md border hairline bg-ink-deep px-3 py-2 text-xs text-fg outline-none focus:border-trace disabled:opacity-60";
type Msg = { ok: boolean; text: string } | null;

/** WCAG contrast of white text on a colour, to warn before saving. */
function whiteContrast(hex: string): number {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 0;
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  return 1.05 / (lum(hex) + 0.05);
}

/** Logo, brand colour and the theme people start with. */
export function BrandPanel({ initial }: { initial: { accent: string | null; defaultTheme: ThemeChoice } }) {
  const brand = useBrand();
  const [accent, setAccent] = useState(initial.accent ?? "#c8102e");
  const [useOwn, setUseOwn] = useState(!!initial.accent);
  const [theme, setTheme] = useState<ThemeChoice>(initial.defaultTheme);
  const [logo, setLogo] = useState<string | null>(null);
  useEffect(() => { if (brand?.logo) setLogo(brand.logo); }, [brand?.logo]);
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const ratio = whiteContrast(accent);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api.patch("/settings/brand", { accent: useOwn ? accent : null, defaultTheme: theme });
      await loadBrand(true);
      setMsg({ ok: true, text: "Saved. Everyone sees the colour now; people who have not picked a theme start with yours." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function upload(file: File) {
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const body = await api.putForm<{ version: string; width: number; height: number }>("/settings/logo", form);
      setLogo(body.version);
      await loadBrand(true);
      setMsg({ ok: true, text: `Logo saved (${body.width} × ${body.height}). It appears on screens, the request portal and documents.` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  async function removeLogo() {
    setBusy(true); setMsg(null);
    try {
      await api.remove("/settings/logo");
      setLogo(null);
      await loadBrand(true);
      setMsg({ ok: true, text: "Logo removed." });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <Panel className="fade-up d3 mt-5 p-5">
      <p className="eyebrow mb-1">Look</p>
      <p className="mb-4 text-sm text-steel">Your logo and colour on screens, the sign-in page, the phone app, the request portal and printed documents.</p>
      <div className="grid gap-6 lg:grid-cols-3">
        <div>
          <p className="mono mb-2 text-[10px] tracking-widest text-steel">LOGO — PNG OR JPEG, UP TO 512 KB</p>
          <div className="mb-3 flex h-20 items-center justify-center rounded-md border hairline bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {logo ? <img src={logoUrl(logo)} alt="Logo" className="max-h-16 max-w-full object-contain" /> : <span className="text-xs text-slate-500">No logo</span>}
          </div>
          <input ref={picker} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => picker.current?.click()}>{logo ? "Replace" : "Upload logo"}</Button>
            {logo && <Button variant="ghost" disabled={busy} onClick={removeLogo}>Remove</Button>}
          </div>
        </div>
        <div>
          <p className="mono mb-2 text-[10px] tracking-widest text-steel">COLOUR</p>
          <label className="mb-2 flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={useOwn} onChange={(e) => setUseOwn(e.target.checked)} className="accent-[var(--c-red)]" /> Use our own colour
          </label>
          {useOwn && (
            <div className="flex items-center gap-2">
              <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} aria-label="Brand colour" className="h-10 w-14 cursor-pointer rounded border hairline bg-transparent" />
              <input value={accent} onChange={(e) => setAccent(e.target.value)} className={`${inputClass} w-28`} aria-label="Brand colour code" />
              <span className="rounded px-3 py-2 text-xs font-semibold text-white" style={{ background: accent }}>Button</span>
            </div>
          )}
          {useOwn && ratio < 4.5 && <p className="mt-2 text-xs text-brand-bright">White text on this colour is hard to read ({ratio.toFixed(1)}:1). Choose a darker shade.</p>}
        </div>
        <div>
          <p className="mono mb-2 text-[10px] tracking-widest text-steel">THEME PEOPLE START WITH</p>
          {(["dark", "light", "system"] as const).map((t) => (
            <label key={t} className="mb-1 flex items-center gap-2 text-sm text-fg">
              <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} className="accent-[var(--c-red)]" />
              {t === "dark" ? "Dark" : t === "light" ? "Light" : "Match each person's device"}
            </label>
          ))}
          <p className="mt-1 text-xs text-dim">Each person can still choose their own from the top bar.</p>
          <button type="button" onClick={() => setThemeChoice(theme)} className="mono mt-1 text-[10.5px] tracking-widest text-steel hover:text-trace">PREVIEW ON THIS SCREEN</button>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={busy || (useOwn && ratio < 4.5)} onClick={save}>Save look</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}

type CurrencyRow = { code: string; symbol: string; decimals: number; name: string };

/** The currency the organisation keeps its books in, and preventive-maintenance grace. */
export function MoneyPanel({ graceDays, onSaved }: { graceDays: number; onSaved?: () => void }) {
  const [list, setList] = useState<{ current: string; locked: boolean; list: CurrencyRow[] } | null>(null);
  const [code, setCode] = useState("");
  const [grace, setGrace] = useState(String(graceDays));
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get<{ current: string; locked: boolean; list: CurrencyRow[] }>("/settings/currencies").then((l) => { setList(l); setCode(l.current); }).catch(() => {}); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      if (list && code !== list.current) await api.patch("/settings/currency", { code });
      await api.patch("/settings/maintenance", { pmGraceDays: Number(grace) });
      setMsg({ ok: true, text: "Saved — reloading so every screen uses it." });
      onSaved?.();
      setTimeout(() => window.location.reload(), 700);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <Panel className="fade-up d3 mt-5 p-5">
      <p className="eyebrow mb-1">Currency and maintenance measures</p>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <label className="block">
            <span className="mono mb-1 block text-[10px] tracking-widest text-steel">CURRENCY OF YOUR BOOKS</span>
            <select value={code} disabled={!list || list.locked} onChange={(e) => setCode(e.target.value)} className={inputClass}>
              {(list?.list ?? []).map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name} ({c.symbol})</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs text-dim">
            {list?.locked
              ? "Locked: amounts are already recorded in this currency, and changing it would relabel them without converting. Your system administrator can change it if that is really intended."
              : "Every amount, report and document uses it. Choose it before recording prices, stock or invoices — it locks after that."}
          </p>
        </div>
        <label className="block">
          <span className="mono mb-1 block text-[10px] tracking-widest text-steel">PREVENTIVE WORK IS ON TIME IF DONE WITHIN (DAYS OF ITS DUE DATE)</span>
          <input inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/\D/g, ""))} className={`${inputClass} w-24`} />
          <span className="mt-2 block text-xs text-dim">Used for preventive-maintenance compliance on the dashboard and reliability report.</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={busy || !list} onClick={save}>Save</Button>
        {msg && <span className={`text-sm ${msg.ok ? "text-phosphor" : "text-brand-bright"}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}
