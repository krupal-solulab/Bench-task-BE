import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CacheService } from '../../redis/cache.service';
import { dashboardCachePattern } from '../../common/utils/cache-key.util';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { ORG_ROLES, OrgRole, Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { IssueType, IssueTypeLevel } from '../../common/enums/issue-type.enum';
import { TaskPriority } from '../../common/enums/task-priority.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UsersRepository } from '../users/users.repository';
import { UserDocument } from '../users/schemas/user.schema';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { Comment, CommentDocument } from '../comments/schemas/comment.schema';
import { Sprint, SprintDocument } from '../sprints/schemas/sprint.schema';
import { ListTasksDto } from '../tasks/dto/list-tasks.dto';
import { buildTaskListFilter, buildTaskListSort } from '../tasks/utils/task-filter.util';
import { ProjectsRepository } from './projects.repository';
import { ProjectDocument } from './schemas/project.schema';
import { ProjectActivityAction } from './schemas/project-activity.schema';
import { isLegalProjectTransition, legalProjectTransitions } from './project-status.rules';
import {
  DEFAULT_WORKFLOW,
  Workflow,
  resolveWorkflow,
  assertValidWorkflowShape,
} from './schemas/workflow.schema';
import {
  GrantableCapability,
  MemberPermissions,
  resolveMemberPermissions,
} from './schemas/member-permissions.schema';
import { PutWorkflowDto } from './dto/put-workflow.dto';
import { CustomFieldDefinition } from './schemas/custom-field.schema';
import { PutComponentsDto } from './dto/put-components.dto';
import { PutCustomFieldsDto } from './dto/put-custom-fields.dto';
import { PutIssueTypesDto } from './dto/put-issue-types.dto';
import { IssueTypeDefinition, resolveIssueTypes } from './schemas/issue-type.schema';
import {
  AutomationActionType,
  AutomationConditionField,
  AutomationRule,
  AutomationTriggerType,
} from './schemas/automation-rule.schema';
import { AutomationRuleDto, PutAutomationRulesDto } from './dto/put-automation-rules.dto';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { PatchPermissionSchemeDto } from './dto/patch-permission-scheme.dto';
import { PermissionSchemesService } from '../../permission-schemes/permission-schemes.service';
import {
  SchemeAction,
  schemeGrants,
} from '../../permission-schemes/schemas/permission-scheme.schema';

interface ProjectMemberResponse {
  user: unknown;
  role: 'owner' | 'member';
  joinedAt: Date;
  permissions: MemberPermissions | null;
}

export interface ProjectResponse {
  id: string;
  name: string;
  description: string;
  status: ProjectStatus;
  owner: unknown;
  members: ProjectMemberResponse[];
  startDate: Date;
  dueDate: Date | null;
  taskCount: number;
  key: string | null;
  components: string[];
  customFields: CustomFieldDefinition[];
  automationRules: AutomationRule[];
  issueTypes: IssueTypeDefinition[];
  permissionSchemeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly cacheService: CacheService,
    private readonly permissionSchemesService: PermissionSchemesService,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
    @InjectModel(Sprint.name) private readonly sprintModel: Model<SprintDocument>,
  ) {}

  async create(dto: CreateProjectDto, actingUser: AuthenticatedUser): Promise<ProjectResponse> {
    const organizationId = requireOrgId(actingUser);
    let ownerId = actingUser.id;

    if (actingUser.role === Role.ADMIN && dto.owner) {
      const owner = await this.usersRepository.findById(dto.owner);
      if (
        !owner ||
        ![Role.ADMIN, Role.MANAGER].includes(owner.role) ||
        extractId(owner.organizationId) !== organizationId
      ) {
        throw new BadRequestException(
          'owner must be an existing Admin or Manager in your organization',
        );
      }
      ownerId = owner.id;
    }

    if (dto.memberIds?.length) {
      await this.assertActiveDevelopers(dto.memberIds, organizationId);
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
    const dueDate = dto.dueDate ? new Date(dto.dueDate) : undefined;
    this.assertValidDateRange(startDate, dueDate);

    if (dto.key) {
      const taken = await this.projectsRepository.keyExistsInOrg(organizationId, dto.key);
      if (taken) throw new BadRequestException(`Project key "${dto.key}" is already in use`);
    }

    const doc = await this.projectsRepository.create({
      name: dto.name,
      description: dto.description ?? '',
      owner: new Types.ObjectId(ownerId) as unknown as Types.ObjectId,
      startDate,
      dueDate,
      key: dto.key ?? null,
      organizationId: new Types.ObjectId(organizationId),
      members: (dto.memberIds ?? []).map((id) => ({
        user: new Types.ObjectId(id),
        joinedAt: new Date(),
      })),
    });

    await this.projectsRepository.logActivity(doc.id, actingUser.id, ProjectActivityAction.CREATED);
    const populated = await this.projectsRepository.findByIdActive(doc.id);
    await this.invalidateDashboardCache();
    return this.toResponse(populated!);
  }

  async findOneScoped(id: string, actingUser: AuthenticatedUser): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanView(project, actingUser);
    return this.toResponse(project);
  }

  async paginate(query: ListProjectsDto, actingUser: AuthenticatedUser) {
    const scope = this.buildScopeFilter(actingUser);
    const { data, total } = await this.projectsRepository.paginate(query, scope);
    const responses = await Promise.all(data.map((doc) => this.toResponse(doc)));
    return { data: responses, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async update(
    id: string,
    dto: UpdateProjectDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const nextStartDate = dto.startDate ? new Date(dto.startDate) : project.startDate;
    const nextDueDate = dto.dueDate ? new Date(dto.dueDate) : project.dueDate;
    this.assertValidDateRange(nextStartDate, nextDueDate);

    // Immutable once set - changing it after issues already carry keys like "OLD-101" would leave
    // historical issue keys inconsistent with the project's new prefix.
    if (dto.key && project.key) {
      throw new ConflictException('This project already has an issue key and it cannot be changed');
    }
    if (dto.key) {
      const taken = await this.projectsRepository.keyExistsInOrg(
        extractId(project.organizationId),
        dto.key,
        project.id,
      );
      if (taken) throw new BadRequestException(`Project key "${dto.key}" is already in use`);
    }

    const updated = await this.projectsRepository.updateById(id, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.startDate ? { startDate: nextStartDate } : {}),
      ...(dto.dueDate ? { dueDate: nextDueDate } : {}),
      ...(dto.key && !project.key ? { key: dto.key } : {}),
    });
    await this.projectsRepository.logActivity(id, actingUser.id, ProjectActivityAction.UPDATED);
    await this.invalidateDashboardCache();
    return this.toResponse(updated!);
  }

  async updateStatus(
    id: string,
    status: ProjectStatus,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    if (project.status === status) {
      return this.toResponse(project);
    }

    if (!isLegalProjectTransition(project.status, status)) {
      throw new ConflictException(
        `Cannot transition from ${project.status} to ${status}. Allowed: ${legalProjectTransitions(project.status).join(', ') || 'none'}`,
      );
    }

    if (status === ProjectStatus.COMPLETED) {
      const blockingCount = await this.taskModel.countDocuments({
        project: project._id,
        deletedAt: null,
        statusCategory: { $ne: StatusCategory.DONE },
      });
      if (blockingCount > 0) {
        throw new ConflictException(
          `Cannot complete project: ${blockingCount} task(s) are not yet Done`,
        );
      }
    }

    const updated = await this.projectsRepository.updateById(id, { status });
    await this.projectsRepository.logActivity(
      id,
      actingUser.id,
      ProjectActivityAction.STATUS_CHANGED,
      project.status,
      status,
    );
    await this.invalidateDashboardCache();
    return this.toResponse(updated!);
  }

  async softDelete(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const now = new Date();
    const tasks = await this.taskModel.find({ project: project._id, deletedAt: null }).exec();
    const taskIds = tasks.map((t) => t._id);

    await this.projectsRepository.softDelete(id);
    if (taskIds.length > 0) {
      await this.taskModel.updateMany({ _id: { $in: taskIds } }, { deletedAt: now }).exec();
      await this.commentModel.updateMany({ task: { $in: taskIds } }, { deletedAt: now }).exec();
    }
    await this.sprintModel
      .updateMany({ project: project._id, deletedAt: null }, { deletedAt: now })
      .exec();
    await this.projectsRepository.logActivity(id, actingUser.id, ProjectActivityAction.DELETED);
    await this.invalidateDashboardCache();
  }

  async listMembers(
    id: string,
    query: PaginationQueryDto,
    actingUser: AuthenticatedUser,
  ): Promise<PaginatedResponseDto<ProjectMemberResponse>> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanView(project, actingUser);
    const response = await this.toResponse(project);

    // members is a small, embedded, already-loaded array (not a growing collection), so paginating
    // it in memory here is not the "pull a whole collection into memory" anti-pattern this codebase
    // avoids for dashboard aggregates — it's just slicing a page out of data already fetched.
    const total = response.members.length;
    const start = (query.page - 1) * query.limit;
    const data = response.members.slice(start, start + query.limit);

    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async addMembers(
    id: string,
    userIds: string[],
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);
    await this.assertActiveDevelopers(userIds, requireOrgId(actingUser));
    const addedIds = await this.projectsRepository.addMembers(id, userIds);
    for (const addedId of addedIds) {
      await this.projectsRepository.logActivity(
        id,
        actingUser.id,
        ProjectActivityAction.MEMBER_ADDED,
        null,
        addedId,
      );
    }
    const updated = await this.projectsRepository.findByIdActive(id);
    return this.toResponse(updated!);
  }

  async removeMember(
    id: string,
    userId: string,
    reassignTo: string | undefined,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const openTasks = await this.taskModel
      .find({
        project: project._id,
        assignee: new Types.ObjectId(userId),
        deletedAt: null,
        statusCategory: { $ne: StatusCategory.DONE },
      })
      .exec();

    if (openTasks.length > 0) {
      if (!reassignTo) {
        throw new ConflictException(
          `User has ${openTasks.length} open task(s) in this project. Pass reassignTo to reassign them first.`,
        );
      }
      if (
        !this.projectsRepository.isMember(project, reassignTo) &&
        extractId(project.owner) !== reassignTo
      ) {
        throw new BadRequestException('reassignTo must be the project owner or a member');
      }
      await this.taskModel
        .updateMany(
          { _id: { $in: openTasks.map((t) => t._id) } },
          { assignee: new Types.ObjectId(reassignTo) },
        )
        .exec();
    }

    await this.projectsRepository.removeMember(id, userId);
    await this.projectsRepository.logActivity(
      id,
      actingUser.id,
      ProjectActivityAction.MEMBER_REMOVED,
      userId,
      null,
    );
    const updated = await this.projectsRepository.findByIdActive(id);
    return this.toResponse(updated!);
  }

  /**
   * Grants/revokes a member's extra per-project task/sprint capabilities. Gated by the
   * UNMODIFIED assertCanManage (same-org Admin or owning Manager only) - never by
   * assertUserCanManageOrGranted - so a member holding any grant can never grant themselves or
   * anyone else more capability.
   */
  async setMemberPermissions(
    id: string,
    userId: string,
    patch: Partial<MemberPermissions>,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const ownerId = extractId(project.owner);
    if (userId === ownerId) {
      throw new BadRequestException(
        'The project owner already has full access and cannot be granted or restricted',
      );
    }
    const member = project.members.find((m) => extractId(m.user) === userId);
    if (!member) {
      throw new NotFoundException('User is not a member of this project');
    }

    const next: MemberPermissions = { ...resolveMemberPermissions(member), ...patch };
    await this.projectsRepository.setMemberPermissions(id, userId, next);
    const updated = await this.projectsRepository.findByIdActive(id);
    return this.toResponse(updated!);
  }

  async listActivity(id: string, page: number, limit: number, actingUser: AuthenticatedUser) {
    const project = await this.getActiveOrThrow(id);
    this.assertCanView(project, actingUser);
    const { data, total } = await this.projectsRepository.paginateActivity(id, page, limit);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async listTasksForProject(id: string, query: ListTasksDto, actingUser: AuthenticatedUser) {
    const project = await this.getActiveOrThrow(id);
    this.assertCanView(project, actingUser);

    const filter = buildTaskListFilter(query, { project: project._id });
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const skip = (query.page - 1) * query.limit;
    const sort = buildTaskListSort(query.sortBy, sortOrder);

    const [data, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .populate('assignee', 'name email role isActive')
        .populate('createdBy', 'name email role isActive')
        .populate('sprint', 'name')
        .populate('parent', 'title issueKey')
        .sort(sort)
        .skip(skip)
        .limit(query.limit)
        .exec(),
      this.taskModel.countDocuments(filter).exec(),
    ]);

    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async statsForProject(id: string, actingUser: AuthenticatedUser) {
    const project = await this.getActiveOrThrow(id);
    this.assertCanView(project, actingUser);

    const [facetResult] = await this.taskModel.aggregate([
      { $match: { project: project._id, deletedAt: null } },
      {
        $facet: {
          byStatus: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
          byPriority: [{ $group: { _id: '$priority', count: { $sum: 1 } } }],
          total: [{ $count: 'count' }],
          overdue: [
            {
              $match: {
                dueDate: { $lt: new Date() },
                statusCategory: { $ne: StatusCategory.DONE },
              },
            },
            { $count: 'count' },
          ],
          done: [{ $match: { statusCategory: StatusCategory.DONE } }, { $count: 'count' }],
        },
      },
    ]);

    const totalTasks = facetResult.total[0]?.count ?? 0;
    const doneCount = facetResult.done[0]?.count ?? 0;
    const overdueCount = facetResult.overdue[0]?.count ?? 0;

    // Zero-filled from this project's actual workflow (custom, or the system default) - so a
    // project on the default workflow still always shows exactly its 4 familiar buckets, and a
    // custom-workflow project's real status names show up instead.
    const workflow = resolveWorkflow(project);
    const tasksByStatus = Object.fromEntries(
      workflow.statuses.map((s) => [
        s.name,
        facetResult.byStatus.find((b: { _id: string }) => b._id === s.name)?.count ?? 0,
      ]),
    );

    return {
      totalTasks,
      tasksByStatus,
      tasksByPriority: Object.fromEntries(
        (['P1', 'P2', 'P3'] as const).map((p) => [
          p,
          facetResult.byPriority.find((b: { _id: string }) => b._id === p)?.count ?? 0,
        ]),
      ),
      overdueCount,
      completionRate: totalTasks > 0 ? Math.round((doneCount / totalTasks) * 100) : 0,
    };
  }

  /** Public wrapper for cross-module use (Tasks/Comments scoping tasks by accessible projects). */
  async getAccessibleProjectIds(actingUser: AuthenticatedUser): Promise<string[]> {
    const scope = this.buildScopeFilter(actingUser);
    const projects = await this.projectsRepository.paginate(
      { page: 1, limit: 10_000, sortBy: 'createdAt', sortOrder: 'desc' } as ListProjectsDto,
      scope,
    );
    return projects.data.map((p) => p.id);
  }

  async getActiveProjectOrThrow(id: string): Promise<ProjectDocument> {
    return this.getActiveOrThrow(id);
  }

  /**
   * Returns the project's issue-key prefix (e.g. "SUP"), assigning one on first use rather than
   * backfilling every existing project - a project nobody has created a hierarchy-aware issue on
   * yet is completely untouched. Derives a default from the name, deduping against the org's
   * other keys, when the project doesn't already have one.
   */
  async getOrAssignKey(project: ProjectDocument): Promise<string> {
    if (project.key) return project.key;

    const organizationId = extractId(project.organizationId);
    const base =
      project.name
        .replace(/[^A-Za-z]/g, '')
        .toUpperCase()
        .slice(0, 4) || 'PRJ';
    let candidate = base;
    let suffix = 2;
    while (await this.projectsRepository.keyExistsInOrg(organizationId, candidate, project.id)) {
      candidate = `${base}${suffix}`;
      suffix += 1;
    }

    await this.projectsRepository.updateById(project.id, { key: candidate });
    return candidate;
  }

  /** Atomic per-project issue-number sequence, for building issue keys like "SUP-101". */
  async nextIssueNumber(projectId: string): Promise<number> {
    return this.projectsRepository.incrementIssueSeq(projectId);
  }

  /**
   * The project's effective workflow - its own custom one, or the system default. When
   * `issueType` is given, returns that type's override if configured, else the same project-wide
   * fallback. Omitting `issueType` (every call site that existed before per-issue-type workflows)
   * is byte-identical to before this feature existed.
   */
  async getWorkflow(
    id: string,
    actingUser: AuthenticatedUser,
    issueType?: string,
  ): Promise<Workflow> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanView(project, actingUser);
    return resolveWorkflow(project, issueType);
  }

  async updateWorkflow(
    id: string,
    dto: PutWorkflowDto,
    actingUser: AuthenticatedUser,
    issueType?: string,
  ): Promise<Workflow> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const workflow: Workflow = {
      statuses: dto.statuses,
      transitions: dto.transitions,
      initialStatus: dto.initialStatus,
    };
    this.assertValidWorkflow(workflow);
    await this.assertNoOrphanedTaskStatuses(
      project,
      workflow.statuses.map((s) => s.name),
      issueType,
    );

    if (issueType) {
      const workflowsByType = project.workflowsByType.filter((w) => w.issueType !== issueType);
      workflowsByType.push({ issueType, workflow });
      await this.projectsRepository.updateById(id, { workflowsByType });
    } else {
      await this.projectsRepository.updateById(id, { workflow });
    }
    await this.invalidateDashboardCache();
    return workflow;
  }

  /**
   * Reverts a project (or, with `issueType`, just that one issue type) to its fallback workflow -
   * the system default for the project-wide case, or the project's own workflow (custom or
   * default) for a per-type reset. Omitting `issueType` is byte-identical to before this feature.
   */
  async resetWorkflow(
    id: string,
    actingUser: AuthenticatedUser,
    issueType?: string,
  ): Promise<Workflow> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    if (issueType) {
      const hasOverride = project.workflowsByType.some((w) => w.issueType === issueType);
      const fallback = resolveWorkflow(project);
      if (!hasOverride) return fallback;

      await this.assertNoOrphanedTaskStatuses(
        project,
        fallback.statuses.map((s) => s.name),
        issueType,
      );
      const workflowsByType = project.workflowsByType.filter((w) => w.issueType !== issueType);
      await this.projectsRepository.updateById(id, { workflowsByType });
      await this.invalidateDashboardCache();
      return fallback;
    }

    if (!project.workflow) return DEFAULT_WORKFLOW;

    await this.assertNoOrphanedTaskStatuses(
      project,
      DEFAULT_WORKFLOW.statuses.map((s) => s.name),
    );

    await this.projectsRepository.updateById(id, { workflow: null });
    await this.invalidateDashboardCache();
    return DEFAULT_WORKFLOW;
  }

  /** Distinct labels already in use on this project's active tasks - for autocomplete, not a
   * registry (labels stay pure free text; there is no "list of allowed labels"). */
  async listLabels(id: string, actingUser: AuthenticatedUser): Promise<string[]> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanView(project, actingUser);
    return this.taskModel.distinct('labels', { project: project._id, deletedAt: null });
  }

  async updateComponents(
    id: string,
    dto: PutComponentsDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const names = dto.names.map((n) => n.trim());
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Component names must be unique');
    }

    const orphaned: string[] = await this.taskModel.distinct('components', {
      project: project._id,
      deletedAt: null,
      components: { $nin: names },
    });
    if (orphaned.length > 0) {
      throw new ConflictException(
        `Cannot remove component(s) still in use by active tasks: ${orphaned.join(', ')}. Move those tasks to a different component first.`,
      );
    }

    const updated = await this.projectsRepository.updateById(id, { components: names });
    return this.toResponse(updated!);
  }

  /**
   * Sets/replaces this project's issue types. Epic and Sub-task are structurally fixed (exactly
   * one of each, always named "Epic"/"Sub-task") since the rest of the app - hierarchy validation,
   * epic-linking, sub-task creation - depends on those two exact names; only the Standard level is
   * the BRD's "extensible" one, freely added/renamed/removed here.
   */
  async updateIssueTypes(
    id: string,
    dto: PutIssueTypesDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const types = dto.issueTypes;
    const names = types.map((t) => t.name.trim());
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Issue type names must be unique');
    }

    const epicRows = types.filter((t) => t.level === IssueTypeLevel.EPIC);
    const subtaskRows = types.filter((t) => t.level === IssueTypeLevel.SUBTASK);
    const standardRows = types.filter((t) => t.level === IssueTypeLevel.STANDARD);
    if (epicRows.length !== 1 || epicRows[0]!.name.trim() !== IssueType.EPIC) {
      throw new BadRequestException(`There must be exactly one Epic-level type, named "Epic"`);
    }
    if (subtaskRows.length !== 1 || subtaskRows[0]!.name.trim() !== IssueType.SUBTASK) {
      throw new BadRequestException(
        `There must be exactly one Sub-task-level type, named "Sub-task"`,
      );
    }
    if (standardRows.length === 0) {
      throw new BadRequestException('There must be at least one Standard-level issue type');
    }

    const orphaned: string[] = await this.taskModel.distinct('issueType', {
      project: project._id,
      deletedAt: null,
      issueType: { $nin: names },
    });
    if (orphaned.length > 0) {
      throw new ConflictException(
        `Cannot remove issue type(s) still in use by active tasks: ${orphaned.join(', ')}. Move those tasks to a different issue type first.`,
      );
    }

    const updated = await this.projectsRepository.updateById(id, {
      issueTypes: types.map((t) => ({ ...t, name: t.name.trim() })),
    });
    return this.toResponse(updated!);
  }

  async updateCustomFields(
    id: string,
    dto: PutCustomFieldsDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const existingById = new Map(project.customFields.map((f) => [f.id, f]));
    const definitions: CustomFieldDefinition[] = dto.fields.map((f) => {
      const existing = f.id ? existingById.get(f.id) : undefined;
      if (f.id && !existing) {
        throw new BadRequestException(`Custom field "${f.id}" does not exist on this project`);
      }
      if (existing && existing.type !== f.type) {
        throw new BadRequestException(
          `Cannot change "${existing.name}"'s type after creation - remove and recreate it instead`,
        );
      }
      return {
        id: f.id ?? new Types.ObjectId().toString(),
        name: f.name.trim(),
        type: f.type,
        required: f.required,
        options: f.options ?? null,
      };
    });

    const names = definitions.map((f) => f.name);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Custom field names must be unique');
    }

    const keptIds = new Set(definitions.map((f) => f.id));
    const removedIds = project.customFields.map((f) => f.id).filter((fid) => !keptIds.has(fid));
    if (removedIds.length > 0) {
      const inUseCount = await this.taskModel.countDocuments({
        project: project._id,
        deletedAt: null,
        $or: removedIds.map((fid) => ({
          [`customFieldValues.${fid}`]: { $exists: true, $ne: null },
        })),
      });
      if (inUseCount > 0) {
        throw new ConflictException(
          'Cannot remove a custom field still holding a value on an active task. Clear those values first.',
        );
      }
    }

    const updated = await this.projectsRepository.updateById(id, { customFields: definitions });
    return this.toResponse(updated!);
  }

  async updateAutomationRules(
    id: string,
    dto: PutAutomationRulesDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    const existingById = new Map(project.automationRules.map((r) => [r.id, r]));
    const rules: AutomationRule[] = dto.rules.map((r) => {
      if (r.id && !existingById.has(r.id)) {
        throw new BadRequestException(`Automation rule "${r.id}" does not exist on this project`);
      }
      this.assertValidAutomationRule(r, project);
      return {
        id: r.id ?? new Types.ObjectId().toString(),
        name: r.name.trim(),
        enabled: r.enabled,
        trigger: { type: r.trigger.type, toStatus: r.trigger.toStatus ?? null },
        conditions: r.conditions.map((c) => ({ field: c.field, value: c.value.trim() })),
        actions: r.actions.map((a) => ({ type: a.type, value: a.value.trim() })),
      };
    });

    const names = rules.map((r) => r.name);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Automation rule names must be unique');
    }

    const updated = await this.projectsRepository.updateById(id, { automationRules: rules });
    return this.toResponse(updated!);
  }

  /** Assign (or, with `null`, unassign) a reusable PermissionScheme to this project. Unassigning
   * falls back to the legacy per-member permission flags - never a dead end. */
  async assignPermissionScheme(
    id: string,
    dto: PatchPermissionSchemeDto,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectResponse> {
    const project = await this.getActiveOrThrow(id);
    this.assertCanManage(project, actingUser);

    if (dto.permissionSchemeId) {
      const scheme = await this.permissionSchemesService.findByIdOrNull(dto.permissionSchemeId);
      if (!scheme || extractId(scheme.organizationId) !== requireOrgId(actingUser)) {
        throw new BadRequestException('Permission scheme not found in this organization');
      }
    }

    const updated = await this.projectsRepository.updateById(id, {
      permissionSchemeId: dto.permissionSchemeId
        ? new Types.ObjectId(dto.permissionSchemeId)
        : null,
    });
    return this.toResponse(updated!);
  }

  /** Every check runs synchronously against the already-loaded project - no extra queries. */
  private assertValidAutomationRule(dto: AutomationRuleDto, project: ProjectDocument): void {
    const statusNames = resolveWorkflow(project).statuses.map((s) => s.name);

    if (dto.trigger.type === AutomationTriggerType.STATUS_CHANGED) {
      if (!dto.trigger.toStatus || !statusNames.includes(dto.trigger.toStatus)) {
        throw new BadRequestException(
          `"${dto.trigger.toStatus}" is not a status in this project's workflow`,
        );
      }
      if (dto.trigger.fromStatus && !statusNames.includes(dto.trigger.fromStatus)) {
        throw new BadRequestException(
          `"${dto.trigger.fromStatus}" is not a status in this project's workflow`,
        );
      }
    }

    for (const condition of dto.conditions) {
      if (
        condition.field === AutomationConditionField.ISSUE_TYPE &&
        !resolveIssueTypes(project).some((t) => t.name === condition.value)
      ) {
        throw new BadRequestException(`"${condition.value}" is not a valid issue type`);
      }
      if (
        condition.field === AutomationConditionField.PRIORITY &&
        !Object.values(TaskPriority).includes(condition.value as TaskPriority)
      ) {
        throw new BadRequestException(`"${condition.value}" is not a valid priority`);
      }
      if (
        condition.field === AutomationConditionField.COMPONENT &&
        !project.components.includes(condition.value)
      ) {
        throw new BadRequestException(`"${condition.value}" is not a component on this project`);
      }
    }

    const memberIds = new Set([
      extractId(project.owner),
      ...project.members.map((m) => extractId(m.user)),
    ]);
    for (const action of dto.actions) {
      if (action.type === AutomationActionType.SET_STATUS && !statusNames.includes(action.value)) {
        throw new BadRequestException(
          `"${action.value}" is not a status in this project's workflow`,
        );
      }
      if (
        action.type === AutomationActionType.SET_PRIORITY &&
        !Object.values(TaskPriority).includes(action.value as TaskPriority)
      ) {
        throw new BadRequestException(`"${action.value}" is not a valid priority`);
      }
      if (action.type === AutomationActionType.SET_ASSIGNEE && !memberIds.has(action.value)) {
        throw new BadRequestException(`"${action.value}" is not a member of this project`);
      }
      if (
        action.type === AutomationActionType.NOTIFY_ROLE &&
        !ORG_ROLES.includes(action.value as OrgRole)
      ) {
        throw new BadRequestException(`"${action.value}" is not a valid role`);
      }
      if (action.type === AutomationActionType.WEBHOOK && !/^https?:\/\/.+/.test(action.value)) {
        throw new BadRequestException('Webhook value must be a valid http(s) URL');
      }
    }
  }

  private assertValidWorkflow(workflow: Workflow): void {
    assertValidWorkflowShape(workflow);
  }

  /**
   * Rejects a workflow change that would drop a status name still held by an active task in this
   * project - forces cleanup instead of silently orphaning tasks in an undefined status.
   */
  private async assertNoOrphanedTaskStatuses(
    project: ProjectDocument,
    validNames: string[],
    issueType?: string,
  ): Promise<void> {
    const orphaned: string[] = await this.taskModel.distinct('status', {
      project: project._id,
      deletedAt: null,
      status: { $nin: validNames },
      ...(issueType ? { issueType } : {}),
    });
    if (orphaned.length > 0) {
      throw new ConflictException(
        `Cannot remove status(es) still in use by active tasks: ${orphaned.join(', ')}. Move those tasks to a different status first.`,
      );
    }
  }

  assertUserCanView(project: ProjectDocument, actingUser: AuthenticatedUser): void {
    this.assertCanView(project, actingUser);
  }

  assertUserCanManage(project: ProjectDocument, actingUser: AuthenticatedUser): void {
    this.assertCanManage(project, actingUser);
  }

  /**
   * Same as assertUserCanManage, PLUS a third success path: a project member who was explicitly
   * granted this specific capability on this specific project (see setMemberPermissions). The
   * same-org-Admin/owning-Manager checks run first and are completely unchanged - this can only
   * ever add a way to pass, never remove one, and a member with no grant hits the exact same
   * ForbiddenException as before this feature existed.
   *
   * When the project has a PermissionScheme assigned, the scheme is authoritative for this
   * capability instead of the legacy per-member flag - every existing project has no scheme
   * (`permissionSchemeId` is null) and so is completely unaffected; a scheme only ever applies to
   * a project that explicitly opted into one via assignPermissionScheme().
   */
  async assertUserCanManageOrGranted(
    project: ProjectDocument,
    actingUser: AuthenticatedUser,
    capability: GrantableCapability,
  ): Promise<void> {
    if (this.isManager(project, actingUser)) return;
    if (project.permissionSchemeId) {
      if (await this.hasSchemeGrant(project, actingUser, this.schemeActionFor(capability))) return;
      throw new ForbiddenException('You do not have permission to manage this project');
    }
    if (this.memberHasCapability(project, actingUser.id, capability)) return;
    throw new ForbiddenException('You do not have permission to manage this project');
  }

  /** Maps a legacy per-member flag onto its closest BRD PermissionScheme action - a naming
   * alignment, not a behavior change: today's flag already gates exactly this call site. */
  private schemeActionFor(capability: GrantableCapability): SchemeAction {
    switch (capability) {
      case 'canCreateTask':
        return SchemeAction.CREATE_ISSUE;
      case 'canDeleteTask':
        return SchemeAction.DELETE;
      case 'canManageSprints':
        return SchemeAction.MANAGE_SPRINT;
      case 'canChangeAnyTaskStatus':
        return SchemeAction.TRANSITION;
      case 'canEditAnyTask':
      default:
        return SchemeAction.EDIT_CUSTOM_FIELDS;
    }
  }

  /** Same shape as assertUserCanManageOrGranted, but for actions with no legacy per-member flag
   * (e.g. reassigning a task) - a project with no scheme assigned behaves exactly like
   * assertUserCanManage (Admin/owning-Manager only), unchanged from before this feature existed. */
  async assertUserCanAssignOrGranted(
    project: ProjectDocument,
    actingUser: AuthenticatedUser,
  ): Promise<void> {
    if (this.isManager(project, actingUser)) return;
    if (project.permissionSchemeId) {
      if (await this.hasSchemeGrant(project, actingUser, SchemeAction.ASSIGN)) return;
    }
    throw new ForbiddenException('You do not have permission to manage this project');
  }

  /** Whether the project's assigned scheme (if any) grants `actingUser` this action - false, with
   * no throw, when no scheme is assigned or the scheme id no longer resolves to a real document. */
  async hasSchemeGrant(
    project: ProjectDocument,
    actingUser: AuthenticatedUser,
    action: SchemeAction,
  ): Promise<boolean> {
    if (!project.permissionSchemeId) return false;
    const scheme = await this.permissionSchemesService.findByIdOrNull(
      extractId(project.permissionSchemeId),
    );
    if (!scheme) return false;
    return schemeGrants(scheme, action, actingUser);
  }

  /** Whether a project member (by user id) was explicitly granted a specific capability on this
   * project - false for a non-member, and false for any capability nobody ever granted them. */
  memberHasCapability(
    project: ProjectDocument,
    userId: string,
    capability: GrantableCapability,
  ): boolean {
    const member = project.members.find((m) => extractId(m.user) === userId);
    if (!member) return false;
    return resolveMemberPermissions(member)[capability] === true;
  }

  isProjectMember(project: ProjectDocument, userId: string): boolean {
    return this.projectsRepository.isMember(project, userId);
  }

  /** Every project member (owner + members) whose global role matches - used by the automation
   * engine's NotifyRole post-function action. An empty result (nobody currently holds that role)
   * is a safe, silent no-op for the caller, not an error. */
  async membersWithRole(project: ProjectDocument, role: Role): Promise<UserDocument[]> {
    const memberIds = [extractId(project.owner), ...project.members.map((m) => extractId(m.user))];
    const users = await this.usersRepository.findByIds(
      memberIds,
      extractId(project.organizationId),
    );
    return users.filter((u) => u.role === role);
  }

  private buildScopeFilter(actingUser: AuthenticatedUser) {
    const organizationId = new Types.ObjectId(requireOrgId(actingUser));
    if (actingUser.role === Role.ADMIN) return { organizationId };
    if (actingUser.role === Role.MANAGER) {
      return {
        organizationId,
        $or: [
          { owner: new Types.ObjectId(actingUser.id) },
          { 'members.user': new Types.ObjectId(actingUser.id) },
        ],
      };
    }
    return { organizationId, 'members.user': new Types.ObjectId(actingUser.id) };
  }

  private assertCanView(project: ProjectDocument, actingUser: AuthenticatedUser): void {
    if (this.isSameOrgAdmin(project, actingUser)) return;
    if (this.projectsRepository.isMember(project, actingUser.id)) return;
    throw new ForbiddenException('You do not have access to this project');
  }

  private assertCanManage(project: ProjectDocument, actingUser: AuthenticatedUser): void {
    if (this.isManager(project, actingUser)) return;
    throw new ForbiddenException('You do not have permission to manage this project');
  }

  /** Same-org Admin, or the project's owning Manager - the authority level that has always been
   * required to manage a project, unaffected by the per-member grants added alongside it. */
  private isManager(project: ProjectDocument, actingUser: AuthenticatedUser): boolean {
    if (this.isSameOrgAdmin(project, actingUser)) return true;
    const ownerId = extractId(project.owner);
    return actingUser.role === Role.MANAGER && ownerId === actingUser.id;
  }

  /** An Admin bypasses ownership/membership checks, but only within their own organization. */
  private isSameOrgAdmin(project: ProjectDocument, actingUser: AuthenticatedUser): boolean {
    return (
      actingUser.role === Role.ADMIN &&
      extractId(project.organizationId) === requireOrgId(actingUser)
    );
  }

  private async assertActiveDevelopers(userIds: string[], organizationId: string): Promise<void> {
    const users = await this.usersRepository.findByIds(userIds, organizationId);
    if (users.length !== userIds.length) {
      throw new BadRequestException('One or more member ids do not exist');
    }
    const invalid = users.filter((u) => u.role !== Role.DEVELOPER || !u.isActive);
    if (invalid.length > 0) {
      throw new BadRequestException('Members must be active Developers');
    }
  }

  private async getActiveOrThrow(id: string): Promise<ProjectDocument> {
    const project = await this.projectsRepository.findByIdActive(id);
    if (!project) throw new NotFoundException('Project not found');
    return project;
  }

  private async invalidateDashboardCache(): Promise<void> {
    await this.cacheService.delByPattern(dashboardCachePattern());
  }

  private async toResponse(project: ProjectDocument): Promise<ProjectResponse> {
    const owner = project.owner as unknown as UserDocument;
    const ownerJson = typeof owner.toJSON === 'function' ? owner.toJSON() : owner;

    const members: ProjectMemberResponse[] = [
      { user: ownerJson, role: 'owner', joinedAt: project.createdAt, permissions: null },
      ...project.members.map((m) => {
        const userDoc = m.user as unknown as UserDocument;
        const userJson = typeof userDoc.toJSON === 'function' ? userDoc.toJSON() : userDoc;
        return {
          user: userJson,
          role: 'member' as const,
          joinedAt: m.joinedAt,
          permissions: resolveMemberPermissions(m),
        };
      }),
    ];

    const taskCount = await this.taskModel.countDocuments({
      project: project._id,
      deletedAt: null,
    });

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      status: project.status,
      owner: ownerJson,
      members,
      startDate: project.startDate,
      dueDate: project.dueDate,
      taskCount,
      key: project.key,
      components: project.components,
      customFields: project.customFields,
      automationRules: project.automationRules,
      issueTypes: resolveIssueTypes(project),
      permissionSchemeId: project.permissionSchemeId ? extractId(project.permissionSchemeId) : null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  }

  private assertValidDateRange(startDate: Date, dueDate: Date | null | undefined): void {
    if (dueDate && dueDate < startDate) {
      throw new BadRequestException('dueDate must be on or after startDate');
    }
  }
}
