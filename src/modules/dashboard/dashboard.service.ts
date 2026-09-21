import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { AppConfig } from '../../config/configuration';
import { CacheService } from '../../redis/cache.service';
import { buildDashboardCacheKey } from '../../common/utils/cache-key.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { TaskPriority } from '../../common/enums/task-priority.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { extractId } from '../../common/utils/mongo.util';
import { SprintStatus } from '../../common/enums/sprint-status.enum';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { DEFAULT_WORKFLOW, resolveWorkflow } from '../projects/schemas/workflow.schema';
import {
  DEFAULT_SLA_POLICY,
  isBreached,
  resolutionHoursOf,
  resolveSlaPolicy,
} from '../projects/schemas/sla-policy.schema';
import { ProjectsService } from '../projects/projects.service';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { Sprint, SprintDocument } from '../sprints/schemas/sprint.schema';
import { computeBurndown } from '../sprints/sprint-reports.util';
import { User, UserDocument } from '../users/schemas/user.schema';
import { DeveloperWorkloadQueryDto } from './dto/dashboard-scope.dto';
import { PutDashboardPreferenceDto } from './dto/put-dashboard-preference.dto';
import {
  DashboardPreference,
  DashboardPreferenceDocument,
} from './schemas/dashboard-preference.schema';

