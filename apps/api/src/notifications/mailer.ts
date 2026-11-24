import { Injectable, Logger } from '@nestjs/common';
import nodemailer = require('nodemailer');

export interface Mail { to: string; subject: string; text: string }

/**
 * Outgoing email. Off unless SMTP_URL is set (smtp://user:pass@host:587 or
 * smtps://…:465). With MAIL_TRANSPORT=memory messages are kept in `outbox`
 * instead of sent — for tests and demos.
 */
@Injectable()
export class Mailer {
  private readonly log = new Logger(Mailer.name);
  private readonly transport: nodemailer.Transporter | null;
  private readonly from = process.env.MAIL_FROM || 'Maintenance ERP <no-reply@localhost>';
  readonly outbox: Mail[] = [];
  readonly mode: 'smtp' | 'memory' | 'off';

  constructor() {
    if (process.env.MAIL_TRANSPORT === 'memory') {
      this.mode = 'memory';
      this.transport = null;
    } else if (process.env.SMTP_URL) {
      this.mode = 'smtp';
      this.transport = nodemailer.createTransport(process.env.SMTP_URL);
    } else {
      this.mode = 'off';
      this.transport = null;
    }
  }

  get enabled(): boolean {
    return this.mode !== 'off';
  }

  async send(mail: Mail): Promise<boolean> {
    if (this.mode === 'memory') {
      this.outbox.push(mail);
      return true;
    }
    if (!this.transport) return false;
    try {
      await this.transport.sendMail({ from: this.from, ...mail });
      return true;
    } catch (err) {
      // Email is best-effort: the in-app notification is already stored.
      this.log.error(`Email to ${mail.to} failed: ${(err as Error).message}`);
      return false;
    }
  }
}
