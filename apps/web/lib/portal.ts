"use client";

import { API_BASE } from "./api";

/**
 * The request portal's own small client: no session, no redirects to the
 * sign-in page. Tracking tokens are sent in request bodies, never in URLs.
 */
export class PortalError extends Error {
  constructor(public status: number, message: string, public errors: string[] = []) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/public${path}`, { ...init, credentials: "omit" });
  } catch {
    throw new PortalError(0, "offline");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errors: string[] = Array.isArray(body?.errors) ? body.errors : [];
    throw new PortalError(res.status, Array.isArray(body?.message) ? body.message.join("; ") : body?.message ?? res.statusText, errors);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export interface PortalInfo {
  org: string;
  open: boolean;
  intro: string;
  introMs: string;
  needsCode: boolean;
  sites: { key: string; label: string; labelMs: string }[];
  categories: { key: string; label: string; labelMs: string }[];
  point: { code: string; label: string; site: string; siteLabel: string; asset: { tag: string; name: string } | null } | null;
  maxPhotos: number;
}

export type Stage = "received" | "accepted" | "in_progress" | "waiting" | "done" | "declined" | "cancelled";

export interface TrackView {
  id: string;
  org: string;
  createdAt: string;
  lang: "en" | "ms";
  description: string;
  place: string;
  site: string;
  asset: string | null;
  category: string;
  urgent: boolean;
  photos: number;
  stage: Stage;
  stageLabel: { en: string; ms: string };
  declineReason: string;
  name: string;
  messages: { from: "TEAM" | "REQUESTER"; by: string; body: string; at: string }[];
  canCancel: boolean;
  canMessage: boolean;
  canRate: boolean;
  rating: number | null;
  ratingComment: string;
}

export const portal = {
  info: (point?: string | null) => call<PortalInfo>(`/portal${point ? `?p=${encodeURIComponent(point)}` : ""}`, { method: "GET" }),
  submit: (form: FormData) => call<{ id: string | null; track: string | null }>("/requests", { method: "POST", body: form }),
  track: (token: string) => call<TrackView>("/track", json({ token })),
  message: (token: string, body: string) => call<TrackView>("/track/messages", json({ token, body })),
  rate: (token: string, rating: number, comment: string) => call<TrackView>("/track/rating", json({ token, rating, comment })),
  cancel: (token: string) => call<TrackView>("/track/cancel", json({ token })),
};

/** Requests sent from this browser, so people can find them again. Kept only on this device. */
const SAVED = "erp.portal.requests";
export interface SavedRequest { id: string; token: string; at: string; host: string }

export function savedRequests(): SavedRequest[] {
  try {
    const all = JSON.parse(window.localStorage.getItem(SAVED) ?? "[]") as SavedRequest[];
    return all.filter((r) => r.host === window.location.host).slice(0, 10);
  } catch { return []; }
}

export function saveRequest(id: string, token: string) {
  try {
    const all = (JSON.parse(window.localStorage.getItem(SAVED) ?? "[]") as SavedRequest[]).filter((r) => r.id !== id || r.host !== window.location.host);
    all.unshift({ id, token, at: new Date().toISOString(), host: window.location.host });
    window.localStorage.setItem(SAVED, JSON.stringify(all.slice(0, 20)));
  } catch { /* private mode: nothing kept */ }
}

export function initialLang(): "en" | "ms" {
  try {
    const saved = window.localStorage.getItem("erp.portal.lang");
    if (saved === "en" || saved === "ms") return saved;
  } catch { /* ignore */ }
  return typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("ms") ? "ms" : "en";
}

export function rememberLang(lang: "en" | "ms") {
  try { window.localStorage.setItem("erp.portal.lang", lang); } catch { /* ignore */ }
}

export const PT = {
  title: { en: "Report a problem", ms: "Laporkan masalah" },
  intro: { en: "Tell the maintenance team what is wrong. You don't need an account.", ms: "Beritahu pasukan penyelenggaraan apa yang rosak. Anda tidak memerlukan akaun." },
  what: { en: "What is wrong?", ms: "Apa masalahnya?" },
  whatHint: { en: "e.g. The air-conditioning in the meeting room is not cooling", ms: "cth. Penyaman udara di bilik mesyuarat tidak sejuk" },
  where: { en: "Where?", ms: "Di mana?" },
  site: { en: "Site", ms: "Tapak" },
  chooseSite: { en: "— choose —", ms: "— pilih —" },
  place: { en: "Place (floor, room, area)", ms: "Lokasi (tingkat, bilik, kawasan)" },
  location: { en: "Location", ms: "Lokasi" },
  type: { en: "Type of problem (optional)", ms: "Jenis masalah (pilihan)" },
  notSure: { en: "Not sure", ms: "Tidak pasti" },
  urgent: { en: "This is urgent or a safety hazard", ms: "Ini segera atau membahayakan keselamatan" },
  you: { en: "Your details", ms: "Butiran anda" },
  name: { en: "Your name", ms: "Nama anda" },
  email: { en: "Email", ms: "E-mel" },
  phone: { en: "Phone", ms: "Telefon" },
  contactHint: { en: "Give an email or a phone number (or both) so the team can reach you. Updates are emailed.", ms: "Berikan e-mel atau nombor telefon (atau kedua-duanya) supaya pasukan boleh menghubungi anda. Kemas kini dihantar melalui e-mel." },
  photos: { en: "Photos (optional)", ms: "Foto (pilihan)" },
  addPhoto: { en: "Add a photo", ms: "Tambah foto" },
  remove: { en: "Remove", ms: "Buang" },
  code: { en: "Access code", ms: "Kod akses" },
  codeHint: { en: "It is on the notice where you found this page.", ms: "Ia tertera pada notis di mana anda menemui halaman ini." },
  send: { en: "Send", ms: "Hantar" },
  sending: { en: "Sending…", ms: "Menghantar…" },
  privacy: { en: "Your details are used only to deal with this request.", ms: "Butiran anda hanya digunakan untuk mengendalikan permohonan ini." },
  thanks: { en: "Thank you — we have your request", ms: "Terima kasih — permohonan anda telah diterima" },
  thanksPlain: { en: "Thank you. Your request has been sent.", ms: "Terima kasih. Permohonan anda telah dihantar." },
  reference: { en: "Your reference", ms: "Rujukan anda" },
  keepLink: { en: "Keep this link to follow your request, reply to the team and rate the work. Anyone with the link can see the request.", ms: "Simpan pautan ini untuk mengikuti permohonan anda, membalas pasukan dan menilai kerja. Sesiapa yang mempunyai pautan boleh melihat permohonan ini." },
  follow: { en: "Follow my request", ms: "Ikuti permohonan saya" },
  copy: { en: "Copy link", ms: "Salin pautan" },
  copied: { en: "Copied", ms: "Disalin" },
  another: { en: "Report another problem", ms: "Laporkan masalah lain" },
  onDevice: { en: "Your requests on this device", ms: "Permohonan anda pada peranti ini" },
  closed: { en: "The online form is closed at the moment. Please contact the maintenance team directly.", ms: "Borang dalam talian ditutup buat masa ini. Sila hubungi pasukan penyelenggaraan secara terus." },
  unavailable: { en: "This page is not available.", ms: "Halaman ini tidak tersedia." },
  offline: { en: "You seem to be offline. Check your connection and try again.", ms: "Anda kelihatan di luar talian. Semak sambungan anda dan cuba lagi." },
  // tracking
  yourRequest: { en: "Your request", ms: "Permohonan anda" },
  sent: { en: "Sent", ms: "Dihantar" },
  progress: { en: "Progress", ms: "Kemajuan" },
  received: { en: "Received", ms: "Diterima" },
  accepted: { en: "Accepted", ms: "Diluluskan" },
  inProgress: { en: "In progress", ms: "Sedang dibaiki" },
  waiting: { en: "Waiting", ms: "Menunggu" },
  done: { en: "Done", ms: "Selesai" },
  reason: { en: "Reason", ms: "Sebab" },
  messages: { en: "Messages", ms: "Mesej" },
  noMessages: { en: "No messages yet. You can add details here.", ms: "Belum ada mesej. Anda boleh menambah butiran di sini." },
  reply: { en: "Write to the team…", ms: "Tulis kepada pasukan…" },
  sendMessage: { en: "Send message", ms: "Hantar mesej" },
  you2: { en: "You", ms: "Anda" },
  cancel: { en: "Cancel this request", ms: "Batalkan permohonan ini" },
  confirmCancel: { en: "Cancel this request? The team will not act on it.", ms: "Batalkan permohonan ini? Pasukan tidak akan mengambil tindakan." },
  rateTitle: { en: "How did we do?", ms: "Bagaimana prestasi kami?" },
  rateComment: { en: "Anything to add? (optional)", ms: "Ada apa-apa untuk ditambah? (pilihan)" },
  rateSend: { en: "Send rating", ms: "Hantar penilaian" },
  rated: { en: "Thank you for your rating", ms: "Terima kasih atas penilaian anda" },
  refresh: { en: "Refresh", ms: "Muat semula" },
  notFound: { en: "We could not find this request. Check that you opened the whole link from your email or confirmation.", ms: "Kami tidak menemui permohonan ini. Pastikan anda membuka keseluruhan pautan daripada e-mel atau pengesahan anda." },
  photosSent: { en: "photo(s) sent", ms: "foto dihantar" },
  urgentTag: { en: "Urgent", ms: "Segera" },
} as const;
