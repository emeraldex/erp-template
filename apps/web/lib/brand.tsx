"use client";

import { useEffect, useState } from "react";
import { API_BASE } from "./api";

/**
 * The organisation's look — brand colour, logo, default theme — and each
 * person's own theme choice. Branding comes from the public /tenant answer,
 * so the sign-in page and the request portal get it too.
 */
export type ThemeChoice = "dark" | "light" | "system";
export interface Brand { accent: string | null; defaultTheme: ThemeChoice; logo: string | null; name: string }

const CHOICE = "erp.theme";
const ORG_DEFAULT = "erp.theme.default";
const ACCENT = "erp.brand.accent";
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Runs before the page paints (inlined in <head>), so a light theme never flashes dark. */
export const THEME_BOOT = `(function(){try{var s=localStorage,d=document.documentElement;var c=s.getItem('${CHOICE}')||s.getItem('${ORG_DEFAULT}')||'dark';if(c==='system')c=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';d.dataset.theme=c;var a=s.getItem('${ACCENT}');if(a&&/^#[0-9a-fA-F]{6}$/.test(a))d.style.setProperty('--c-red',a);}catch(e){}})();`;

const read = (k: string) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* private mode */ } };

export function themeChoice(): ThemeChoice {
  const c = read(CHOICE);
  return c === "light" || c === "dark" || c === "system" ? c : ((read(ORG_DEFAULT) as ThemeChoice) || "dark");
}

/** Apply a theme now. */
export function applyTheme(choice: ThemeChoice = themeChoice()) {
  const resolved = choice === "system" ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;
  document.documentElement.dataset.theme = resolved;
}

/** This person's choice, kept on this device. */
export function setThemeChoice(choice: ThemeChoice) {
  write(CHOICE, choice);
  applyTheme(choice);
  listeners.forEach((l) => l());
}

let brand: Brand | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function applyBrand(b: Brand) {
  brand = b;
  const root = document.documentElement.style;
  if (b.accent && HEX.test(b.accent)) root.setProperty("--c-red", b.accent); else root.removeProperty("--c-red");
  write(ACCENT, b.accent && HEX.test(b.accent) ? b.accent : null);
  write(ORG_DEFAULT, b.defaultTheme);
  if (!read(CHOICE)) applyTheme(b.defaultTheme);
  listeners.forEach((l) => l());
}

/** Load (once per page) and apply the organisation's branding. */
export function loadBrand(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = fetch(`${API_BASE}/tenant`, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : null))
    .then((t: { name: string; brand?: { accent: string | null; defaultTheme: ThemeChoice; logo: string | null } } | null) => {
      if (t) applyBrand({ name: t.name, accent: t.brand?.accent ?? null, defaultTheme: t.brand?.defaultTheme ?? "dark", logo: t.brand?.logo ?? null });
    })
    .catch(() => { loading = null; });
  return loading;
}

/** The organisation's branding, once loaded; re-renders when it changes. */
export function useBrand(): Brand | null {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    void loadBrand();
    return () => { listeners.delete(l); };
  }, []);
  return brand;
}

/** This person's theme choice; re-renders when it changes. */
export function useThemeChoice(): ThemeChoice {
  const [choice, setChoice] = useState<ThemeChoice>("dark");
  useEffect(() => {
    const l = () => setChoice(themeChoice());
    l();
    listeners.add(l);
    // Follow the device when the choice is "system".
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => { if (themeChoice() === "system") applyTheme("system"); };
    mq.addEventListener("change", onChange);
    return () => { listeners.delete(l); mq.removeEventListener("change", onChange); };
  }, []);
  return choice;
}

/** The logo's address (versioned, so a new upload shows at once). */
export const logoUrl = (version: string) => `${API_BASE}/tenant/logo?v=${encodeURIComponent(version)}`;

/** The organisation's logo, or nothing. */
export function BrandLogo({ className = "h-8 w-auto", alt }: { className?: string; alt?: string }) {
  const b = useBrand();
  const [broken, setBroken] = useState(false);
  if (!b?.logo || broken) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={logoUrl(b.logo)} alt={alt ?? b.name} className={`${className} object-contain`} onError={() => setBroken(true)} />;
}

const NEXT: Record<ThemeChoice, ThemeChoice> = { dark: "light", light: "system", system: "dark" };
const LABEL: Record<ThemeChoice, string> = { dark: "Dark", light: "Light", system: "Device" };
const ICON: Record<ThemeChoice, string> = { dark: "☾", light: "☀", system: "◐" };

/** A button that steps through dark → light → match the device. */
export function ThemeSwitch({ className = "" }: { className?: string }) {
  const choice = useThemeChoice();
  return (
    <button type="button" onClick={() => setThemeChoice(NEXT[choice])} className={className} title={`Theme: ${LABEL[choice]} — click to change`} aria-label={`Theme: ${LABEL[choice]}. Change theme`}>
      <span aria-hidden="true">{ICON[choice]}</span> {LABEL[choice]}
    </button>
  );
}
