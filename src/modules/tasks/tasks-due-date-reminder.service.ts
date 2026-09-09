import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { extractId } from '../../common/utils/mongo.util';
import { NotificationsService } from '../../notifications/notifications.service';
import { TasksRepository } from './tasks.repository';

const DUE_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Hourly check for tasks due within the next 24h that haven't been notified about yet. */
@Injectable()
export class TasksDueDateReminderService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly notificationsService: NotificationsService,
    @InjectPinoLogger(TasksDueDateReminderService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleDueSoonReminders(): Promise<void> {
    const now = new Date();
    const threshold = new Date(now.getTime() + DUE_SOON_WINDOW_MS);
    const tasks = await this.tasksRepository.findDueSoonUnnotified(now, threshold);
    this.logger.debug({ count: tasks.length }, 'checking tasks with an approaching due date');

    for (const task of tasks) {
      if (!task.assignee || !task.dueDate) continue;
      await this.notificationsService.notifyTaskDueSoon({
        taskId: task.id,
        taskTitle: task.title,
        assigneeId: extractId(task.assignee),
        dueDate: task.dueDate,
      });
      await this.tasksRepository.markDueDateNotified(task.id);
    }
  }
}
