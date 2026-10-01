import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ORG_ROLES, Role } from '../../common/enums/role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { SprintStatus } from '../../common/enums/sprint-status.enum';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { Sprint, SprintDocument } from '../sprints/schemas/sprint.schema';
import { AuditLogEntry, AuditLogEntryDocument } from '../audit-log/schemas/audit-log-entry.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_AUDIT_LIMIT = 8;

export interface AdminSystemStats {
  generatedAt: Date;
  users: {
    total: number;
    active: number;
    inactive: number;
    byRole: Record<string, { total: number; active: number }>;
  };
  projects: {
    total: number;
    archived: number;
    byStatus: Record<string, number>;
    createdLast30Days: number;
  };
  tasks: {
    total: number;
    open: number;
    completed: number;
    overdue: number;
    createdLast7Days: number;
    completedLast7Days: number;
  };
  sprints: { active: number };
  activity: {
    auditEventsLast7Days: number;
    recent: AuditLogEntryDocument[];
  };
}

/**
 * Module 8 gap-closure: the org Admin's "system dashboard" - org-wide health counts (people,
 * projects, work, admin activity). Deliberately read-only aggregate counts over the org's own
 * documents, never cached (an Admin looking at a system page expects current numbers) and never
 * role-scoped like DashboardService (an org Admin already sees everything in their own org).
 */
@Injectable()
export class AdminStatsService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Sprint.name) private readonly sprintModel: Model<SprintDocument>,
    @InjectModel(AuditLogEntry.name)
    private readonly auditLogModel: Model<AuditLogEntryDocument>,
  ) {}

  async getStats(organizationId: string): Promise<AdminSystemStats> {
    const orgId = new Types.ObjectId(organizationId);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
    const liveProjects = { organizationId: orgId, deletedAt: null };
    const liveTasks = { organizationId: orgId, deletedAt: null };

    const [
      userRows,
      projectStatusRows,
      archivedProjects,
      projectsLast30,
      taskFacet,
      activeSprints,
      auditLast7,
      recentAudit,
    ] = await Promise.all([
      this.userModel.aggregate<{ _id: { role: Role; isActive: boolean }; count: number }>([
        { $match: { organizationId: orgId } },
        { $group: { _id: { role: '$role', isActive: '$isActive' }, count: { $sum: 1 } } },
      ]),
      this.projectModel.aggregate<{ _id: ProjectStatus; count: number }>([
        { $match: liveProjects },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.projectModel.countDocuments({ ...liveProjects, archivedAt: { $ne: null } }),
      this.projectModel.countDocuments({ ...liveProjects, createdAt: { $gte: thirtyDaysAgo } }),
      this.taskModel.aggregate([
        { $match: liveTasks },
        {
          $facet: {
            total: [{ $count: 'count' }],
            done: [{ $match: { statusCategory: StatusCategory.DONE } }, { $count: 'count' }],
            overdue: [
              { $match: { dueDate: { $lt: now }, statusCategory: { $ne: StatusCategory.DONE } } },
              { $count: 'count' },
            ],
            createdLast7: [{ $match: { createdAt: { $gte: sevenDaysAgo } } }, { $count: 'count' }],
            completedLast7: [
              {
                $match: {
                  statusCategory: StatusCategory.DONE,
                  updatedAt: { $gte: sevenDaysAgo },
                },
              },
              { $count: 'count' },
            ],
          },
        },
      ]),
      this.sprintModel.countDocuments({
        organizationId: orgId,
        deletedAt: null,
        status: SprintStatus.ACTIVE,
      }),
      this.auditLogModel.countDocuments({
        organizationId: orgId,
        createdAt: { $gte: sevenDaysAgo },
      }),
      this.auditLogModel
        .find({ organizationId: orgId })
        .populate('actor', 'name email')
        .sort({ createdAt: -1 })
        .limit(RECENT_AUDIT_LIMIT)
        .exec(),
    ]);

    const byRole: AdminSystemStats['users']['byRole'] = Object.fromEntries(
      ORG_ROLES.map((role) => [role, { total: 0, active: 0 }]),
    );
    let totalUsers = 0;
    let activeUsers = 0;
    for (const row of userRows) {
      const bucket = (byRole[row._id.role] ??= { total: 0, active: 0 });
      bucket.total += row.count;
      totalUsers += row.count;
      if (row._id.isActive) {
        bucket.active += row.count;
        activeUsers += row.count;
      }
    }

    const byStatus: Record<string, number> = Object.fromEntries(
      Object.values(ProjectStatus).map((status) => [status, 0]),
    );
    for (const row of projectStatusRows) byStatus[row._id] = row.count;

    const facet = taskFacet[0] ?? {};
    const count = (key: string): number => facet[key]?.[0]?.count ?? 0;
    const totalTasks = count('total');
    const completedTasks = count('done');

    return {
      generatedAt: now,
      users: { total: totalUsers, active: activeUsers, inactive: totalUsers - activeUsers, byRole },
      projects: {
        total: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        archived: archivedProjects,
        byStatus,
        createdLast30Days: projectsLast30,
      },
      tasks: {
        total: totalTasks,
        open: totalTasks - completedTasks,
        completed: completedTasks,
        overdue: count('overdue'),
        createdLast7Days: count('createdLast7'),
        completedLast7Days: count('completedLast7'),
      },
      sprints: { active: activeSprints },
      activity: { auditEventsLast7Days: auditLast7, recent: recentAudit },
    };
  }
}
