"use client";

import { SessionUser } from "./types";
import { mock } from "./mock-data";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const SESSION_KEY = "erp.session";

export interface Session {
  token: string;
  user: SessionUser;
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  return raw ? (JSON.parse(raw) as Session) : null;
}

export function setSession(s: Session | null) {
  if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  else window.localStorage.removeItem(SESSION_KEY);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const session = getSession();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body?.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(Array.isArray(message) ? message.join("; ") : message);
  }
}

/**
 * GET with a demo fallback: if the API isn't reachable, serve bundled
 * sample data and flag the response as offline so the UI can say so.
 */
export async function getWithFallback<T>(path: string, mockKey: keyof typeof mock): Promise<{ data: T; offline: boolean }> {
  try {
    const data = await request<T>(path);
    return { data, offline: false };
  } catch (e) {
    if (e instanceof ApiError && e.status !== 0) throw e; // real API errors surface
    return { data: mock[mockKey] as unknown as T, offline: true };
  }
}

export const api = {
  login: (email: string, password: string) =>
    request<Session>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  get: <T,>(path: string) => request<T>(path),
  post: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T,>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
};
