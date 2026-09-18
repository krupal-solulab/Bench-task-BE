import { Module } from '@nestjs/common';
import { IntegrationHealthService } from './integration-health.service';
import { IntegrationHealthController } from './integration-health.controller';

@Module({
  controllers: [IntegrationHealthController],
  providers: [IntegrationHealthService],
})
export class IntegrationHealthModule {}
