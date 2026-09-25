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
import { Role } from '../common/enums/role.enum';
import { AuthenticatedUser } from '../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../common/utils/auth-user.util';
import { AuditLogService } from '../modules/audit-log/audit-log.service';
import { AuditAction } from '../modules/audit-log/schemas/audit-log-entry.schema';
import { SecuritySchemesService } from './security-schemes.service';
import { CreateSecuritySchemeDto } from './dto/create-security-scheme.dto';
import { UpdateSecuritySchemeDto } from './dto/update-security-scheme.dto';

@ApiTags('security-schemes')
@ApiBearerAuth()
@Controller('security-schemes')
@Roles(Role.ADMIN)
export class SecuritySchemesController {
  constructor(
    private readonly securitySchemesService: SecuritySchemesService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a reusable issue security scheme (Module 6)' })
  async create(@Body() dto: CreateSecuritySchemeDto, @CurrentUser() user: AuthenticatedUser) {
    const created = await this.securitySchemesService.create(dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.SECURITY_SCHEME_CREATED,
      targetType: 'SecurityScheme',
      targetId: created.id,
      targetLabel: created.name,
    });
    return created;
  }

  @Get()
  @ApiOperation({ summary: "List this organization's security schemes" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.securitySchemesService.listMine(user);
  }

  @Patch(':id')
  @ApiOperation({ summary: "Update a security scheme's name and/or levels" })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateSecuritySchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.securitySchemesService.update(id, dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.SECURITY_SCHEME_UPDATED,
      targetType: 'SecurityScheme',
      targetId: updated.id,
      targetLabel: updated.name,
    });
    return updated;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a security scheme (must not be assigned to any project)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const existing = await this.securitySchemesService.findByIdOrNull(id);
    await this.securitySchemesService.remove(id, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.SECURITY_SCHEME_DELETED,
      targetType: 'SecurityScheme',
      targetId: id,
      targetLabel: existing?.name ?? null,
    });
  }
}
