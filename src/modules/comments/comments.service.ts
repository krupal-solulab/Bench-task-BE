import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TasksRepository } from '../tasks/tasks.repository';
import { TaskDocument } from '../tasks/schemas/task.schema';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../../events/events.gateway';
import { CommentsRepository } from './comments.repository';
import { CommentDocument } from './schemas/comment.schema';

@Injectable()
export class CommentsService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    private readonly eventsGateway: EventsGateway,
  ) {}

  async create(
    taskId: string,
    body: string,
    actingUser: AuthenticatedUser,
  ): Promise<CommentDocument> {
    const { projectId } = await this.assertTaskMember(taskId, actingUser);
    const comment = await this.commentsRepository.create({
      task: new Types.ObjectId(taskId),
      author: new Types.ObjectId(actingUser.id),
      body,
    });
    const created = (await this.commentsRepository.findByIdActive(comment.id)) as CommentDocument;

    try {
      this.eventsGateway.emitCommentCreated({
        taskId,
        projectId,
        commentId: created.id,
        authorId: actingUser.id,
      });
    } catch {
      // Best-effort real-time push; a delivery failure here must never fail comment creation.
    }

    return created;
  }

  async paginateForTask(
    taskId: string,
    page: number,
    limit: number,
    sortOrder: 'asc' | 'desc',
    actingUser: AuthenticatedUser,
  ) {
    await this.assertTaskMember(taskId, actingUser);
    const { data, total } = await this.commentsRepository.paginateForTask(
      taskId,
      page,
      limit,
      sortOrder,
    );
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async update(id: string, body: string, actingUser: AuthenticatedUser): Promise<CommentDocument> {
    const comment = await this.getActiveOrThrow(id);
    await this.assertCanModify(comment, actingUser);
    return (await this.commentsRepository.updateById(id, body))!;
  }

  async softDelete(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const comment = await this.getActiveOrThrow(id);
    await this.assertCanModify(comment, actingUser);
    await this.commentsRepository.softDelete(id);
  }

  private async assertCanModify(
    comment: CommentDocument,
    actingUser: AuthenticatedUser,
  ): Promise<void> {
    if (extractId(comment.author) === actingUser.id) return;
    // Same-org-Admin bypass only - see assertTaskMember's comment below for why a global
    // `role === ADMIN` check would leak across organizations here too.
    if (actingUser.role === Role.ADMIN) {
      const task = await this.tasksRepository.findRawById(extractId(comment.task));
      if (task && extractId(task.organizationId) === requireOrgId(actingUser)) return;
    }
    throw new ForbiddenException('You can only modify your own comments');
  }

  /**
   * Returns the task and its project id (needed by create() to target the right socket room) -
   * every exception/branch is otherwise unchanged from before this method returned a value.
   */
  private async assertTaskMember(
    taskId: string,
    actingUser: AuthenticatedUser,
  ): Promise<{ task: TaskDocument; projectId: string }> {
    const task = await this.tasksRepository.findRawById(taskId);
    if (!task) throw new NotFoundException('Task not found');
    const projectId = task.project.toString();
    // Same-org-Admin bypass only - a global `role === ADMIN` check here would let an Admin from
    // one organization read/post comments on another organization's task, since findRawById is
    // not org-scoped (this codebase's repositories verify-then-query-by-id at the service layer
    // rather than threading organizationId into every repository query).
    if (
      actingUser.role === Role.ADMIN &&
      extractId(task.organizationId) === requireOrgId(actingUser)
    ) {
      return { task, projectId };
    }
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    if (!this.projectsService.isProjectMember(project, actingUser.id)) {
      throw new ForbiddenException('You must be a member of this project to comment');
    }
    return { task, projectId };
  }

  private async getActiveOrThrow(id: string): Promise<CommentDocument> {
    const comment = await this.commentsRepository.findByIdActive(id);
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }
}
