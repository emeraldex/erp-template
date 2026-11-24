import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, JWTVerifyGetKey, jwtVerify } from 'jose';
import { authConfig } from './auth.config';
import { SsoConfigService } from './sso-config.service';

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }

/** Short-lived state carried through the identity provider round trip. */
export interface SsoState { state: string; nonce: string; verifier: string; tid: string; web: string; exp: number }

export class SsoError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const b64url = (b: Buffer) => b.toString('base64url');

/** OpenID Connect authorization-code flow with PKCE. */
@Injectable()
export class SsoService {
  private readonly log = new Logger(SsoService.name);
  private readonly discovery = new Map<string, { doc: Discovery; jwks: JWTVerifyGetKey; at: number }>();

  constructor(private readonly config: SsoConfigService) {}

  /** Fetch (and cache for an hour) the issuer's discovery document and keys. */
  async discover(issuer: string): Promise<{ doc: Discovery; jwks: JWTVerifyGetKey }> {
    const hit = this.discovery.get(issuer);
    if (hit && Date.now() - hit.at < 3_600_000) return hit;
    let doc: Discovery;
    try {
      const res = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      doc = (await res.json()) as Discovery;
    } catch (err) {
      throw new BadRequestException(`Could not read ${issuer}/.well-known/openid-configuration (${(err as Error).message})`);
    }
    if (doc.issuer?.replace(/\/+$/, '') !== issuer) throw new BadRequestException(`Discovery document is for issuer ${doc.issuer}, not ${issuer}`);
    for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      if (!doc[k]) throw new BadRequestException(`Discovery document has no ${k}`);
    }
    const entry = { doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri)), at: Date.now() };
    this.discovery.set(issuer, entry);
    return entry;
  }

  sealState(s: SsoState): string {
    const body = b64url(Buffer.from(JSON.stringify(s)));
    return `${body}.${b64url(createHmac('sha256', authConfig.secret).update(`sso:${body}`).digest())}`;
  }

  openState(cookie: string | undefined): SsoState {
    const [body, sig] = (cookie ?? '').split('.');
    if (!body || !sig) throw new SsoError('state_missing', 'Sign-in session expired — start again');
    const expected = createHmac('sha256', authConfig.secret).update(`sso:${body}`).digest();
    const given = Buffer.from(sig, 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new SsoError('state_invalid', 'Sign-in state was tampered with');
    const s = JSON.parse(Buffer.from(body, 'base64url').toString()) as SsoState;
    if (s.exp < Date.now()) throw new SsoError('state_expired', 'Sign-in took too long — start again');
    return s;
  }

  /** Build the redirect to the identity provider and the state to remember. */
  async start(redirectUri: string, tid: string, web: string): Promise<{ url: string; state: SsoState }> {
    const cfg = await this.config.get();
    if (!cfg.enabled) throw new SsoError('not_enabled', 'Single sign-on is not enabled for this organisation');
    const { doc } = await this.discover(cfg.issuer);
    const state: SsoState = {
      state: b64url(randomBytes(24)), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)),
      tid, web, exp: Date.now() + 10 * 60_000,
    };
    const url = new URL(doc.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: cfg.clientId, redirect_uri: redirectUri, scope: 'openid email profile',
      state: state.state, nonce: state.nonce,
      code_challenge: b64url(createHash('sha256').update(state.verifier).digest()), code_challenge_method: 'S256',
    }).toString();
    return { url: url.toString(), state };
  }

  /** Exchange the code, verify the ID token, and return the user's verified email. */
  async finish(params: { code?: string; state?: string; error?: string }, s: SsoState, redirectUri: string): Promise<{ email: string; subject: string }> {
    if (params.error) throw new SsoError('idp_error', `The identity provider refused sign-in (${params.error})`);
    if (!params.code || !params.state) throw new SsoError('bad_callback', 'Missing code or state');
    const a = Buffer.from(params.state);
    const b = Buffer.from(s.state);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new SsoError('state_mismatch', 'Sign-in state does not match');

    const cfg = await this.config.get();
    if (!cfg.enabled) throw new SsoError('not_enabled', 'Single sign-on is not enabled for this organisation');
    const { doc, jwks } = await this.discover(cfg.issuer);
    const secret = await this.config.clientSecret();
    const res = await fetch(doc.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: params.code, redirect_uri: redirectUri, client_id: cfg.clientId,
        code_verifier: s.verifier, ...(secret ? { client_secret: secret } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !tokens.id_token) {
      this.log.warn(`Token exchange failed: ${res.status} ${tokens.error ?? ''} ${tokens.error_description ?? ''}`);
      throw new SsoError('token_exchange', 'The identity provider did not issue a token');
    }
    let claims: Record<string, unknown>;
    try {
      ({ payload: claims } = await jwtVerify(tokens.id_token, jwks, { issuer: doc.issuer, audience: cfg.clientId, clockTolerance: 60 }));
    } catch (err) {
      this.log.warn(`ID token rejected: ${(err as Error).message}`);
      throw new SsoError('token_invalid', 'The identity token could not be verified');
    }
    if (claims.nonce !== s.nonce) throw new SsoError('nonce_mismatch', 'The identity token was not issued for this sign-in');
    // Entra ID often puts the address in preferred_username; accept it only as a fallback.
    const email = String(claims.email ?? claims.preferred_username ?? '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) throw new SsoError('no_email', 'The identity provider did not share an email address');
    if (claims.email_verified === false) throw new SsoError('email_unverified', 'Your email address is not verified with the identity provider');
    return { email, subject: String(claims.sub) };
  }
}
