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
import { categoryOf, resolveWorkflow, Workflow } from '../projects/schemas/workflow.schema';
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
import { IssueLink, IssueLinkDocument } from '../planning/schemas/issue-link.schema';
import { SchemeAction } from '../../permission-schemes/schemas/permission-scheme.schema';
import { SecuritySchemesService } from '../../security-schemes/security-schemes.service';
import { viewableLevelNames } from '../../security-schemes/schemas/security-scheme.schema';
import { FieldPermissionSchemesService } from '../../field-permission-schemes/field-permission-schemes.service';
import {
  BUILT_IN_TASK_FIELD_IDS,
  canEditField,
  canViewField,
} from '../../field-permission-schemes/schemas/field-permission-scheme.schema';
import { granteeMatchesGrant } from '../../common/utils/grant-matching.util';
import { SprintsService } from '../sprints/sprints.service';
import { SprintStatus } from '../../common/enums/sprint-status.enum';
import { ReleasesService } from '../releases/releases.service';
import { TasksRepository, RankScope } from './tasks.repository';
import { BulkOperationLogsRepository } from './bulk-operation-logs.repository';
import { PendingApproval, TaskDocument } from './schemas/task.schema';
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
import { BulkFixVersionDto } from './dto/bulk-fix-version.dto';
import { BulkCustomFieldDto } from './dto/bulk-custom-field.dto';
import { BulkMoveProjectDto } from './dto/bulk-move-project.dto';
import { PreviewBulkStatusDto } from './dto/preview-bulk-status.dto';
import { ListTasksDto } from './dto/list-tasks.dto';
import { SearchTasksDto } from './dto/search-tasks.dto';
import { buildCsv } from '../import-export/csv.util';
import type { CsvExportResult } from '../import-export/import-export.service';
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
import { computeBurndown } from '../sprints/sprint-reports.util';
import { buildTaskSummary } from './task-summary.util';
import { Organization, OrganizationDocument } from '../organizations/schemas/organization.schema';
import { resolveLinkTypes } from '../planning/schemas/link-type.schema';
import { SIMILARITY_THRESHOLD, similarityScore, tokenize } from './similarity.util';
import { assessTaskRisk, TaskRisk } from './task-risk.util';
import { AtRiskQueryDto, SimilarIssuesQueryDto } from './dto/ai-insights.dto';

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
/** Module 5 gap-closure: how long a bulk-* action's changes stay undoable. Short and fixed
 * deliberately - this is an "oops, wrong value" safety net, not a general-purpose revert window. */
const UNDO_WINDOW_MS = 5 * 60 * 1000;

export interface BulkOperationResult {
  succeeded: string[];
  failed: Array<{ taskId: string; message: string }>;
  /** Module 5 gap-closure: the id of the BulkOperationLog capturing this call's successful
   * changes, passable to undoBulkOperation() within the undo window - null when nothing succeeded
   * (nothing to undo). */
  undoToken: string | null;
}

export interface BulkStatusPreviewEntry {
  taskId: string;
  willSucceed: boolean;
  reason: string | null;
}

export interface BulkStatusPreviewResult {
  entries: BulkStatusPreviewEntry[];
  willSucceedCount: number;
  willFailCount: number;
}

