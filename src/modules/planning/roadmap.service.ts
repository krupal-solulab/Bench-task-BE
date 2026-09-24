import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { IssueType } from '../../common/enums/issue-type.enum';
import { ProjectsService } from '../projects/projects.service';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { SprintsService } from '../sprints/sprints.service';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { OrganizationsService } from '../organizations/organizations.service';
import { resolveLinkTypes } from './schemas/link-type.schema';
import { IssueLink, IssueLinkDocument } from './schemas/issue-link.schema';
import { RoadmapQueryDto } from './dto/roadmap-query.dto';

export interface DependencyGraphNode {
  id: string;
  issueKey: string | null;
  title: string;
  status: string;
  statusCategory: string;
  issueType: string;
  external: boolean;
  projectName?: string;
}

export interface DependencyGraphEdge {
  id: string;
  source: string;
  target: string;
  linkTypeId: string;
  linkTypeName: string;
  isBlocking: boolean;
}

export interface RoadmapEpic {
  epicId: string;
  issueKey: string | null;
  title: string;
  statusCategory: string;
  dueDate: Date | null;
  createdAt: Date;
  project: { id: string; name: string };
  linkedIssueCount: number;
  doneCount: number;
  progress: number;
  // Cross-project "blocked by" warnings (BRD: "an epic in Project A blocked by an epic in Project
  // B is flagged directly on the org-wide roadmap") - only the incoming direction is surfaced
  // here, since that's the actionable warning ("you can't proceed until...", not "you're
  // blocking someone else", which the other epic's own row already shows from its side).
  blockedByExternal: Array<{
    epicId: string;
    issueKey: string | null;
    title: string;
    projectName: string;
  }>;
}

export interface RoadmapProjectCapacity {
  projectId: string;
  activeSprintId: string | null;
  capacityPoints: number | null;
  committedPoints: number;
}

export interface RoadmapData {
  projects: Array<{ id: string; name: string }>;
  epics: RoadmapEpic[];
  capacity: RoadmapProjectCapacity[];
}

/**
 * Module 1's per-project dependency graph and org-wide cross-project roadmap. Reads the Task,
 * Project, and IssueLink models directly (rather than adding new cross-module repository methods
 * to TasksRepository/ProjectsRepository) - the same "duplicate a tiny read-only query to avoid a
 * module cycle" trade-off ProjectsService.epicProgressReport already documents for itself.
 */
@Injectable()
export class RoadmapService {
  constructor(
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(IssueLink.name) private readonly issueLinkModel: Model<IssueLinkDocument>,
    private readonly projectsService: ProjectsService,
    private readonly organizationsService: OrganizationsService,
    private readonly sprintsService: SprintsService,
  ) {}

