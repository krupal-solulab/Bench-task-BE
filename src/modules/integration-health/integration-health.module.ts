import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { IntegrationHealthService } from './integration-health.service';
import { IntegrationHealthController } from './integration-health.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [IntegrationHealthController],
  providers: [IntegrationHealthService],
})
export class IntegrationHealthModule {}
