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
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@ApiTags('teams')
@ApiBearerAuth()
@Controller('teams')
export class TeamsController {
  constructor(
    private readonly teamsService: TeamsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a team (Module 6: Teams, Project Roles & Security Schemes)' })
  async create(@Body() dto: CreateTeamDto, @CurrentUser() user: AuthenticatedUser) {
    const created = await this.teamsService.create(dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.TEAM_CREATED,
      targetType: 'Team',
      targetId: created.id,
      targetLabel: created.name,
    });
    return created;
  }

  @Get()
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: "List this organization's teams" })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.listMine(user);
  }

  @Get(':id')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Get a single team' })
  async get(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.teamsService.getOwnedOrThrow(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: "Update a team's name, description, lead, and/or members" })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.teamsService.update(id, dto, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.TEAM_UPDATED,
      targetType: 'Team',
      targetId: updated.id,
      targetLabel: updated.name,
    });
    return updated;
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a team' })
  async remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const existing = await this.teamsService.getOwnedOrThrow(id, user);
    await this.teamsService.remove(id, user);
    await this.auditLogService.record({
      organizationId: requireOrgId(user),
      actorId: user.id,
      action: AuditAction.TEAM_DELETED,
      targetType: 'Team',
      targetId: id,
      targetLabel: existing.name,
    });
  }
}
