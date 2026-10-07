import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppConfig } from '../config/configuration';
import { EmailPayload, IEmailService } from './email.interface';

/** Plain-text body for any template: a pre-rendered `data.text` if given (the digest provides
 * one), otherwise a readable list of the payload's fields. */
export function renderEmailText(payload: EmailPayload): string {
  if (typeof payload.data.text === 'string') return payload.data.text;
  const lines = Object.entries(payload.data)
    .filter(([, value]) => value !== undefined && value !== null && typeof value !== 'object')
    .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2')}: ${String(value)}`);
  return [payload.subject, '', ...lines].join('\n');
}

/**
 * Module 11 gap-closure: real email delivery over SMTP (nodemailer). Only ever selected when
 * SMTP_HOST is configured (see NotificationsModule's EMAIL_SERVICE factory); without it the app
 * keeps using LoggingEmailService, exactly as before.
 */
@Injectable()
export class SmtpEmailService implements IEmailService {
  private transporter: Transporter | null = null;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectPinoLogger(SmtpEmailService.name) private readonly logger: PinoLogger,
  ) {}

  private getTransporter(): Transporter {
    if (!this.transporter) {
      const smtp = this.configService.get('smtp', { infer: true });
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
      });
    }
    return this.transporter;
  }

  async send(payload: EmailPayload): Promise<void> {
    const smtp = this.configService.get('smtp', { infer: true });
    await this.getTransporter().sendMail({
      from: smtp.from,
      to: payload.to,
      subject: payload.subject,
      text: renderEmailText(payload),
      ...(payload.html ? { html: payload.html } : {}),
    });
    this.logger.info({ to: payload.to, template: payload.template }, 'email sent via SMTP');
  }
}
