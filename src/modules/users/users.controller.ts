import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { requireOrgId } from '../../common/utils/auth-user.util';
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
  constructor(private readonly usersService: UsersService) {}

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
    return this.usersService.create(dto, requireOrgId(actingUser));
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Update name/email (Admin only)' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actingUser: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, requireOrgId(actingUser));
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Change a user role (Admin only, cannot self-demote)' })
  async updateRole(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.usersService.updateRole(id, dto.role, currentUser.id, requireOrgId(currentUser));
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Activate/deactivate a user (Admin only, cannot self-deactivate)' })
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ) {
    return this.usersService.updateStatus(
      id,
      dto.isActive,
      currentUser.id,
      requireOrgId(currentUser),
    );
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
