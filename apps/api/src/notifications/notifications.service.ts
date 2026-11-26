import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StoreService } from '../common/store.service';
import type { Role } from '../common/types';
import { computeAlerts, SlaAlert } from '../dashboard/sla';
import { Mailer } from './mailer';

const LINKS: Record<string, (ref: string) => string> = {
  JOB: (r) => `/jobs/${encodeURIComponent(r)}`,
  DEMAND: () => '/demands',
  OV: () => '/ov',
  INVOICE: () => '/invoicing',
  STOCK: (r) => `/stock?part=${encodeURIComponent(r)}`,
};

export interface AlertRunResult { checked: number; newAlerts: number; notifications: number; emails: number }

/** FR-10 — SLA alerts delivered in-app and, if configured, by email digest. */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService, private readonly store: StoreService, private readonly mailer: Mailer) {}

  /** Roles that can move a record out of its current status — the people who must act. */
  private owners(alert: SlaAlert): Role[] {
    const rules =
      alert.entity === 'JOB' ? this.store.jobTransitions :
      alert.entity === 'DEMAND' ? this.store.demandTransitions :
      alert.entity === 'OV' ? this.store.ovTransitions : this.store.invoiceTransitions;
    const roles = new Set<Role>(rules.filter((r) => r.from === alert.status).flatMap((r) => r.roles));
    if (alert.level === 'breached') for (const r of this.store.rolesWith('alerts.escalation')) roles.add(r); // escalate breaches
    if (!roles.size) roles.add('ADMIN');
    return [...roles];
  }

  private message(a: SlaAlert): { title: string; body: string } {
    const when = a.level === 'breached'
      ? `${a.days} day${a.days === 1 ? '' : 's'} overdue`
      : `due in ${a.days} day${a.days === 1 ? '' : 's'}`;
    return {
      title: `${a.level === 'breached' ? 'SLA breached' : 'SLA due soon'}: ${a.ref} — ${when}`,
      body: `${a.detail} · ${a.rule} (${a.source}) · status ${a.status}`,
    };
  }

  /**
   * Find new alerts and deliver each exactly once. The sla_alerts unique key
   * (record, rule, level, time entered the status) makes this safe to run on
   * several API replicas at once: only the instance whose insert wins notifies.
   */
  async runAlerts(now = Date.now()): Promise<AlertRunResult> {
    const warnDays = Number(process.env.SLA_WARN_DAYS || 1);
    const snap = await this.store.dashboardSnapshot();
    const alerts = computeAlerts(this.store.slaRules, snap as never, now, warnDays);
    const users = await this.prisma.user.findMany({ select: { id: true, email: true, name: true, role: true } });
    const digests = new Map<string, { email: string; name: string; lines: string[] }>();
    let newAlerts = 0;
    let notifications = 0;

    for (const a of alerts) {
      try {
        await this.prisma.slaAlert.create({
          data: { id: randomUUID(), ref: a.ref, ruleId: a.ruleId, level: `${a.level}@${a.statusSince}` },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue; // already sent
        throw err;
      }
      newAlerts++;
      const { title, body } = this.message(a);
      const roles = this.owners(a);
      const recipients = users.filter((u) => roles.includes(u.role as Role));
      if (!recipients.length) continue;
      await this.prisma.notification.createMany({
        data: recipients.map((u) => ({ id: randomUUID(), userId: u.id, kind: `sla.${a.level}`, title, body, ref: `${a.entity}:${a.ref}` })),
      });
      notifications += recipients.length;
      for (const u of recipients) {
        const d = digests.get(u.id) ?? { email: u.email, name: u.name, lines: [] };
        d.lines.push(`• ${title}\n  ${body}`);
        digests.set(u.id, d);
      }
    }

    let emails = 0;
    if (this.mailer.enabled) {
      for (const d of digests.values()) {
        const ok = await this.mailer.send({
          to: d.email,
          subject: `[ERP] ${d.lines.length} SLA alert${d.lines.length === 1 ? '' : 's'} need your attention`,
          text: `Hello ${d.name},\n\nThe following records need action:\n\n${d.lines.join('\n\n')}\n\nSign in to the ERP to act on them.\n`,
        });
        if (ok) emails++;
      }
    }
    if (newAlerts) this.log.log(`SLA alerts: ${newAlerts} new, ${notifications} notifications, ${emails} emails`);
    return { checked: alerts.length, newAlerts, notifications, emails };
  }

  async mine(userId: string) {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      unread,
      items: items.map((n) => {
        const [entity, ref] = (n.ref ?? '').split(':');
        const link = entity in LINKS && ref ? LINKS[entity](ref) : undefined;
        return { id: n.id, kind: n.kind, title: n.title, body: n.body, ref, link, createdAt: n.createdAt.toISOString(), read: !!n.readAt };
      }),
    };
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (!res.count) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true, updated: res.count };
  }
}
