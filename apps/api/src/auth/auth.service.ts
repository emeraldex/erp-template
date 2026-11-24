import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { dummyVerify, hashPassword, verifyPassword } from '../common/password';
import { toBranch } from '../common/mappers';
import { Branch, Role } from '../common/types';
import { authConfig } from './auth.config';
import { SessionStore } from './session.store';
import { SsoConfigService } from './sso-config.service';
import { currentTenant } from '../tenancy/tenant';

/** What the signed token carries: only a session reference and its expiry. */
interface TokenClaims {
  sid: string;
  /** Tenant the session belongs to; a token is useless at another organisation's address. */
  tid: string;
  exp: number;
}

/** The authenticated caller, attached to the request by AuthGuard. */
export interface AuthUser {
  sub: string;
  sid: string;
  name: string;
  email: string;
  role: Role;
  branch: Branch;
  designation: string;
  mustChangePassword: boolean;
}

const INVALID = 'Invalid email or password';
const LOCKED = 'Account temporarily locked after repeated failed sign-ins. Try again later or contact an administrator.';
const WEAK = new Set(['demo123', 'password', 'password123', 'changeme', '123456789012', 'qwertyuiopas']);

export function profile(u: AuthUser) {
  return {
    id: u.sub, name: u.name, email: u.email, role: u.role,
    branch: u.branch, designation: u.designation, mustChangePassword: u.mustChangePassword,
  };
}

@Injectable()
export class AuthService {
  constructor(private readonly sessions: SessionStore, private readonly sso: SsoConfigService) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.sessions.userByEmail(email);
    if (!user || user.deactivatedAt) {
      await dummyVerify(); // same work whether or not the account exists (or is active)
      throw new UnauthorizedException(INVALID);
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await dummyVerify();
      throw new UnauthorizedException(LOCKED);
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const locked = await this.sessions.recordFailure(user.id, user.failedLogins);
      throw new UnauthorizedException(locked ? LOCKED : INVALID);
    }
    // With SSO enforced, passwords only work for administrators (break-glass access
    // if the identity provider is down or misconfigured).
    const sso = await this.sso.get();
    if (sso.enabled && !sso.allowPasswordLogin && user.role !== 'ADMIN') {
      throw new ForbiddenException({ statusCode: 403, code: 'SSO_REQUIRED', message: `Sign in with ${sso.label} instead` });
    }
    await this.sessions.recordSuccess(user.id);
    return this.issue(user, meta, 'password');
  }

  /** After a verified single sign-on: start a session for the matching user, if any. */
  async loginSso(email: string, meta: { ip?: string; userAgent?: string }) {
    const user = await this.sessions.userByEmail(email);
    if (!user || user.deactivatedAt) return null;
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) return null;
    return this.issue(user, meta, 'sso');
  }

  private async issue(
    user: NonNullable<Awaited<ReturnType<SessionStore['userByEmail']>>>,
    meta: { ip?: string; userAgent?: string },
    method: 'password' | 'sso',
  ) {
    const session = await this.sessions.create(user.id, meta, method);
    const authUser = this.toAuthUser(user, session.id, method);
    return { token: this.sign({ sid: session.id, tid: currentTenant().id, exp: session.expiresAt.getTime() }), user: authUser, expiresAt: session.expiresAt };
  }

  /** Resolve a token to a live session, enforcing expiry, idle timeout and revocation. */
  async authenticate(token: string): Promise<AuthUser> {
    const claims = this.verify(token);
    if (claims.tid !== currentTenant().id) throw new UnauthorizedException('Session belongs to another organisation');
    const session = await this.sessions.find(claims.sid);
    const now = Date.now();
    if (!session || session.revokedAt || session.user.deactivatedAt) throw new UnauthorizedException('Session has ended — sign in again');
    if (session.expiresAt.getTime() <= now) throw new UnauthorizedException('Session expired — sign in again');
    if (now - session.lastSeenAt.getTime() > authConfig.idleMs) {
      await this.sessions.revoke(session.id);
      throw new UnauthorizedException('Signed out after inactivity — sign in again');
    }
    if (now - session.lastSeenAt.getTime() > 60_000) await this.sessions.touch(session.id);
    return this.toAuthUser(session.user, session.id, session.method === 'sso' ? 'sso' : 'password');
  }

  logout(sid: string) {
    return this.sessions.revoke(sid);
  }

  async changePassword(user: AuthUser, current: string, next: string) {
    const row = await this.sessions.userById(user.sub);
    if (!row || !(await verifyPassword(current, row.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    if (next.length < authConfig.minPasswordLength) {
      throw new BadRequestException(`New password must be at least ${authConfig.minPasswordLength} characters`);
    }
    if (next === current) throw new BadRequestException('New password must differ from the current one');
    if (WEAK.has(next.toLowerCase()) || next.toLowerCase().includes(row.email.split('@')[0].toLowerCase())) {
      throw new BadRequestException('New password is too easy to guess');
    }
    await this.sessions.setPassword(user.sub, await hashPassword(next));
    await this.sessions.revokeAllFor(user.sub, user.sid); // sign out every other device
    return { ...user, mustChangePassword: false };
  }

  sign(claims: TokenClaims): string {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = createHmac('sha256', authConfig.secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token: string): TokenClaims {
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra !== undefined) throw new UnauthorizedException('Malformed token');
    const expected = createHmac('sha256', authConfig.secret).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new UnauthorizedException('Bad signature');
    }
    let claims: TokenClaims;
    try {
      claims = JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch {
      throw new UnauthorizedException('Malformed token');
    }
    if (typeof claims.sid !== 'string' || typeof claims.tid !== 'string' || typeof claims.exp !== 'number') throw new UnauthorizedException('Malformed token');
    if (claims.exp <= Date.now()) throw new UnauthorizedException('Session expired — sign in again');
    return claims;
  }

  private toAuthUser(
    u: { id: string; name: string; email: string; role: string; branch: string; designation: string; mustChangePassword: boolean },
    sid: string,
    method: 'password' | 'sso' = 'password',
  ): AuthUser {
    return {
      sub: u.id, sid, name: u.name, email: u.email, role: u.role as Role,
      branch: toBranch(u.branch),
      // Someone who signed in through their identity provider has no password to change here.
      designation: u.designation, mustChangePassword: method === 'sso' ? false : u.mustChangePassword,
    };
  }
}
