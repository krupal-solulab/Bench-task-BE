import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../modules/users/users.module';
import { EventsModule } from '../events/events.module';
import { EMAIL_SERVICE } from './email.constants';
import { LoggingEmailService } from './logging-email.service';
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
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    { provide: EMAIL_SERVICE, useClass: LoggingEmailService },
    NotificationsRepository,
    ChannelStatusService,
    NotificationsService,
  ],
  exports: [NotificationsService, ChannelStatusService],
})
export class NotificationsModule {}
