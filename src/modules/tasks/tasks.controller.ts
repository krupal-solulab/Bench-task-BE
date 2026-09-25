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
import { ORG_ROLES } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskAssigneeDto } from './dto/update-task-assignee.dto';
import { UpdateTaskSprintDto } from './dto/update-task-sprint.dto';
import { UpdateTaskRankDto } from './dto/update-task-rank.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { SearchTasksDto } from './dto/search-tasks.dto';
import { AutocompleteValuesQueryDto } from './dto/autocomplete-values-query.dto';
import { BulkMoveSprintDto } from './dto/bulk-move-sprint.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkRelabelDto } from './dto/bulk-relabel.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';

@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @Roles(...ORG_ROLES)
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

  // Registered before GET :id - a literal path segment ("search") must precede a :id sibling or
  // Express/Nest would swallow it as the route param (same gotcha fixed for sprints' /velocity).
  @Get('search')
  @ApiOperation({ summary: 'JQL-lite compound search (Search/Dashboards v2)' })
  async search(@Query() query: SearchTasksDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.search(query, user);
  }

  // 3 literal segments - can never collide with GET :id or GET search regardless of registration
  // order (different segment count/shape), so no ordering comment is needed here.
  @Get('search/autocomplete-fields')
  @ApiOperation({ summary: "The Issue Navigator's JQL field/operator/keyword metadata" })
  autocompleteFields() {
    return this.tasksService.jqlFieldMetadata();
  }

  @Get('search/autocomplete-values')
  @ApiOperation({ summary: 'Distinct, currently-in-use values for a JQL field (Module 4)' })
  async autocompleteValues(
    @Query() query: AutocompleteValuesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.autocompleteValues(query.field, user);
  }

  // Registered before PATCH :id/GET :id - literal path segments must precede a :id sibling at the
  // same depth or Express/Nest would swallow them as the route param (same gotcha as /search above).
  @Patch('bulk-move-sprint')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Move multiple tasks into a sprint, or back to the backlog (BRD 6.2)' })
  async bulkMoveSprint(@Body() dto: BulkMoveSprintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkMoveSprint(dto, user);
  }

  @Patch('bulk-assign')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Reassign multiple tasks at once (BRD 6.2)' })
  async bulkAssign(@Body() dto: BulkAssignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkAssign(dto, user);
  }

  @Patch('bulk-relabel')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Add labels to multiple tasks at once (BRD 6.2)' })
  async bulkRelabel(@Body() dto: BulkRelabelDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkRelabel(dto, user);
  }

  @Patch('bulk-status')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Transition multiple tasks to the same status at once (Module 5)' })
  async bulkStatus(@Body() dto: BulkStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkStatus(dto, user);
  }

  @Patch('bulk-priority')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Set the priority of multiple tasks at once (Module 5)' })
  async bulkPriority(@Body() dto: BulkPriorityDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkPriority(dto, user);
  }

  @Patch('bulk-delete')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Soft-delete multiple tasks at once (Module 5)' })
  async bulkDelete(@Body() dto: BulkDeleteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkDelete(dto, user);
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
  @Roles(...ORG_ROLES)
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
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Reassign a task (assignee must be owner or project member)' })
  async updateAssignee(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskAssigneeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.updateAssignee(id, dto.assignee, user);
  }

  @Patch(':id/sprint')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Move a task into a sprint, or back to the backlog (sprintId: null)' })
  async updateSprint(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskSprintDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.updateSprint(id, dto, user);
  }

  @Patch(':id/rank')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Reorder a task within its current backlog/sprint list' })
  async updateRank(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskRankDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.updateRank(id, dto, user);
  }

  @Delete(':id')
  @Roles(...ORG_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a task' })
  async remove(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.tasksService.softDelete(id, user);
  }

  // Module 7: Watchers/Voting - self-service only, so there's no request body; the acting user is
  // always the one being added/removed.
  @Post(':id/watch')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Start watching this task (Module 7)' })
  async watch(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.addWatcher(id, user);
  }

  @Delete(':id/watch')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Stop watching this task (Module 7)' })
  async unwatch(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.removeWatcher(id, user);
  }

  @Post(':id/vote')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Vote for this task (Module 7)' })
  async vote(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.addVoter(id, user);
  }

  @Delete(':id/vote')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Remove your vote from this task (Module 7)' })
  async unvote(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.removeVoter(id, user);
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

  @Get(':id/epic-progress')
  @ApiOperation({ summary: "An Epic's linked-issue count and completion percentage" })
  async epicProgress(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.epicProgress(id, user);
  }

  @Get(':id/epic-burndown')
  @ApiOperation({ summary: "An Epic's remaining linked-issue work over time" })
  async epicBurndown(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.epicBurndown(id, user);
  }

  @Get(':id/summary')
  @ApiOperation({
    summary: 'A deterministic, field-based summary of this issue (not AI-generated)',
  })
  async summary(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.summary(id, user);
  }
}
