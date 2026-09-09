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
import { Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { TaskStatus } from '../../common/enums/task-status.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UsersRepository } from '../users/users.repository';
import { UserDocument } from '../users/schemas/user.schema';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { Comment, CommentDocument } from '../comments/schemas/comment.schema';
import { ListTasksDto } from '../tasks/dto/list-tasks.dto';
import { buildTaskListFilter } from '../tasks/utils/task-filter.util';
import { ProjectsRepository } from './projects.repository';
import { ProjectDocument } from './schemas/project.schema';
import { ProjectActivityAction } from './schemas/project-activity.schema';
import { isLegalProjectTransition, legalProjectTransitions } from './project-status.rules';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';

interface ProjectMemberResponse {
  user: unknown;
  role: 'owner' | 'member';
  joinedAt: Date;
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
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly cacheService: CacheService,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Comment.name) private readonly commentModel: Model<CommentDocument>,
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

    const doc = await this.projectsRepository.create({
      name: dto.name,
      description: dto.description ?? '',
      owner: new Types.ObjectId(ownerId) as unknown as Types.ObjectId,
      startDate,
      dueDate,
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

    const updated = await this.projectsRepository.updateById(id, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.startDate ? { startDate: nextStartDate } : {}),
      ...(dto.dueDate ? { dueDate: nextDueDate } : {}),
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
        status: { $ne: TaskStatus.DONE },
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
        status: { $ne: TaskStatus.DONE },
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

    const [data, total] = await Promise.all([
      this.taskModel
        .find(filter)
        .populate('assignee', 'name email role isActive')
        .populate('createdBy', 'name email role isActive')
        .sort({ [query.sortBy]: sortOrder })
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
            { $match: { dueDate: { $lt: new Date() }, status: { $ne: TaskStatus.DONE } } },
            { $count: 'count' },
          ],
          done: [{ $match: { status: TaskStatus.DONE } }, { $count: 'count' }],
        },
      },
    ]);

    const totalTasks = facetResult.total[0]?.count ?? 0;
    const doneCount = facetResult.done[0]?.count ?? 0;
    const overdueCount = facetResult.overdue[0]?.count ?? 0;

    const tasksByStatus = Object.fromEntries(
      Object.values(TaskStatus).map((s) => [
        s,
        facetResult.byStatus.find((b: { _id: string }) => b._id === s)?.count ?? 0,
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

  assertUserCanView(project: ProjectDocument, actingUser: AuthenticatedUser): void {
    this.assertCanView(project, actingUser);
  }

  assertUserCanManage(project: ProjectDocument, actingUser: AuthenticatedUser): void {
    this.assertCanManage(project, actingUser);
  }

  isProjectMember(project: ProjectDocument, userId: string): boolean {
    return this.projectsRepository.isMember(project, userId);
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
    if (this.isSameOrgAdmin(project, actingUser)) return;
    const ownerId = extractId(project.owner);
    if (actingUser.role === Role.MANAGER && ownerId === actingUser.id) return;
    throw new ForbiddenException('You do not have permission to manage this project');
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
      { user: ownerJson, role: 'owner', joinedAt: project.createdAt },
      ...project.members.map((m) => {
        const userDoc = m.user as unknown as UserDocument;
        const userJson = typeof userDoc.toJSON === 'function' ? userDoc.toJSON() : userDoc;
        return { user: userJson, role: 'member' as const, joinedAt: m.joinedAt };
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
