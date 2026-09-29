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
import { SprintsRepository } from '../sprints/sprints.repository';
import { User, UserDocument } from '../users/schemas/user.schema';
import { buildCsv } from '../import-export/csv.util';
import { WorkLogsRepository } from './worklogs.repository';
import { WorkLogDocument } from './schemas/work-log.schema';
import { CreateWorkLogDto } from './dto/create-work-log.dto';
import { UpdateWorkLogDto } from './dto/update-work-log.dto';
import { ListWorkLogsDto } from './dto/list-work-logs.dto';
import { WorkLogReportQueryDto } from './dto/work-log-report-query.dto';
import { MyTimesheetQueryDto } from './dto/my-timesheet-query.dto';
import {
  bucketTimesheetEntries,
  TimesheetBucket,
  TimesheetBucketEntry,
} from './utils/timesheet-bucket.util';

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
  /** The project-wide estimate-vs-actual rollup (BRD gap-closure) - the sum of every non-deleted
   * task's `originalEstimateHours`, independent of this report's own date-range filter, since an
   * estimate isn't a dated event the way a logged hour is. */
  totalEstimateHours: number;
}

export interface WorkLogSprintTaskEntry {
  taskId: string;
  issueKey: string | null;
  title: string;
  originalEstimateHours: number | null;
  loggedHours: number;
}

export interface WorkLogSprintReport {
  sprintId: string;
  sprintName: string;
  totalEstimateHours: number;
  totalLoggedHours: number;
  tasks: WorkLogSprintTaskEntry[];
}

export interface WorkLogCorrelationEntry {
  taskId: string;
  issueKey: string | null;
  title: string;
  storyPoints: number | null;
  loggedHours: number;
}

export interface WorkLogCorrelationReport {
  entries: WorkLogCorrelationEntry[];
}

export interface CsvExportResult {
  filename: string;
  csv: string;
}

export interface MyTimesheetReport {
  groupBy: 'week' | 'month';
  buckets: TimesheetBucket[];
}

@Injectable()
export class WorkLogsService {
  constructor(
    private readonly worklogsRepository: WorkLogsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    private readonly sprintsRepository: SprintsRepository,
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
    const [rows, totalEstimateHours] = await Promise.all([
      this.worklogsRepository.totalsByUser(filter),
      this.tasksRepository.sumEstimateHoursForProject(projectId),
    ]);
    if (rows.length === 0) {
      return {
        entries: [],
        totalHours: 0,
        billableHours: 0,
        nonBillableHours: 0,
        totalEstimateHours,
      };
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
      totalEstimateHours,
    };
  }

  /** Sprint-level time-spent-vs-estimate (BRD gap-closure: the "sprint" level of the report the
   * BRD asks for at issue/sprint/project - previously only issue and project levels existed). */
  async reportForSprint(
    projectId: string,
    sprintId: string,
    actingUser: AuthenticatedUser,
  ): Promise<WorkLogSprintReport> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const sprint = await this.sprintsRepository.findByIdActiveInProject(sprintId, projectId);
    if (!sprint) throw new NotFoundException('Sprint not found');

    const tasks = await this.tasksRepository.findBySprintRaw(sprintId);
    const totals = await this.worklogsRepository.totalsByTask(tasks.map((t) => t.id));
    const hoursByTask = new Map(totals.map((row) => [row._id.toString(), row.totalHours]));

    const taskEntries: WorkLogSprintTaskEntry[] = tasks.map((t) => ({
      taskId: t.id,
      issueKey: t.issueKey,
      title: t.title,
      originalEstimateHours: t.originalEstimateHours,
      loggedHours: hoursByTask.get(t.id) ?? 0,
    }));

    return {
      sprintId,
      sprintName: sprint.name,
      totalEstimateHours: taskEntries.reduce((sum, t) => sum + (t.originalEstimateHours ?? 0), 0),
      totalLoggedHours: taskEntries.reduce((sum, t) => sum + t.loggedHours, 0),
      tasks: taskEntries,
    };
  }

  /** Story-point-to-time correlation (BRD gap-closure) - every story-pointed task in the project
   * with at least one logged hour, for a scatter of storyPoints against actual hours spent. Not
   * date-scoped: an estimate/story-point isn't a dated event the way a logged hour is. */
  async correlationForProject(
    projectId: string,
    actingUser: AuthenticatedUser,
  ): Promise<WorkLogCorrelationReport> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);

    const tasks = await this.tasksRepository.findWithStoryPointsForProject(projectId);
    const totals = await this.worklogsRepository.totalsByTask(tasks.map((t) => t.id));
    const hoursByTask = new Map(totals.map((row) => [row._id.toString(), row.totalHours]));

    const entries: WorkLogCorrelationEntry[] = tasks
      .map((t) => ({
        taskId: t.id,
        issueKey: t.issueKey,
        title: t.title,
        storyPoints: t.storyPoints,
        loggedHours: hoursByTask.get(t.id) ?? 0,
      }))
      .filter((e) => e.loggedHours > 0);

    return { entries };
  }

  /** Module 5's CSV shape (`{filename, csv}`, built client-side into a download - see
   * ImportExportService's own doc comment for why this codebase never returns a raw text/csv
   * response), reused here for the timesheet's CSV export gap. */
  async exportProjectCsv(
    projectId: string,
    query: WorkLogReportQueryDto,
    actingUser: AuthenticatedUser,
  ): Promise<CsvExportResult> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const filter = this.worklogsRepository.buildProjectFilter(projectId, query);
    const logs = await this.worklogsRepository.findAllForProject(filter);

    const rows: string[][] = [
      ['User', 'Task', 'Hours', 'Billable', 'Work Date', 'Description'],
      ...logs.map((log) => {
        const user = log.user as unknown as { name?: string } | null;
        const task = log.task as unknown as { title?: string; issueKey?: string | null } | null;
        return [
          user?.name ?? '',
          task?.issueKey ?? task?.title ?? '',
          String(log.hours),
          log.billable ? 'Yes' : 'No',
          log.workDate.toISOString().slice(0, 10),
          log.description,
        ];
      }),
    ];

    const datePart = new Date().toISOString().slice(0, 10);
    return {
      filename: `${project.key ?? project.name}-timesheet-${datePart}.csv`,
      csv: buildCsv(rows),
    };
  }

  /** Personal cross-project timesheet (BRD gap-closure) - every work log the caller logged
   * themselves, across every project in their org, bucketed by week or month. */
  async myTimesheet(
    actingUser: AuthenticatedUser,
    query: MyTimesheetQueryDto,
  ): Promise<MyTimesheetReport> {
    const logs = await this.worklogsRepository.findForUser(
      actingUser.id,
      requireOrgId(actingUser),
      query.from,
      query.to,
    );

    const entries: TimesheetBucketEntry[] = logs.map((log) => {
      const task = log.task as unknown as { title?: string; issueKey?: string | null } | null;
      const project = log.project as unknown as { name?: string } | null;
      return {
        id: log.id,
        taskId: extractId(log.task),
        issueKey: task?.issueKey ?? null,
        taskTitle: task?.title ?? '',
        projectId: extractId(log.project),
        projectName: project?.name ?? '',
        hours: log.hours,
        workDate: log.workDate.toISOString(),
        billable: log.billable,
        description: log.description,
      };
    });

    return {
      groupBy: query.groupBy,
      buckets: bucketTimesheetEntries(entries, query.groupBy),
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
