import { Module } from '@nestjs/common';
import { NotificationSnooze, NotificationSnoozeSchema } from './schemas/notification-snooze.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../modules/users/users.module';
import { EventsModule } from '../events/events.module';
import { EMAIL_SERVICE } from './email.constants';
import { LoggingEmailService } from './logging-email.service';
import { SmtpEmailService } from './smtp-email.service';
import { NotificationDigestService } from './notification-digest.service';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { ChannelStatusService } from './channel-status.service';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationsController } from './notifications.controller';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import {
  NotificationPreference,
  NotificationPreferenceSchema,
} from './schemas/notification-preference.schema';

@Module({
  imports: [
    UsersModule,
    EventsModule,
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
      { name: NotificationPreference.name, schema: NotificationPreferenceSchema },
      { name: NotificationSnooze.name, schema: NotificationSnoozeSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    LoggingEmailService,
    SmtpEmailService,
    // Module 11 gap-closure: real SMTP only once SMTP_HOST is configured - otherwise the
    // logging-only sender, exactly as before.
    {
      provide: EMAIL_SERVICE,
      inject: [ConfigService, LoggingEmailService, SmtpEmailService],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        logging: LoggingEmailService,
        smtp: SmtpEmailService,
      ) => (config.get('smtp', { infer: true }).host ? smtp : logging),
    },
    NotificationDigestService,
    NotificationsRepository,
    ChannelStatusService,
    NotificationsService,
  ],
  exports: [NotificationsService, ChannelStatusService],
})
export class NotificationsModule {}
