import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ORG_ROLES, Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { CreateCustomRoleDto, UpdateCustomRoleDto } from './dto/custom-role.dto';
import { CustomRolesService } from './custom-roles.service';

/** Organization-defined job roles (QA, DevOps, ...) - readable by everyone (badges), Admin-managed. */
@ApiTags('custom-roles')
@ApiBearerAuth()
@Controller('custom-roles')
export class CustomRolesController {
  constructor(
    private readonly customRolesService: CustomRolesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: "List the organization's roles (seeds the defaults on first use)" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.customRolesService.list(requireOrgId(user));
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a role (Admin only)' })
  async create(@Body() dto: CreateCustomRoleDto, @CurrentUser() user: AuthenticatedUser) {
    const organizationId = requireOrgId(user);
    const role = await this.customRolesService.create(organizationId, dto);
    await this.audit(user, AuditAction.CUSTOM_ROLE_CREATED, role.id, role.name, {
      accessLevel: role.accessLevel,
    });
    return role;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Update a role; changing its access level moves its users too (Admin only)',
  })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCustomRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { role, previousName } = await this.customRolesService.update(
      requireOrgId(user),
      id,
      dto,
    );
    await this.audit(user, AuditAction.CUSTOM_ROLE_UPDATED, role.id, role.name, {
      ...(previousName !== role.name ? { renamedFrom: previousName } : {}),
      accessLevel: role.accessLevel,
    });
    return role;
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role nobody holds (Admin only)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const removed = await this.customRolesService.remove(requireOrgId(user), id);
    await this.audit(user, AuditAction.CUSTOM_ROLE_DELETED, removed.id, removed.name, {});
  }

  private audit(
    user: AuthenticatedUser,
    action: AuditAction,
    targetId: string,
    targetLabel: string,
    metadata: Record<string, unknown>,
  ) {
    return this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action,
      targetType: 'CustomRole',
      targetId,
      targetLabel,
      metadata,
    });
  }
}
