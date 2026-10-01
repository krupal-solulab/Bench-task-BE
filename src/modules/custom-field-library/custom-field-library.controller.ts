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
import { CustomFieldLibraryService } from './custom-field-library.service';
import {
  AdoptLibraryFieldDto,
  CreateCustomFieldLibraryEntryDto,
  UpdateCustomFieldLibraryEntryDto,
} from './dto/custom-field-library.dto';

/** Module 8 gap-closure: the org-wide custom field library. Readable by every org role (a
 * project's managers adopt fields from it); only Admins edit the library itself. */
@ApiTags('custom-field-library')
@ApiBearerAuth()
@Roles(...ORG_ROLES)
@Controller()
export class CustomFieldLibraryController {
  constructor(
    private readonly libraryService: CustomFieldLibraryService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get('custom-field-library')
  @ApiOperation({ summary: "This org's custom field library, with per-field project usage" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.libraryService.list(user);
  }

  @Post('custom-field-library')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Add a field to the org-wide library (Module 8)' })
  async create(
    @Body() dto: CreateCustomFieldLibraryEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const created = await this.libraryService.create(dto, user);
    await this.record(user, AuditAction.LIBRARY_FIELD_CREATED, created.id, created.name);
    return created;
  }

  @Patch('custom-field-library/:id')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Rename / re-option a library field - pushed to every project that uses it',
  })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateCustomFieldLibraryEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.libraryService.update(id, dto, user);
    await this.record(user, AuditAction.LIBRARY_FIELD_UPDATED, updated.id, updated.name);
    return updated;
  }

  @Delete('custom-field-library/:id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a library field (blocked while any project uses it)' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const existing = await this.libraryService.findByIdOrNull(id);
    await this.libraryService.remove(id, user);
    await this.record(user, AuditAction.LIBRARY_FIELD_DELETED, id, existing?.name ?? null);
  }

  @Post('projects/:id/custom-fields/library/:entryId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Add a library field to this project's custom fields (Module 8)" })
  async adopt(
    @Param('id', ParseObjectIdPipe) projectId: string,
    @Param('entryId', ParseObjectIdPipe) entryId: string,
    @Body() dto: AdoptLibraryFieldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.libraryService.adoptIntoProject(projectId, entryId, dto, user);
  }

  private record(
    user: AuthenticatedUser,
    action: AuditAction,
    targetId: string,
    targetLabel: string | null,
  ) {
    return this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action,
      targetType: 'CustomFieldLibraryEntry',
      targetId,
      targetLabel,
    });
  }
}
