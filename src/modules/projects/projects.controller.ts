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
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { ListTasksDto } from '../tasks/dto/list-tasks.dto';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { UpdateProjectStatusDto } from './dto/update-project-status.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { AddMembersDto } from './dto/add-members.dto';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a project' })
  async create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List projects (auto-scoped by role)' })
  async list(@Query() query: ListProjectsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.paginate(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single project' })
  async findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.findOneScoped(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update project fields' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Transition project status' })
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.updateStatus(id, dto.status, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a project (cascades to tasks/comments)' })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.projectsService.softDelete(id, user);
  }

  @Get(':id/members')
  @ApiOperation({ summary: 'List project members (paginated)' })
  async listMembers(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.listMembers(id, query, user);
  }

  @Post(':id/members')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Add members (must be active Developers, idempotent)' })
  async addMembers(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddMembersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.addMembers(id, dto.userIds, user);
  }

  @Delete(':id/members/:userId')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Remove a member (409 if they have open tasks and no reassignTo)' })
  async removeMember(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('userId', ParseObjectIdPipe) userId: string,
    @Query('reassignTo') reassignTo: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.removeMember(id, userId, reassignTo, user);
  }

  @Get(':id/tasks')
  @ApiOperation({ summary: 'List tasks for a project (pre-scoped, same filters as /tasks)' })
  async listTasks(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: ListTasksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.listTasksForProject(id, query, user);
  }

  @Get(':id/stats')
  @ApiOperation({ summary: 'Per-project task aggregation for the detail page' })
  async stats(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.projectsService.statsForProject(id, user);
  }

  @Get(':id/activity')
  @ApiOperation({ summary: 'Paginated audit trail for a project' })
  async activity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.projectsService.listActivity(id, query.page, query.limit, user);
  }
}
