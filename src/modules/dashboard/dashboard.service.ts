import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { AppConfig } from '../../config/configuration';
import { CacheService } from '../../redis/cache.service';
import { buildDashboardCacheKey } from '../../common/utils/cache-key.util';
import { Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { TaskStatus } from '../../common/enums/task-status.enum';
import { TaskPriority } from '../../common/enums/task-priority.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { ProjectsService } from '../projects/projects.service';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { DeveloperWorkloadQueryDto } from './dto/dashboard-scope.dto';

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
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

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
              done: [{ $match: { status: TaskStatus.DONE } }, { $count: 'count' }],
              overdue: [
                { $match: { dueDate: { $lt: new Date() }, status: { $ne: TaskStatus.DONE } } },
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
      const rows = await this.taskModel.aggregate([
        { $match: taskFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]);
      return Object.values(TaskStatus).map((status) => ({
        status,
        count: rows.find((r: { _id: string }) => r._id === status)?.count ?? 0,
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
              completed: { $sum: { $cond: [{ $eq: ['$status', TaskStatus.DONE] }, 1, 0] } },
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
          .find({ ...taskFilter, dueDate: { $lt: new Date() }, status: { $ne: TaskStatus.DONE } })
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
              status: TaskStatus.DONE,
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

    if (projectId && accessibleIds && !accessibleIds.includes(projectId)) {
      throw new ForbiddenException('You do not have access to this project');
    }

    const scopedIds = projectId ? [projectId] : accessibleIds;

    const projectFilter: Record<string, unknown> = { deletedAt: null };
    const taskFilter: Record<string, unknown> = { deletedAt: null };

    if (scopedIds) {
      const objectIds = scopedIds.map((id) => new Types.ObjectId(id));
      projectFilter._id = { $in: objectIds };
      taskFilter.project = { $in: objectIds };
    }

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
