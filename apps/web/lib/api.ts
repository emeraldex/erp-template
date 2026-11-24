"use client";

import { SessionUser } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const PROFILE_KEY = "erp.profile";

/**
 * Demo mode: when the API is unreachable, serve the bundled sample data so the
 * UI can be shown without a backend. Off unless NEXT_PUBLIC_DEMO_MODE=1 at
 * build time, so a production build never shows invented records.
 */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/**
 * The signed-in user's profile, cached for display only. The credential itself
 * is an httpOnly cookie set by the API, which page scripts cannot read.
 */
export interface Session {
  user: SessionUser;
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    return raw ? { user: JSON.parse(raw) as SessionUser } : null;
  } catch {
    return null;
  }
}

export function setSession(s: Session | null) {
  try {
    if (s) window.localStorage.setItem(PROFILE_KEY, JSON.stringify(s.user));
    else window.localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* storage unavailable (private mode) — the cookie still authenticates */
  }
}

// ─── connection status, for the app-wide banner ──────────────────────────────

export type ConnectionState = "ok" | "unreachable";
const listeners = new Set<(s: ConnectionState) => void>();
let connection: ConnectionState = "ok";

function setConnection(s: ConnectionState) {
  if (s === connection) return;
  connection = s;
  listeners.forEach((l) => l(s));
}

export function onConnectionChange(l: (s: ConnectionState) => void): () => void {
  listeners.add(l);
  l(connection);
  return () => listeners.delete(l);
}

export class ApiError extends Error {
  constructor(public status: number, message: string | string[], public code?: string) {
    super(Array.isArray(message) ? message.join("; ") : message);
  }
}

function redirect(path: string) {
  if (typeof window !== "undefined" && window.location.pathname !== path) window.location.assign(path);
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        // Let the browser set the multipart boundary for uploads.
        ...(isForm ? {} : { "Content-Type": "application/json" }),
        // The API requires this on state changes made with the session cookie,
        // which a cross-site form or image tag cannot send (CSRF protection).
        "X-Requested-With": "erp-web",
        ...init?.headers,
      },
    });
  } catch {
    setConnection("unreachable");
    throw new ApiError(0, "Cannot reach the server. Check your connection and try again.");
  }
  setConnection("ok");

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new ApiError(res.status, body?.message ?? res.statusText, body?.code);
    const isAuthCall = path.startsWith("/auth/login") || path.startsWith("/auth/change-password");
    if (res.status === 401 && !isAuthCall) {
      setSession(null);
      redirect("/login");
    } else if (err.code === "PASSWORD_CHANGE_REQUIRED") {
      redirect("/change-password");
    }
    throw err;
  }
  return res;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await send(path, init)).json() as Promise<T>;
}

/** File name from a Content-Disposition header, preferring the UTF-8 form. */
function filenameFrom(header: string | null, fallback: string): string {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1]);
  return header?.match(/filename="([^"]+)"/i)?.[1] ?? fallback;
}

/** GET a file from the API and hand it to the browser as a download. */
export async function download(path: string, fallbackName = "download"): Promise<void> {
  const res = await send(path);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFrom(res.headers.get("Content-Disposition"), fallbackName);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/**
 * GET that, in demo mode only, falls back to bundled sample data when the API
 * is unreachable. Outside demo mode an unreachable API is an error the user sees.
 */
export async function getWithFallback<T>(path: string, mockKey: string): Promise<{ data: T; offline: boolean }> {
  try {
    return { data: await request<T>(path), offline: false };
  } catch (e) {
    if (!DEMO_MODE || !(e instanceof ApiError) || e.status !== 0) throw e;
    const { mock } = await import("./mock-data");
    return { data: (mock as Record<string, unknown>)[mockKey] as T, offline: true };
  }
}

export const api = {
  login: (email: string, password: string) =>
    request<{ user: SessionUser }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: SessionUser }>("/auth/me"),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ user: SessionUser }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  upload: <T,>(path: string, form: FormData) => request<T>(path, { method: "POST", body: form }),
};
