import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { buildDigest, Digest, DIGEST_PERIOD_MS, DigestFrequency } from './digest.util';
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
import { renderEmailTemplate } from './email-templates';

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

export interface MentionedNotification {
  taskId: string;
  taskTitle: string;
  mentionedUserId: string;
  actorId: string;
  actorName: string;
}

export interface WatchedTaskUpdatedNotification {
  taskId: string;
  taskTitle: string;
  watcherIds: string[];
  /** Never notified as a watcher - typically the actor themself, plus anyone (e.g. the assignee)
   * who already received their own dedicated notification for this same event. */
  excludeUserIds: string[];
  message: string;
}

export interface AutomationRoleNotification {
  taskId: string;
  taskTitle: string;
  recipientId: string;
  ruleName: string;
}

export interface ApprovalRequestedNotification {
  taskId: string;
  taskTitle: string;
  toStatus: string;
  approverIds: string[];
}

export interface ApprovalDecidedNotification {
  taskId: string;
  taskTitle: string;
  requesterId: string;
  toStatus: string;
  approved: boolean;
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
/** Product name shown in email headers/footers. */
const EMAIL_APP_NAME = 'Project & Task Management';

/** "October 14, 2026 at 9:36 AM UTC" - emails can't know the reader's time zone. */
function formatEmailDate(date: Date): string {
  return `${new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(date)} UTC`;
}

export interface ProjectInviteEmail {
  inviteId: string;
  email: string;
  inviterName: string;
  role: string;
  /** Null for an organization invite (Admin > Users) - the email then names the organization. */
  projectName: string | null;
  organizationName: string | null;
  inviteUrl: string;
  temporaryPassword: string;
  expiresAt: Date;
}

/** Module 11 gap-closure: most unread notifications a digest reads. */
const DIGEST_SCAN_LIMIT = 200;

/** Module 11 gap-closure: longest allowed per-issue snooze. */
const MAX_SNOOZE_DAYS = 90;

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

