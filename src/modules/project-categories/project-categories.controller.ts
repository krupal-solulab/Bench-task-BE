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
import { ORG_ROLES, Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { ProjectCategoriesService } from './project-categories.service';
import { CreateProjectCategoryDto } from './dto/create-project-category.dto';
import { UpdateProjectCategoryDto } from './dto/update-project-category.dto';

/** Module 8 gap-closure: org-wide project categories. Readable by every org role (the project
 * form and list filter need them); only Admins manage the catalog. */
@ApiTags('project-categories')
@ApiBearerAuth()
@Roles(...ORG_ROLES)
@Controller('project-categories')
export class ProjectCategoriesController {
  constructor(
    private readonly projectCategoriesService: ProjectCategoriesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: "This org's project categories (Module 8)" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.projectCategoriesService.list(user);
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a project category (Module 8)' })
  async create(@Body() dto: CreateProjectCategoryDto, @CurrentUser() user: AuthenticatedUser) {
    const created = await this.projectCategoriesService.create(dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.PROJECT_CATEGORY_CREATED,
      targetType: 'ProjectCategory',
      targetId: created.id,
      targetLabel: created.name,
    });
    return created;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Rename / re-describe a project category' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectCategoryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.projectCategoriesService.update(id, dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.PROJECT_CATEGORY_UPDATED,
      targetType: 'ProjectCategory',
      targetId: updated.id,
      targetLabel: updated.name,
    });
    return updated;
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project category (blocked while any project uses it)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const existing = await this.projectCategoriesService.findByIdOrNull(id);
    await this.projectCategoriesService.remove(id, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.PROJECT_CATEGORY_DELETED,
      targetType: 'ProjectCategory',
      targetId: id,
      targetLabel: existing?.name ?? null,
    });
  }
}
