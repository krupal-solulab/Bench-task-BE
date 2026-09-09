import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { UsersRepository } from '../modules/users/users.repository';
import { EMAIL_SERVICE } from './email.constants';
import { IEmailService } from './email.interface';

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

/**
 * Every method here swallows its own failures (a bad assignee id, the email transport
 * throwing, ...) and logs a warning instead of rejecting - notifications are a courtesy, never
 * something that should break task creation/reassignment or the due-date reminder cron.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(EMAIL_SERVICE) private readonly emailService: IEmailService,
    private readonly usersRepository: UsersRepository,
    @InjectPinoLogger(NotificationsService.name) private readonly logger: PinoLogger,
  ) {}

  async notifyTaskAssigned(notification: TaskAssignedNotification): Promise<void> {
    try {
      const assignee = await this.usersRepository.findById(notification.assigneeId);
      if (!assignee) return;
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
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to send task-assigned notification, ignoring',
      );
    }
  }

  async notifyTaskDueSoon(notification: TaskDueSoonNotification): Promise<void> {
    try {
      const assignee = await this.usersRepository.findById(notification.assigneeId);
      if (!assignee) return;
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
    } catch (err) {
      this.logger.warn(
        { err, taskId: notification.taskId },
        'failed to send task-due-soon notification, ignoring',
      );
    }
  }
}
