import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformOnly } from '../../common/decorators/platform-only.decorator';
import { Role } from '../../common/enums/role.enum';
import { OrganizationsService } from './organizations.service';

@ApiTags('platform')
@ApiBearerAuth()
@Roles(Role.PLATFORM_ADMIN)
@PlatformOnly()
@Controller('platform/stats')
export class PlatformStatsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Platform-wide organization/user counts (PlatformAdmin only)' })
  async stats() {
    return this.organizationsService.stats();
  }
}
