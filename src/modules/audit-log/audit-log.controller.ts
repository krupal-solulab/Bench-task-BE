import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogDto } from './dto/list-audit-log.dto';

@ApiTags('audit-log')
@ApiBearerAuth()
@Controller('audit-log')
@Roles(Role.ADMIN)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: "This organization's admin audit log (Module 8)" })
  async list(@Query() query: ListAuditLogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.auditLogService.paginate(requireOrgId(user), query);
  }
}
