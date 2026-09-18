import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { Role } from '../../common/enums/role.enum';
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
}
