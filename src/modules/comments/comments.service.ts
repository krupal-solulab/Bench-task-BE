import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TasksRepository } from '../tasks/tasks.repository';
import { ProjectsService } from '../projects/projects.service';
import { CommentsRepository } from './comments.repository';
import { CommentDocument } from './schemas/comment.schema';

@Injectable()
export class CommentsService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
  ) {}

  async create(
    taskId: string,
    body: string,
    actingUser: AuthenticatedUser,
  ): Promise<CommentDocument> {
    await this.assertTaskMember(taskId, actingUser);
    const comment = await this.commentsRepository.create({
      task: new Types.ObjectId(taskId),
      author: new Types.ObjectId(actingUser.id),
      body,
    });
    return this.commentsRepository.findByIdActive(comment.id) as Promise<CommentDocument>;
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
    this.assertCanModify(comment, actingUser);
    return (await this.commentsRepository.updateById(id, body))!;
  }

  async softDelete(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const comment = await this.getActiveOrThrow(id);
    this.assertCanModify(comment, actingUser);
    await this.commentsRepository.softDelete(id);
  }

  private assertCanModify(comment: CommentDocument, actingUser: AuthenticatedUser): void {
    if (actingUser.role === Role.ADMIN) return;
    if (extractId(comment.author) === actingUser.id) return;
    throw new ForbiddenException('You can only modify your own comments');
  }

  private async assertTaskMember(taskId: string, actingUser: AuthenticatedUser): Promise<void> {
    const task = await this.tasksRepository.findRawById(taskId);
    if (!task) throw new NotFoundException('Task not found');
    if (actingUser.role === Role.ADMIN) return;
    const project = await this.projectsService.getActiveProjectOrThrow(task.project.toString());
    if (!this.projectsService.isProjectMember(project, actingUser.id)) {
      throw new ForbiddenException('You must be a member of this project to comment');
    }
  }

  private async getActiveOrThrow(id: string): Promise<CommentDocument> {
    const comment = await this.commentsRepository.findByIdActive(id);
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }
}
