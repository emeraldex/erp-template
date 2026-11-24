import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (pw: string | Buffer, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;

// scrypt from Node's stdlib rather than bcrypt/argon2: memory-hard, no native
// addon to compile, so the production image needs no build toolchain.
const N = 2 ** 15; // CPU/memory cost
const r = 8;
const p = 1;
const KEYLEN = 32;
// scrypt needs maxmem >= ~128 * N * r; Node's default (32 MB) is below what
// N=32768 requires, so raise it explicitly or the hash call throws.
const OPTS = { N, r, p, maxmem: 256 * N * r };

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(plain, salt, KEYLEN, OPTS);
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, sN, sR, sP, salt64, key64] = parts;
  const expected = Buffer.from(key64, 'base64');
  const actual = await scrypt(plain, Buffer.from(salt64, 'base64'), expected.length, {
    N: Number(sN), r: Number(sR), p: Number(sP), maxmem: 256 * Number(sN) * Number(sR),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Burn roughly one hash's worth of time when the email doesn't exist, so login
 * latency can't be used to enumerate valid accounts.
 */
export async function dummyVerify(): Promise<void> {
  await scrypt('invalid', randomBytes(16), KEYLEN, OPTS);
}
