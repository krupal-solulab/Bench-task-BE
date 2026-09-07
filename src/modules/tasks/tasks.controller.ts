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
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskAssigneeDto } from './dto/update-task-assignee.dto';
import { ListTasksDto } from './dto/list-tasks.dto';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Create a task under a project' })
  async create(@Body() dto: CreateTaskDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List tasks (auto-scoped by role)' })
  async list(@Query() query: ListTasksDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.paginate(query, user);
  }

  @Get('overdue')
  @ApiOperation({ summary: 'Paginated overdue task list (scoped by role)' })
  async overdue(@Query() query: ListTasksDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.overdue(query, user);
  }

  @Get('my-tasks')
  @ApiOperation({ summary: 'Tasks assigned to the current user' })
  async myTasks(@Query() query: ListTasksDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.myTasks(query, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single task' })
  async findOne(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.findOneScoped(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Update title/description/priority/dueDate' })
  async update(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.update(id, dto, user);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Transition task status (Developer limited to own assigned task)' })
  async updateStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.updateStatus(id, dto.status, user);
  }

  @Patch(':id/assignee')
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'Reassign a task (assignee must be owner or project member)' })
  async updateAssignee(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskAssigneeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.updateAssignee(id, dto.assignee, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a task' })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.tasksService.softDelete(id, user);
  }

  @Get(':id/activity')
  @ApiOperation({ summary: 'Paginated audit trail for a task' })
  async activity(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: PaginationQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.listActivity(id, query.page, query.limit, user);
  }
}
