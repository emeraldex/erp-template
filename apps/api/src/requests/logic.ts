import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';
import type { Phase } from '../packs/types';

/**
 * Tracking links. A link is `<request id>.<signature>`, the signature an HMAC
 * of the organisation, the request and its salt under a key derived from
 * AUTH_SECRET. Nothing is stored: any email can carry a fresh copy, and
 * changing the salt cancels every link to that request.
 */
const keyCache = new Map<string, Buffer>();
function key(secret: string): Buffer {
  let k = keyCache.get(secret);
  if (!k) {
    k = Buffer.from(hkdfSync('sha256', secret, 'erp-requests', 'tracking-link', 32));
    keyCache.set(secret, k);
  }
  return k;
}

const sign = (secret: string, tenant: string, id: string, salt: string) =>
  createHmac('sha256', key(secret)).update(`${tenant}:${id}:${salt}`).digest('base64url').slice(0, 27);

export const newSalt = () => randomBytes(12).toString('base64url');

export function makeToken(secret: string, tenant: string, id: string, salt: string): string {
  return `${id}.${sign(secret, tenant, id, salt)}`;
}

/** The request id a token names, before it is checked against the salt. */
export function tokenId(token: unknown): string | null {
  if (typeof token !== 'string' || token.length > 80) return null;
  const m = /^(REQ-\d{4}-\d{4,6})\.([A-Za-z0-9_-]{27})$/.exec(token);
  return m ? m[1] : null;
}

