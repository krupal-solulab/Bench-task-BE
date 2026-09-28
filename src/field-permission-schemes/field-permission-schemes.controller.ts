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
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../common/pipes/parse-object-id.pipe';
import { ORG_ROLES, Role } from '../common/enums/role.enum';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../common/utils/auth-user.util';
import { AuditLogService } from '../modules/audit-log/audit-log.service';
import { AuditAction } from '../modules/audit-log/schemas/audit-log-entry.schema';
import { FieldPermissionSchemesService } from './field-permission-schemes.service';
import { CreateFieldPermissionSchemeDto } from './dto/create-field-permission-scheme.dto';
import { UpdateFieldPermissionSchemeDto } from './dto/update-field-permission-scheme.dto';

@ApiTags('field-permission-schemes')
@ApiBearerAuth()
@Roles(...ORG_ROLES)
@Controller('field-permission-schemes')
export class FieldPermissionSchemesController {
  constructor(
    private readonly fieldPermissionSchemesService: FieldPermissionSchemesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create a reusable field-level view/edit permission scheme (Module 12)',
  })
  async create(
    @Body() dto: CreateFieldPermissionSchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const created = await this.fieldPermissionSchemesService.create(dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.FIELD_PERMISSION_SCHEME_CREATED,
      targetType: 'FieldPermissionScheme',
      targetId: created.id,
      targetLabel: created.name,
    });
    return created;
  }

  @Get()
  @ApiOperation({
    summary:
      "List this organization's field permission schemes - open to any org member (not just " +
      'Admin) since TaskForm needs it to compute per-field view/edit access for every role.',
  })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.fieldPermissionSchemesService.listMine(user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: "Update a field permission scheme's name and/or rules" })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateFieldPermissionSchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.fieldPermissionSchemesService.update(id, dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.FIELD_PERMISSION_SCHEME_UPDATED,
      targetType: 'FieldPermissionScheme',
      targetId: updated.id,
      targetLabel: updated.name,
    });
    return updated;
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a field permission scheme (must not be assigned to any project)',
  })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const existing = await this.fieldPermissionSchemesService.findByIdOrNull(id);
    await this.fieldPermissionSchemesService.remove(id, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.FIELD_PERMISSION_SCHEME_DELETED,
      targetType: 'FieldPermissionScheme',
      targetId: id,
      targetLabel: existing?.name ?? null,
    });
  }
}
