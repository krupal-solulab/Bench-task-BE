import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CacheService } from '../../redis/cache.service';
import { dashboardCachePattern } from '../../common/utils/cache-key.util';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { IssueType, STANDARD_ISSUE_TYPES } from '../../common/enums/issue-type.enum';
import { TaskPriority } from '../../common/enums/task-priority.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { NotificationsService } from '../../notifications/notifications.service';
import { EventsGateway } from '../../events/events.gateway';
import { ProjectsService } from '../projects/projects.service';
import { ProjectDocument } from '../projects/schemas/project.schema';
import { categoryOf, resolveWorkflow } from '../projects/schemas/workflow.schema';
import { validateCustomFieldValues } from '../projects/schemas/custom-field.schema';
import {
  AutomationAction,
  AutomationActionType,
  AutomationFiredAction,
  AutomationTriggerType,
  evaluateAutomationRules,
  renderTemplate,
} from '../projects/schemas/automation-rule.schema';
import { Comment, CommentDocument } from '../comments/schemas/comment.schema';
import { SchemeAction } from '../../permission-schemes/schemas/permission-scheme.schema';
import { SprintsService } from '../sprints/sprints.service';
import { SprintStatus } from '../../common/enums/sprint-status.enum';
import { TasksRepository, RankScope } from './tasks.repository';
import { TaskDocument } from './schemas/task.schema';
import { TaskActivityAction } from './schemas/task-activity.schema';
import { isLegalTaskTransition, legalTaskTransitions } from './task-status.rules';
import { midpointRank, needsRenumber, nextAppendRank } from './utils/rank.util';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskSprintDto } from './dto/update-task-sprint.dto';
import { UpdateTaskRankDto } from './dto/update-task-rank.dto';
import { ListTasksDto } from './dto/list-tasks.dto';

/**
 * Marks a call to update/updateStatus/updateAssignee as an automation rule's own action rather
 * than a human request: the permission check is skipped (the rule's Admin/Manager author already
 * authorized this behavior when they created it), but every other guard - workflow-transition
 * legality, assignee eligibility, component/custom-field validation - still runs unchanged.
 */