export function checkToken(secret: string, tenant: string, token: string, salt: string): boolean {
  const id = tokenId(token);
  if (!id) return false;
  const given = Buffer.from(token.slice(id.length + 1));
  const expected = Buffer.from(sign(secret, tenant, id, salt));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** What the requester is told about progress — never internal status names. */
export type Stage = 'received' | 'accepted' | 'in_progress' | 'waiting' | 'done' | 'declined' | 'cancelled';

export function stageOf(status: string, jobPhase: Phase | null): Stage {
  if (status === 'DECLINED') return 'declined';
  if (status === 'CANCELLED') return 'cancelled';
  if (status !== 'ACCEPTED' || !jobPhase) return 'received';
  switch (jobPhase) {
    case 'new': return 'accepted';
    case 'active': return 'in_progress';
    case 'waiting_parts': case 'waiting_customer': case 'external': return 'waiting';
    case 'done': case 'closed': return 'done';
  }
}

export const STAGE_LABEL: Record<Stage, { en: string; ms: string }> = {
  received: { en: 'Received — waiting to be reviewed', ms: 'Diterima — menunggu semakan' },
  accepted: { en: 'Accepted — work has been booked', ms: 'Diterima — kerja telah dijadualkan' },
  in_progress: { en: 'In progress', ms: 'Sedang dibaiki' },
  waiting: { en: 'Waiting (parts, approval or a contractor)', ms: 'Menunggu (alat ganti, kelulusan atau kontraktor)' },
  done: { en: 'Done', ms: 'Selesai' },
  declined: { en: 'Not taken forward', ms: 'Tidak diteruskan' },
  cancelled: { en: 'Cancelled', ms: 'Dibatalkan' },
};

export type Lang = 'en' | 'ms';
export const langOf = (v: unknown): Lang => (v === 'ms' ? 'ms' : 'en');

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const PHONE = /^[+0-9 ()-]{6,24}$/;

export interface RequestInput {
  description: string; place: string; site: string; category: string; urgent: boolean;
  name: string; email: string; phone: string; lang: Lang;
}

/** Check and tidy what someone typed into the request form. Returns the problems found. */
export function cleanInput(body: Record<string, unknown>): { input: RequestInput; errors: string[] } {
  const s = (k: string, max: number) => (typeof body[k] === 'string' ? (body[k] as string).replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 1000) : '';
  const input: RequestInput = {
    description, place: s('place', 120), site: s('site', 40), category: s('category', 40),
    urgent: body.urgent === true || body.urgent === 'true' || body.urgent === '1' || body.urgent === 'on',
    name: s('name', 80), email: s('email', 254).toLowerCase(), phone: s('phone', 24), lang: langOf(body.lang),
  };
  const errors: string[] = [];
  if (description.length < 5) errors.push('Say what is wrong (at least 5 characters)');
  if (input.name.length < 2) errors.push('Give your name');
  if (!input.email && !input.phone) errors.push('Give an email address or a phone number so the team can reach you');
  if (input.email && !EMAIL.test(input.email)) errors.push('That email address does not look right');
  if (input.phone && !PHONE.test(input.phone)) errors.push('That phone number does not look right');
  return { input, errors };
}

/** Emails to the requester, in their language. Never echo their own text back (no open relay). */
export function requestEmail(kind: 'received' | 'accepted' | 'merged' | 'declined' | 'message' | 'done', lang: Lang, o: {
  org: string; id: string; link: string; reason?: string; jobId?: string;
}): { subject: string; text: string } {
  const ms = lang === 'ms';
  const sign = ms ? `\n\n— ${o.org}` : `\n\n— ${o.org}`;
  const track = ms ? `Ikuti permohonan anda di sini:\n${o.link}` : `Follow your request here:\n${o.link}`;
  switch (kind) {
    case 'received':
      return ms
        ? { subject: `${o.id}: permohonan anda diterima`, text: `Terima kasih. Kami telah menerima permohonan anda (${o.id}) dan akan menyemaknya.\n\n${track}${sign}` }
        : { subject: `${o.id}: we have your request`, text: `Thank you. We have received your request (${o.id}) and will review it.\n\n${track}${sign}` };
    case 'accepted':
      return ms
        ? { subject: `${o.id}: kerja telah dijadualkan`, text: `Permohonan anda (${o.id}) telah diterima dan kerja telah dijadualkan.\n\n${track}${sign}` }
        : { subject: `${o.id}: work has been booked`, text: `Your request (${o.id}) has been accepted and the work has been booked.\n\n${track}${sign}` };
    case 'merged':
      return ms
        ? { subject: `${o.id}: sudah dalam tindakan`, text: `Masalah yang anda laporkan (${o.id}) sudah pun dilaporkan dan sedang diuruskan. Kami akan memaklumkan anda apabila ia selesai.\n\n${track}${sign}` }
        : { subject: `${o.id}: already being dealt with`, text: `The problem you reported (${o.id}) had already been reported and is being dealt with. We will let you know when it is done.\n\n${track}${sign}` };
    case 'declined':
      return ms
        ? { subject: `${o.id}: tidak diteruskan`, text: `Permohonan anda (${o.id}) tidak diteruskan.\n\nSebab: ${o.reason ?? '-'}\n\n${track}${sign}` }
        : { subject: `${o.id}: not taken forward`, text: `Your request (${o.id}) has not been taken forward.\n\nReason: ${o.reason ?? '-'}\n\n${track}${sign}` };
    case 'message':
      return ms
        ? { subject: `${o.id}: mesej daripada pasukan`, text: `Pasukan telah menghantar mesej tentang permohonan anda (${o.id}). Baca dan balas di sini:\n${o.link}${sign}` }
        : { subject: `${o.id}: a message from the team`, text: `The team has sent a message about your request (${o.id}). Read and reply here:\n${o.link}${sign}` };
    case 'done':
      return ms
        ? { subject: `${o.id}: kerja selesai`, text: `Kerja bagi permohonan anda (${o.id}) telah selesai. Bagaimana prestasi kami? Beri penilaian di sini:\n${o.link}${sign}` }
        : { subject: `${o.id}: the work is done`, text: `The work on your request (${o.id}) is done. How did we do? Rate it here:\n${o.link}${sign}` };
  }
}