  /** Module 7: someone @mentioned this user in a comment - in-app only (lighter-weight, like
   * AUTOMATION), and never fired for mentioning yourself. */
  async notifyMentioned(notification: MentionedNotification): Promise<void> {
    if (notification.mentionedUserId === notification.actorId) return;
    let mentioned: UserDocument | null = null;
    try {
      mentioned = await this.usersRepository.findById(notification.mentionedUserId);
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to look up mentioned user, ignoring',
      );
    }
    if (!mentioned) return;
    await this.createInAppNotification(
      notification.mentionedUserId,
      extractId(mentioned.organizationId),
      NotificationType.MENTIONED,
      'You were mentioned',
      `${notification.actorName} mentioned you on "${notification.taskTitle}"`,
      { taskId: notification.taskId },
    );
  }

  /** Module 7: broadens a hardcoded assignee-only notification (status changed, comment added, ...)
   * to every other watcher of the task - `excludeUserIds` keeps the actor and anyone who already
   * got their own dedicated notification for this same event from being notified twice. Every
   * lookup/send failure is per-watcher and never stops the rest of the list, same "never breaks
   * the caller" contract as every other method here. */
  async notifyWatchers(notification: WatchedTaskUpdatedNotification): Promise<void> {
    const excluded = new Set(notification.excludeUserIds);
    const recipientIds = notification.watcherIds.filter((id) => !excluded.has(id));
    for (const watcherId of recipientIds) {
      let watcher: UserDocument | null = null;
      try {
        watcher = await this.usersRepository.findById(watcherId);
      } catch (err) {
        this.logger.warn(
          { err, taskId: notification.taskId, watcherId },
          'failed to look up a watcher, ignoring',
        );
      }
      if (!watcher) continue;
      await this.createInAppNotification(
        watcherId,
        extractId(watcher.organizationId),
        NotificationType.WATCHED_TASK_UPDATED,
        'Watched issue updated',
        notification.message,
        { taskId: notification.taskId },
      );
    }
  }

  /** Module 12's Approval Workflows - notifies every eligible approver that a transition needs a
   * decision. In-app only (like WATCHED_TASK_UPDATED), never email - the same per-recipient
   * "one failed lookup never stops the rest" contract as notifyWatchers. */
  async notifyApprovalRequested(notification: ApprovalRequestedNotification): Promise<void> {
    for (const approverId of new Set(notification.approverIds)) {
      let approver: UserDocument | null = null;
      try {
        approver = await this.usersRepository.findById(approverId);
      } catch (err) {
        this.logger.warn(
          { err, taskId: notification.taskId, approverId },
          'failed to look up an approver, ignoring',
        );
      }
      if (!approver) continue;
      await this.createInAppNotification(
        approverId,
        extractId(approver.organizationId),
        NotificationType.APPROVAL_REQUESTED,
        'Approval requested',
        `"${notification.taskTitle}" needs your approval to move to ${notification.toStatus}`,
        { taskId: notification.taskId },
      );
    }
  }

  /** The other half of notifyApprovalRequested - tells the original requester whether their
   * transition was granted or rejected. */
  async notifyApprovalDecided(notification: ApprovalDecidedNotification): Promise<void> {
    let requester: UserDocument | null = null;
    try {
      requester = await this.usersRepository.findById(notification.requesterId);
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to look up an approval requester, ignoring',
      );
    }
    if (!requester) return;
    await this.createInAppNotification(
      notification.requesterId,
      extractId(requester.organizationId),
      NotificationType.APPROVAL_DECIDED,
      notification.approved ? 'Approval granted' : 'Approval rejected',
      notification.approved
        ? `"${notification.taskTitle}" was approved to move to ${notification.toStatus}`
        : `"${notification.taskTitle}"'s move to ${notification.toStatus} was rejected`,
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
      query.type,
      await this.snoozedTaskIds(recipientId),
    );
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async unreadCount(recipientId: string): Promise<number> {
    return this.notificationsRepository.countUnread(
      recipientId,
      await this.snoozedTaskIds(recipientId),
    );
  }

  /** Module 11 gap-closure: per-issue snooze (see NotificationSnooze). */
  async listSnoozes(ownerId: string) {
    return this.notificationsRepository.findActiveSnoozes(ownerId, new Date());
  }

  async snooze(ownerId: string, taskId: string, until: string) {
    const untilDate = new Date(until);
    const now = Date.now();
    if (untilDate.getTime() <= now) {
      throw new BadRequestException('until must be in the future');
    }
    if (untilDate.getTime() - now > MAX_SNOOZE_DAYS * 24 * 60 * 60 * 1000) {
      throw new BadRequestException(`A snooze can last at most ${MAX_SNOOZE_DAYS} days`);
    }
    return this.notificationsRepository.upsertSnooze(ownerId, taskId, untilDate);
  }

  async unsnooze(ownerId: string, taskId: string): Promise<void> {
    await this.notificationsRepository.deleteSnooze(ownerId, taskId);
  }

  private async snoozedTaskIds(ownerId: string): Promise<Types.ObjectId[]> {
    const snoozes = await this.notificationsRepository.findActiveSnoozes(ownerId, new Date());
    return snoozes.map((s) => s.task);
  }

  async markRead(id: string, recipientId: string): Promise<void> {
    const notification = await this.getOwnedOrThrow(id, recipientId);
    if (notification.readAt) return;
    await this.notificationsRepository.markRead(id);
  }

  async markAllRead(recipientId: string): Promise<void> {
    await this.notificationsRepository.markAllRead(recipientId);
  }

  async getPreferences(
    ownerId: string,
  ): Promise<{ mutedTypes: NotificationType[]; digest: DigestFrequency }> {
    const preference = await this.notificationsRepository.findPreference(ownerId);
    return { mutedTypes: preference?.mutedTypes ?? [], digest: preference?.digest ?? 'off' };
  }

  /** Module 11 gap-closure: the in-app digest - unread notifications from the last period. */
  async digestFor(
    ownerId: string,
    period: 'daily' | 'weekly',
    now = new Date(),
    appUrl = process.env.APP_URL ?? 'http://localhost:5173',
  ): Promise<Digest> {
    const since = new Date(now.getTime() - DIGEST_PERIOD_MS[period]);
    const notifications = await this.notificationsRepository.findUnreadSince(
      ownerId,
      since,
      await this.snoozedTaskIds(ownerId),
      DIGEST_SCAN_LIMIT,
    );
    return buildDigest(
      notifications.map((n) => ({
        type: n.type,
        title: n.title,
        message: n.message,
        taskId: n.taskId ? n.taskId.toString() : null,
        createdAt: n.createdAt,
      })),
      period,
      appUrl,
    );
  }

  async updatePreferences(
    ownerId: string,
    organizationId: string,
    dto: PutNotificationPreferenceDto,
  ): Promise<{ mutedTypes: NotificationType[]; digest: DigestFrequency }> {
    const updated = await this.notificationsRepository.upsertPreference(
      ownerId,
      organizationId,
      dto.mutedTypes,
      dto.digest,
    );
    return { mutedTypes: updated.mutedTypes, digest: updated.digest ?? 'off' };
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

  /**
   * The invitation email: the sign-in link plus the generated temporary password (masked in any
   * log of the email). Unlike the courtesy notifications above this one reports failure, so the
   * inviter can be told to share the link themselves - it never throws.
   */
  async sendProjectInvite(invite: ProjectInviteEmail): Promise<boolean> {
    try {
      if (await this.channelStatusService.isPaused('Email')) return false;
      const expires = formatEmailDate(invite.expiresAt);
      const target = invite.projectName ?? invite.organizationName ?? EMAIL_APP_NAME;
      const subject = `${invite.inviterName} invited you to join ${target}`;
      const view = {
        appName: EMAIL_APP_NAME,
        subject,
        inviterName: invite.inviterName,
        projectName: invite.projectName,
        organizationName: invite.organizationName,
        target,
        role: invite.role,
        email: invite.email,
        temporaryPassword: invite.temporaryPassword,
        inviteUrl: invite.inviteUrl,
        expires,
        year: new Date().getFullYear(),
      };
      await this.emailService.send({
        to: invite.email,
        subject,
        template: 'project-invite',
        redact: [invite.temporaryPassword],
        html: await renderEmailTemplate('project-invite', view),
        data: {
          text: [
            'Hello,',
            '',
            (invite.projectName
              ? `${invite.inviterName} invited you to join the project "${invite.projectName}"` +
                (invite.organizationName ? ` in ${invite.organizationName}` : '')
              : `${invite.inviterName} invited you to join ${target} on ${EMAIL_APP_NAME}`) +
              ` as a ${invite.role}.`,
            '',
            `Accept the invitation: ${invite.inviteUrl}`,
            '',
            `Email: ${invite.email}`,
            `Temporary password: ${invite.temporaryPassword}`,
            '',
            'After signing in you will enter your name and choose your own password.',
            `This invitation expires on ${expires}.`,
          ].join('\n'),
        },
      });
      // Logged-only (no SMTP configured) counts as not sent: the inviter must share it.
      return this.emailService.delivers !== false;
    } catch (err) {
      this.logger.warn({ err, inviteId: invite.inviteId }, 'failed to send project invite email');
      return false;
    }
  }

  async notifyInviteAccepted(input: {
    inviterId: string;
    organizationId: string;
    /** Null for an organization invite (Admin > Users). */
    projectId: string | null;
    projectName: string | null;
    inviteeName: string;
  }): Promise<void> {
    await this.createInAppNotification(
      input.inviterId,
      input.organizationId,
      NotificationType.INVITE_ACCEPTED,
      'Invitation accepted',
      input.projectName
        ? `${input.inviteeName} joined "${input.projectName}"`
        : `${input.inviteeName} accepted your invitation and joined the organization`,
      input.projectId ? { projectId: input.projectId } : {},
    );
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
