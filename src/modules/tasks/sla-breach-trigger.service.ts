import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { TasksService } from './tasks.service';

/** Hourly check for BRD 8's SlaBreach notification scheme event - mirrors
 * TasksDueDateReminderService/UnassignedAutomationTriggerService's own cron pattern exactly. */
@Injectable()
export class SlaBreachTriggerService {
  constructor(
    private readonly tasksService: TasksService,
    @InjectPinoLogger(SlaBreachTriggerService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleSlaBreachCheck(): Promise<void> {
    try {
      await this.tasksService.checkSlaBreaches();
    } catch (err) {
      this.logger.warn({ err }, 'SLA-breach notification check failed');
    }
  }
}
