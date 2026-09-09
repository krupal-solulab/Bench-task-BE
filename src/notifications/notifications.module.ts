import { Module } from '@nestjs/common';
import { UsersModule } from '../modules/users/users.module';
import { EMAIL_SERVICE } from './email.constants';
import { LoggingEmailService } from './logging-email.service';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [UsersModule],
  providers: [{ provide: EMAIL_SERVICE, useClass: LoggingEmailService }, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
