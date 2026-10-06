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
import { AtRiskQueryDto, SimilarIssuesQueryDto } from './dto/ai-insights.dto';
import { ActivityFeedQueryDto } from './dto/activity-feed-query.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskAssigneeDto } from './dto/update-task-assignee.dto';
import { UpdateTaskSprintDto } from './dto/update-task-sprint.dto';
import { UpdateTaskRankDto } from './dto/update-task-rank.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { SearchTasksDto } from './dto/search-tasks.dto';
import { ExportSearchTasksDto } from './dto/export-search-tasks.dto';
import { AutocompleteValuesQueryDto } from './dto/autocomplete-values-query.dto';
import { BulkMoveSprintDto } from './dto/bulk-move-sprint.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkRelabelDto } from './dto/bulk-relabel.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { BulkFixVersionDto } from './dto/bulk-fix-version.dto';
import { BulkCustomFieldDto } from './dto/bulk-custom-field.dto';
import { BulkMoveProjectDto } from './dto/bulk-move-project.dto';
import { PreviewBulkStatusDto } from './dto/preview-bulk-status.dto';
import { MoveTaskProjectDto } from './dto/move-task-project.dto';
import { AddExternalReferenceDto } from './dto/add-external-reference.dto';

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
  // Module 11 gap-closure - declared before ':id' (same segment count).
  @Get('activity-feed')
  @ApiOperation({ summary: 'Recent activity across issues I can see (Module 11)' })
  async activityFeed(@Query() query: ActivityFeedQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.activityFeed(query, user);
  }

  // Module 10 gap-closure - both declared before ':id' (same segment count).
  @Get('similar')
  @ApiOperation({
    summary: 'Likely duplicates of the text being typed, best match first (Module 10)',
  })
  async similar(@Query() query: SimilarIssuesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.similarIssues(query, user);
  }

  @Get('at-risk')
  @ApiOperation({ summary: "A project's open issues at risk, with the reasons (Module 10)" })
  async atRisk(@Query() query: AtRiskQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.atRiskIssues(query, user);
  }

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

  @Get('search/export')
  @ApiOperation({ summary: "A JQL search's full matching set as a downloadable CSV (Module 4)" })
  async exportSearch(@Query() query: ExportSearchTasksDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.exportSearchCsv(query.jql, user);
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

  // Distinct 2-segment shape from the 1-segment "bulk-status" above - no route-ordering concern.
  @Post('bulk-status/preview')
  @ApiOperation({
    summary:
      'Dry-run a bulk status transition (Module 5 gap-closure) - which tasks would succeed/fail, without changing anything',
  })
  async previewBulkStatus(
    @Body() dto: PreviewBulkStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.previewBulkStatus(dto, user);
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

  @Patch('bulk-fix-version')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Add a Fix Version to multiple tasks at once (Module 5 gap-closure)' })
  async bulkFixVersion(@Body() dto: BulkFixVersionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkFixVersion(dto, user);
  }

  @Patch('bulk-custom-field')
  @Roles(...ORG_ROLES)
  @ApiOperation({
    summary:
      'Set one custom field to one value across multiple tasks at once (Module 5 gap-closure)',
  })
  async bulkCustomField(@Body() dto: BulkCustomFieldDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkCustomField(dto, user);
  }

  @Patch('bulk-move-project')
  @Roles(...ORG_ROLES)
  @ApiOperation({
    summary: 'Move multiple tasks to a different project at once (Module 5 gap-closure)',
  })
  async bulkMoveProject(@Body() dto: BulkMoveProjectDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.bulkMoveProject(dto, user);
  }

  // 2 literal segments plus a :logId param in the middle - a distinct shape from every bulk-*
  // route above (which are all exactly 1 literal segment), so no ordering concern.
  @Post('bulk-operations/:logId/undo')
  @Roles(...ORG_ROLES)
  @ApiOperation({
    summary: "Undo a bulk-* action's changes within its undo window (Module 5 gap-closure)",
  })
  async undoBulkOperation(
    @Param('logId', ParseObjectIdPipe) logId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.undoBulkOperation(logId, user);
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

  // Module 12's Approval Workflows - self-service like watch/vote below (no request body; the
  // acting user is always the one deciding, resolved from their own JWT).
  @Get(':id/transitions/preview')
  @ApiOperation({
    summary: 'Dry-run every next status: allowed?, why not, approvals needed, automations (M12)',
  })
  async previewTransitions(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.previewTransitions(id, user);
  }

  @Post(':id/approval/approve')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Approve a transition awaiting approval (Module 12)' })
  async approveApproval(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.approveTransition(id, user);
  }

  @Post(':id/approval/reject')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Reject a transition awaiting approval (Module 12)' })
  async rejectApproval(
    @Param('id', ParseObjectIdPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.rejectTransition(id, user);
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

  @Patch(':id/move-project')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Move a task to a different project (Module 5 gap-closure)' })
  async moveProject(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: MoveTaskProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.moveToProject(id, dto.targetProjectId, user);
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

  // Module 7 gap-closure: manually-pasted external references (e.g. a GitHub/GitLab PR/commit URL)
  // - see ExternalReference's own doc comment in task.schema.ts.
  @Post(':id/external-references')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Add an external reference link to this task (Module 7)' })
  async addExternalReference(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: AddExternalReferenceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.addExternalReference(id, dto, user);
  }

  @Delete(':id/external-references/:referenceId')
  @Roles(...ORG_ROLES)
  @ApiOperation({ summary: 'Remove an external reference link from this task (Module 7)' })
  async removeExternalReference(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('referenceId', ParseObjectIdPipe) referenceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tasksService.removeExternalReference(id, referenceId, user);
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

  @Get(':id/risk')
  @ApiOperation({ summary: "This issue's risk score and reasons (Module 10)" })
  async risk(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tasksService.taskRisk(id, user);
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
