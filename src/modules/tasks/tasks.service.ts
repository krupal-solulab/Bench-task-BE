import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { CacheService } from '../../redis/cache.service';
import { dashboardCachePattern } from '../../common/utils/cache-key.util';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { IssueType, IssueTypeLevel } from '../../common/enums/issue-type.enum';
import { TaskPriority } from '../../common/enums/task-priority.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { NotificationsService } from '../../notifications/notifications.service';
import { EventsGateway } from '../../events/events.gateway';
import { ProjectsService } from '../projects/projects.service';
import { ProjectDocument } from '../projects/schemas/project.schema';
import { categoryOf, resolveWorkflow } from '../projects/schemas/workflow.schema';
import {
  NotificationSchemeEvent,
  resolveNotificationSchemeRule,
} from '../projects/schemas/notification-scheme.schema';
import { isBreached, resolveSlaPolicy } from '../projects/schemas/sla-policy.schema';
import { resolveIssueTypes } from '../projects/schemas/issue-type.schema';
import {
  CustomFieldDefinition,
  CustomFieldType,
  isEmpty,
  resolveCustomFields,
  validateCustomFieldValues,
} from '../projects/schemas/custom-field.schema';
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
import { ReleasesService } from '../releases/releases.service';
import { TasksRepository, RankScope } from './tasks.repository';
import { TaskDocument } from './schemas/task.schema';
import { TaskActivityAction } from './schemas/task-activity.schema';
import {
  AutomationExecutionLog,
  AutomationExecutionLogDocument,
  AutomationExecutionOutcome,
} from './schemas/automation-execution-log.schema';
import { AUTOMATION_QUEUE } from '../automation-queue/automation-queue.constants';
import {
  AutomationJobData,
  IAutomationQueue,
} from '../automation-queue/automation-queue.interface';
import { isLegalTaskTransition, legalTaskTransitions } from './task-status.rules';
import { midpointRank, needsRenumber, nextAppendRank } from './utils/rank.util';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskSprintDto } from './dto/update-task-sprint.dto';
import { UpdateTaskRankDto } from './dto/update-task-rank.dto';
import { BulkMoveSprintDto } from './dto/bulk-move-sprint.dto';
import { BulkAssignDto } from './dto/bulk-assign.dto';
import { BulkRelabelDto } from './dto/bulk-relabel.dto';
import { BulkStatusDto } from './dto/bulk-status.dto';
import { BulkPriorityDto } from './dto/bulk-priority.dto';
import { BulkDeleteDto } from './dto/bulk-delete.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { SearchTasksDto } from './dto/search-tasks.dto';
import {
  analyzeCurrentSprintUsage,
  assertValidJqlOrderBy,
  buildJqlSort,
  compileJqlAst,
  parseJql,
  substituteCurrentSprint,
} from './search/jql.util';
import {
  JQL_DYNAMIC_VALUE_FIELDS,
  JQL_FIELD_METADATA,
  JQL_KEYWORDS,
} from './search/jql-autocomplete.util';

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

/** Per-task outcome of a bulk backlog action (BRD 6.2) - a single unauthorized/invalid id never
 * fails the whole batch, so callers can show "12 of 13 moved, 1 failed: <reason>". */
export interface BulkOperationResult {
  succeeded: string[];
  failed: Array<{ taskId: string; message: string }>;
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    private readonly sprintsService: SprintsService,
    private readonly releasesService: ReleasesService,
    private readonly cacheService: CacheService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsGateway: EventsGateway,
    @Inject(AUTOMATION_QUEUE) private readonly automationQueue: IAutomationQueue,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(AutomationExecutionLog.name)
    private readonly automationLogModel: Model<AutomationExecutionLogDocument>,
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
    const parent = await this.assertValidHierarchy(project, issueType, dto.parent);
    this.assertValidComponents(project, dto.components);
    await this.releasesService.validateIdsForProject(project.id, [
      ...(dto.fixVersions ?? []),
      ...(dto.affectsVersions ?? []),
    ]);
    const effectiveCustomFields = resolveCustomFields(project, issueType);
    validateCustomFieldValues(effectiveCustomFields, dto.customFieldValues ?? {}, 'create');
    this.assertUserPickerFieldsEligible(
      project,
      effectiveCustomFields,
      dto.customFieldValues ?? {},
    );

