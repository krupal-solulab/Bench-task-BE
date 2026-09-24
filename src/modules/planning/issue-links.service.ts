import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { TasksRepository } from '../tasks/tasks.repository';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { OrganizationsService } from '../organizations/organizations.service';
import { LinkTypeDefinition, resolveLinkTypes } from './schemas/link-type.schema';
import { IssueLink, IssueLinkDocument } from './schemas/issue-link.schema';
import { CreateIssueLinkDto } from './dto/create-issue-link.dto';
import { PutLinkTypesDto } from './dto/put-link-types.dto';
import { findCyclePath } from './utils/dependency-graph.util';

export interface ResolvedIssueLink {
  id: string;
  linkTypeId: string;
  linkTypeName: string;
  direction: 'outgoing' | 'incoming';
  task: {
    id: string;
    issueKey: string | null;
    title: string;
    status: string;
    statusCategory: string;
    project: { id: string; name: string };
  };
}

const TASK_SUMMARY_FIELDS = 'issueKey title status statusCategory project';

@Injectable()
export class IssueLinksService {
  constructor(
    @InjectModel(IssueLink.name) private readonly issueLinkModel: Model<IssueLinkDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async getLinkTypes(actingUser: AuthenticatedUser): Promise<LinkTypeDefinition[]> {
    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    return resolveLinkTypes(organization);
  }

  async updateLinkTypes(
    dto: PutLinkTypesDto,
    actingUser: AuthenticatedUser,
  ): Promise<LinkTypeDefinition[]> {
    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    const existingById = new Map(resolveLinkTypes(organization).map((t) => [t.id, t]));

    const linkTypes: LinkTypeDefinition[] = dto.linkTypes.map((t) => {
      if (t.id && !existingById.has(t.id)) {
        throw new BadRequestException(`Link type "${t.id}" does not exist for this org`);
      }
      return {
        id: t.id ?? new Types.ObjectId().toString(),
        name: t.name.trim(),
        inverseName: t.inverseName.trim(),
        isBlocking: t.isBlocking,
      };
    });

    const names = linkTypes.map((t) => t.name);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException('Link type names must be unique');
    }

    const updated = await this.organizationsService.updateLinkTypes(organizationId, linkTypes);
    return resolveLinkTypes(updated);
  }

  /**
   * Creates a link from `taskId` (the source) to `dto.targetTaskId`. For a blocking link type,
   * runs circular-dependency detection across every existing blocking link in the org (links can
   * cross projects, so cycle detection can't be scoped to just one project) and rejects with the
   * full cycle path (by issueKey, not raw ids) before saving - "a blocking warning before save"
   * per the BRD, enforced server-side rather than trusted to the client's own pre-check.
   */
  async createLink(
    taskId: string,
    dto: CreateIssueLinkDto,
    actingUser: AuthenticatedUser,
  ): Promise<ResolvedIssueLink> {
    if (taskId === dto.targetTaskId) {
      throw new BadRequestException('A task cannot be linked to itself');
    }

    const sourceTask = await this.getViewableTaskOrThrow(taskId, actingUser);
    const targetTask = await this.getViewableTaskOrThrow(dto.targetTaskId, actingUser);

    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    const linkTypes = resolveLinkTypes(organization);
    const linkType = linkTypes.find((t) => t.id === dto.linkTypeId);
    if (!linkType) {
      throw new BadRequestException(`Unknown link type "${dto.linkTypeId}"`);
    }

    const duplicate = await this.issueLinkModel
      .exists({ sourceTask: sourceTask._id, targetTask: targetTask._id, linkTypeId: linkType.id })
      .exec();
    if (duplicate) {
      throw new ConflictException('This link already exists');
    }

    if (linkType.isBlocking) {
      const blockingTypeIds = linkTypes.filter((t) => t.isBlocking).map((t) => t.id);
      const existingBlockingLinks = await this.issueLinkModel
        .find({ organizationId: organization._id, linkTypeId: { $in: blockingTypeIds } })
        .select('sourceTask targetTask')
        .exec();
      const edges = existingBlockingLinks.map((l) => ({
        source: extractId(l.sourceTask),
        target: extractId(l.targetTask),
      }));
      const cycle = findCyclePath(edges, taskId, dto.targetTaskId);
      if (cycle) {
        const tasksInCycle = await this.taskModel
          .find({ _id: { $in: cycle.map((id) => new Types.ObjectId(id)) } })
          .select('issueKey title')
          .exec();
        const labelById = new Map(tasksInCycle.map((t) => [t.id, t.issueKey ?? t.title]));
        const readablePath = cycle.map((id) => labelById.get(id) ?? id).join(' → ');
        throw new BadRequestException(`This would create a circular dependency: ${readablePath}`);
      }
    }

    const link = await this.issueLinkModel.create({
      organizationId: organization._id,
      sourceTask: sourceTask._id,
      targetTask: targetTask._id,
      linkTypeId: linkType.id,
      createdBy: new Types.ObjectId(actingUser.id),
    });

    return this.resolveLink(link, taskId, linkTypes, targetTask);
  }

