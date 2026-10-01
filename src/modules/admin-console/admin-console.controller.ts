import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AdminStatsService } from './admin-stats.service';

/** Module 8 gap-closure: org-Admin-only Global Admin Console endpoints, always scoped to the
 * caller's own org (no `:orgId` param). */
@ApiTags('admin-console')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller('admin-console')
export class AdminConsoleController {
  constructor(private readonly adminStatsService: AdminStatsService) {}

  @Get('stats')
  @ApiOperation({ summary: 'Org-wide system dashboard counts (Module 8)' })
  async stats(@CurrentUser() user: AuthenticatedUser) {
    return this.adminStatsService.getStats(requireOrgId(user));
  }
}
