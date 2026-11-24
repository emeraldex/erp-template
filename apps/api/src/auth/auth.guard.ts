import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService, AuthUser } from './auth.service';
import { authConfig } from './auth.config';
import { ALLOW_PENDING_PASSWORD_KEY } from './auth.decorators';
import { ROLES_KEY } from './roles.decorator';
import { Role } from '../common/types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Session from the httpOnly cookie (browser) or an Authorization bearer token (scripts). */
export function readToken(req: Request): { token: string; via: 'cookie' | 'bearer' } | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return { token: header.slice(7), via: 'bearer' };
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[authConfig.cookieName];
  return cookie ? { token: cookie, via: 'cookie' } : null;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const found = readToken(req);
    if (!found) throw new UnauthorizedException('Sign in required');

    // Cookies ride along on cross-site requests; require a header a plain HTML
    // form or <img> cannot set, so a state change can't be forged (CSRF).
    if (found.via === 'cookie' && !SAFE_METHODS.has(req.method) && !req.headers['x-requested-with']) {
      throw new ForbiddenException('Missing X-Requested-With header');
    }

    const user = await this.auth.authenticate(found.token);
    req.user = user;

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (user.mustChangePassword && !allowPending) {
      throw new ForbiddenException({ statusCode: 403, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password to continue' });
    }

    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role) && user.role !== 'ADMIN') {
      throw new ForbiddenException(`Requires role: ${roles.join(' | ')}`);
    }
    return true;
  }
}
