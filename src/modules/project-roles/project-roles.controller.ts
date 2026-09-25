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
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { ProjectRolesService } from './project-roles.service';
import { CreateProjectRoleDto } from './dto/create-project-role.dto';
import { UpdateProjectRoleDto } from './dto/update-project-role.dto';

/** Definition authoring is Admin-only (mirrors PermissionSchemesController exactly) - assigning who
 * fills a role on a specific project is a separate, project-scoped concern (see
 * ProjectsController's role-assignment routes, gated by that project's own manage-permission). */
@ApiTags('project-roles')
@ApiBearerAuth()
@Controller('project-roles')
@Roles(Role.ADMIN)
export class ProjectRolesController {
  constructor(
    private readonly projectRolesService: ProjectRolesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a reusable project role for this organization (Module 6)' })
  async create(@Body() dto: CreateProjectRoleDto, @CurrentUser() user: AuthenticatedUser) {
    const created = await this.projectRolesService.create(dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.PROJECT_ROLE_CREATED,
      targetType: 'ProjectRole',
      targetId: created.id,
      targetLabel: created.name,
    });
    return created;
  }

  @Get()
  @ApiOperation({ summary: "List this organization's project roles" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.projectRolesService.listMine(user);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update a project role's name and/or description" })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.projectRolesService.update(id, dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.PROJECT_ROLE_UPDATED,
      targetType: 'ProjectRole',
      targetId: updated.id,
      targetLabel: updated.name,
    });
    return updated;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project role (must not be assigned on any project)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const existing = await this.projectRolesService.findByIdOrNull(id);
    await this.projectRolesService.remove(id, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.PROJECT_ROLE_DELETED,
      targetType: 'ProjectRole',
      targetId: id,
      targetLabel: existing?.name ?? null,
    });
  }
}