interface AutomationContext {
  bypassPermission: true;
  viaRuleId: string;
  viaRuleName: string;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    private readonly sprintsService: SprintsService,
    private readonly cacheService: CacheService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsGateway: EventsGateway,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
  ) {}

  async create(dto: CreateTaskDto, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(dto.project);
    await this.projectsService.assertUserCanManageOrGranted(project, actingUser, 'canCreateTask');

    if (project.status === ProjectStatus.COMPLETED) {
      throw new ConflictException('Cannot create tasks in a Completed project');
    }

    if (dto.assignee) {
      this.assertAssigneeEligible(project, dto.assignee);
    }

    const issueType = dto.issueType ?? IssueType.TASK;
    const parent = await this.assertValidHierarchy(dto.project, issueType, dto.parent);
    this.assertValidComponents(project, dto.components);
    validateCustomFieldValues(project.customFields, dto.customFieldValues ?? {}, 'create');

    // Every new Story/Task/Bug starts in the backlog (sprint: null), appended to the end of its
    // rank order - this keeps task creation's validation surface entirely unchanged for anyone not
    // using sprints. Epics/Sub-tasks never appear in backlog ordering, so skip the extra query.
    let rank = 0;
    if (this.isStandardIssue(issueType)) {
      const backlogScope: RankScope = { project: new Types.ObjectId(dto.project), sprint: null };
      const maxRank = await this.tasksRepository.findMaxRank(backlogScope);
      rank = nextAppendRank(maxRank);
    }

    const keyPrefix = await this.projectsService.getOrAssignKey(project);
    const seq = await this.projectsService.nextIssueNumber(dto.project);

    const workflow = resolveWorkflow(project);
    const status = workflow.initialStatus;
    const statusCategory = categoryOf(workflow, status) ?? StatusCategory.TODO;

    const task = await this.tasksRepository.create({
      title: dto.title,
      description: dto.description ?? '',
      project: new Types.ObjectId(dto.project),
      assignee: dto.assignee ? new Types.ObjectId(dto.assignee) : null,
      priority: dto.priority,
      status,
      statusCategory,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      createdBy: new Types.ObjectId(actingUser.id),
      // Copied from the parent project (not actingUser) so a task's org always matches its
      // project's org, even in the platform-provisioned-admin edge case.
      organizationId: project.organizationId,
      rank,
      issueType,
      parent,
      storyPoints: dto.storyPoints ?? null,
      issueKey: `${keyPrefix}-${seq}`,
      labels: dto.labels ?? [],
      components: dto.components ?? [],
      customFieldValues: dto.customFieldValues ?? {},
    });

    await this.tasksRepository.logActivity(task.id, actingUser.id, TaskActivityAction.CREATED);
    await this.invalidateDashboardCache();

    if (dto.assignee) {
      await this.notificationsService.notifyTaskAssigned({
        taskId: task.id,
        taskTitle: task.title,
        assigneeId: dto.assignee,
        actorEmail: actingUser.email,
      });
    }

    const created = (await this.tasksRepository.findByIdActive(task.id)) as TaskDocument;
    const changedByAutomation = await this.runAutomations(
      project,
      { type: AutomationTriggerType.ISSUE_CREATED },
      created,
      actingUser,
    );
    // Re-fetch so the response reflects any fields an automation action just changed, rather than
    // the stale pre-automation snapshot already held in `created`.
    return changedByAutomation
      ? ((await this.tasksRepository.findByIdActive(task.id)) as TaskDocument)
      : created;
  }

  async paginate(query: ListTasksDto, actingUser: AuthenticatedUser) {
    const scope = await this.buildScope(actingUser);
    const { data, total } = await this.tasksRepository.paginate(query, scope);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async myTasks(query: ListTasksDto, actingUser: AuthenticatedUser) {
    const { data, total } = await this.tasksRepository.paginate(query, {
      assignee: new Types.ObjectId(actingUser.id),
      organizationId: new Types.ObjectId(requireOrgId(actingUser)),
    });
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async overdue(query: ListTasksDto, actingUser: AuthenticatedUser) {
    const scope = await this.buildScope(actingUser);
    const { data, total } = await this.tasksRepository.paginate({ ...query, overdue: true }, scope);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async findOneScoped(id: string, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    await this.assertCanView(task, actingUser);
    return task;
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    actingUser: AuthenticatedUser,
    automation?: AutomationContext,
  ): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    if (!automation?.bypassPermission) {
      await this.projectsService.assertUserCanManageOrGranted(
        project,
        actingUser,
        'canEditAnyTask',
      );
    }
    this.assertValidComponents(project, dto.components);
    validateCustomFieldValues(project.customFields, dto.customFieldValues ?? {}, 'update');

    const activities: Array<[TaskActivityAction, string | null, string | null]> = [];
    if (dto.priority && dto.priority !== task.priority) {
      activities.push([TaskActivityAction.PRIORITY_CHANGED, task.priority, dto.priority]);
    }
    if (dto.dueDate !== undefined && dto.dueDate !== task.dueDate?.toISOString()) {
      activities.push([
        TaskActivityAction.DUE_DATE_CHANGED,
        task.dueDate?.toISOString() ?? null,
        dto.dueDate ?? null,
      ]);
    }
    if ((dto.title && dto.title !== task.title) || dto.description !== undefined) {
      activities.push([TaskActivityAction.UPDATED, null, null]);
    }

    const updated = await this.tasksRepository.updateById(id, {
      ...(dto.title ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.priority ? { priority: dto.priority } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
      ...(dto.labels !== undefined ? { labels: dto.labels } : {}),
      ...(dto.components !== undefined ? { components: dto.components } : {}),
      // Merged (not replaced) - omitting a key on update keeps its previously-stored value,
      // matching UpdateTaskDto's partial-patch semantics for every other field.
      ...(dto.customFieldValues !== undefined
        ? { customFieldValues: { ...task.customFieldValues, ...dto.customFieldValues } }
        : {}),
    });

    for (const [action, from, to] of activities) {
      await this.tasksRepository.logActivity(
        id,
        actingUser.id,
        action,
        from,
        to,
        automation?.viaRuleName ?? null,
      );
    }
    await this.invalidateDashboardCache();
    return updated!;
  }

  async updateStatus(
    id: string,
    status: string,
    actingUser: AuthenticatedUser,
    automation?: AutomationContext,
  ): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));

    const isManagerOrAdmin =
      (actingUser.role === Role.ADMIN &&
        extractId(project.organizationId) === requireOrgId(actingUser)) ||
      (actingUser.role === Role.MANAGER && this.isOwner(project, actingUser.id));
    const isAssignedDeveloper =
      actingUser.role === Role.DEVELOPER &&
      !!task.assignee &&
      extractId(task.assignee) === actingUser.id;
    const hasStatusGrant = this.projectsService.memberHasCapability(
      project,
      actingUser.id,
      'canChangeAnyTaskStatus',
    );
    const hasSchemeGrant = await this.projectsService.hasSchemeGrant(
      project,
      actingUser,
      SchemeAction.TRANSITION,
    );

    if (
      !automation?.bypassPermission &&
      !isManagerOrAdmin &&
      !isAssignedDeveloper &&
      !hasStatusGrant &&
      !hasSchemeGrant
    ) {
      throw new ForbiddenException('You cannot change the status of this task');
    }

    if (task.status === status) return task;

    const workflow = resolveWorkflow(project);
    const newCategory = categoryOf(workflow, status);
    if (!newCategory) {
      throw new BadRequestException(
        `"${status}" is not a status in this project's workflow. Allowed: ${workflow.statuses.map((s) => s.name).join(', ')}`,
      );
    }

    if (!isLegalTaskTransition(workflow, task.status, status)) {
      throw new ConflictException(
        `Cannot transition from ${task.status} to ${status}. Allowed: ${legalTaskTransitions(workflow, task.status).join(', ') || 'none'}`,
      );
    }

    const previousCategory = categoryOf(workflow, task.status);
    const update: Partial<{
      status: string;
      statusCategory: StatusCategory;
      completedAt: Date | null;
    }> = { status, statusCategory: newCategory };
    if (newCategory === StatusCategory.DONE) update.completedAt = new Date();
    else if (previousCategory === StatusCategory.DONE) update.completedAt = null;

    const updated = await this.tasksRepository.updateById(id, update);
    await this.tasksRepository.logActivity(
      id,
      actingUser.id,
      TaskActivityAction.STATUS_CHANGED,
      task.status,
      status,
      automation?.viaRuleName ?? null,
    );
    await this.invalidateDashboardCache();

    try {
      this.eventsGateway.emitTaskStatusChanged({
        taskId: id,
        projectId: project.id,
        fromStatus: task.status,
        toStatus: status,
        actorId: actingUser.id,
      });
    } catch {
      // Best-effort real-time push; a delivery failure here must never fail the status update.
    }

    if (task.assignee) {
      await this.notificationsService.notifyStatusChanged({
        taskId: id,
        taskTitle: task.title,
        assigneeId: extractId(task.assignee),
        actorId: actingUser.id,
        fromStatus: task.status,
        toStatus: status,
      });
    }

    // Only a human-initiated status change fires automations - an automation's own status change
    // (automation is set) never re-evaluates rules, which is what makes chaining impossible.
    if (!automation) {
      const changedByAutomation = await this.runAutomations(
        project,
        { type: AutomationTriggerType.STATUS_CHANGED, toStatus: status },
        updated!,
        actingUser,
      );
      // Re-fetch so the response reflects any fields an automation action just changed, rather
      // than the stale pre-automation snapshot already held in `updated`.
      if (changedByAutomation) {
        return (await this.tasksRepository.findByIdActive(id)) as TaskDocument;
      }
    }

    return updated!;
  }

  async updateAssignee(
    id: string,
    assignee: string | null,
    actingUser: AuthenticatedUser,
    automation?: AutomationContext,
  ): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    if (!automation?.bypassPermission) {
      await this.projectsService.assertUserCanAssignOrGranted(project, actingUser);
    }

    if (assignee) this.assertAssigneeEligible(project, assignee);

    const previousAssignee = task.assignee ? extractId(task.assignee) : null;
    const updated = await this.tasksRepository.updateById(id, {
      assignee: assignee ? new Types.ObjectId(assignee) : null,
    });
    await this.tasksRepository.logActivity(
      id,
      actingUser.id,
      TaskActivityAction.REASSIGNED,
      previousAssignee,
      assignee,
      automation?.viaRuleName ?? null,
    );
    await this.invalidateDashboardCache();

    if (assignee && assignee !== previousAssignee) {
      await this.notificationsService.notifyTaskAssigned({
        taskId: id,
        taskTitle: task.title,
        assigneeId: assignee,
        actorEmail: actingUser.email,
      });
    }

    return updated!;
  }

  async updateSprint(
    id: string,
    dto: UpdateTaskSprintDto,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    const projectId = extractId(task.project);
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    await this.projectsService.assertUserCanManageOrGranted(
      project,
      actingUser,
      'canManageSprints',
    );

    if (!this.isStandardIssue(task.issueType)) {
      throw new BadRequestException('Only Story/Task/Bug issues can be assigned to a sprint');
    }

    const previousSprintId = task.sprint ? extractId(task.sprint) : null;
    if (dto.sprintId === previousSprintId) return task;

    if (dto.sprintId) {
      const sprint = await this.sprintsService.getActiveOrThrow(dto.sprintId, projectId);
      if (sprint.status === SprintStatus.COMPLETED) {
        throw new ConflictException('Cannot add a task to a completed sprint');
      }
    }

    const scope: RankScope = {
      project: new Types.ObjectId(projectId),
      sprint: dto.sprintId ? new Types.ObjectId(dto.sprintId) : null,
    };
    const maxRank = await this.tasksRepository.findMaxRank(scope);

    const updated = await this.tasksRepository.updateById(id, {
      sprint: dto.sprintId ? new Types.ObjectId(dto.sprintId) : null,
      rank: nextAppendRank(maxRank),
    });
    await this.tasksRepository.logActivity(
      id,
      actingUser.id,
      dto.sprintId ? TaskActivityAction.SPRINT_ASSIGNED : TaskActivityAction.SPRINT_REMOVED,
      previousSprintId,
      dto.sprintId,
    );
    await this.invalidateDashboardCache();
    return updated!;
  }

  async updateRank(
    id: string,
    dto: UpdateTaskRankDto,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    if (!dto.beforeTaskId && !dto.afterTaskId) {
      throw new BadRequestException('At least one of beforeTaskId/afterTaskId is required');
    }

    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    await this.projectsService.assertUserCanManageOrGranted(
      project,
      actingUser,
      'canManageSprints',
    );

    const scope: RankScope = {
      project: new Types.ObjectId(extractId(task.project)),
      sprint: task.sprint ? new Types.ObjectId(extractId(task.sprint)) : null,
    };

    const neighborRank = async (neighborId?: string): Promise<number | null> => {
      if (!neighborId) return null;
      const rank = await this.tasksRepository.findRankInScope(neighborId, scope);
      if (rank === null) {
        throw new BadRequestException('beforeTaskId/afterTaskId must be in the same list');
      }
      return rank;
    };

    let beforeRank = await neighborRank(dto.beforeTaskId);
    let afterRank = await neighborRank(dto.afterTaskId);

    if (needsRenumber(beforeRank, afterRank)) {
      await this.tasksRepository.renumberScope(scope);
      beforeRank = await neighborRank(dto.beforeTaskId);
      afterRank = await neighborRank(dto.afterTaskId);
    }

    const updated = await this.tasksRepository.updateById(id, {
      rank: midpointRank(beforeRank, afterRank),
    });
    return updated!;
  }

  async softDelete(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    await this.projectsService.assertUserCanManageOrGranted(project, actingUser, 'canDeleteTask');

    await this.tasksRepository.softDelete(id);
    await this.tasksRepository.logActivity(id, actingUser.id, TaskActivityAction.DELETED);
    await this.invalidateDashboardCache();
  }

  async listActivity(id: string, page: number, limit: number, actingUser: AuthenticatedUser) {
    const task = await this.getActiveOrThrow(id);
    await this.assertCanView(task, actingUser);
    const { data, total } = await this.tasksRepository.paginateActivity(id, page, limit);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async epicProgress(id: string, actingUser: AuthenticatedUser) {
    const epic = await this.getActiveOrThrow(id);
    await this.assertCanView(epic, actingUser);
    if (epic.issueType !== IssueType.EPIC) {
      throw new BadRequestException('epic-progress is only valid for an Epic issue');
    }
    const { total, done } = await this.tasksRepository.countLinkedIssues(id);
    return {
      linkedIssueCount: total,
      doneCount: done,
      progress: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }

  private isOwner(project: ProjectDocument, userId: string): boolean {
    return extractId(project.owner) === userId;
  }

  private assertAssigneeEligible(project: ProjectDocument, assignee: string): void {
    if (!this.projectsService.isProjectMember(project, assignee)) {
      throw new BadRequestException('Assignee must be the project owner or a member');
    }
  }

  /** Every given component name must already be defined in the project's component list. */
  private assertValidComponents(project: ProjectDocument, components: string[] | undefined): void {
    if (!components?.length) return;
    const unknown = components.filter((c) => !project.components.includes(c));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown component(s) for this project: ${unknown.join(', ')}`);
    }
  }

  private isStandardIssue(issueType: IssueType): boolean {
    return (STANDARD_ISSUE_TYPES as readonly IssueType[]).includes(issueType);
  }

  /**
   * Enforces the fixed 2-level hierarchy: Epic (no parent) <- Story/Task/Bug (optional Epic-link)
   * <- Sub-task (required Story/Task/Bug parent). Returns the validated parent id, or null.
   */
  private async assertValidHierarchy(
    projectId: string,
    issueType: IssueType,
    parentId: string | undefined,
  ): Promise<Types.ObjectId | null> {
    if (issueType === IssueType.EPIC) {
      if (parentId) throw new BadRequestException('An Epic cannot have a parent');
      return null;
    }

    if (!parentId) {
      if (issueType === IssueType.SUBTASK) {
        throw new BadRequestException('A Sub-task requires a parent issue');
      }
      return null;
    }

    const parentTask = await this.tasksRepository.findRawById(parentId);
    if (!parentTask || extractId(parentTask.project) !== projectId) {
      throw new BadRequestException('parent must be an existing issue in the same project');
    }

    if (issueType === IssueType.SUBTASK) {
      if (!this.isStandardIssue(parentTask.issueType)) {
        throw new BadRequestException("A Sub-task's parent must be a Story, Task, or Bug");
      }
    } else if (parentTask.issueType !== IssueType.EPIC) {
      throw new BadRequestException('parent must be an Epic for a Story/Task/Bug');
    }

    return new Types.ObjectId(parentId);
  }

  private async assertCanView(task: TaskDocument, actingUser: AuthenticatedUser): Promise<void> {
    if (
      actingUser.role === Role.ADMIN &&
      extractId(task.organizationId) === requireOrgId(actingUser)
    ) {
      return;
    }
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    if (this.projectsService.isProjectMember(project, actingUser.id)) return;
    throw new ForbiddenException('You do not have access to this task');
  }

  private async buildScope(actingUser: AuthenticatedUser) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(actingUser);
    return {
      project: { $in: projectIds.map((p) => new Types.ObjectId(p)) },
      organizationId: new Types.ObjectId(requireOrgId(actingUser)),
    };
  }

  private async getActiveOrThrow(id: string): Promise<TaskDocument> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private async invalidateDashboardCache(): Promise<void> {
    await this.cacheService.delByPattern(dashboardCachePattern());
  }

  /**
   * Evaluates this project's automation rules against a fired trigger and applies every matched
   * action. Never throws - a bad rule (evaluation failure) or a single failing action is logged
   * and skipped, so automation can never break the human-initiated change that triggered it.
   */
  /**
   * Returns whether any rule matched (regardless of whether its action(s) individually
   * succeeded) - the caller uses this to decide whether it needs to re-fetch the task before
   * returning it, since a fired action may have changed fields the caller already read.
   */
  private async runAutomations(
    project: ProjectDocument,
    trigger: { type: AutomationTriggerType; toStatus?: string },
    task: TaskDocument,
    actingUser: AuthenticatedUser,
  ): Promise<boolean> {
    if (!project.automationRules?.length) return false;

    let fired: AutomationFiredAction[];
    try {
      fired = evaluateAutomationRules(project.automationRules, trigger, {
        issueType: task.issueType,
        priority: task.priority,
        components: task.components,
      });
    } catch (err) {
      this.logger.warn(
        `Automation rule evaluation failed on task ${task.id}: ${(err as Error).message}`,
      );
      return false;
    }

    for (const { ruleId, ruleName, action } of fired) {
      try {
        await this.applyAutomationAction(task, action, actingUser, {
          bypassPermission: true,
          viaRuleId: ruleId,
          viaRuleName: ruleName,
        });
      } catch (err) {
        this.logger.warn(
          `Automation rule "${ruleName}" (${action.type}) failed on task ${task.id}: ${(err as Error).message}`,
        );
      }
    }

    return fired.length > 0;
  }

  /**
   * Applies one automation action by calling this service's own existing mutation methods
   * reentrantly (with the permission check bypassed) - every other guard those methods already
   * run (transition legality, assignee eligibility, component/custom-field validation) applies
   * exactly as it would to a human-initiated call, so automation never needs to duplicate them.
   */
  private async applyAutomationAction(
    task: TaskDocument,
    action: AutomationAction,
    actingUser: AuthenticatedUser,
    ctx: AutomationContext,
  ): Promise<void> {
    switch (action.type) {
      case AutomationActionType.SET_STATUS:
        await this.updateStatus(task.id, action.value, actingUser, ctx);
        return;
      case AutomationActionType.SET_PRIORITY:
        await this.update(task.id, { priority: action.value as TaskPriority }, actingUser, ctx);
        return;
      case AutomationActionType.SET_ASSIGNEE:
        await this.updateAssignee(task.id, action.value, actingUser, ctx);
        return;
      case AutomationActionType.ADD_LABELS: {
        const additions = action.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const labels = [...new Set([...task.labels, ...additions])];
        await this.update(task.id, { labels }, actingUser, ctx);
        return;
      }
      case AutomationActionType.ADD_COMMENT:
        await this.addAutomationComment(task, renderTemplate(action.value, task), actingUser);
        return;
    }
  }

  /**
   * Posts a comment on behalf of an automation action. Injects the Comment model directly rather
   * than CommentsService/CommentsModule - CommentsModule already imports TasksModule (for
   * TasksRepository), so importing CommentsModule back here would create a genuine two-way module
   * cycle for the sake of one small action; this mirrors ProjectsService's own existing direct
   * Comment-model injection.
   */
  private async addAutomationComment(
    task: TaskDocument,
    body: string,
    actingUser: AuthenticatedUser,
  ): Promise<void> {
    const comment = await this.commentModel.create({
      task: new Types.ObjectId(task.id),
      author: new Types.ObjectId(actingUser.id),
      body,
    });

    try {
      this.eventsGateway.emitCommentCreated({
        taskId: task.id,
        projectId: extractId(task.project),
        commentId: comment.id,
        authorId: actingUser.id,
      });
    } catch {
      // Best-effort real-time push; a delivery failure here must never fail the automation action.
    }
  }
}
