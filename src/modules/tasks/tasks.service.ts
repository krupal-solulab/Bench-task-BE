import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { CacheService } from '../../redis/cache.service';
import { dashboardCachePattern } from '../../common/utils/cache-key.util';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { TaskStatus } from '../../common/enums/task-status.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { NotificationsService } from '../../notifications/notifications.service';
import { EventsGateway } from '../../events/events.gateway';
import { ProjectsService } from '../projects/projects.service';
import { ProjectDocument } from '../projects/schemas/project.schema';
import { TasksRepository } from './tasks.repository';
import { TaskDocument } from './schemas/task.schema';
import { TaskActivityAction } from './schemas/task-activity.schema';
import { isLegalTaskTransition, legalTaskTransitions } from './task-status.rules';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksDto } from './dto/list-tasks.dto';

@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    private readonly cacheService: CacheService,
    private readonly notificationsService: NotificationsService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async create(dto: CreateTaskDto, actingUser: AuthenticatedUser): Promise<TaskDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(dto.project);
    this.projectsService.assertUserCanManage(project, actingUser);

    if (project.status === ProjectStatus.COMPLETED) {
      throw new ConflictException('Cannot create tasks in a Completed project');
    }

    if (dto.assignee) {
      this.assertAssigneeEligible(project, dto.assignee);
    }

    const task = await this.tasksRepository.create({
      title: dto.title,
      description: dto.description ?? '',
      project: new Types.ObjectId(dto.project),
      assignee: dto.assignee ? new Types.ObjectId(dto.assignee) : null,
      priority: dto.priority,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      createdBy: new Types.ObjectId(actingUser.id),
      // Copied from the parent project (not actingUser) so a task's org always matches its
      // project's org, even in the platform-provisioned-admin edge case.
      organizationId: project.organizationId,
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

    return this.tasksRepository.findByIdActive(task.id) as Promise<TaskDocument>;
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
  ): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    this.projectsService.assertUserCanManage(project, actingUser);

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
    });

    for (const [action, from, to] of activities) {
      await this.tasksRepository.logActivity(id, actingUser.id, action, from, to);
    }
    await this.invalidateDashboardCache();
    return updated!;
  }

  async updateStatus(
    id: string,
    status: TaskStatus,
    actingUser: AuthenticatedUser,
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

    if (!isManagerOrAdmin && !isAssignedDeveloper) {
      throw new ForbiddenException('You cannot change the status of this task');
    }

    if (task.status === status) return task;

    if (!isLegalTaskTransition(task.status, status)) {
      throw new ConflictException(
        `Cannot transition from ${task.status} to ${status}. Allowed: ${legalTaskTransitions(task.status).join(', ') || 'none'}`,
      );
    }

    const update: Partial<{ status: TaskStatus; completedAt: Date | null }> = { status };
    if (status === TaskStatus.DONE) update.completedAt = new Date();
    else if (task.status === TaskStatus.DONE) update.completedAt = null;

    const updated = await this.tasksRepository.updateById(id, update);
    await this.tasksRepository.logActivity(
      id,
      actingUser.id,
      TaskActivityAction.STATUS_CHANGED,
      task.status,
      status,
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

    return updated!;
  }

  async updateAssignee(
    id: string,
    assignee: string | null,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    this.projectsService.assertUserCanManage(project, actingUser);

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

  async softDelete(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const task = await this.getActiveOrThrow(id);
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    this.projectsService.assertUserCanManage(project, actingUser);

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

  private isOwner(project: ProjectDocument, userId: string): boolean {
    return extractId(project.owner) === userId;
  }

  private assertAssigneeEligible(project: ProjectDocument, assignee: string): void {
    if (!this.projectsService.isProjectMember(project, assignee)) {
      throw new BadRequestException('Assignee must be the project owner or a member');
    }
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
}