interface CachedResult<T> {
  data: T;
  hit: boolean;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly cacheService: CacheService,
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Sprint.name) private readonly sprintModel: Model<SprintDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(DashboardPreference.name)
    private readonly dashboardPreferenceModel: Model<DashboardPreferenceDocument>,
  ) {}

  /** Layout metadata, not the expensive aggregations elsewhere in this service - a direct read of
   * a single tiny per-user document, so this isn't cached like everything else here. */
  async getPreferences(
    actingUser: AuthenticatedUser,
  ): Promise<{ hiddenWidgets: string[]; widgetOrder: string[] }> {
    const preference = await this.dashboardPreferenceModel
      .findOne({ owner: new Types.ObjectId(actingUser.id) })
      .exec();
    return {
      hiddenWidgets: preference?.hiddenWidgets ?? [],
      widgetOrder: preference?.widgetOrder ?? [],
    };
  }

  async updatePreferences(
    dto: PutDashboardPreferenceDto,
    actingUser: AuthenticatedUser,
  ): Promise<{ hiddenWidgets: string[]; widgetOrder: string[] }> {
    const updated = await this.dashboardPreferenceModel
      .findOneAndUpdate(
        { owner: new Types.ObjectId(actingUser.id) },
        {
          owner: new Types.ObjectId(actingUser.id),
          organizationId: new Types.ObjectId(requireOrgId(actingUser)),
          hiddenWidgets: dto.hiddenWidgets,
          widgetOrder: dto.widgetOrder,
        },
        { upsert: true, new: true },
      )
      .exec();
    return { hiddenWidgets: updated.hiddenWidgets, widgetOrder: updated.widgetOrder };
  }

  async summary(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached('summary', actingUser, { projectId }, this.ttlDashboard(), async () => {
      const { projectFilter, taskFilter } = await this.resolveScope(actingUser, projectId);

      const [totalProjects, projectStatusRows, taskFacet] = await Promise.all([
        this.projectModel.countDocuments(projectFilter),
        this.projectModel.aggregate([
          { $match: projectFilter },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
        this.taskModel.aggregate([
          { $match: taskFilter },
          {
            $facet: {
              total: [{ $count: 'count' }],
              done: [{ $match: { statusCategory: StatusCategory.DONE } }, { $count: 'count' }],
              overdue: [
                {
                  $match: {
                    dueDate: { $lt: new Date() },
                    statusCategory: { $ne: StatusCategory.DONE },
                  },
                },
                { $count: 'count' },
              ],
            },
          },
        ]),
      ]);

      const totalTasks = taskFacet[0].total[0]?.count ?? 0;
      const completedTasks = taskFacet[0].done[0]?.count ?? 0;

      return {
        totalProjects,
        projectsByStatus: this.zeroFillProjectStatus(projectStatusRows),
        totalTasks,
        openTasks: totalTasks - completedTasks,
        completedTasks,
        overdueCount: taskFacet[0].overdue[0]?.count ?? 0,
        completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      };
    });
  }

  async projectsByStatus(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'projects-by-status',
      actingUser,
      { projectId },
      this.ttlDashboard(),
      async () => {
        const { projectFilter } = await this.resolveScope(actingUser, projectId);
        const rows = await this.projectModel.aggregate([
          { $match: projectFilter },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]);
        const filled = this.zeroFillProjectStatus(rows);
        return Object.entries(filled).map(([status, count]) => ({ status, count }));
      },
    );
  }

  async tasksStatus(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached('tasks-status', actingUser, { projectId }, this.ttlDashboard(), async () => {
      const { taskFilter } = await this.resolveScope(actingUser, projectId);
      const rows: { _id: string; count: number }[] = await this.taskModel.aggregate([
        { $match: taskFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);

      // Scoped to one project: zero-fill from that project's actual workflow (custom, or the
      // system default), so its real status names always show up. Org-wide: zero-fill from the
      // system default's 4 names, unioned with any other status names actually in use - an org
      // that never touches custom workflows sees identical output to today, and any project's
      // custom statuses simply appear additionally when used.
      let statusDefs: { name: string; category: StatusCategory }[];
      if (projectId) {
        const project = await this.projectModel.findById(projectId).select('workflow').exec();
        statusDefs = resolveWorkflow(project ?? {}).statuses;
      } else {
        const known = new Set(DEFAULT_WORKFLOW.statuses.map((s) => s.name));
        const extra = rows
          .filter((r) => !known.has(r._id))
          .map((r) => ({ name: r._id, category: StatusCategory.IN_PROGRESS }) as const);
        statusDefs = [...DEFAULT_WORKFLOW.statuses, ...extra];
      }

      return statusDefs.map(({ name, category }) => ({
        status: name,
        category,
        count: rows.find((r) => r._id === name)?.count ?? 0,
      }));
    });
  }

  async tasksByPriority(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'tasks-by-priority',
      actingUser,
      { projectId },
      this.ttlDashboard(),
      async () => {
        const { taskFilter } = await this.resolveScope(actingUser, projectId);
        const rows = await this.taskModel.aggregate([
          { $match: taskFilter },
          { $group: { _id: '$priority', count: { $sum: 1 } } },
        ]);
        return Object.values(TaskPriority).map((priority) => ({
          priority,
          count: rows.find((r: { _id: string }) => r._id === priority)?.count ?? 0,
        }));
      },
    );
  }

  async developerWorkload(query: DeveloperWorkloadQueryDto, actingUser: AuthenticatedUser) {
    return this.cached(
      'developer-workload',
      actingUser,
      { projectId: query.projectId, sortBy: query.sortBy },
      this.ttlDashboard(),
      async () => {
        const { taskFilter } = await this.resolveScope(actingUser, query.projectId);
        const rows = await this.taskModel.aggregate([
          { $match: { ...taskFilter, assignee: { $ne: null } } },
          {
            $group: {
              _id: '$assignee',
              total: { $sum: 1 },
              completed: {
                $sum: { $cond: [{ $eq: ['$statusCategory', StatusCategory.DONE] }, 1, 0] },
              },
            },
          },
          {
            $lookup: {
              from: this.userModel.collection.name,
              localField: '_id',
              foreignField: '_id',
              as: 'user',
            },
          },
          { $unwind: '$user' },
          {
            $project: {
              _id: 0,
              userId: { $toString: '$_id' },
              name: '$user.name',
              totalAssigned: '$total',
              completed: 1,
              completionRate: {
                $cond: [
                  { $eq: ['$total', 0] },
                  0,
                  { $round: [{ $multiply: [{ $divide: ['$completed', '$total'] }, 100] }, 0] },
                ],
              },
            },
          },
        ]);

        const sorted = [...rows].sort((a, b) => {
          if (query.sortBy === 'name') return a.name.localeCompare(b.name);
          if (query.sortBy === 'completionRate') return b.completionRate - a.completionRate;
          return b.totalAssigned - a.totalAssigned;
        });
        return sorted;
      },
    );
  }

  async overdueSummary(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'overdue-summary',
      actingUser,
      { projectId },
      this.ttlDashboard(),
      async () => {
        const { taskFilter } = await this.resolveScope(actingUser, projectId);
        const tasks = await this.taskModel
          .find({
            ...taskFilter,
            dueDate: { $lt: new Date() },
            statusCategory: { $ne: StatusCategory.DONE },
          })
          .populate('project', 'name')
          .populate('assignee', 'name')
          .sort({ dueDate: 1 })
          .limit(100)
          .exec();

        return tasks.map((task) => {
          const project = task.project as unknown as { id: string; name: string };
          const assignee = task.assignee as unknown as { id: string; name: string } | null;
          return {
            id: task.id,
            title: task.title,
            project: { id: project.id, name: project.name },
            assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
            dueDate: task.dueDate,
            priority: task.priority,
          };
        });
      },
    );
  }

  async taskTrend(days: number, projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached('task-trend', actingUser, { days, projectId }, this.ttlTrend(), async () => {
      const { taskFilter } = await this.resolveScope(actingUser, projectId);
      const since = new Date();
      since.setDate(since.getDate() - days);

      const [createdRows, completedRows] = await Promise.all([
        this.taskModel.aggregate([
          { $match: { ...taskFilter, createdAt: { $gte: since } } },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              count: { $sum: 1 },
            },
          },
        ]),
        this.taskModel.aggregate([
          {
            $match: {
              ...taskFilter,
              statusCategory: StatusCategory.DONE,
              completedAt: { $gte: since, $ne: null },
            },
          },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
              count: { $sum: 1 },
            },
          },
        ]),
      ]);

      const points: { date: string; created: number; completed: number }[] = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        points.push({
          date: key,
          created: createdRows.find((r: { _id: string }) => r._id === key)?.count ?? 0,
          completed: completedRows.find((r: { _id: string }) => r._id === key)?.count ?? 0,
        });
      }
      return points;
    });
  }

  /**
   * SLA compliance and average resolution time per priority (Search/Dashboards v2), for
   * accessible, non-deleted tasks created in the last 90 days - a pragmatic bound, since a
   * dashboard is a recent-activity view rather than a full historical scan. Computed via a
   * bounded in-memory reduction rather than a single `$group` pipeline: each task's SLA target
   * depends on *its own project's* resolved policy, which a plain aggregation can't apply
   * per-document without an unnecessary `$lookup`+`$expr` join for what is, at dashboard scale,
   * a small dataset.
   */
  async slaCompliance(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'sla-compliance',
      actingUser,
      { projectId },
      this.ttlDashboard(),
      async () => {
        const { taskFilter } = await this.resolveScope(actingUser, projectId);
        const since = new Date();
        since.setDate(since.getDate() - 90);

        const tasks = await this.taskModel
          .find(
            { ...taskFilter, createdAt: { $gte: since } },
            { priority: 1, project: 1, createdAt: 1, completedAt: 1 },
          )
          .lean();

        const projectIds = [...new Set(tasks.map((t) => extractId(t.project)))].map(
          (id) => new Types.ObjectId(id),
        );
        const projects = await this.projectModel
          .find({ _id: { $in: projectIds } }, { slaPolicy: 1 })
          .lean();
        const policyByProject = new Map(
          projects.map((p) => [p._id.toString(), resolveSlaPolicy(p)]),
        );

        const now = new Date();
        const byPriority = new Map(
          Object.values(TaskPriority).map((priority) => [
            priority,
            { total: 0, compliant: 0, breached: 0, resolutionHoursSum: 0, resolutionHoursCount: 0 },
          ]),
        );

        for (const task of tasks) {
          const policy = policyByProject.get(extractId(task.project)) ?? DEFAULT_SLA_POLICY;
          const snapshot = {
            priority: task.priority,
            createdAt: task.createdAt,
            completedAt: task.completedAt,
          };
          const row = byPriority.get(task.priority)!;
          row.total += 1;
          if (isBreached(snapshot, policy, now)) row.breached += 1;
          else row.compliant += 1;
          const hours = resolutionHoursOf(snapshot);
          if (hours != null) {
            row.resolutionHoursSum += hours;
            row.resolutionHoursCount += 1;
          }
        }

        return Object.values(TaskPriority).map((priority) => {
          const row = byPriority.get(priority)!;
          return {
            priority,
            total: row.total,
            compliant: row.compliant,
            breached: row.breached,
            avgResolutionHours:
              row.resolutionHoursCount > 0
                ? Math.round(row.resolutionHoursSum / row.resolutionHoursCount)
                : null,
          };
        });
      },
    );
  }

  /** Story points (or issue count, when no task in range has story points) completed per rolling
   * 7-day window over the last 8 windows, across accessible projects - mirrors taskTrend's own
   * day-bucket aggregation + JS zero-fill, just re-bucketed into weeks. */
  async velocityTrend(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'velocity-trend',
      actingUser,
      { projectId },
      this.ttlDashboard(),
      async () => {
        const { taskFilter } = await this.resolveScope(actingUser, projectId);
        const WEEKS = 8;
        const since = new Date();
        since.setDate(since.getDate() - WEEKS * 7);

        const dayRows: { _id: string; points: number; count: number }[] =
          await this.taskModel.aggregate([
            {
              $match: {
                ...taskFilter,
                statusCategory: StatusCategory.DONE,
                completedAt: { $gte: since, $ne: null },
              },
            },
            {
              $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$completedAt' } },
                points: { $sum: { $ifNull: ['$storyPoints', 0] } },
                count: { $sum: 1 },
              },
            },
          ]);
        const byDay = new Map(dayRows.map((r) => [r._id, r]));

        const points: { weekStart: string; completedPoints: number; completedCount: number }[] = [];
        for (let w = WEEKS - 1; w >= 0; w--) {
          const bucketEnd = new Date();
          bucketEnd.setDate(bucketEnd.getDate() - w * 7);
          const bucketStart = new Date(bucketEnd);
          bucketStart.setDate(bucketStart.getDate() - 6);

          let completedPoints = 0;
          let completedCount = 0;
          for (let d = 0; d < 7; d++) {
            const day = new Date(bucketStart);
            day.setDate(day.getDate() + d);
            const row = byDay.get(day.toISOString().slice(0, 10));
            completedPoints += row?.points ?? 0;
            completedCount += row?.count ?? 0;
          }
          points.push({
            weekStart: bucketStart.toISOString().slice(0, 10),
            completedPoints,
            completedCount,
          });
        }

        return { points, hasStoryPoints: points.some((p) => p.completedPoints > 0) };
      },
    );
  }

  /**
   * "Burndown" at dashboard scope, reframed as a list of currently-Active sprints ordered
   * "most behind schedule first" (Search/Dashboards v2) - an overlaid multi-sprint burndown line
   * doesn't mean anything across projects with different sprint date ranges. Reuses the existing,
   * already-tested `computeBurndown` pure function directly, taking each sprint's final (today's)
   * point rather than the whole day-by-day series.
   */
  async activeSprintsHealth(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'active-sprints-health',
      actingUser,
      { projectId },
      this.ttlDashboard(),
      async () => {
        const { projectFilter } = await this.resolveScope(actingUser, projectId);
        const accessibleProjectIds = (
          await this.projectModel.find(projectFilter, { _id: 1 }).lean()
        ).map((p) => p._id);

        const sprints = await this.sprintModel
          .find({
            project: { $in: accessibleProjectIds },
            status: SprintStatus.ACTIVE,
            deletedAt: null,
          })
          .populate('project', 'name')
          .exec();
        if (sprints.length === 0) return [];

        const now = new Date();
        const MS_PER_DAY = 24 * 60 * 60 * 1000;

        const rows = await Promise.all(
          sprints.map(async (sprint) => {
            const tasks = await this.taskModel
              .find({ sprint: sprint._id, deletedAt: null }, { storyPoints: 1, completedAt: 1 })
              .lean();
            const { points, hasStoryPoints } = computeBurndown(
              tasks,
              sprint.startedAt!,
              sprint.endDate,
              null,
              now,
            );
            const last = points[points.length - 1]!;

            const totalDays = Math.max(
              1,
              Math.round((sprint.endDate.getTime() - sprint.startedAt!.getTime()) / MS_PER_DAY),
            );
            const daysElapsed = Math.min(
              totalDays,
              Math.max(0, Math.round((now.getTime() - sprint.startedAt!.getTime()) / MS_PER_DAY)),
            );
            const percentTimeElapsed = Math.round((daysElapsed / totalDays) * 100);

            const totalWork = hasStoryPoints
              ? tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0)
              : tasks.length;
            const remaining = hasStoryPoints ? last.remainingPoints : last.remainingCount;
            const percentWorkRemaining =
              totalWork > 0 ? Math.round((remaining / totalWork) * 100) : 0;

            const project = sprint.project as unknown as { id: string; name: string };
            return {
              sprintId: sprint.id,
              sprintName: sprint.name,
              projectId: project.id,
              projectName: project.name,
              percentTimeElapsed,
              percentWorkRemaining,
              remainingPoints: last.remainingPoints,
              remainingCount: last.remainingCount,
              hasStoryPoints,
            };
          }),
        );

        // Most behind schedule first: work remaining outpacing time remaining by the widest margin.
        return rows.sort(
          (a, b) =>
            b.percentWorkRemaining -
            (100 - b.percentTimeElapsed) -
            (a.percentWorkRemaining - (100 - a.percentTimeElapsed)),
        );
      },
    );
  }

  /** BRD 7's "My Open Issues" widget - the caller's own assigned, not-yet-Done tasks, soonest due
   * first (nulls last) - unlike every other widget here, this always scopes to the caller
   * regardless of role (`resolveScope` only auto-scopes Developers), since "my issues" is
   * inherently personal for an Admin/Manager too. */
  async myOpenIssues(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'my-open-issues',
      actingUser,
      { projectId },
      this.ttlDashboard(),
      async () => {
        const { taskFilter } = await this.resolveScope(actingUser, projectId);
        const tasks = await this.taskModel
          .find({
            ...taskFilter,
            assignee: new Types.ObjectId(actingUser.id),
            statusCategory: { $ne: StatusCategory.DONE },
          })
          .populate('project', 'name')
          .sort({ dueDate: 1 })
          .limit(100)
          .exec();

        return tasks.map((task) => {
          const project = task.project as unknown as { id: string; name: string };
          return {
            id: task.id,
            title: task.title,
            issueKey: task.issueKey,
            project: { id: project.id, name: project.name },
            status: task.status,
            dueDate: task.dueDate,
            priority: task.priority,
          };
        });
      },
    );
  }

  /** BRD 7's resolution-time-trend widget: average hours-to-resolve per priority, bucketed into
   * rolling 7-day windows over the last 8 weeks - mirrors velocityTrend's own week-bucketing, just
   * grouped by priority instead of summed into one series. */
  async resolutionTimeTrend(projectId: string | undefined, actingUser: AuthenticatedUser) {
    return this.cached(
      'resolution-time-trend',
      actingUser,
      { projectId },
      this.ttlTrend(),
      async () => {
        const { taskFilter } = await this.resolveScope(actingUser, projectId);
        const WEEKS = 8;
        const since = new Date();
        since.setDate(since.getDate() - WEEKS * 7);

        const tasks = await this.taskModel
          .find(
            {
              ...taskFilter,
              statusCategory: StatusCategory.DONE,
              completedAt: { $gte: since, $ne: null },
            },
            { priority: 1, createdAt: 1, completedAt: 1 },
          )
          .lean();

        const points: {
          weekStart: string;
          avgResolutionHoursByPriority: Record<string, number | null>;
        }[] = [];
        for (let w = WEEKS - 1; w >= 0; w--) {
          const bucketEnd = new Date();
          bucketEnd.setDate(bucketEnd.getDate() - w * 7);
          const bucketStart = new Date(bucketEnd);
          bucketStart.setDate(bucketStart.getDate() - 6);

          const sums = new Map(Object.values(TaskPriority).map((p) => [p, { sum: 0, count: 0 }]));
          for (const task of tasks) {
            if (
              !task.completedAt ||
              task.completedAt < bucketStart ||
              task.completedAt > bucketEnd
            ) {
              continue;
            }
            const hours = resolutionHoursOf(task);
            if (hours == null) continue;
            const row = sums.get(task.priority);
            if (!row) continue;
            row.sum += hours;
            row.count += 1;
          }

          const avgResolutionHoursByPriority: Record<string, number | null> = {};
          for (const priority of Object.values(TaskPriority)) {
            const row = sums.get(priority)!;
            avgResolutionHoursByPriority[priority] =
              row.count > 0 ? Math.round(row.sum / row.count) : null;
          }
          points.push({
            weekStart: bucketStart.toISOString().slice(0, 10),
            avgResolutionHoursByPriority,
          });
        }

        return points;
      },
    );
  }

  private zeroFillProjectStatus(
    rows: { _id: string; count: number }[],
  ): Record<ProjectStatus, number> {
    return Object.fromEntries(
      Object.values(ProjectStatus).map((status) => [
        status,
        rows.find((r) => r._id === status)?.count ?? 0,
      ]),
    ) as Record<ProjectStatus, number>;
  }

  private async resolveScope(actingUser: AuthenticatedUser, projectId?: string) {
    const accessibleIds = await this.projectsService.getAccessibleProjectIds(actingUser);

    if (projectId && !accessibleIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const scopedIds = projectId ? [projectId] : accessibleIds;
    const objectIds = scopedIds.map((id) => new Types.ObjectId(id));
    const organizationId = new Types.ObjectId(requireOrgId(actingUser));

    const projectFilter: Record<string, unknown> = {
      deletedAt: null,
      organizationId,
      _id: { $in: objectIds },
    };
    // organizationId is redundant with the project-id scoping above (accessibleIds is already
    // org-scoped) but kept as a cheap, direct defense-in-depth clause on the Task collection.
    const taskFilter: Record<string, unknown> = {
      deletedAt: null,
      organizationId,
      project: { $in: objectIds },
    };

    if (actingUser.role === Role.DEVELOPER) {
      taskFilter.assignee = new Types.ObjectId(actingUser.id);
    }

    return { projectFilter, taskFilter };
  }

  private async cached<T>(
    endpoint: string,
    actingUser: AuthenticatedUser,
    query: Record<string, unknown>,
    ttl: number,
    compute: () => Promise<T>,
  ): Promise<CachedResult<T>> {
    const key = buildDashboardCacheKey(endpoint, actingUser.role, actingUser.id, query);
    const cachedValue = await this.cacheService.get<T>(key);
    if (cachedValue !== null) {
      return { data: cachedValue, hit: true };
    }
    const data = await compute();
    await this.cacheService.set(key, data, ttl);
    return { data, hit: false };
  }

  private ttlDashboard(): number {
    return this.configService.get('redis.ttlDashboard', { infer: true });
  }

  private ttlTrend(): number {
    return this.configService.get('redis.ttlTrend', { infer: true });
  }
}
