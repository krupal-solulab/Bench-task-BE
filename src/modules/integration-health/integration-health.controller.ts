import { BadRequestException, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  PAUSABLE_NOTIFICATION_CHANNELS,
  PausableNotificationChannel,
} from '../../notifications/channel-status.service';
import { IntegrationHealthService } from './integration-health.service';

@ApiTags('platform')
@ApiBearerAuth()
@Roles(Role.PLATFORM_ADMIN)
@PlatformOnly()
@Controller('platform/integrations')
export class IntegrationHealthController {
  constructor(private readonly integrationHealthService: IntegrationHealthService) {}

  @Get('health')
  @ApiOperation({ summary: 'Live status of every integration wired into this app' })
  async health() {
    return this.integrationHealthService.check();
  }

  @Post(':channel/pause')
  @ApiOperation({ summary: 'Pause the Email or WhatsApp notification channel' })
  async pause(@Param('channel') channel: string) {
    await this.integrationHealthService.setChannelPaused(this.assertPausable(channel), true);
    return this.integrationHealthService.check();
  }

  @Post(':channel/resume')
  @ApiOperation({ summary: 'Resume the Email or WhatsApp notification channel' })
  async resume(@Param('channel') channel: string) {
    await this.integrationHealthService.setChannelPaused(this.assertPausable(channel), false);
    return this.integrationHealthService.check();
  }

  private assertPausable(channel: string): PausableNotificationChannel {
    if (!(PAUSABLE_NOTIFICATION_CHANNELS as readonly string[]).includes(channel)) {
      throw new BadRequestException(
        `"${channel}" cannot be paused - only ${PAUSABLE_NOTIFICATION_CHANNELS.join(', ')} can`,
      );
    }
    return channel as PausableNotificationChannel;
  }
}
