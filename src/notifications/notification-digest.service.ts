import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AppConfig } from '../config/configuration';
import { UsersRepository } from '../modules/users/users.repository';
import { ChannelStatusService } from './channel-status.service';
import { EMAIL_SERVICE } from './email.constants';
import { IEmailService } from './email.interface';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { DIGEST_PERIOD_MS } from './digest.util';

/**
 * Module 11 gap-closure: sends each opted-in user their digest email once per period (daily or
 * weekly, from their notification preferences). Users with nothing unread get no email. The
 * email only leaves the server if SMTP is configured (otherwise LoggingEmailService just logs
 * it, like every other email) and the Platform Admin hasn't paused the Email channel.
 */
@Injectable()
export class NotificationDigestService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
    private readonly notificationsService: NotificationsService,
    private readonly usersRepository: UsersRepository,
    private readonly channelStatusService: ChannelStatusService,
    private readonly configService: ConfigService<AppConfig, true>,
    @Inject(EMAIL_SERVICE) private readonly emailService: IEmailService,
    @InjectPinoLogger(NotificationDigestService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async sendDueDigests(now = new Date()): Promise<number> {
    if (await this.channelStatusService.isPaused('Email')) return 0;
    const due = await this.notificationsRepository.findDigestsDue(now, DIGEST_PERIOD_MS);
    let sent = 0;
    for (const preference of due) {
      const ownerId = preference.owner.toString();
      try {
        const period = preference.digest as 'daily' | 'weekly';
        const digest = await this.notificationsService.digestFor(
          ownerId,
          period,
          now,
          this.appUrl(),
        );
        if (digest.unreadCount > 0) {
          const user = await this.usersRepository.findById(ownerId);
          if (user?.isActive) {
            await this.emailService.send({
              to: user.email,
              subject: digest.subject,
              template: 'digest',
              data: { text: digest.text, period, unreadCount: digest.unreadCount },
            });
            sent += 1;
          }
        }
        await this.notificationsRepository.markDigestSent(ownerId, now);
      } catch (err) {
        this.logger.warn({ err, ownerId }, 'failed to send a notification digest, will retry');
      }
    }
    return sent;
  }

  appUrl(): string {
    return this.configService.get('appUrl', { infer: true });
  }
}
