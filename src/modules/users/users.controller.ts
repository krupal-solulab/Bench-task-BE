import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuditAction } from '../audit-log/schemas/audit-log-entry.schema';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { ListUsersDto } from './dto/list-users.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'List users (Admin only)' })
  async list(@Query() query: ListUsersDto, @CurrentUser() actingUser: AuthenticatedUser) {
    return this.usersService.paginate(query, requireOrgId(actingUser));
  }

  @Get('assignable')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List active developers for assignee pickers' })
  async assignable(@CurrentUser() actingUser: AuthenticatedUser) {
    const data = await this.usersService.assignable(requireOrgId(actingUser));
    return {
      data,
      meta: {
        total: data.length,
        page: 1,
        limit: data.length || 1,
        totalPages: 1,
        hasNextPage: false,
        hasPrevPage: false,
      },
    };
  }

  @Get(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get a single user (Admin only)' })
  async findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() actingUser: AuthenticatedUser,
  ) {
    return this.usersService.findByIdInOrgOrThrow(id, requireOrgId(actingUser));
  }

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a user with an explicit role (Admin only)' })
  async create(@Body() dto: CreateUserDto, @CurrentUser() actingUser: AuthenticatedUser) {
    const organizationId = requireOrgId(actingUser);
    const created = await this.usersService.create(dto, organizationId);
    await this.auditLogService.record({
      organizationId,
      actorId: actingUser.id,
      action: AuditAction.USER_CREATED,
      targetType: 'User',
      targetId: created.id,
      targetLabel: created.name,
      metadata: { role: created.role },
    });
    return created;
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update name/email (Admin only)' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actingUser: AuthenticatedUser,
  ) {
    const organizationId = requireOrgId(actingUser);
    const updated = await this.usersService.update(id, dto, organizationId);
    await this.auditLogService.record({
      organizationId,
      actorId: actingUser.id,
      action: AuditAction.USER_UPDATED,
      targetType: 'User',
      targetId: updated.id,
      targetLabel: updated.name,
    });
    return updated;
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Change a user role (Admin only, cannot self-demote)' })
  async updateRole(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const organizationId = requireOrgId(currentUser);
    const previousRole = (await this.usersService.findByIdInOrgOrThrow(id, organizationId)).role;
    const updated = await this.usersService.updateRole(
      id,
      dto.role,
      currentUser.id,
      organizationId,
    );
    await this.auditLogService.record({
      organizationId,
      actorId: currentUser.id,
      action: AuditAction.USER_ROLE_CHANGED,
      targetType: 'User',
      targetId: updated.id,
      targetLabel: updated.name,
      metadata: { from: previousRole, to: dto.role },
    });
    return updated;
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Activate/deactivate a user (Admin only, cannot self-deactivate)' })
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    const organizationId = requireOrgId(currentUser);
    const updated = await this.usersService.updateStatus(
      id,
      dto.isActive,
      currentUser.id,
      organizationId,
    );
    await this.auditLogService.record({
      organizationId,
      actorId: currentUser.id,
      action: AuditAction.USER_STATUS_CHANGED,
      targetType: 'User',
      targetId: updated.id,
      targetLabel: updated.name,
      metadata: { isActive: dto.isActive },
    });
    return updated;
  }

  @Get(':id/workload')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Task counts by status for one user' })
  async workload(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() actingUser: AuthenticatedUser,
  ) {
    return this.usersService.getWorkload(id, requireOrgId(actingUser));
  }
}
