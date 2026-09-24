import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TasksRepository } from '../tasks/tasks.repository';
import { TaskDocument } from '../tasks/schemas/task.schema';
import { ProjectsService } from '../projects/projects.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { WorkLogsRepository } from './worklogs.repository';
import { WorkLogDocument } from './schemas/work-log.schema';
import { CreateWorkLogDto } from './dto/create-work-log.dto';
import { UpdateWorkLogDto } from './dto/update-work-log.dto';
import { ListWorkLogsDto } from './dto/list-work-logs.dto';
import { WorkLogReportQueryDto } from './dto/work-log-report-query.dto';

export interface WorkLogSummary {
  taskId: string;
  originalEstimateHours: number | null;
  totalLoggedHours: number;
  remainingHours: number | null;
  varianceHours: number | null;
}

export interface WorkLogUserReportEntry {
  userId: string;
  userName: string;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
  entryCount: number;
}

export interface WorkLogReport {
  entries: WorkLogUserReportEntry[];
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
}

@Injectable()
export class WorkLogsService {
  constructor(
    private readonly worklogsRepository: WorkLogsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async create(
    taskId: string,
    dto: CreateWorkLogDto,
    actingUser: AuthenticatedUser,
  ): Promise<WorkLogDocument> {
    const task = await this.assertTaskMember(taskId, actingUser);
    const log = await this.worklogsRepository.create({
      task: new Types.ObjectId(taskId),
      project: task.project as Types.ObjectId,
      user: new Types.ObjectId(actingUser.id),
      hours: dto.hours,
      description: dto.description ?? '',
      workDate: new Date(dto.workDate),
      billable: dto.billable ?? true,
      organizationId: task.organizationId as Types.ObjectId,
    });
    return (await this.worklogsRepository.findByIdActive(log.id))!;
  }

  async paginateForTask(
    taskId: string,
    query: { page: number; limit: number; sortOrder: 'asc' | 'desc' },
    actingUser: AuthenticatedUser,
  ) {
    await this.assertTaskMember(taskId, actingUser);
    const { data, total } = await this.worklogsRepository.paginateForTask(
      taskId,
      query.page,
      query.limit,
      query.sortOrder,
    );
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  /** Estimate-vs-actual for a single task (BRD: "estimate-vs-actual reporting"). */
  async summaryForTask(taskId: string, actingUser: AuthenticatedUser): Promise<WorkLogSummary> {
    const task = await this.assertTaskMember(taskId, actingUser);
    const totalLoggedHours = await this.worklogsRepository.totalHoursForTask(taskId);
    const originalEstimateHours = task.originalEstimateHours;

    return {
      taskId,
      originalEstimateHours,
      totalLoggedHours,
      remainingHours:
        originalEstimateHours != null
          ? Math.max(0, originalEstimateHours - totalLoggedHours)
          : null,
      varianceHours:
        originalEstimateHours != null ? totalLoggedHours - originalEstimateHours : null,
    };
  }

  async update(
    id: string,
    dto: UpdateWorkLogDto,
    actingUser: AuthenticatedUser,
  ): Promise<WorkLogDocument> {
    const log = await this.getActiveOrThrow(id);
    await this.assertCanModify(log, actingUser);
    return (await this.worklogsRepository.updateById(id, {
      ...(dto.hours !== undefined ? { hours: dto.hours } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.workDate !== undefined ? { workDate: new Date(dto.workDate) } : {}),
      ...(dto.billable !== undefined ? { billable: dto.billable } : {}),
    }))!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const log = await this.getActiveOrThrow(id);
    await this.assertCanModify(log, actingUser);
    await this.worklogsRepository.softDelete(id);
  }

  /** The raw, filterable project-wide timesheet view. */
  async paginateForProject(
    projectId: string,
    query: ListWorkLogsDto,
    actingUser: AuthenticatedUser,
  ) {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const filter = this.worklogsRepository.buildProjectFilter(projectId, query);
    const { data, total } = await this.worklogsRepository.paginateForProject(
      filter,
      query.page,
      query.limit,
      query.sortOrder,
    );
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  /** The aggregated per-user timesheet report (BRD: "timesheets"). */
  async reportForProject(
    projectId: string,
    query: WorkLogReportQueryDto,
    actingUser: AuthenticatedUser,
  ): Promise<WorkLogReport> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const filter = this.worklogsRepository.buildProjectFilter(projectId, query);
    const rows = await this.worklogsRepository.totalsByUser(filter);
    if (rows.length === 0) {
      return { entries: [], totalHours: 0, billableHours: 0, nonBillableHours: 0 };
    }

    const users = await this.userModel
      .find({ _id: { $in: rows.map((r) => r._id) } })
      .select('name')
      .exec();
    const nameById = new Map(users.map((u) => [u.id, u.name]));

    const entries: WorkLogUserReportEntry[] = rows.map((row) => ({
      userId: row._id.toString(),
      userName: nameById.get(row._id.toString()) ?? 'Unknown user',
      totalHours: row.totalHours,
      billableHours: row.billableHours,
      nonBillableHours: row.nonBillableHours,
      entryCount: row.entryCount,
    }));

    return {
      entries,
      totalHours: entries.reduce((sum, e) => sum + e.totalHours, 0),
      billableHours: entries.reduce((sum, e) => sum + e.billableHours, 0),
      nonBillableHours: entries.reduce((sum, e) => sum + e.nonBillableHours, 0),
    };
  }

  private async assertCanModify(
    log: WorkLogDocument,
    actingUser: AuthenticatedUser,
  ): Promise<void> {
    if (extractId(log.user) === actingUser.id) return;
    // Same-org-Admin bypass only - mirrors CommentsService.assertCanModify's exact reasoning.
    if (
      actingUser.role === Role.ADMIN &&
      extractId(log.organizationId) === requireOrgId(actingUser)
    ) {
      return;
    }
    throw new ForbiddenException('You can only modify your own work logs');
  }

  /** Mirrors CommentsService.assertTaskMember: same-org-Admin bypass, otherwise the caller must
   * be a member of the task's project. */
  private async assertTaskMember(
    taskId: string,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    const task = await this.tasksRepository.findRawById(taskId);
    if (!task) throw new NotFoundException('Task not found');
    if (
      actingUser.role === Role.ADMIN &&
      extractId(task.organizationId) === requireOrgId(actingUser)
    ) {
      return task;
    }
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    if (!this.projectsService.isProjectMember(project, actingUser.id)) {
      throw new ForbiddenException('You must be a member of this project to log work');
    }
    return task;
  }

  private async getActiveOrThrow(id: string): Promise<WorkLogDocument> {
    const log = await this.worklogsRepository.findByIdActive(id);
    if (!log) throw new NotFoundException('Work log not found');
    return log;
  }
}
