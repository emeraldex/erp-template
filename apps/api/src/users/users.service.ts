import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { hashPassword } from '../common/password';
import type { Role } from '../common/types';
import { StoreService } from '../common/store.service';

type Actor = { sub: string; name: string; role: Role };

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/;
const tempPassword = () => randomBytes(12).toString('base64url');

const PUBLIC = {
  id: true, name: true, email: true, role: true, designation: true, branch: true, createdAt: true,
  deactivatedAt: true, lockedUntil: true, mustChangePassword: true,
} as const;

/**
 * Staff accounts for the current organisation (ADMIN only). Accounts are
 * deactivated, never deleted, so every audit entry stays attributable.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly store: StoreService) {}

  private async log(actor: Actor, summary: string, before: unknown, after: unknown) {
    await this.prisma.configChange.create({
      data: { id: randomUUID(), by: actor.name, role: actor.role, area: 'users', summary, before: (before ?? {}) as never, after: (after ?? {}) as never },
    });
  }

  /** Active staff, for pickers: id, name, role and site only. */
  async directory() {
    return this.prisma.user.findMany({
      where: { deactivatedAt: null },
      select: { id: true, name: true, role: true, branch: true },
      orderBy: { name: 'asc' },
    });
  }

  private async activeAdmins(): Promise<number> {
    return this.prisma.user.count({ where: { role: 'ADMIN', deactivatedAt: null } });
  }

  private async find(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  private check(body: { name?: unknown; role?: unknown; branch?: unknown; designation?: unknown }) {
    if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 100)) throw new BadRequestException('Name is required (up to 100 characters)');
    const roles = this.store.dict('role', true).map((r) => r.key);
    const sites = this.store.dict('site', true).map((r) => r.key);
    if (body.role !== undefined && !roles.includes(body.role as string)) throw new BadRequestException(`Role must be one of ${roles.join(', ')}`);
    if (body.branch !== undefined && !sites.includes(body.branch as string)) throw new BadRequestException(`Branch must be one of ${sites.join(', ')}`);
    if (body.designation !== undefined && (typeof body.designation !== 'string' || body.designation.length > 40)) throw new BadRequestException('Designation is up to 40 characters');
  }

  async list() {
    const users = await this.prisma.user.findMany({ select: PUBLIC, orderBy: [{ deactivatedAt: 'asc' }, { name: 'asc' }] });
    const last = await this.prisma.session.groupBy({ by: ['userId'], _max: { createdAt: true } });
    const seen = new Map(last.map((l) => [l.userId, l._max.createdAt]));
    return users.map((u) => ({ ...u, lastSignIn: seen.get(u.id)?.toISOString() ?? null }));
  }

  async create(body: { name?: string; email?: string; role?: string; designation?: string; branch?: string }, actor: Actor) {
    this.check({ ...body, name: body.name ?? '' });
    const email = (body.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new BadRequestException('A valid email address is required');
    if (!body.role) throw new BadRequestException('Role is required');
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException(`${email} already has an account`);
    const password = tempPassword();
    const user = await this.prisma.user.create({
      data: {
        id: `u-${randomBytes(5).toString('hex')}`, name: body.name!.trim(), email, role: body.role as never,
        designation: (body.designation ?? '').trim(), branch: (body.branch ?? 'HQ') as never,
        passwordHash: await hashPassword(password), mustChangePassword: true,
      },
      select: PUBLIC,
    });
    await this.log(actor, `Added ${user.name} <${email}> as ${user.role}`, null, user);
    // Shown once to the administrator to pass on; it must be changed at first sign-in.
    return { user, temporaryPassword: password };
  }

  async update(id: string, body: { name?: string; role?: string; designation?: string; branch?: string }, actor: Actor) {
    this.check(body);
    const before = await this.find(id);
    if (body.role && body.role !== before.role) {
      if (id === actor.sub) throw new ForbiddenException('You cannot change your own role');
      if (before.role === 'ADMIN' && !before.deactivatedAt && (await this.activeAdmins()) <= 1) throw new ForbiddenException('This is the last active administrator');
    }
    const after = await this.prisma.user.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name.trim() } : {}), ...(body.role ? { role: body.role as never } : {}),
        ...(body.designation !== undefined ? { designation: body.designation.trim() } : {}), ...(body.branch ? { branch: body.branch as never } : {}),
      },
      select: PUBLIC,
    });
    await this.log(actor, `Updated ${after.name}${body.role && body.role !== before.role ? `: role ${before.role} → ${after.role}` : ''}`, before, after);
    return after;
  }

  async resetPassword(id: string, actor: Actor) {
    const before = await this.find(id);
    const password = tempPassword();
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
    await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.log(actor, `Reset the password of ${before.name}`, { id }, { id });
    return { temporaryPassword: password };
  }

  async unlock(id: string, actor: Actor) {
    const before = await this.find(id);
    await this.prisma.user.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.log(actor, `Unlocked ${before.name}`, { lockedUntil: before.lockedUntil }, { lockedUntil: null });
    return this.find(id);
  }

  async setActive(id: string, active: boolean, actor: Actor) {
    const before = await this.find(id);
    if (!active) {
      if (id === actor.sub) throw new ForbiddenException('You cannot deactivate yourself');
      if (before.role === 'ADMIN' && !before.deactivatedAt && (await this.activeAdmins()) <= 1) throw new ForbiddenException('This is the last active administrator');
    }
    const after = await this.prisma.user.update({ where: { id }, data: { deactivatedAt: active ? null : new Date() }, select: PUBLIC });
    if (!active) await this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.log(actor, `${active ? 'Reactivated' : 'Deactivated'} ${after.name}`, before, after);
    return after;
  }
}
