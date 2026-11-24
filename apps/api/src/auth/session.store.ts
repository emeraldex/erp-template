import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { authConfig } from './auth.config';

/** Persistence for login sessions and per-account sign-in protection. */
@Injectable()
export class SessionStore {
  constructor(private readonly prisma: PrismaService) {}

  userByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  }

  userById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(userId: string, meta: { ip?: string; userAgent?: string }, method: 'password' | 'sso' = 'password') {
    const now = Date.now();
    return this.prisma.session.create({
      data: {
        id: randomBytes(24).toString('base64url'),
        userId,
        expiresAt: new Date(now + authConfig.ttlMs),
        ip: meta.ip?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 256),
        method,
      },
    });
  }

  find(id: string) {
    return this.prisma.session.findUnique({ where: { id }, include: { user: true } });
  }

  touch(id: string) {
    return this.prisma.session.update({ where: { id }, data: { lastSeenAt: new Date() } });
  }

  revoke(id: string) {
    return this.prisma.session.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  revokeAllFor(userId: string, exceptId?: string) {
    return this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Count a failed sign-in; lock the account once the limit is reached. */
  async recordFailure(userId: string, failedLogins: number) {
    const next = failedLogins + 1;
    const lock = next >= authConfig.maxFailedLogins;
    await this.prisma.user.update({
      where: { id: userId },
      data: lock
        ? { failedLogins: 0, lockedUntil: new Date(Date.now() + authConfig.lockMs) }
        : { failedLogins: next },
    });
    return lock;
  }

  recordSuccess(userId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { failedLogins: 0, lockedUntil: null } });
  }

  setPassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });
  }
}