  async listLinks(taskId: string, actingUser: AuthenticatedUser): Promise<ResolvedIssueLink[]> {
    await this.getViewableTaskOrThrow(taskId, actingUser);

    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    const linkTypes = resolveLinkTypes(organization);

    const taskObjectId = new Types.ObjectId(taskId);
    const links = await this.issueLinkModel
      .find({ $or: [{ sourceTask: taskObjectId }, { targetTask: taskObjectId }] })
      .sort({ createdAt: -1 })
      .exec();
    if (links.length === 0) return [];

    const otherTaskIds = [
      ...new Set(
        links.map((l) =>
          extractId(l.sourceTask) === taskId ? extractId(l.targetTask) : extractId(l.sourceTask),
        ),
      ),
    ];
    const otherTasks = await this.taskModel
      .find({ _id: { $in: otherTaskIds.map((id) => new Types.ObjectId(id)) } })
      .select(TASK_SUMMARY_FIELDS)
      .populate('project', 'name')
      .exec();
    const otherTaskById = new Map(otherTasks.map((t) => [t.id, t]));

    return links
      .map((link) => {
        const otherTaskId =
          extractId(link.sourceTask) === taskId
            ? extractId(link.targetTask)
            : extractId(link.sourceTask);
        const otherTask = otherTaskById.get(otherTaskId);
        if (!otherTask) return null; // the other task was hard-deleted from the DB entirely
        return this.resolveLink(link, taskId, linkTypes, otherTask);
      })
      .filter((l): l is ResolvedIssueLink => l !== null);
  }

  async deleteLink(taskId: string, linkId: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getViewableTaskOrThrow(taskId, actingUser);

    const link = await this.issueLinkModel.findById(linkId).exec();
    if (!link || (extractId(link.sourceTask) !== taskId && extractId(link.targetTask) !== taskId)) {
      throw new NotFoundException('Link not found');
    }
    await this.issueLinkModel.deleteOne({ _id: linkId }).exec();
  }

  private resolveLink(
    link: IssueLinkDocument,
    fromTaskId: string,
    linkTypes: LinkTypeDefinition[],
    otherTask: TaskDocument,
  ): ResolvedIssueLink {
    const direction: 'outgoing' | 'incoming' =
      extractId(link.sourceTask) === fromTaskId ? 'outgoing' : 'incoming';
    const linkType = linkTypes.find((t) => t.id === link.linkTypeId);
    const linkTypeName = linkType
      ? direction === 'outgoing'
        ? linkType.name
        : linkType.inverseName
      : link.linkTypeId;
    // otherTask.project may be populated (an object) or a bare ObjectId depending on the caller -
    // both call sites above always populate it, but this stays defensive rather than assuming.
    const project = otherTask.project as unknown as { id?: string; _id?: string; name?: string };
    return {
      id: link.id,
      linkTypeId: link.linkTypeId,
      linkTypeName,
      direction,
      task: {
        id: otherTask.id,
        issueKey: otherTask.issueKey,
        title: otherTask.title,
        status: otherTask.status,
        statusCategory: otherTask.statusCategory,
        project: { id: project.id ?? String(project._id), name: project.name ?? '' },
      },
    };
  }

  private async getViewableTaskOrThrow(
    taskId: string,
    actingUser: AuthenticatedUser,
  ): Promise<TaskDocument> {
    const task = await this.tasksRepository.findByIdActive(taskId);
    if (!task) throw new NotFoundException('Task not found');
    const project = await this.projectsService.getActiveProjectOrThrow(extractId(task.project));
    this.projectsService.assertUserCanView(project, actingUser);
    return task;
  }
}
