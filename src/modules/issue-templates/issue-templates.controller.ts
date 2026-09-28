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
  Query,
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
import { IssueTemplatesService } from './issue-templates.service';
import { CreateIssueTemplateDto } from './dto/create-issue-template.dto';
import { UpdateIssueTemplateDto } from './dto/update-issue-template.dto';

@ApiTags('issue-templates')
@ApiBearerAuth()
@Roles(...ORG_ROLES)
@Controller('issue-templates')
export class IssueTemplatesController {
  constructor(
    private readonly issueTemplatesService: IssueTemplatesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a reusable issue template (Module 12)' })
  async create(@Body() dto: CreateIssueTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    const created = await this.issueTemplatesService.create(dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.ISSUE_TEMPLATE_CREATED,
      targetType: 'IssueTemplate',
      targetId: created.id,
      targetLabel: created.name,
    });
    return created;
  }

  @Get()
  @ApiOperation({
    summary: 'List issue templates - pass projectId to include ones scoped to that project',
  })
  async list(
    @Query('projectId') projectId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.issueTemplatesService.list(user, projectId);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update an issue template' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateIssueTemplateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.issueTemplatesService.update(id, dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.ISSUE_TEMPLATE_UPDATED,
      targetType: 'IssueTemplate',
      targetId: updated.id,
      targetLabel: updated.name,
    });
    return updated;
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an issue template' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const existing = await this.issueTemplatesService.findByIdOrNull(id);
    await this.issueTemplatesService.remove(id, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.ISSUE_TEMPLATE_DELETED,
      targetType: 'IssueTemplate',
      targetId: id,
      targetLabel: existing?.name ?? null,
    });
  }
}
