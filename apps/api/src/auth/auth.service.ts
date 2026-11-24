import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { StoreService } from '../common/store.service';
import { dummyVerify, verifyPassword } from '../common/password';
import { Role } from '../common/types';

const SECRET = process.env.AUTH_SECRET;
if (!SECRET || SECRET === 'change-me-in-production') {
  throw new Error('AUTH_SECRET must be set to a strong random value before the API will start.');
}
const TTL_HOURS = Number(process.env.AUTH_TTL_HOURS ?? 8);

export interface TokenPayload {
  sub: string;
  name: string;
  role: Role;
  branch: string;
  exp: number;
}

/**
 * HMAC-signed bearer token (JWT-compatible shape). To move to a corporate IdP,
 * replace verify() with the provider's token introspection — the guard and the
 * role gates above it are unchanged.
 */
@Injectable()
export class AuthService {
  constructor(private readonly store: StoreService) {}

  async login(email: string, password: string) {
    const user = await this.store.userByEmail(email);
    if (!user) {
      await dummyVerify(); // same work whether or not the account exists
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const payload: TokenPayload = {
      sub: user.id,
      name: user.name,
      role: user.role,
      branch: user.branch,
      exp: Date.now() + TTL_HOURS * 3600_000,
    };
    return {
      token: this.sign(payload),
      user: {
        id: user.id, name: user.name, email: user.email,
        role: user.role, branch: user.branch, designation: user.designation,
      },
    };
  }

  sign(payload: TokenPayload): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = createHmac('sha256', SECRET as string).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  verify(token: string): TokenPayload {
    const [body, sig] = token.split('.');
    if (!body || !sig) throw new UnauthorizedException('Malformed token');
    const expected = createHmac('sha256', SECRET as string).update(body).digest();
    const given = Buffer.from(sig, 'base64url');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      throw new UnauthorizedException('Bad signature');
    }
    const payload: TokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (payload.exp < Date.now()) throw new UnauthorizedException('Token expired');
    return payload;
  }
}