    // Every new Story/Task/Bug starts in the backlog (sprint: null), appended to the end of its
    // rank order - this keeps task creation's validation surface entirely unchanged for anyone not
    // using sprints. Epics/Sub-tasks never appear in backlog ordering, so skip the extra query.
    let rank = 0;
    if (this.isStandardIssue(project, issueType)) {
      const backlogScope: RankScope = { project: new Types.ObjectId(dto.project), sprint: null };
      const maxRank = await this.tasksRepository.findMaxRank(backlogScope);
      rank = nextAppendRank(maxRank);
    }

    const keyPrefix = await this.projectsService.getOrAssignKey(project);
    const seq = await this.projectsService.nextIssueNumber(dto.project);

    const workflow = resolveWorkflow(project, issueType);
    const status = workflow.initialStatus;
    const statusCategory = categoryOf(workflow, status) ?? StatusCategory.TODO;

    const task = await this.tasksRepository.create({
      title: dto.title,
      description: dto.description ?? '',
      project: new Types.ObjectId(dto.project),
      assignee: dto.assignee ? new Types.ObjectId(dto.assignee) : null,
      // A task created with no assignee starts its "became unassigned" episode immediately (BRD
      // 8's UnassignedForDuration trigger) - see updateAssignee's identical reasoning.
      assigneeClearedAt: dto.assignee ? null : new Date(),
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
      originalEstimateHours: dto.originalEstimateHours ?? null,
      issueKey: `${keyPrefix}-${seq}`,
      labels: dto.labels ?? [],
      components: dto.components ?? [],
      fixVersions: (dto.fixVersions ?? []).map((id) => new Types.ObjectId(id)),
      affectsVersions: (dto.affectsVersions ?? []).map((id) => new Types.ObjectId(id)),
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
      await this.notifyScheme(project, NotificationSchemeEvent.ASSIGNED, task.id, task.title);
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

  /**
   * JQL-lite compound search (Search/Dashboards v2) - additive alongside `paginate()`'s
   * fixed-shape `GET /tasks` filtering, which this does not touch. The parsed query is compiled
   * to a Mongo filter and ANDed with the same org/accessible-project scope every other list
   * endpoint already enforces.
   */
  async search(dto: SearchTasksDto, actingUser: AuthenticatedUser) {
    const { ast: parsedAst, orderBy } = parseJql(dto.jql);
    assertValidJqlOrderBy(orderBy);

    // `sprint = current` (BRD 7) resolves to "this project's active sprint" - meaningless without
    // pinning the query to exactly one project, so it's rejected with a clear 400 rather than
    // silently matching every project's active sprint or none at all.
    let ast = parsedAst;
    const { usesCurrentSprint, projectIds } = analyzeCurrentSprintUsage(ast);
    if (usesCurrentSprint) {
      if (projectIds.length !== 1) {
        throw new BadRequestException(
          '"sprint = current" requires the query to also filter by exactly one "project"',
        );
      }
      const activeSprint = await this.sprintsService.findActive(projectIds[0]!, actingUser);
      if (!activeSprint) {
        throw new BadRequestException('This project has no active sprint');
      }
      ast = substituteCurrentSprint(ast, activeSprint.id);
    }

    const compiled = compileJqlAst(ast, actingUser);
    const scope = await this.buildScope(actingUser);

    const filter: FilterQuery<TaskDocument> = {
      $and: [{ deletedAt: null, ...scope }, compiled],
    };
    const sort = buildJqlSort(orderBy);

    const { data, total } = await this.tasksRepository.paginateWithFilter(
      filter,
      sort,
      dto.page,
      dto.limit,
    );
    return { data, meta: buildPaginationMeta(total, dto.page, dto.limit) };
  }

  /** Static field/operator/keyword metadata for the Issue Navigator's JQL autocomplete (Module 4)
   * - a thin passthrough, kept as a service method rather than read directly from the controller
   * to match this codebase's usual controller-delegates-to-service convention. */
  jqlFieldMetadata() {
    return { fields: JQL_FIELD_METADATA, keywords: JQL_KEYWORDS };
  }

  /** Dynamic value suggestions for a JQL field - see jql-autocomplete.util.ts's own doc comment
   * for which fields this covers and why the rest are deliberately left to the frontend's
   * existing data sources (assignable users, accessible projects). */
  async autocompleteValues(field: string, actingUser: AuthenticatedUser): Promise<string[]> {
    if (!(JQL_DYNAMIC_VALUE_FIELDS as readonly string[]).includes(field)) {
      throw new BadRequestException(
        `Unsupported autocomplete field "${field}" - expected one of: ${JQL_DYNAMIC_VALUE_FIELDS.join(', ')}`,
      );
    }
    return this.tasksRepository.distinctValues(
      field as 'issueType' | 'status' | 'labels' | 'components',
      requireOrgId(actingUser),
    );
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
    await this.releasesService.validateIdsForProject(project.id, [
      ...(dto.fixVersions ?? []),
      ...(dto.affectsVersions ?? []),
    ]);
    const effectiveCustomFields = resolveCustomFields(project, task.issueType);
    validateCustomFieldValues(effectiveCustomFields, dto.customFieldValues ?? {}, 'update');
    this.assertUserPickerFieldsEligible(
      project,
      effectiveCustomFields,
      dto.customFieldValues ?? {},
    );

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
      ...(dto.fixVersions !== undefined
        ? { fixVersions: dto.fixVersions.map((id) => new Types.ObjectId(id)) }
        : {}),
      ...(dto.affectsVersions !== undefined
        ? { affectsVersions: dto.affectsVersions.map((id) => new Types.ObjectId(id)) }
        : {}),
      ...(dto.originalEstimateHours !== undefined
        ? { originalEstimateHours: dto.originalEstimateHours }
        : {}),
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

    const workflow = resolveWorkflow(project, task.issueType);
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

    // Transition Conditions/Validators - additive to the permission gate above, and only ever
    // narrow a transition further (never widen), so a transition with neither field set behaves
    // exactly as before this feature existed. Automation-driven transitions bypass both, same as
    // the permission gate above (the rule's Admin/Manager author already authorized this).
    const transitionRule = workflow.transitions.find(
      (t) => t.from === task.status && t.to === status,
    );
    if (
      !automation?.bypassPermission &&
      transitionRule?.allowedRoles?.length &&
      !transitionRule.allowedRoles.includes(actingUser.role)
    ) {
      throw new ForbiddenException(
        `Only ${transitionRule.allowedRoles.join('/')} can make this transition`,
      );
    }
    if (!automation?.bypassPermission && transitionRule?.requireComment) {
      const hasComment = await this.commentModel.exists({ task: task._id, deletedAt: null });
      if (!hasComment) {
        throw new BadRequestException('This transition requires a comment on the task first');
      }
    }
    if (!automation?.bypassPermission && transitionRule?.requiredCustomFieldIds?.length) {
      const effectiveCustomFields = resolveCustomFields(project, task.issueType);
      const byId = new Map(effectiveCustomFields.map((f) => [f.id, f]));
      const missing = transitionRule.requiredCustomFieldIds
        .map((id) => byId.get(id))
        .filter((def): def is CustomFieldDefinition => !!def)
        .filter((def) => isEmpty(task.customFieldValues?.[def.id]));
      if (missing.length > 0) {
        throw new BadRequestException(
          `This transition requires a value for: ${missing.map((d) => d.name).join(', ')}`,
        );
      }
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
    // Unconditional on assignee (unlike the hardcoded notification above) - a role subscriber to
    // the Transitioned event cares about every status change on the project, not just tasks that
    // happen to be assigned.
    await this.notifyScheme(project, NotificationSchemeEvent.TRANSITIONED, id, task.title);

    // Only a human-initiated status change fires automations - an automation's own status change
    // (automation is set) never re-evaluates rules, which is what makes chaining impossible.
    if (!automation) {
      const changedByAutomation = await this.runAutomations(
        project,
        { type: AutomationTriggerType.STATUS_CHANGED, toStatus: status, fromStatus: task.status },
        updated!,
        actingUser,
      );
      // Re-fetch so the response reflects any fields an automation action just changed, rather
      // than the stale pre-automation snapshot already held in `updated`.
      if (changedByAutomation) {
        return (await this.tasksRepository.findByIdActive(id)) as TaskDocument;
      }

      // BRD 8's cross-issue trigger: "all sub-tasks of a Story marked Done -> auto-transition the
      // parent Story." Unlike every other trigger, this one's fired actions target the PARENT
      // task, not the sub-task whose own change caused the check - see runAutomations, which
      // needs no special-casing for this since it just acts on whatever `task` it's given.
      if (newCategory === StatusCategory.DONE && task.parent) {
        const parentId = extractId(task.parent);
        const { total, done } = await this.tasksRepository.countLinkedIssues(parentId);
        if (total > 0 && total === done) {
          const parentTask = await this.tasksRepository.findByIdActive(parentId);
          if (parentTask) {
            await this.runAutomations(
              project,
              { type: AutomationTriggerType.ALL_SUBTASKS_DONE },
              parentTask,
              actingUser,
            );
          }
        }
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
    const becameUnassigned = !assignee && previousAssignee !== null;
    const updated = await this.tasksRepository.updateById(id, {
      assignee: assignee ? new Types.ObjectId(assignee) : null,
      // A fresh "became unassigned" episode starts the clock for UnassignedForDuration rules;
      // reassigning clears both, so a later unassignment starts a genuinely new episode rather
      // than immediately re-firing a rule that already fired for the previous one. Calling this
      // with assignee: null when it's already null is a no-op, not a new episode.
      ...(assignee ? { assigneeClearedAt: null, firedTimeBasedRuleIds: [] } : {}),
      ...(becameUnassigned ? { assigneeClearedAt: new Date() } : {}),
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
      await this.notifyScheme(project, NotificationSchemeEvent.ASSIGNED, id, task.title);
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

    if (!this.isStandardIssue(project, task.issueType)) {
      throw new BadRequestException('Only Story/Task/Bug issues can be assigned to a sprint');
    }

    const previousSprintId = task.sprint ? extractId(task.sprint) : null;
    if (dto.sprintId === previousSprintId) return task;

    if (dto.sprintId) {
      const sprint = await this.sprintsService.getActiveOrThrow(dto.sprintId, projectId);
      if (sprint.status === SprintStatus.COMPLETED) {
        throw new ConflictException('Cannot add a task to a completed sprint');
      }
      // BRD 6.3's "add mid-sprint" override is a client-side confirmation, not a server-side
      // block: adding a task to an already-Active sprint is (and must stay) unrestricted here -
      // this is a normal, already-relied-upon workflow (PMs add tasks to a running sprint all the
      // time). The frontend detects this case itself (the sprint's own `status` is already in its
      // hands) and shows a confirm dialog before calling this same endpoint; the scope-change
      // indicator on the Active Sprint view is driven by the `initialTaskIds` snapshot below, not
      // by this endpoint refusing the write.
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

  /**
   * Runs `perTask` once per id, collecting which ids succeeded and which failed (with a message)
   * rather than letting one bad/unauthorized id abort the whole batch - the same
   * one-failure-doesn't-block-the-rest philosophy `runAutomations` already uses. Backs all three
   * bulk backlog actions below (BRD 6.2's "move multiple issues into a sprint, bulk-assign,
   * bulk-relabel"), each of which is just this loop calling the existing single-task method, so
   * per-task permission/validation logic is never duplicated.
   */
  private async runBulk(
    taskIds: string[],
    perTask: (taskId: string) => Promise<unknown>,
  ): Promise<BulkOperationResult> {
    const succeeded: string[] = [];
    const failed: Array<{ taskId: string; message: string }> = [];
    for (const taskId of taskIds) {
      try {
        await perTask(taskId);
        succeeded.push(taskId);
      } catch (err) {
        failed.push({
          taskId,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return { succeeded, failed };
  }

  async bulkMoveSprint(
    dto: BulkMoveSprintDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, (taskId) =>
      this.updateSprint(taskId, { sprintId: dto.sprintId }, actingUser),
    );
  }

  async bulkAssign(
    dto: BulkAssignDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, (taskId) =>
      this.updateAssignee(taskId, dto.assignee, actingUser),
    );
  }

  async bulkRelabel(
    dto: BulkRelabelDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, async (taskId) => {
      const task = await this.getActiveOrThrow(taskId);
      const labels = [...new Set([...task.labels, ...dto.labels])];
      await this.update(taskId, { labels }, actingUser);
    });
  }

  /** Module 5's bulk transition - each task's workflow legality is checked independently (a
   * custom-workflow project may not even have this status), so one illegal transition among many
   * selected tasks fails only that task, matching every other bulk-* endpoint's partial-success
   * shape. */
  async bulkStatus(
    dto: BulkStatusDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, (taskId) => this.updateStatus(taskId, dto.status, actingUser));
  }

  async bulkPriority(
    dto: BulkPriorityDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, (taskId) =>
      this.update(taskId, { priority: dto.priority }, actingUser),
    );
  }

  async bulkDelete(
    dto: BulkDeleteDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, (taskId) => this.softDelete(taskId, actingUser));
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

  /**
   * A User-picker custom field's value must be a project member, the same eligibility check
   * assertAssigneeEligible already applies to the `assignee` field. Kept separate from
   * validateCustomFieldValues (which stays a pure, DB-free function) since this needs the
   * project's owner/member list.
   */
  private assertUserPickerFieldsEligible(
    project: ProjectDocument,
    definitions: CustomFieldDefinition[],
    values: Record<string, unknown>,
  ): void {
    for (const def of definitions) {
      if (def.type !== CustomFieldType.USER_PICKER) continue;
      const value = values[def.id];
      if (value === undefined || value === null || value === '') continue;
      if (typeof value !== 'string' || !this.projectsService.isProjectMember(project, value)) {
        throw new BadRequestException(`"${def.name}" must be the project owner or a member`);
      }
    }
  }

  /**
   * Fires the project's admin-configured Notification Scheme entry for `event`, if one is
   * configured (Notification Schemes v2) - additive on top of whatever hardcoded notification the
   * caller already sent. A no-op for any project that hasn't configured a scheme for this event,
   * which is every existing project by default.
   */
  private async notifyScheme(
    project: ProjectDocument,
    event: NotificationSchemeEvent,
    taskId: string,
    taskTitle: string,
  ): Promise<void> {
    const rule = resolveNotificationSchemeRule(project, event);
    if (!rule) return;

    for (const role of rule.notifyRoles) {
      const members = await this.projectsService.membersWithRole(project, role);
      for (const member of members) {
        await this.notificationsService.notifySchemeEvent({
          recipient: {
            id: member.id,
            email: member.email,
            organizationId: extractId(project.organizationId),
          },
          event,
          channels: rule.channels,
          title: `[${event}] ${taskTitle}`,
          message: `Your project's notification scheme flagged "${taskTitle}" for the ${event} event`,
          taskId,
        });
      }
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

  /** Whether `issueType` resolves to the project's Standard level - project-scoped (not a fixed
   * 3-name list) so a custom Standard-level type an Admin added counts too. */
  private isStandardIssue(project: ProjectDocument, issueType: string): boolean {
    return (
      resolveIssueTypes(project).find((t) => t.name === issueType)?.level ===
      IssueTypeLevel.STANDARD
    );
  }

  /**
   * Enforces the 3-level hierarchy - Epic (no parent) <- Standard (optional Epic-link) <- Sub-task
   * (required Standard parent) - driven by each type's resolved `level` rather than its literal
   * name, so a project's custom Standard-level types (the BRD's "extensible" level) are enforced
   * identically to the built-in Story/Task/Bug. Epic and Sub-task are still exactly one fixed name
   * each (enforced at save time by ProjectsService.updateIssueTypes), so comparing against the
   * literal `IssueType.EPIC`/`IssueType.SUBTASK` for those two levels is still safe and simpler
   * than a second level lookup. Returns the validated parent id, or null.
   */
  private async assertValidHierarchy(
    project: ProjectDocument,
    issueType: string,
    parentId: string | undefined,
  ): Promise<Types.ObjectId | null> {
    const projectId = project.id;
    const definition = resolveIssueTypes(project).find((t) => t.name === issueType);
    if (!definition) {
      throw new BadRequestException(`"${issueType}" is not an enabled issue type for this project`);
    }

    if (definition.level === IssueTypeLevel.EPIC) {
      if (parentId) throw new BadRequestException('An Epic cannot have a parent');
      return null;
    }

    if (!parentId) {
      if (definition.level === IssueTypeLevel.SUBTASK) {
        throw new BadRequestException('A Sub-task requires a parent issue');
      }
      return null;
    }

    const parentTask = await this.tasksRepository.findRawById(parentId);
    if (!parentTask || extractId(parentTask.project) !== projectId) {
      throw new BadRequestException('parent must be an existing issue in the same project');
    }

    if (definition.level === IssueTypeLevel.SUBTASK) {
      if (!this.isStandardIssue(project, parentTask.issueType)) {
        throw new BadRequestException(
          "A Sub-task's parent must be a Standard-level issue (e.g. Story, Task, or Bug)",
        );
      }
    } else if (parentTask.issueType !== IssueType.EPIC) {
      throw new BadRequestException('parent must be an Epic for a Standard-level issue');
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
    trigger: {
      type: AutomationTriggerType;
      toStatus?: string;
      fromStatus?: string;
      unassignedHours?: number;
    },
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

    // Enqueued (BRD 8: "Rules run through the existing background job queue"), not executed
    // inline - each fired action becomes its own job, preserving the same one-bad-action-never-
    // blocks-the-others isolation the previous synchronous loop had. In production this means
    // automation's effects land shortly after (not within) the response that triggered them; the
    // test-only FakeAutomationQueue executes synchronously so existing/new tests asserting
    // immediate effects are unaffected.
    for (const { ruleId, ruleName, action } of fired) {
      await this.automationQueue.enqueue({
        ruleId,
        ruleName,
        triggerType: trigger.type,
        projectId: project.id,
        taskId: task.id,
        actionType: action.type,
        actionValue: action.value,
        actingUser: {
          id: actingUser.id,
          email: actingUser.email,
          role: actingUser.role,
          organizationId: actingUser.organizationId,
        },
      });
    }

    return fired.length > 0;
  }

  /**
   * Executes exactly one fired automation action (one queue job's worth of work) and writes an
   * AutomationExecutionLog entry recording the outcome either way - the BRD's automation audit
   * trail. Called by AutomationJobProcessor's real Worker and by FakeAutomationQueue in tests.
   * Public because it's invoked from outside this service (the queue processor), unlike every
   * other automation method here.
   */
  async executeAutomationJob(data: AutomationJobData): Promise<void> {
    const actingUser: AuthenticatedUser = {
      id: data.actingUser.id,
      email: data.actingUser.email,
      role: data.actingUser.role,
      organizationId: data.actingUser.organizationId,
    };
    const ctx: AutomationContext = {
      bypassPermission: true,
      viaRuleId: data.ruleId,
      viaRuleName: data.ruleName,
    };

    let outcome = AutomationExecutionOutcome.SUCCESS;
    let errorMessage: string | null = null;
    try {
      const project = await this.projectsService.getActiveProjectOrThrow(data.projectId);
      const task = await this.getActiveOrThrow(data.taskId);
      await this.applyAutomationAction(
        project,
        task,
        { type: data.actionType as AutomationActionType, value: data.actionValue },
        actingUser,
        ctx,
      );
    } catch (err) {
      outcome = AutomationExecutionOutcome.FAILURE;
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Automation rule "${data.ruleName}" (${data.actionType}) failed on task ${data.taskId}: ${errorMessage}`,
      );
    }

    await this.automationLogModel.create({
      project: new Types.ObjectId(data.projectId),
      task: new Types.ObjectId(data.taskId),
      ruleId: data.ruleId,
      ruleName: data.ruleName,
      triggerType: data.triggerType,
      actionSummaries: [`${data.actionType}: ${data.actionValue}`],
      outcome,
      errorMessage,
    });
  }

  /** BRD 8's automation audit trail - "which rule fired, when, on which issue," queryable
   * project-wide rather than requiring a drill-into-each-task view. */
  async listAutomationLog(
    projectId: string,
    page: number,
    limit: number,
    actingUser: AuthenticatedUser,
  ) {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);

    const filter = { project: new Types.ObjectId(projectId) };
    const [data, total] = await Promise.all([
      this.automationLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('task', 'title issueKey')
        .exec(),
      this.automationLogModel.countDocuments(filter),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  /**
   * Hourly-checked time-based automation trigger (BRD 8: "issue unassigned for 24h -> escalate
   * priority + notify PM") - called by UnassignedAutomationTriggerService's `@Cron`, not by any
   * request path. For each currently-unassigned open task, evaluates its project's
   * UnassignedForDuration rules against how long it's actually been unassigned, firing (enqueuing)
   * any newly-matched rule and recording it in `firedTimeBasedRuleIds` so the same rule doesn't
   * refire every subsequent hourly run for the same "became unassigned" episode.
   */
  async checkUnassignedForDurationRules(): Promise<void> {
    const now = new Date();
    const candidates = await this.tasksRepository.findUnassignedCandidates();

    for (const task of candidates) {
      if (!task.assigneeClearedAt) continue;
      const unassignedHours = (now.getTime() - task.assigneeClearedAt.getTime()) / (60 * 60 * 1000);

      const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
      if (!project.automationRules?.length) continue;

      let fired: AutomationFiredAction[];
      try {
        fired = evaluateAutomationRules(
          project.automationRules,
          { type: AutomationTriggerType.UNASSIGNED_FOR_DURATION, unassignedHours },
          { issueType: task.issueType, priority: task.priority, components: task.components },
        );
      } catch (err) {
        this.logger.warn(
          `Automation rule evaluation failed on task ${task.id}: ${(err as Error).message}`,
        );
        continue;
      }

      const newlyFired = fired.filter((f) => !task.firedTimeBasedRuleIds.includes(f.ruleId));
      if (newlyFired.length === 0) continue;

      // A system/scheduled trigger has no human actingUser - the task's own creator stands in
      // for one (a real, valid user id keeps TaskActivity's required `actor` ref meaningful);
      // every downstream check is bypassed via ctx.bypassPermission exactly as for any other
      // automation-fired action.
      const systemActingUser: AuthenticatedUser = {
        id: extractId(task.createdBy),
        email: 'automation@internal',
        role: Role.MANAGER,
        organizationId: extractId(task.organizationId),
      };
      for (const { ruleId, ruleName, action } of newlyFired) {
        await this.automationQueue.enqueue({
          ruleId,
          ruleName,
          triggerType: AutomationTriggerType.UNASSIGNED_FOR_DURATION,
          projectId: project.id,
          taskId: task.id,
          actionType: action.type,
          actionValue: action.value,
          actingUser: systemActingUser,
        });
      }
      await this.tasksRepository.addFiredTimeBasedRuleIds(
        task.id,
        newlyFired.map((f) => f.ruleId),
      );
    }
  }

  /**
   * Hourly-checked SLA-breach notification (BRD 8's SlaBreach notification scheme event) - for
   * every open task not yet notified, resolves its project's SLA policy and fires the scheme's
   * SlaBreach entry once the task has actually breached, via the same notifyScheme path every
   * other scheme event already uses. Idempotent via `slaBreachNotifiedAt`, same shape as the
   * due-date-reminder's own flag - a task that isn't yet breached is simply left unmarked and
   * re-checked next hour.
   */
  async checkSlaBreaches(): Promise<void> {
    const now = new Date();
    const candidates = await this.tasksRepository.findOpenTasksUnnotifiedForSla();

    for (const task of candidates) {
      const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
      const policy = resolveSlaPolicy(project);
      const breached = isBreached(
        { priority: task.priority, createdAt: task.createdAt, completedAt: task.completedAt },
        policy,
        now,
      );
      if (!breached) continue;

      await this.notifyScheme(project, NotificationSchemeEvent.SLA_BREACH, task.id, task.title);
      await this.tasksRepository.markSlaBreachNotified(task.id);
    }
  }

  /**
   * Applies one automation action by calling this service's own existing mutation methods
   * reentrantly (with the permission check bypassed) - every other guard those methods already
   * run (transition legality, assignee eligibility, component/custom-field validation) applies
   * exactly as it would to a human-initiated call, so automation never needs to duplicate them.
   */
  private async applyAutomationAction(
    project: ProjectDocument,
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
      case AutomationActionType.WEBHOOK:
        // Logging stub - no webhook infrastructure exists in this codebase, and firing a real
        // request to an admin-supplied URL would be an SSRF risk with no way to validate the
        // target. Mirrors the WhatsApp notification channel's same logging-only treatment.
        this.logger.log(
          `Automation rule "${ctx.viaRuleName}" would POST to ${action.value} for task ${task.id} (webhook delivery not implemented - logging only)`,
        );
        return;
      case AutomationActionType.NOTIFY_ROLE: {
        const targets = await this.projectsService.membersWithRole(project, action.value as Role);
        for (const target of targets) {
          await this.notificationsService.notifyAutomationRole({
            recipientId: target.id,
            taskId: task.id,
            taskTitle: task.title,
            ruleName: ctx.viaRuleName,
          });
        }
        return;
      }
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
