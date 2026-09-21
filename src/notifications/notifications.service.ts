import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { extractId } from '../common/utils/mongo.util';
import { buildPaginationMeta } from '../common/utils/pagination.util';
import { UsersRepository } from '../modules/users/users.repository';
import { UserDocument } from '../modules/users/schemas/user.schema';
import { EventsGateway } from '../events/events.gateway';
import { EMAIL_SERVICE } from './email.constants';
import { IEmailService } from './email.interface';
import { NotificationsRepository } from './notifications.repository';
import { ChannelStatusService } from './channel-status.service';
import { NotificationDocument, NotificationType } from './schemas/notification.schema';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { PutNotificationPreferenceDto } from './dto/put-notification-preference.dto';
import {
  NotificationChannel,
  NotificationSchemeEvent,
} from '../modules/projects/schemas/notification-scheme.schema';

export interface TaskAssignedNotification {
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  actorEmail: string;
}

export interface TaskDueSoonNotification {
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  dueDate: Date;
}

export interface StatusChangedNotification {
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  actorId: string;
  fromStatus: string;
  toStatus: string;
}

export interface CommentAddedNotification {
  taskId: string;
  taskTitle: string;
  assigneeId: string;
  actorId: string;
  commentAuthorName: string;
}

export interface AutomationRoleNotification {
  taskId: string;
  taskTitle: string;
  recipientId: string;
  ruleName: string;
}

export interface SchemeEventNotification {
  recipient: { id: string; email: string; organizationId: string };
  event: NotificationSchemeEvent;
  channels: NotificationChannel[];
  title: string;
  message: string;
  taskId?: string;
}