/** Module 10 gap-closure: bounds for the deterministic AI-insight endpoints. */
const SIMILARITY_CANDIDATE_LIMIT = 1000;
const SIMILAR_RESULT_LIMIT = 5;
const RISK_SCAN_LIMIT = 2000;
const AT_RISK_RESULT_LIMIT = 50;

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly bulkOperationLogsRepository: BulkOperationLogsRepository,
    private readonly projectsService: ProjectsService,
    private readonly securitySchemesService: SecuritySchemesService,
    private readonly fieldPermissionSchemesService: FieldPermissionSchemesService,
    private readonly sprintsService: SprintsService,
    private readonly releasesService: ReleasesService,
    private readonly cacheService: CacheService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsGateway: EventsGateway,
    @Inject(AUTOMATION_QUEUE) private readonly automationQueue: IAutomationQueue,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(IssueLink.name) private readonly issueLinkModel: Model<IssueLinkDocument>,
    @InjectModel(AutomationExecutionLog.name)
    private readonly automationLogModel: Model<AutomationExecutionLogDocument>,
    @InjectModel(Organization.name) private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  async create(dto: CreateTaskDto, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const project = await this.projectsService.getWritableProjectOrThrow(dto.project);
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
    await this.assertValidSecurityLevel(project, dto.securityLevel);
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

    // Module 7's Watchers: the reporter is always auto-watching their own issue, plus the
    // assignee if one is set at creation time (deduped - the creator may be assigning it to
    // themselves) - see updateAssignee() for the equivalent auto-watch on a later reassignment.
    const initialWatcherIds = [
      ...new Set([actingUser.id, ...(dto.assignee ? [dto.assignee] : [])]),
    ];

    const task = await this.tasksRepository.create({
      title: dto.title,
      description: dto.description ?? '',
      project: new Types.ObjectId(dto.project),
      assignee: dto.assignee ? new Types.ObjectId(dto.assignee) : null,
      // A task created with no assignee starts its "became unassigned" episode immediately (BRD
      // 8's UnassignedForDuration trigger) - see updateAssignee's identical reasoning.
      assigneeClearedAt: dto.assignee ? null : new Date(),
      watcherIds: initialWatcherIds.map((id) => new Types.ObjectId(id)),
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
      securityLevel: dto.securityLevel ?? null,
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
      ...(await this.buildSecurityExclusionFilter(actingUser)),
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
  /** Shared by `search()` and `exportSearchCsv()` - parses+compiles a JQL string into a Mongo
   * filter/sort pair, scoped to what the acting user may see. Kept private since both callers
   * need the exact same currentSprint/scope handling and neither should be able to drift. */
  private async buildJqlSearchFilter(
    jql: string,
    actingUser: AuthenticatedUser,
  ): Promise<{ filter: FilterQuery<TaskDocument>; sort: Record<string, 1 | -1> }> {
    const { ast: parsedAst, orderBy } = parseJql(jql);
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

    return {
      filter: { $and: [{ deletedAt: null, ...scope }, compiled] },
      sort: buildJqlSort(orderBy),
    };
  }

  async search(dto: SearchTasksDto, actingUser: AuthenticatedUser) {
    const { filter, sort } = await this.buildJqlSearchFilter(dto.jql, actingUser);
    const { data, total } = await this.tasksRepository.paginateWithFilter(
      filter,
      sort,
      dto.page,
      dto.limit,
    );
    return { data, meta: buildPaginationMeta(total, dto.page, dto.limit) };
  }

  /** Module 4 gap-closure: exports a JQL search's FULL matching set (not just the current page) as
   * CSV - reuses Module 5's `buildCsv()` and `{filename, csv}` shape exactly, the same pattern
   * WorkLogsService's own CSV export (Module 3 gap-closure) already established. Cross-project by
   * design, since a JQL search itself is never project-scoped. */
  async exportSearchCsv(jql: string, actingUser: AuthenticatedUser): Promise<CsvExportResult> {
    const { filter, sort } = await this.buildJqlSearchFilter(jql, actingUser);
    const tasks = await this.tasksRepository.findAllWithFilter(filter, sort);

    const rows: string[][] = [
      ['issueKey', 'title', 'issueType', 'status', 'priority', 'project', 'assignee', 'dueDate'],
      ...tasks.map((t) => {
        const assignee = t.assignee as unknown as { name?: string } | null;
        const project = t.project as unknown as { name?: string } | null;
        return [
          t.issueKey ?? '',
          t.title,
          t.issueType,
          t.status,
          t.priority,
          project?.name ?? '',
          assignee?.name ?? '',
          t.dueDate ? t.dueDate.toISOString().slice(0, 10) : '',
        ];
      }),
    ];

    const datePart = new Date().toISOString().slice(0, 10);
    return { filename: `jql-search-${datePart}.csv`, csv: buildCsv(rows) };
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

  async findOneScoped(
    id: string,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument | Record<string, unknown>> {
    const task = await this.getActiveOrThrow(id);
    await this.assertCanView(task, actingUser);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    return this.redactHiddenFields(task, project, actingUser);
  }

  /**
   * Module 12's Field-Level Permissions - VIEW side. Deliberately scoped to this single-task read
   * only, not every list/search endpoint too: those return full documents to many different
   * consumers (dashboards, JQL search, board views, bulk exports), and redacting per-field across
   * every one of them risks real regressions disproportionate to the value - a documented scope
   * decision, not a silent gap. EDIT enforcement (see assertFieldsEditable, called from update())
   * has no such gap: it's the single choke point every field write already goes through.
   */
  private async redactHiddenFields(
    task: TaskDocument,
    project: ProjectDocument,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument | Record<string, unknown>> {
    if (!project.fieldPermissionSchemeId) return task;
    const scheme = await this.fieldPermissionSchemesService.findByIdOrNull(
      extractId(project.fieldPermissionSchemeId),
    );
    if (!scheme) return task;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plain = task.toJSON() as Record<string, any>;
    for (const rule of scheme.rules) {
      if (canViewField(scheme, rule.fieldId, actingUser.role)) continue;
      if ((BUILT_IN_TASK_FIELD_IDS as readonly string[]).includes(rule.fieldId)) {
        plain[rule.fieldId] = null;
      } else if (plain.customFieldValues && typeof plain.customFieldValues === 'object') {
        delete plain.customFieldValues[rule.fieldId];
      }
    }
    return plain;
  }

  /**
   * Module 7's Watchers/Voting - self-service only (a user can only watch/vote for themselves,
   * never add/remove anyone else), gated by the same view access as reading the task at all -
   * you can't watch or vote for an issue you can't see. `$addToSet`/`$pull` make every one of
   * these idempotent, so calling watch twice, or unwatch when not watching, is a safe no-op.
   */
  async addWatcher(id: string, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(id);
    await this.assertCanView(task, actingUser);
    return (await this.tasksRepository.addWatcher(id, actingUser.id))!;
  }

  async removeWatcher(id: string, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(id);
    await this.assertCanView(task, actingUser);
    return (await this.tasksRepository.removeWatcher(id, actingUser.id))!;
  }

  async addVoter(id: string, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(id);
    await this.assertCanView(task, actingUser);
    return (await this.tasksRepository.addVoter(id, actingUser.id))!;
  }

  async removeVoter(id: string, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(id);
    await this.assertCanView(task, actingUser);
    return (await this.tasksRepository.removeVoter(id, actingUser.id))!;
  }

  /**
   * Module 7 gap-closure: manually-pasted external references (see ExternalReference's own doc
   * comment in task.schema.ts). Adding is gated the same as watch/vote (anyone who can view the
   * task); removing is restricted to whoever added the entry, or a same-org Admin - the same split
   * CommentsService.assertCanModify uses, since this is closer to "delete someone's comment" than
   * to the always-self-service watch/vote toggle above.
   */
  async addExternalReference(
    id: string,
    dto: { label: string; url: string },
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(id);
    await this.assertCanView(task, actingUser);
    return (await this.tasksRepository.addExternalReference(id, {
      label: dto.label,
      url: dto.url,
      addedBy: new Types.ObjectId(actingUser.id),
      addedAt: new Date(),
    }))!;
  }

  async removeExternalReference(
    id: string,
    referenceId: string,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(id);
    await this.assertCanView(task, actingUser);
    const reference = task.externalReferences.find((r) => extractId(r) === referenceId);
    if (!reference) {
      throw new NotFoundException('External reference not found');
    }
    const isSameOrgAdmin =
      actingUser.role === Role.ADMIN && extractId(task.organizationId) === requireOrgId(actingUser);
    if (extractId(reference.addedBy) !== actingUser.id && !isSameOrgAdmin) {
      throw new ForbiddenException('You can only remove external references you added');
    }
    return (await this.tasksRepository.removeExternalReference(id, referenceId))!;
  }

  async update(
    id: string,
    dto: UpdateTaskDto,
    actingUser: AuthenticatedUser,
    automation?: AutomationContext,
  ): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    if (!automation?.bypassPermission) {
      await this.projectsService.assertUserCanManageOrGranted(
        project,
        actingUser,
        'canEditAnyTask',
      );
    }
    await this.assertFieldsEditable(project, actingUser, dto, automation);
    this.assertValidComponents(project, dto.components);
    await this.assertValidSecurityLevel(project, dto.securityLevel);
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
      ...(dto.securityLevel !== undefined ? { securityLevel: dto.securityLevel } : {}),
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
    const task = await this.getWritableOrThrow(id);
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

    // Module 12's Approval Workflows - a task with a transition already awaiting a decision is
    // frozen from any OTHER status change (including automation-driven ones) until that decision
    // is made, so a stale approval can never be granted against a status the task has since moved
    // away from. Approve/reject go through their own dedicated methods, not this one.
    if (task.pendingApproval) {
      throw new ConflictException(
        `This task has a transition to "${task.pendingApproval.toStatus}" pending approval - approve or reject it first`,
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

    if (!automation?.bypassPermission && transitionRule?.requiresApproval) {
      const pendingApproval = {
        toStatus: status,
        requestedBy: new Types.ObjectId(actingUser.id),
        requestedAt: new Date(),
        approverRoles: transitionRule.approverRoles ?? [],
        approverUserIds: transitionRule.approverUserIds ?? [],
        approverTeamIds: transitionRule.approverTeamIds ?? [],
        approverProjectRoleIds: transitionRule.approverProjectRoleIds ?? [],
      };
      const updated = await this.tasksRepository.updateById(id, { pendingApproval });
      await this.tasksRepository.logActivity(
        id,
        actingUser.id,
        TaskActivityAction.APPROVAL_REQUESTED,
        task.status,
        status,
        null,
      );
      await this.invalidateDashboardCache();
      // Notification fan-out is deliberately scoped to explicit approverUserIds plus the project
      // members already resolvable via ProjectsService.membersWithRole (the same helper
      // notifyScheme already uses) - it does NOT resolve approverTeamIds/approverProjectRoleIds
      // into concrete recipients. This narrows only who gets PINGED, never who's actually eligible
      // to decide: approveTransition/rejectTransition below check all 4 grantee kinds via
      // granteeMatchesGrant regardless of who was notified.
      const roleRecipients = (
        await Promise.all(
          pendingApproval.approverRoles.map((role) =>
            this.projectsService.membersWithRole(project, role),
          ),
        )
      ).flat();
      const approverIds = [
        ...new Set([
          ...roleRecipients.map((u) => u.id),
          ...pendingApproval.approverUserIds.map(extractId),
        ]),
      ];
      await this.notificationsService.notifyApprovalRequested({
        taskId: id,
        taskTitle: task.title,
        toStatus: status,
        approverIds,
      });
      return updated!;
    }

    return this.applyStatusChange(
      id,
      project,
      task,
      status,
      workflow,
      newCategory,
      actingUser,
      TaskActivityAction.STATUS_CHANGED,
      automation,
    );
  }

  /** Module 12's Approval Workflows - the approve half of a `requiresApproval` transition. Shares
   * every side effect (websocket push, notifications, automations) with an ordinary immediate
   * status change via applyStatusChange, so an approved transition behaves identically to one
   * that never needed approval in the first place, once it actually applies. */
  async approveTransition(id: string, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const { task, project } = await this.getPendingApprovalOrThrow(id, actingUser);
    const pendingApproval = task.pendingApproval!;
    const workflow = resolveWorkflow(project, task.issueType);
    const newCategory = categoryOf(workflow, pendingApproval.toStatus)!;

    const updated = await this.applyStatusChange(
      id,
      project,
      task,
      pendingApproval.toStatus,
      workflow,
      newCategory,
      actingUser,
      TaskActivityAction.APPROVAL_GRANTED,
    );
    await this.notificationsService.notifyApprovalDecided({
      taskId: id,
      taskTitle: task.title,
      requesterId: extractId(pendingApproval.requestedBy),
      toStatus: pendingApproval.toStatus,
      approved: true,
    });
    return updated;
  }

  /** The other half - clears the pending request without ever changing the task's status. */
  async rejectTransition(id: string, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const { task, pendingApproval } = await this.getPendingApprovalOrThrow(id, actingUser);
    const updated = await this.tasksRepository.updateById(id, { pendingApproval: null });
    await this.tasksRepository.logActivity(
      id,
      actingUser.id,
      TaskActivityAction.APPROVAL_REJECTED,
      task.status,
      pendingApproval.toStatus,
      null,
    );
    await this.notificationsService.notifyApprovalDecided({
      taskId: id,
      taskTitle: task.title,
      requesterId: extractId(pendingApproval.requestedBy),
      toStatus: pendingApproval.toStatus,
      approved: false,
    });
    return updated!;
  }

  /** Shared eligibility gate for approve/reject: the task must actually have a pending request,
   * the acting user must match one of its 4 snapshotted grantee kinds (via the same
   * granteeMatchesGrant every other scheme in this codebase uses), and the requester may never
   * decide their own request - approval only means something when a second person confirms it. */
  private async getPendingApprovalOrThrow(
    id: string,
    actingUser: AuthenticatedUser,
  ): Promise<{ task: TaskDocument; project: ProjectDocument; pendingApproval: PendingApproval }> {
    const task = await this.getWritableOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    const pendingApproval = task.pendingApproval;
    if (!pendingApproval) {
      throw new BadRequestException('This task has no transition pending approval');
    }
    if (extractId(pendingApproval.requestedBy) === actingUser.id) {
      throw new ForbiddenException('You cannot decide your own approval request');
    }
    const ctx = await this.projectsService.resolveGranteeContext(project, actingUser);
    const isEligible = granteeMatchesGrant(
      {
        allowedRoles: pendingApproval.approverRoles,
        allowedUserIds: pendingApproval.approverUserIds,
        allowedTeamIds: pendingApproval.approverTeamIds,
        allowedProjectRoleIds: pendingApproval.approverProjectRoleIds,
      },
      ctx,
    );
    // Module 6 gap-closure: the project's default-approver pool (if configured) can ALSO decide
    // any approval-gated transition, on top of whoever the transition's own snapshot names - see
    // DefaultApprovers' doc comment on project.schema.ts for why this is additive, never a
    // replacement for the transition's own (already-mandatory) approver configuration.
    const isEligibleViaDefault =
      !isEligible && project.defaultApprovers && granteeMatchesGrant(project.defaultApprovers, ctx);
    if (!isEligible && !isEligibleViaDefault) {
      throw new ForbiddenException('You are not an eligible approver for this transition');
    }
    return { task, project, pendingApproval };
  }

  /**
   * The side effects of an applied status change - persisting the new status/category, logging
   * activity (under whichever `logAction` the caller wants: STATUS_CHANGED for an immediate
   * change, APPROVAL_GRANTED for one that just cleared approval), the websocket push, the
   * hardcoded assignee/watcher notifications, the project's Notification Scheme, and automations.
   * Extracted from updateStatus() so approveTransition() gets byte-identical behavior once a
   * transition actually applies, rather than a second, driftable copy of ~80 lines.
   */
  private async applyStatusChange(
    id: string,
    project: ProjectDocument,
    task: TaskDocument,
    status: string,
    workflow: Workflow,
    newCategory: StatusCategory,
    actingUser: AuthenticatedUser,
    logAction: TaskActivityAction,
    automation?: AutomationContext,
  ): Promise<TaskDocument> {
    const previousCategory = categoryOf(workflow, task.status);
    const update: Partial<{
      status: string;
      statusCategory: StatusCategory;
      completedAt: Date | null;
      pendingApproval: null;
    }> = { status, statusCategory: newCategory, pendingApproval: null };
    if (newCategory === StatusCategory.DONE) update.completedAt = new Date();
    else if (previousCategory === StatusCategory.DONE) update.completedAt = null;

    const updated = await this.tasksRepository.updateById(id, update);
    await this.tasksRepository.logActivity(
      id,
      actingUser.id,
      logAction,
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
    // Module 7: broaden to every other watcher (the assignee, if also watching, already got the
    // dedicated notification above).
    await this.notificationsService.notifyWatchers({
      taskId: id,
      taskTitle: task.title,
      watcherIds: task.watcherIds.map(extractId),
      excludeUserIds: [actingUser.id, ...(task.assignee ? [extractId(task.assignee)] : [])],
      message: `"${task.title}" moved from ${task.status} to ${status}`,
    });
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
    const task = await this.getWritableOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    if (!automation?.bypassPermission) {
      await this.projectsService.assertUserCanAssignOrGranted(project, actingUser);
    }

    if (assignee) this.assertAssigneeEligible(project, assignee);

    const previousAssignee = task.assignee ? extractId(task.assignee) : null;
    const becameUnassigned = !assignee && previousAssignee !== null;
    let updated = await this.tasksRepository.updateById(id, {
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
      // Module 7: a newly-assigned user auto-watches their own issue (never auto-removed).
      updated = await this.tasksRepository.addWatcher(id, assignee);
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
    const task = await this.getWritableOrThrow(id);
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
   * one-failure-doesn't-block-the-rest philosophy `runAutomations` already uses. Backs every bulk-*
   * action below, each of which is just this loop calling the existing single-task method, so
   * per-task permission/validation logic is never duplicated.
   *
   * Module 5 gap-closure (undo window): `perTask` also returns the field it changed and that
   * field's value BEFORE the change, for every task it succeeds on. Once the whole batch finishes,
   * those captures are written as one BulkOperationLog, whose id comes back as `undoToken` -
   * `undoBulkOperation()` replays them in reverse within a short time window. A `perTask` that
   * returns `null` (bulkDelete's own semantics don't need this, but the shape stays uniform)
   * simply isn't captured for undo.
   */
  private async runBulk(
    taskIds: string[],
    action: string,
    actingUser: AuthenticatedUser,
    perTask: (taskId: string) => Promise<{ field: string; previousValue: unknown } | null>,
  ): Promise<BulkOperationResult> {
    const succeeded: string[] = [];
    const failed: Array<{ taskId: string; message: string }> = [];
    const changes: Array<{ taskId: string; field: string; previousValue: unknown }> = [];
    for (const taskId of taskIds) {
      try {
        const capture = await perTask(taskId);
        succeeded.push(taskId);
        if (capture) changes.push({ taskId, ...capture });
      } catch (err) {
        failed.push({
          taskId,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    let undoToken: string | null = null;
    if (changes.length > 0) {
      const log = await this.bulkOperationLogsRepository.create({
        organizationId: new Types.ObjectId(requireOrgId(actingUser)),
        actor: new Types.ObjectId(actingUser.id),
        action,
        changes: changes.map((c) => ({
          taskId: new Types.ObjectId(c.taskId),
          field: c.field,
          previousValue: c.previousValue,
        })),
        undoneAt: null,
      });
      undoToken = log.id;
    }
    return { succeeded, failed, undoToken };
  }

  async bulkMoveSprint(
    dto: BulkMoveSprintDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-move-sprint', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = task.sprint ? extractId(task.sprint) : null;
      await this.updateSprint(taskId, { sprintId: dto.sprintId }, actingUser);
      return { field: 'sprintId', previousValue };
    });
  }

  async bulkAssign(
    dto: BulkAssignDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-assign', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = task.assignee ? extractId(task.assignee) : null;
      await this.updateAssignee(taskId, dto.assignee, actingUser);
      return { field: 'assignee', previousValue };
    });
  }

  async bulkRelabel(
    dto: BulkRelabelDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-relabel', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = task.labels;
      const labels = [...new Set([...task.labels, ...dto.labels])];
      await this.update(taskId, { labels }, actingUser);
      return { field: 'labels', previousValue };
    });
  }

  /** Module 5's bulk transition - each task's workflow legality is checked independently (a
   * custom-workflow project may not even have this status), so one illegal transition among many
   * selected tasks fails only that task, matching every other bulk-* endpoint's partial-success
   * shape. See previewBulkStatus() for the gap-closure "see what would fail before committing"
   * half of this same BRD line. */
  async bulkStatus(
    dto: BulkStatusDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-status', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = task.status;
      await this.updateStatus(taskId, dto.status, actingUser);
      return { field: 'status', previousValue };
    });
  }

  /**
   * Module 5 gap-closure: "no pre-validation before a bulk transition" - a read-only pass over the
   * same two most common failure reasons bulkStatus's real per-task call would hit (an unknown
   * status name for that task's own workflow, or a transition its workflow doesn't allow from the
   * task's current status), without ever calling updateStatus(). Deliberately NOT a byte-for-byte
   * simulation of every guard updateStatus enforces (role-gated transitions, requireComment,
   * required custom fields, an in-flight approval) - those are comparatively rare blockers, and
   * duplicating updateStatus's entire rule engine a second time here would be a second place for
   * the two to drift out of sync. This closes "no way to know before committing", not "a perfect
   * dry-run".
   */
  async previewBulkStatus(
    dto: PreviewBulkStatusDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkStatusPreviewResult> {
    const entries: BulkStatusPreviewEntry[] = [];
    for (const taskId of dto.taskIds) {
      try {
        const task = await this.getActiveOrThrow(taskId);
        const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
        this.projectsService.assertUserCanView(project, actingUser);
        const workflow = resolveWorkflow(project, task.issueType);
        if (categoryOf(workflow, dto.status) == null) {
          entries.push({
            taskId,
            willSucceed: false,
            reason: `"${dto.status}" is not a valid status for this task's workflow`,
          });
          continue;
        }
        if (!isLegalTaskTransition(workflow, task.status, dto.status)) {
          entries.push({
            taskId,
            willSucceed: false,
            reason:
              `Cannot transition from "${task.status}" to "${dto.status}" - allowed: ` +
              `${legalTaskTransitions(workflow, task.status).join(', ') || 'none'}`,
          });
          continue;
        }
        entries.push({ taskId, willSucceed: true, reason: null });
      } catch (err) {
        entries.push({
          taskId,
          willSucceed: false,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    return {
      entries,
      willSucceedCount: entries.filter((e) => e.willSucceed).length,
      willFailCount: entries.filter((e) => !e.willSucceed).length,
    };
  }

  async bulkPriority(
    dto: BulkPriorityDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-priority', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = task.priority;
      await this.update(taskId, { priority: dto.priority }, actingUser);
      return { field: 'priority', previousValue };
    });
  }

  async bulkDelete(
    dto: BulkDeleteDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-delete', actingUser, async (taskId) => {
      await this.softDelete(taskId, actingUser);
      return { field: 'deletedAt', previousValue: null };
    });
  }

  /** Module 5 gap-closure: bulk fix-version edit - same "add to existing" union semantics as
   * bulkRelabel, reusing update()'s existing per-task releasesService.validateIdsForProject check
   * (rejects a release id that doesn't belong to that specific task's own project). */
  async bulkFixVersion(
    dto: BulkFixVersionDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-fix-version', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = task.fixVersions.map((v) => extractId(v));
      const fixVersions = [...new Set([...previousValue, ...dto.fixVersions])];
      await this.update(taskId, { fixVersions }, actingUser);
      return { field: 'fixVersions', previousValue };
    });
  }

  /** Module 5 gap-closure: bulk custom-field edit - sets one field to one value across every
   * selected task, reusing update()'s existing per-task validateCustomFieldValues check (rejects a
   * value invalid for that specific task's own project+issueType field schema). */
  async bulkCustomField(
    dto: BulkCustomFieldDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-custom-field', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = task.customFieldValues;
      const customFieldValues = { ...task.customFieldValues, [dto.fieldId]: dto.value };
      await this.update(taskId, { customFieldValues }, actingUser);
      return { field: 'customFieldValues', previousValue };
    });
  }

  /**
   * Module 5 gap-closure: moves a single task to a different project - no prior single- or
   * multi-task equivalent existed anywhere in this codebase (`UpdateTaskDto` deliberately omits
   * `project`). Requires manage access on BOTH projects (the stricter assertUserCanManage, not the
   * grant-extensible assertUserCanManageOrGranted every other field edit uses here - moving a task
   * out of one project and into another is a bigger action than a normal field edit, a deliberate,
   * conservative scope choice). Every project-scoped reference the task carried is re-validated (or
   * cleared, when it has no equivalent in the destination) rather than left silently dangling:
   * - issueKey is regenerated under the destination project's own key/sequence (a moved task's key
   *   encoding the OLD project's prefix would be actively misleading).
   * - sprint, components, fixVersions/affectsVersions, customFieldValues, securityLevel are cleared
   *   - every one of these is validated against the project's own schema at write time, and none of
   *     the source project's values have any guaranteed meaning in the destination.
   * - status resets to the destination workflow's initial status (the source status name may not
   *   even exist in the destination project's workflow for this issue type).
   * - issueType falls back to the built-in Task type if the source type isn't enabled in the
   *   destination project.
   * - assignee is kept only if still a member of the destination project, else cleared.
   * - a task with children is rejected outright - assertValidHierarchy requires a parent and its
   *   children to share one project, so moving a parent alone would orphan its children's hierarchy
   *   invariant; the caller must move a whole subtree leaf-first, one issue at a time.
   */
  async moveToProject(
    taskId: string,
    targetProjectId: string,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    const task = await this.getWritableOrThrow(taskId);
    const sourceProjectId = extractId(task.project);
    if (sourceProjectId === targetProjectId) {
      throw new BadRequestException('Task is already in this project');
    }

    const sourceProject = await this.projectsService.getActiveProjectOrThrow(sourceProjectId);
    const targetProject = await this.projectsService.getWritableProjectOrThrow(targetProjectId);
    this.projectsService.assertUserCanManage(sourceProject, actingUser);
    this.projectsService.assertUserCanManage(targetProject, actingUser);

    if (targetProject.status === ProjectStatus.COMPLETED) {
      throw new ConflictException('Cannot move a task into a Completed project');
    }
    if (await this.tasksRepository.hasChildren(taskId)) {
      throw new ConflictException(
        'Cannot move a task that has sub-tasks or Epic-linked children - move them individually first',
      );
    }

    const destIssueTypes = resolveIssueTypes(targetProject);
    const issueType = destIssueTypes.some((t) => t.name === task.issueType)
      ? task.issueType
      : IssueType.TASK;

    const workflow = resolveWorkflow(targetProject, issueType);
    const status = workflow.initialStatus;
    const statusCategory = categoryOf(workflow, status) ?? StatusCategory.TODO;

    const assigneeId = task.assignee ? extractId(task.assignee) : null;
    const assigneeStillEligible =
      assigneeId != null && this.projectsService.isProjectMember(targetProject, assigneeId);

    let rank = task.rank;
    if (this.isStandardIssue(targetProject, issueType)) {
      const backlogScope: RankScope = {
        project: new Types.ObjectId(targetProjectId),
        sprint: null,
      };
      const maxRank = await this.tasksRepository.findMaxRank(backlogScope);
      rank = nextAppendRank(maxRank);
    }

    const keyPrefix = await this.projectsService.getOrAssignKey(targetProject);
    const seq = await this.projectsService.nextIssueNumber(targetProjectId);
    const oldIssueKey = task.issueKey;
    const newIssueKey = `${keyPrefix}-${seq}`;

    const updated = await this.tasksRepository.updateById(taskId, {
      project: new Types.ObjectId(targetProjectId),
      organizationId: targetProject.organizationId,
      issueKey: newIssueKey,
      issueType,
      status,
      statusCategory,
      sprint: null,
      parent: null,
      rank,
      components: [],
      fixVersions: [],
      affectsVersions: [],
      customFieldValues: {},
      securityLevel: null,
      assignee: assigneeStillEligible ? task.assignee : null,
      assigneeClearedAt: assigneeStillEligible ? task.assigneeClearedAt : new Date(),
    });

    await this.tasksRepository.logActivity(
      taskId,
      actingUser.id,
      TaskActivityAction.MOVED_PROJECT,
      oldIssueKey,
      newIssueKey,
    );
    await this.invalidateDashboardCache();
    return updated!;
  }

  /** Module 5 gap-closure: bulk move-between-projects - a thin wrapper over moveToProject(), same
   * partial-success shape as every other bulk-* action. Undoing a project move returns the task to
   * its ORIGINAL project, but the per-project fields moveToProject() clears (sprint, components,
   * fixVersions/affectsVersions, custom fields, security level) are not restored - a project move
   * is not a fully symmetric operation, documented here rather than silently implied by "undo". */
  async bulkMoveProject(
    dto: BulkMoveProjectDto,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    return this.runBulk(dto.taskIds, 'bulk-move-project', actingUser, async (taskId) => {
      const task = await this.getWritableOrThrow(taskId);
      const previousValue = extractId(task.project);
      await this.moveToProject(taskId, dto.targetProjectId, actingUser);
      return { field: 'project', previousValue };
    });
  }

  /** Dispatches a single captured BulkOperationLog change back through the SAME single-task update
   * method the original bulk-* action used - so an undo re-runs every permission/validation guard
   * that method has, exactly like the original action did. */
  private async revertChange(
    change: { taskId: string; field: string; previousValue: unknown },
    actingUser: AuthenticatedUser,
  ): Promise<void> {
    switch (change.field) {
      case 'status':
        await this.updateStatus(change.taskId, change.previousValue as string, actingUser);
        return;
      case 'priority':
        await this.update(
          change.taskId,
          { priority: change.previousValue as TaskPriority },
          actingUser,
        );
        return;
      case 'assignee':
        await this.updateAssignee(change.taskId, change.previousValue as string | null, actingUser);
        return;
      case 'sprintId':
        await this.updateSprint(
          change.taskId,
          { sprintId: change.previousValue as string | null },
          actingUser,
        );
        return;
      case 'labels':
        await this.update(change.taskId, { labels: change.previousValue as string[] }, actingUser);
        return;
      case 'fixVersions':
        await this.update(
          change.taskId,
          { fixVersions: change.previousValue as string[] },
          actingUser,
        );
        return;
      case 'customFieldValues':
        await this.update(
          change.taskId,
          { customFieldValues: change.previousValue as Record<string, unknown> },
          actingUser,
        );
        return;
      case 'deletedAt':
        await this.assertDeletedTaskWritable(change.taskId);
        await this.tasksRepository.restoreById(change.taskId);
        return;
      case 'project':
        await this.moveToProject(change.taskId, change.previousValue as string, actingUser);
        return;
      default:
        throw new BadRequestException(`Cannot undo unknown field "${change.field}"`);
    }
  }

  /** Module 5 gap-closure: the undo window itself - replays a BulkOperationLog's captured changes
   * in reverse, one task at a time, tolerating individual failures the same partial-success way the
   * original bulk call did (e.g. a task whose workflow changed since may no longer legally accept
   * its old status back). Time-boxed and single-use: expired or already-undone logs are rejected. */
  async undoBulkOperation(
    logId: string,
    actingUser: AuthenticatedUser,
  ): Promise<BulkOperationResult> {
    const log = await this.bulkOperationLogsRepository.findByIdInOrg(
      logId,
      requireOrgId(actingUser),
    );
    if (!log) throw new NotFoundException('Undo record not found');
    if (log.undoneAt) throw new ConflictException('This action was already undone');
    if (Date.now() - log.createdAt.getTime() > UNDO_WINDOW_MS) {
      throw new ConflictException('The undo window for this action has expired');
    }

    const succeeded: string[] = [];
    const failed: Array<{ taskId: string; message: string }> = [];
    for (const change of log.changes) {
      const taskId = extractId(change.taskId);
      try {
        await this.revertChange(
          { taskId, field: change.field, previousValue: change.previousValue },
          actingUser,
        );
        succeeded.push(taskId);
      } catch (err) {
        failed.push({ taskId, message: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
    await this.bulkOperationLogsRepository.markUndone(logId);
    return { succeeded, failed, undoToken: null };
  }

  async updateRank(
    id: string,
    dto: UpdateTaskRankDto,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    if (!dto.beforeTaskId && !dto.afterTaskId) {
      throw new BadRequestException('At least one of beforeTaskId/afterTaskId is required');
    }

    const task = await this.getWritableOrThrow(id);
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
    const task = await this.getWritableOrThrow(id);
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

  /**
   * Module 9's Epic Burndown: remaining linked-issue work over time, reusing sprint burndown's own
   * `computeBurndown` unchanged - an Epic's direct children are exactly the
   * {storyPoints, completedAt} shape it already expects. Unlike a Sprint, an Epic has no
   * `startDate`/`endDate` of its own: `createdAt` stands in for the start, and `dueDate` (if set)
   * for the ideal end - `hasIdealLine` tells the frontend whether to draw that reference series at
   * all, since a made-up end date for an epic with no due date would be misleading rather than
   * merely simplified.
   */
  async epicBurndown(id: string, actingUser: AuthenticatedUser) {
    const epic = await this.getActiveOrThrow(id);
    await this.assertCanView(epic, actingUser);
    if (epic.issueType !== IssueType.EPIC) {
      throw new BadRequestException('epic-burndown is only valid for an Epic issue');
    }

    const linkedTasks = await this.tasksRepository.findLinkedIssueSnapshots(id);
    const plannedEndDate = epic.dueDate ?? epic.completedAt ?? new Date();
    const result = computeBurndown(
      linkedTasks,
      epic.createdAt,
      plannedEndDate,
      epic.completedAt,
      new Date(),
    );
    return { ...result, hasIdealLine: epic.dueDate != null };
  }

  /**
   * Module 10's deterministic issue summary (NOT an LLM call - see `task-summary.util.ts`'s own
   * doc comment). Assembles real field values and `TaskActivity` history for `buildTaskSummary`.
   */
  async summary(id: string, actingUser: AuthenticatedUser) {
    const task = await this.getActiveOrThrow(id);
    await this.assertCanView(task, actingUser);

    const [activity, commentCount, linkedIssueCount] = await Promise.all([
      this.tasksRepository.findActivityForSummary(id),
      this.commentModel.countDocuments({ task: task._id }),
      this.issueLinkModel.countDocuments({
        $or: [{ sourceTask: task._id }, { targetTask: task._id }],
      }),
    ]);

    // `assignee` is populated by `findByIdActive` (which `getActiveOrThrow` calls) with at least
    // `name` - the schema's static type is `Types.ObjectId | null` since populate isn't visible to
    // the type system, so this is the same documented cast every populate-vs-schema-type mismatch
    // in this codebase already uses.
    const assigneeName = task.assignee ? (task.assignee as unknown as { name: string }).name : null;

    return buildTaskSummary({
      title: task.title,
      status: task.status,
      priority: task.priority,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      assigneeName,
      commentCount,
      linkedIssueCount,
      watcherCount: task.watcherIds.length,
      voterCount: task.voterIds.length,
      activity,
      now: new Date(),
    });
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

  /** Module 6: `securityLevel` must be a level name from the project's assigned Security Scheme -
   * `undefined` (not provided) is a no-op; explicit `null` always clears it and is always valid,
   * even on a project with no scheme. A non-null value on a project with no scheme assigned is
   * rejected the same way setting an unknown custom field would be. */
  private async assertValidSecurityLevel(
    project: ProjectDocument,
    securityLevel: string | null | undefined,
  ): Promise<void> {
    if (securityLevel === undefined || securityLevel === null) return;
    if (!project.securitySchemeId) {
      throw new BadRequestException('This project has no security scheme assigned');
    }
    const scheme = await this.securitySchemesService.findByIdOrNull(
      extractId(project.securitySchemeId),
    );
    const levelNames = scheme?.levels.map((l) => l.name) ?? [];
    if (!levelNames.includes(securityLevel)) {
      throw new BadRequestException(
        `"${securityLevel}" is not a security level in this project's scheme. Allowed: ${levelNames.join(', ')}`,
      );
    }
  }

  /**
   * Module 12's Field-Level Permissions - EDIT side. Only checks fields `dto` actually provides
   * (partial-patch semantics, same as everywhere else in this method) - omitting a restricted
   * field is never itself an error, only trying to *change* one you're not allowed to touch is.
   * `customFieldValues` is checked per-key (each project custom field id is its own "field" for
   * this scheme), not as one field literally named "customFieldValues".
   */
  private async assertFieldsEditable(
    project: ProjectDocument,
    actingUser: AuthenticatedUser,
    dto: UpdateTaskDto,
    automation?: AutomationContext,
  ): Promise<void> {
    if (automation?.bypassPermission) return;
    if (!project.fieldPermissionSchemeId) return;
    const scheme = await this.fieldPermissionSchemesService.findByIdOrNull(
      extractId(project.fieldPermissionSchemeId),
    );
    if (!scheme) return;

    const dtoRecord = dto as unknown as Record<string, unknown>;
    const fieldIds: string[] = BUILT_IN_TASK_FIELD_IDS.filter(
      (fieldId) => dtoRecord[fieldId] !== undefined,
    );
    if (dto.customFieldValues) fieldIds.push(...Object.keys(dto.customFieldValues));

    const blocked = [...new Set(fieldIds)].filter(
      (fieldId) => !canEditField(scheme, fieldId, actingUser.role),
    );
    if (blocked.length > 0) {
      throw new ForbiddenException(`You do not have permission to edit: ${blocked.join(', ')}`);
    }
  }

  /** The security level names `actingUser` may NOT view on `project` - empty when the project has
   * no scheme assigned (every existing project) or the scheme grants every level. Used both for
   * the single-task view check and to build the list/search exclusion filter. */
  private async blockedSecurityLevels(
    project: ProjectDocument,
    actingUser: AuthenticatedUser,
  ): Promise<string[]> {
    if (!project.securitySchemeId) return [];
    const scheme = await this.securitySchemesService.findByIdOrNull(
      extractId(project.securitySchemeId),
    );
    if (!scheme) return [];
    const ctx = await this.projectsService.resolveGranteeContext(project, actingUser);
    const viewable = new Set(viewableLevelNames(scheme, ctx));
    return scheme.levels.map((l) => l.name).filter((name) => !viewable.has(name));
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
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    const isSameOrgAdmin =
      actingUser.role === Role.ADMIN && extractId(task.organizationId) === requireOrgId(actingUser);
    if (!isSameOrgAdmin && !this.projectsService.isProjectMember(project, actingUser.id)) {
      throw new ForbiddenException('You do not have access to this task');
    }
    // Module 6: project access alone isn't enough once a security level restricts this specific
    // issue - a same-org Admin is NOT exempt here (unlike the project-membership check above),
    // since a Security Scheme is explicitly about restricting who can see a given issue, not
    // rederiving the org-wide admin bypass every other check already gives them.
    if (task.securityLevel) {
      const blocked = await this.blockedSecurityLevels(project, actingUser);
      if (blocked.includes(task.securityLevel)) {
        throw new ForbiddenException('You do not have access to this task');
      }
    }
  }

  /** ANDed into every list/search scope - excludes only (project, level) combinations the acting
   * user's Security Scheme grants don't cover. A project with no scheme assigned (every existing
   * project) contributes nothing here, so this is a no-op until an Admin opts in. */
  private async buildSecurityExclusionFilter(
    actingUser: AuthenticatedUser,
  ): Promise<FilterQuery<TaskDocument>> {
    const restrictedProjects = await this.projectsService.findProjectsWithSecurityScheme(
      requireOrgId(actingUser),
    );
    if (restrictedProjects.length === 0) return {};

    const clauses: FilterQuery<TaskDocument>[] = [];
    for (const project of restrictedProjects) {
      const blocked = await this.blockedSecurityLevels(project, actingUser);
      if (blocked.length > 0) {
        clauses.push({ project: project._id, securityLevel: { $in: blocked } });
      }
    }
    return clauses.length > 0 ? { $nor: clauses } : {};
  }

  private async buildScope(actingUser: AuthenticatedUser) {
    const projectIds = await this.projectsService.getAccessibleProjectIds(actingUser);
    return {
      project: { $in: projectIds.map((p) => new Types.ObjectId(p)) },
      organizationId: new Types.ObjectId(requireOrgId(actingUser)),
      ...(await this.buildSecurityExclusionFilter(actingUser)),
    };
  }

  /**
   * Module 10 gap-closure: deterministic duplicate detection - every issue in the project the
   * caller can see (security levels respected via buildScope), scored by similarityScore and
   * returned best-first. Replaces the old substring-only JQL `text ~` lookup in the New Task form.
   */
  async similarIssues(dto: SimilarIssuesQueryDto, actingUser: AuthenticatedUser) {
    const project = await this.projectsService.getActiveProjectOrThrow(dto.project);
    this.projectsService.assertUserCanView(project, actingUser);
    if (tokenize(dto.text).length === 0) return [];

    const candidates = await this.tasksRepository.findSimilarityCandidates(
      {
        ...(await this.buildScope(actingUser)),
        project: project._id,
        deletedAt: null,
        ...(dto.excludeId ? { _id: { $ne: new Types.ObjectId(dto.excludeId) } } : {}),
      },
      SIMILARITY_CANDIDATE_LIMIT,
    );
    return candidates
      .map((task) => ({ task, score: similarityScore(dto.text, task) }))
      .filter((match) => match.score >= SIMILARITY_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, SIMILAR_RESULT_LIMIT)
      .map(({ task, score }) => ({
        id: task._id.toString(),
        issueKey: task.issueKey,
        title: task.title,
        status: task.status,
        statusCategory: task.statusCategory,
        score,
      }));
  }

  /** Module 10 gap-closure: a project's open issues that are at risk, highest risk first. */
  async atRiskIssues(dto: AtRiskQueryDto, actingUser: AuthenticatedUser) {
    const project = await this.projectsService.getActiveProjectOrThrow(dto.project);
    this.projectsService.assertUserCanView(project, actingUser);
    const scope = await this.buildScope(actingUser);
    const tasks = await this.tasksRepository.findForRisk(
      {
        ...scope,
        project: project._id,
        deletedAt: null,
        statusCategory: { $ne: StatusCategory.DONE },
      },
      RISK_SCAN_LIMIT,
    );
    const risks = await this.computeRisks(tasks, scope, requireOrgId(actingUser));
    return tasks
      .map((task) => ({ task, risk: risks.get(task._id.toString())! }))
      .filter(({ risk }) => risk.score > 0)
      .sort(
        (a, b) =>
          b.risk.score - a.risk.score ||
          (a.task.dueDate?.getTime() ?? Infinity) - (b.task.dueDate?.getTime() ?? Infinity),
      )
      .slice(0, AT_RISK_RESULT_LIMIT)
      .map(({ task, risk }) => ({
        id: task._id.toString(),
        issueKey: task.issueKey,
        title: task.title,
        status: task.status,
        priority: task.priority,
        dueDate: task.dueDate,
        assignee: task.assignee ?? null,
        risk,
      }));
  }

  /** Module 10 gap-closure: one issue's risk assessment (same rules as atRiskIssues). */
  async taskRisk(id: string, actingUser: AuthenticatedUser): Promise<TaskRisk> {
    const task = await this.getActiveOrThrow(id);
    await this.assertCanView(task, actingUser);
    const risks = await this.computeRisks(
      [task],
      await this.buildScope(actingUser),
      requireOrgId(actingUser),
    );
    return risks.get(task._id.toString())!;
  }

  private async computeRisks(
    tasks: Array<{
      _id: Types.ObjectId;
      priority: TaskPriority;
      assignee?: unknown;
      dueDate?: Date | null;
      statusCategory: StatusCategory;
      createdAt: Date;
    }>,
    scope: FilterQuery<TaskDocument>,
    organizationId: string,
  ): Promise<Map<string, TaskRisk>> {
    const ids = tasks.map((t) => t._id);
    const organization = await this.organizationModel
      .findById(organizationId)
      .select('linkTypes')
      .lean();
    const blockingTypeIds = resolveLinkTypes(organization ?? { linkTypes: [] })
      .filter((t) => t.isBlocking)
      .map((t) => t.id);

    const [lastChange, links] = await Promise.all([
      this.tasksRepository.lastStatusChangeByTask(ids),
      ids.length > 0 && blockingTypeIds.length > 0
        ? this.issueLinkModel
            .find({ targetTask: { $in: ids }, linkTypeId: { $in: blockingTypeIds } })
            .select('sourceTask targetTask')
            .lean()
        : Promise.resolve([]),
    ]);

    // Only blockers the caller can see, and only ones still open.
    const blockerIds = [...new Set(links.map((l) => l.sourceTask.toString()))];
    const openBlockers =
      blockerIds.length > 0
        ? await this.tasksRepository.findForRisk(
            {
              ...scope,
              _id: { $in: blockerIds.map((b) => new Types.ObjectId(b)) },
              deletedAt: null,
              statusCategory: { $ne: StatusCategory.DONE },
            },
            blockerIds.length,
          )
        : [];
    const blockerLabel = new Map(
      openBlockers.map((b) => [b._id.toString(), b.issueKey ?? b.title]),
    );

    const now = new Date();
    return new Map(
      tasks.map((task) => {
        const key = task._id.toString();
        const blockedBy = links
          .filter((l) => l.targetTask.toString() === key)
          .map((l) => blockerLabel.get(l.sourceTask.toString()))
          .filter((label): label is string => !!label);
        return [
          key,
          assessTaskRisk(
            {
              priority: task.priority,
              assignee: task.assignee ?? null,
              dueDate: task.dueDate ?? null,
              statusCategory: task.statusCategory,
              lastStatusChangeAt: lastChange.get(key) ?? task.createdAt,
              openBlockers: blockedBy,
            },
            now,
          ),
        ];
      }),
    );
  }

  private async getActiveOrThrow(id: string): Promise<TaskDocument> {
    const task = await this.tasksRepository.findByIdActive(id);
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  /** Module 8 gap-closure: `getActiveOrThrow` for WRITE paths - refuses a task whose project is
   * archived (read-only). */
  private async getWritableOrThrow(id: string): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    await this.projectsService.assertProjectIdWritable(extractId(task.project));
    return task;
  }

  /** Undo of a bulk delete restores an already-deleted task, which getWritableOrThrow can't load. */
  private async assertDeletedTaskWritable(id: string): Promise<void> {
    const task = await this.tasksRepository.findIncludingDeleted(id);
    if (task) await this.projectsService.assertProjectIdWritable(extractId(task.project));
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
      const project = await this.projectsService.getWritableProjectOrThrow(data.projectId);
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
      if (project.archivedAt) continue; // archived = read-only (Module 8)
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
      if (project.archivedAt) continue; // archived = read-only (Module 8)
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
