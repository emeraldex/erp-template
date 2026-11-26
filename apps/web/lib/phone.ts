"use client";

/**
 * Phones get the phone app (/m) unless the person chose the full site.
 * Narrow screens below the md breakpoint count as phones.
 */
const KEY = "erp.fullSite";

export const isNarrow = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

export function wantsFullSite(): boolean {
  try { return window.localStorage.getItem(KEY) === "1"; } catch { return false; }
}

export function setFullSite(on: boolean) {
  try { if (on) window.localStorage.setItem(KEY, "1"); else window.localStorage.removeItem(KEY); } catch { /* private mode */ }
}

/** Where a phone should go instead of a desktop page, or null to stay. */
export function phoneRoute(pathname: string, search: string): string | null {
  if (!isNarrow() || wantsFullSite()) return null;
  const job = pathname.match(/^\/jobs\/([^/]+)$/);
  if (job) return `/m/job?id=${job[1]}`;
  const asset = new URLSearchParams(search).get("id");
  if (pathname === "/assets" && asset) return `/m/asset?id=${encodeURIComponent(asset)}`;
  if (pathname === "/dashboard") return "/m";
  return null;
}
