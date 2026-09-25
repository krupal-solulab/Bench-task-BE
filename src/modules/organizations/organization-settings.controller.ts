import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';

/**
 * Module 8's org Settings - self-service for the org's OWN Admin (no `:id` param, always the
 * caller's own org), separate from the Platform-Admin-only rename/status routes on
 * platform-organizations.controller.ts, which are completely untouched by this feature.
 */
@ApiTags('organization-settings')
@ApiBearerAuth()
@Controller('organizations/me')
@Roles(Role.ADMIN)
export class OrganizationSettingsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: "This organization's settings (Module 8)" })
  async get(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.getSettings(requireOrgId(user));
  }

  @Patch()
  @ApiOperation({ summary: "Update this organization's settings (Module 8)" })
  async update(@Body() dto: UpdateOrganizationSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    const organizationId = requireOrgId(user);
    const updated = await this.organizationsService.updateSettings(organizationId, dto);
    await this.auditLogService.record({
      organizationId,
      actorId: user.id,
      action: AuditAction.ORGANIZATION_SETTINGS_UPDATED,
      targetType: 'Organization',
      targetId: organizationId,
      targetLabel: updated.name,
      metadata: dto as Record<string, unknown>,
    });
    return updated;
  }
}