/**
 * Every email-sending method here swallows its own failures (a bad assignee id, the email
 * transport throwing, ...) and logs a warning instead of rejecting - notifications are a
 * courtesy, never something that should break task creation/reassignment or the due-date
 * reminder cron. The in-app notification row each method now also writes follows the same
 * contract: a failure to write it or to push it over the socket never fails the caller.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(EMAIL_SERVICE) private readonly emailService: IEmailService,
    private readonly usersRepository: UsersRepository,
    private readonly notificationsRepository: NotificationsRepository,
    private readonly eventsGateway: EventsGateway,
    private readonly channelStatusService: ChannelStatusService,
    @InjectPinoLogger(NotificationsService.name) private readonly logger: PinoLogger,
  ) {}

  async notifyTaskAssigned(notification: TaskAssignedNotification): Promise<void> {
    // The lookup + email send are wrapped exactly as before this phase - a failure anywhere in
    // here (including the lookup itself) is swallowed, never breaking task creation/reassignment.
    let assignee: UserDocument | null = null;
    try {
      assignee = await this.usersRepository.findById(notification.assigneeId);
      if (!assignee) return;
      if (!(await this.channelStatusService.isPaused('Email'))) {
        await this.emailService.send({
          to: assignee.email,
          subject: `You've been assigned: ${notification.taskTitle}`,
          template: 'task-assigned',
          data: {
            taskId: notification.taskId,
            taskTitle: notification.taskTitle,
            assigneeName: assignee.name,
            actorEmail: notification.actorEmail,
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to send task-assigned notification, ignoring',
      );
    }
    if (!assignee) return;

    await this.createInAppNotification(
      notification.assigneeId,
      extractId(assignee.organizationId),
      NotificationType.TASK_ASSIGNED,
      'Assigned to you',
      `You were assigned "${notification.taskTitle}"`,
      { taskId: notification.taskId },
    );
  }

  async notifyTaskDueSoon(notification: TaskDueSoonNotification): Promise<void> {
    let assignee: UserDocument | null = null;
    try {
      assignee = await this.usersRepository.findById(notification.assigneeId);
      if (!assignee) return;
      if (!(await this.channelStatusService.isPaused('Email'))) {
        await this.emailService.send({
          to: assignee.email,
          subject: `Due soon: ${notification.taskTitle}`,
          template: 'task-due-soon',
          data: {
            taskId: notification.taskId,
            taskTitle: notification.taskTitle,
            assigneeName: assignee.name,
            dueDate: notification.dueDate.toISOString(),
          },
        });
      }
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to send task-due-soon notification, ignoring',
      );
    }
    if (!assignee) return;

    await this.createInAppNotification(
      notification.assigneeId,
      extractId(assignee.organizationId),
      NotificationType.DUE_SOON,
      'Due soon',
      `"${notification.taskTitle}" is due soon`,
      { taskId: notification.taskId },
    );
  }

  async notifyStatusChanged(notification: StatusChangedNotification): Promise<void> {
    if (notification.assigneeId === notification.actorId) return;
    let assignee: UserDocument | null = null;
    try {
      assignee = await this.usersRepository.findById(notification.assigneeId);
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to look up assignee for a status-changed notification, ignoring',
      );
    }
    if (!assignee) return;
    await this.createInAppNotification(
      notification.assigneeId,
      extractId(assignee.organizationId),
      NotificationType.STATUS_CHANGED,
      'Status changed',
      `"${notification.taskTitle}" moved from ${notification.fromStatus} to ${notification.toStatus}`,
      { taskId: notification.taskId },
    );
  }

  async notifyCommentAdded(notification: CommentAddedNotification): Promise<void> {
    if (notification.assigneeId === notification.actorId) return;
    let assignee: UserDocument | null = null;
    try {
      assignee = await this.usersRepository.findById(notification.assigneeId);
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to look up assignee for a comment-added notification, ignoring',
      );
    }
    if (!assignee) return;
    await this.createInAppNotification(
      notification.assigneeId,
      extractId(assignee.organizationId),
      NotificationType.COMMENT_ADDED,
      'New comment',
      `${notification.commentAuthorName} commented on "${notification.taskTitle}"`,
      { taskId: notification.taskId },
    );
  }

  /** Sent by an automation rule's NotifyRole post-function action (Workflow Engine v2) - in-app
   * only, no email, since this is a new, lighter-weight notification kind. */
  async notifyAutomationRole(notification: AutomationRoleNotification): Promise<void> {
    let recipient: UserDocument | null = null;
    try {
      recipient = await this.usersRepository.findById(notification.recipientId);
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to look up recipient for an automation-role notification, ignoring',
      );
    }
    if (!recipient) return;
    await this.createInAppNotification(
      notification.recipientId,
      extractId(recipient.organizationId),
      NotificationType.AUTOMATION,
      'Automation notification',
      `Automation rule "${notification.ruleName}" fired on "${notification.taskTitle}"`,
      { taskId: notification.taskId },
    );
  }

  /**
   * Fires a project's admin-configured Notification Scheme entry for one recipient (called once
   * per role-matched project member, by the caller resolving `ProjectsService.membersWithRole`).
   * Additive on top of whatever hardcoded notification the triggering event already sends -
   * never called for a project/event with no scheme configured (see
   * `resolveNotificationSchemeRule`), so an unconfigured project is entirely unaffected.
   * WhatsApp has no provider configured anywhere in this codebase - selecting it only logs a
   * "would send" line, mirroring the Webhook automation action's own stub treatment.
   */
  async notifySchemeEvent(notification: SchemeEventNotification): Promise<void> {
    if (notification.channels.includes(NotificationChannel.IN_APP)) {
      await this.createInAppNotification(
        notification.recipient.id,
        notification.recipient.organizationId,
        NotificationType.SCHEME,
        notification.title,
        notification.message,
        { taskId: notification.taskId },
      );
    }

    if (
      notification.channels.includes(NotificationChannel.EMAIL) &&
      !(await this.channelStatusService.isPaused('Email'))
    ) {
      try {
        await this.emailService.send({
          to: notification.recipient.email,
          subject: notification.title,
          template: 'notification-scheme',
          data: { message: notification.message, event: notification.event },
        });
      } catch (err) {
        this.logger.warn(
          { err, event: notification.event, recipientId: notification.recipient.id },
          'failed to send a notification-scheme email, ignoring',
        );
      }
    }

    if (
      notification.channels.includes(NotificationChannel.WHATSAPP) &&
      !(await this.channelStatusService.isPaused('WhatsApp'))
    ) {
      this.logger.info(
        `Would send WhatsApp to ${notification.recipient.email}: "${notification.title}" ` +
          '(no WhatsApp provider configured - logging only)',
      );
    }
  }

  async listMine(recipientId: string, query: ListNotificationsDto) {
    const { data, total } = await this.notificationsRepository.paginate(
      recipientId,
      query.page,
      query.limit,
      !!query.unreadOnly,
    );
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  unreadCount(recipientId: string): Promise<number> {
    return this.notificationsRepository.countUnread(recipientId);
  }

  async markRead(id: string, recipientId: string): Promise<void> {
    const notification = await this.getOwnedOrThrow(id, recipientId);
    if (notification.readAt) return;
    await this.notificationsRepository.markRead(id);
  }

  async markAllRead(recipientId: string): Promise<void> {
    await this.notificationsRepository.markAllRead(recipientId);
  }

  async getPreferences(ownerId: string): Promise<{ mutedTypes: NotificationType[] }> {
    const preference = await this.notificationsRepository.findPreference(ownerId);
    return { mutedTypes: preference?.mutedTypes ?? [] };
  }

  async updatePreferences(
    ownerId: string,
    organizationId: string,
    dto: PutNotificationPreferenceDto,
  ): Promise<{ mutedTypes: NotificationType[] }> {
    const updated = await this.notificationsRepository.upsertPreference(
      ownerId,
      organizationId,
      dto.mutedTypes,
    );
    return { mutedTypes: updated.mutedTypes };
  }

  private async getOwnedOrThrow(id: string, recipientId: string): Promise<NotificationDocument> {
    const notification = await this.notificationsRepository.findById(id);
    // Never distinguish "doesn't exist" from "exists but isn't yours" - same privacy convention
    // as Saved Filters.
    if (!notification || extractId(notification.recipient) !== recipientId) {
      throw new NotFoundException('Notification not found');
    }
    return notification;
  }

  private async createInAppNotification(
    recipientId: string,
    organizationId: string,
    type: NotificationType,
    title: string,
    message: string,
    refs: { taskId?: string; projectId?: string },
  ): Promise<void> {
    try {
      const preference = await this.notificationsRepository.findPreference(recipientId);
      if (preference?.mutedTypes.includes(type)) return;

      const created = await this.notificationsRepository.create({
        recipient: new Types.ObjectId(recipientId),
        organizationId: new Types.ObjectId(organizationId),
        type,
        title,
        message,
        taskId: refs.taskId ? new Types.ObjectId(refs.taskId) : null,
        projectId: refs.projectId ? new Types.ObjectId(refs.projectId) : null,
      });

      try {
        this.eventsGateway.emitNotificationCreated({
          recipientId,
          notificationId: created.id,
        });
      } catch {
        // Best-effort real-time push; a delivery failure here must never fail notification creation.
      }
    } catch (err) {
      this.logger.warn(
        { err, recipientId, type },
        'failed to create in-app notification, ignoring',
      );
    }
  }
}
