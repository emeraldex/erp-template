/**
 * Authentication settings, read once from the environment. Every value has a
 * safe default except AUTH_SECRET, which the API refuses to start without.
 */
const num = (name: string, fallback: number) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number (got "${raw}")`);
  return n;
};
const bool = (name: string, fallback: boolean) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
};

const secret = process.env.AUTH_SECRET;
if (!secret || secret === 'change-me-in-production' || secret.length < 32) {
  throw new Error('AUTH_SECRET must be set to a random value of at least 32 characters (openssl rand -hex 32).');
}

const production = process.env.NODE_ENV === 'production';

export const authConfig = {
  secret,
  /** Absolute session lifetime. */
  ttlMs: num('AUTH_TTL_HOURS', 8) * 3_600_000,
  /** Sign out after this long without a request. */
  idleMs: num('AUTH_IDLE_MINUTES', 60) * 60_000,
  /** Failed sign-ins before the account is locked. */
  maxFailedLogins: num('LOGIN_MAX_ATTEMPTS', 5),
  lockMs: num('LOGIN_LOCK_MINUTES', 15) * 60_000,
  /** Sign-in requests allowed per client IP per minute. */
  loginRateLimit: num('LOGIN_RATE_LIMIT', 10),
  /** All other requests allowed per client IP per minute. */
  apiRateLimit: num('API_RATE_LIMIT', 600),
  /** Request-portal submissions allowed per client IP, per minute and per hour. */
  portalRateLimit: num('PORTAL_RATE_LIMIT', 5),
  portalHourlyLimit: num('PORTAL_HOURLY_LIMIT', 20),
  cookieName: 'erp_session',
  cookieSecure: bool('COOKIE_SECURE', production),
  minPasswordLength: 12,
};
