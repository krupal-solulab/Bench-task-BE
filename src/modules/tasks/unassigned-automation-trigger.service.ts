import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { TasksService } from './tasks.service';

/** Hourly check for the UnassignedForDuration automation trigger (BRD 8) - mirrors
 * TasksDueDateReminderService's own cron pattern exactly. */
@Injectable()
export class UnassignedAutomationTriggerService {
  constructor(
    private readonly tasksService: TasksService,
    @InjectPinoLogger(UnassignedAutomationTriggerService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleUnassignedDurationCheck(): Promise<void> {
    try {
      await this.tasksService.checkUnassignedForDurationRules();
    } catch (err) {
      this.logger.warn({ err }, 'Unassigned-for-duration automation check failed');
    }
  }
}
