import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { UsersRepository } from '../users/users.repository';
import { TasksRepository } from '../tasks/tasks.repository';
import { TaskDocument } from '../tasks/schemas/task.schema';
import { TaskActivityAction } from '../tasks/schemas/task-activity.schema';
import { ProjectsService } from '../projects/projects.service';
import { EventsGateway } from '../../events/events.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  NotificationSchemeEvent,
  resolveNotificationSchemeRule,
} from '../projects/schemas/notification-scheme.schema';
import { ProjectDocument } from '../projects/schemas/project.schema';
import { CommentsRepository } from './comments.repository';
import { CommentDocument } from './schemas/comment.schema';
import { extractMentionedUserIds } from './mention.util';

@Injectable()
export class CommentsService {
  constructor(
    private readonly commentsRepository: CommentsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly usersRepository: UsersRepository,
    private readonly projectsService: ProjectsService,
    private readonly eventsGateway: EventsGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(
    taskId: string,
    body: string,
    actingUser: AuthenticatedUser,
  ): Promise<CommentDocument> {
    const { task, projectId } = await this.assertTaskMember(taskId, actingUser);
    const mentionedUserIds = await this.resolveMentions(body, requireOrgId(actingUser));

    const comment = await this.commentsRepository.create({
      task: new Types.ObjectId(taskId),
      author: new Types.ObjectId(actingUser.id),
      body,
      mentionedUserIds: mentionedUserIds.map((id) => new Types.ObjectId(id)),
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

    // Module 7 - a comment is a meaningful, signal-heavy event worth a permanent history entry
    // (unlike watch/vote/mention, deliberately left out - see task-activity.schema.ts's comment).
    await this.tasksRepository.logActivity(taskId, actingUser.id, TaskActivityAction.COMMENTED);

    if (task.assignee) {
      await this.notificationsService.notifyCommentAdded({
        taskId,
        taskTitle: task.title,
        assigneeId: extractId(task.assignee),
        actorId: actingUser.id,
        commentAuthorName: actingUser.email,
      });
    }
    // Module 7: broaden to every other watcher (the assignee, if also watching, already got the
    // dedicated notification above).
    await this.notificationsService.notifyWatchers({
      taskId,
      taskTitle: task.title,
      watcherIds: task.watcherIds.map(extractId),
      excludeUserIds: [actingUser.id, ...(task.assignee ? [extractId(task.assignee)] : [])],
      message: `${actingUser.email} commented on "${task.title}"`,
    });
    // Module 7: @mentions - notified regardless of watcher/assignee status, since being mentioned
    // is its own distinct signal even for someone not otherwise involved in the task.
    for (const mentionedUserId of mentionedUserIds) {
      await this.notificationsService.notifyMentioned({
        taskId,
        taskTitle: task.title,
        mentionedUserId,
        actorId: actingUser.id,
        actorName: actingUser.email,
      });
    }

    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    await this.notifyScheme(project, NotificationSchemeEvent.COMMENTED, taskId, task.title);

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
    // Mentions are re-derived so the stored list never diverges from the edited body, but editing
    // never re-notifies - only the original creation does (avoids re-pinging someone on every
    // unrelated typo fix to a comment that already mentioned them).
    const mentionedUserIds = await this.resolveMentions(body, requireOrgId(actingUser));
    return (await this.commentsRepository.updateById(id, {
      body,
      mentionedUserIds: mentionedUserIds.map((mentionedId) => new Types.ObjectId(mentionedId)),
    }))!;
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

  /** Extracts `@[Name](userId)` mentions from `body` and keeps only the ids that actually resolve
   * to a real user in the same org - a stale/forged/foreign-org id in the markup is silently
   * dropped rather than rejecting the whole comment, since the visible text still reads fine
   * either way (this is a notification list, not a referential-integrity-critical field). */
  private async resolveMentions(body: string, organizationId: string): Promise<string[]> {
    const candidateIds = extractMentionedUserIds(body);
    if (candidateIds.length === 0) return [];
    const users = await this.usersRepository.findByIds(candidateIds, organizationId);
    return users.map((u) => u.id);
  }

  private async getActiveOrThrow(id: string): Promise<CommentDocument> {
    const comment = await this.commentsRepository.findByIdActive(id);
    if (!comment) throw new NotFoundException('Comment not found');
    return comment;
  }

  /** Fires the project's admin-configured Notification Scheme entry for `event`, if one is
   * configured (Notification Schemes v2) - additive on top of the hardcoded assignee notification
   * above. A no-op for any project that hasn't configured a scheme for this event. */
  private async notifyScheme(
    project: ProjectDocument,
    event: NotificationSchemeEvent,
    taskId: string,
    taskTitle: string,
  ): Promise<void> {
    const rule = resolveNotificationSchemeRule(project, event);
    if (!rule) return;

    for (const role of rule.notifyRoles) {
      const members = await this.projectsService.membersWithRole(project, role);
      for (const member of members) {
        await this.notificationsService.notifySchemeEvent({
          recipient: {
            id: member.id,
            email: member.email,
            organizationId: extractId(project.organizationId),
          },
          event,
          channels: rule.channels,
          title: `[${event}] ${taskTitle}`,
          message: `Your project's notification scheme flagged "${taskTitle}" for the ${event} event`,
          taskId,
        });
      }
    }
  }
}