  async getDependencyGraph(
    projectId: string,
    actingUser: AuthenticatedUser,
  ): Promise<{ nodes: DependencyGraphNode[]; edges: DependencyGraphEdge[] }> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);

    const tasks = await this.taskModel
      .find({ project: project._id, deletedAt: null })
      .select('issueKey title status statusCategory issueType')
      .exec();
    const taskIdSet = new Set(tasks.map((t) => t.id));
    const taskObjectIds = tasks.map((t) => t._id);

    const links =
      taskObjectIds.length > 0
        ? await this.issueLinkModel
            .find({
              $or: [{ sourceTask: { $in: taskObjectIds } }, { targetTask: { $in: taskObjectIds } }],
            })
            .exec()
        : [];

    const externalTaskIds = new Set<string>();
    for (const link of links) {
      const source = extractId(link.sourceTask);
      const target = extractId(link.targetTask);
      if (!taskIdSet.has(source)) externalTaskIds.add(source);
      if (!taskIdSet.has(target)) externalTaskIds.add(target);
    }
    const externalTasks =
      externalTaskIds.size > 0
        ? await this.taskModel
            .find({ _id: { $in: [...externalTaskIds].map((id) => new Types.ObjectId(id)) } })
            .select('issueKey title status statusCategory issueType project')
            .populate('project', 'name')
            .exec()
        : [];

    const organization = await this.organizationsService.getOrganizationDocument(
      requireOrgId(actingUser),
    );
    const linkTypeById = new Map(resolveLinkTypes(organization).map((t) => [t.id, t]));

    const nodes: DependencyGraphNode[] = [
      ...tasks.map((t) => ({
        id: t.id,
        issueKey: t.issueKey,
        title: t.title,
        status: t.status,
        statusCategory: t.statusCategory,
        issueType: t.issueType,
        external: false,
      })),
      ...externalTasks.map((t) => {
        const externalProject = t.project as unknown as { name?: string };
        return {
          id: t.id,
          issueKey: t.issueKey,
          title: t.title,
          status: t.status,
          statusCategory: t.statusCategory,
          issueType: t.issueType,
          external: true,
          projectName: externalProject.name ?? '',
        };
      }),
    ];

    const edges: DependencyGraphEdge[] = links.map((link) => {
      const linkType = linkTypeById.get(link.linkTypeId);
      return {
        id: link.id,
        source: extractId(link.sourceTask),
        target: extractId(link.targetTask),
        linkTypeId: link.linkTypeId,
        linkTypeName: linkType?.name ?? link.linkTypeId,
        isBlocking: linkType?.isBlocking ?? false,
      };
    });

    return { nodes, edges };
  }

  async getRoadmap(query: RoadmapQueryDto, actingUser: AuthenticatedUser): Promise<RoadmapData> {
    const accessibleIds = await this.projectsService.getAccessibleProjectIds(actingUser);
    const projectIds = query.projectIds?.length
      ? accessibleIds.filter((id) => query.projectIds!.includes(id))
      : accessibleIds;
    if (projectIds.length === 0) return { projects: [], epics: [], capacity: [] };

    const projectObjectIds = projectIds.map((id) => new Types.ObjectId(id));
    const projects = await this.projectModel
      .find({ _id: { $in: projectObjectIds } })
      .select('name')
      .exec();
    const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

    const epicFilter: Record<string, unknown> = {
      project: { $in: projectObjectIds },
      issueType: IssueType.EPIC,
      deletedAt: null,
    };
    if (query.status) epicFilter.statusCategory = query.status;

    const epicDocs = await this.taskModel
      .find(epicFilter)
      .select('title issueKey dueDate createdAt statusCategory project')
      .exec();
    const epicIds = epicDocs.map((e) => e._id);
    const epicIdSet = new Set(epicDocs.map((e) => e.id));

    const [progressByEpic, blockingLinks] = await Promise.all([
      this.computeEpicProgress(epicIds),
      epicIds.length > 0
        ? this.issueLinkModel
            .find({ $or: [{ sourceTask: { $in: epicIds } }, { targetTask: { $in: epicIds } }] })
            .exec()
        : Promise.resolve([]),
    ]);

    const organization = await this.organizationsService.getOrganizationDocument(
      requireOrgId(actingUser),
    );
    const blockingTypeIds = new Set(
      resolveLinkTypes(organization)
        .filter((t) => t.isBlocking)
        .map((t) => t.id),
    );

    // Only cross-project "X is blocked by Y" edges matter for the roadmap warning - same-project
    // blocking is already visible on that project's own dependency graph tab.
    const blockedByExternalByEpic = new Map<
      string,
      Array<{ epicId: string; issueKey: string | null; title: string; projectName: string }>
    >();
    const otherEpicIdsNeeded = new Set<string>();
    for (const link of blockingLinks) {
      if (!blockingTypeIds.has(link.linkTypeId)) continue;
      const source = extractId(link.sourceTask); // blocks
      const target = extractId(link.targetTask); // is blocked by source
      if (!epicIdSet.has(target)) continue; // the blocked side must be one of our epics
      otherEpicIdsNeeded.add(source);
    }
    const otherEpics =
      otherEpicIdsNeeded.size > 0
        ? await this.taskModel
            .find({ _id: { $in: [...otherEpicIdsNeeded].map((id) => new Types.ObjectId(id)) } })
            .select('issueKey title project')
            .populate('project', 'name')
            .exec()
        : [];
    const otherEpicById = new Map(otherEpics.map((e) => [e.id, e]));

    for (const link of blockingLinks) {
      if (!blockingTypeIds.has(link.linkTypeId)) continue;
      const source = extractId(link.sourceTask);
      const target = extractId(link.targetTask);
      if (!epicIdSet.has(target)) continue;
      const blockerEpic = epicDocs.find((e) => e.id === target)!;
      const sourceEpic = otherEpicById.get(source);
      if (!sourceEpic) continue;
      const sourceProjectId = extractId(sourceEpic.project);
      const targetProjectId = extractId(blockerEpic.project);
      if (sourceProjectId === targetProjectId) continue; // same-project, not a cross-project warning

      const sourceProject = sourceEpic.project as unknown as { name?: string };
      const list = blockedByExternalByEpic.get(target) ?? [];
      list.push({
        epicId: source,
        issueKey: sourceEpic.issueKey,
        title: sourceEpic.title,
        projectName: sourceProject.name ?? '',
      });
      blockedByExternalByEpic.set(target, list);
    }

    const epics: RoadmapEpic[] = epicDocs.map((epic) => {
      const progress = progressByEpic.get(epic.id) ?? { linkedIssueCount: 0, doneCount: 0 };
      return {
        epicId: epic.id,
        issueKey: epic.issueKey,
        title: epic.title,
        statusCategory: epic.statusCategory,
        dueDate: epic.dueDate,
        createdAt: epic.createdAt,
        project: {
          id: extractId(epic.project),
          name: projectNameById.get(extractId(epic.project)) ?? '',
        },
        linkedIssueCount: progress.linkedIssueCount,
        doneCount: progress.doneCount,
        progress:
          progress.linkedIssueCount > 0
            ? Math.round((progress.doneCount / progress.linkedIssueCount) * 100)
            : 0,
        blockedByExternal: blockedByExternalByEpic.get(epic.id) ?? [],
      };
    });

    const capacity = await Promise.all(
      projectIds.map(async (projectId): Promise<RoadmapProjectCapacity> => {
        const activeSprint = await this.sprintsService.findActive(projectId, actingUser);
        if (!activeSprint) {
          return { projectId, activeSprintId: null, capacityPoints: null, committedPoints: 0 };
        }
        const committed = await this.taskModel
          .aggregate<{ _id: null; total: number }>([
            { $match: { sprint: activeSprint._id, deletedAt: null } },
            { $group: { _id: null, total: { $sum: { $ifNull: ['$storyPoints', 0] } } } },
          ])
          .exec();
        return {
          projectId,
          activeSprintId: activeSprint.id,
          capacityPoints: activeSprint.capacityPoints,
          committedPoints: committed[0]?.total ?? 0,
        };
      }),
    );

    return {
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      epics,
      capacity,
    };
  }

  private async computeEpicProgress(
    epicIds: Types.ObjectId[],
  ): Promise<Map<string, { linkedIssueCount: number; doneCount: number }>> {
    const result = new Map<string, { linkedIssueCount: number; doneCount: number }>();
    if (epicIds.length === 0) return result;

    const rows = await this.taskModel
      .aggregate<{ _id: Types.ObjectId; total: number; done: number }>([
        { $match: { parent: { $in: epicIds }, deletedAt: null } },
        {
          $group: {
            _id: '$parent',
            total: { $sum: 1 },
            done: { $sum: { $cond: [{ $eq: ['$statusCategory', 'Done'] }, 1, 0] } },
          },
        },
      ])
      .exec();
    for (const row of rows) {
      result.set(String(row._id), { linkedIssueCount: row.total, doneCount: row.done });
    }
    return result;
  }
}
