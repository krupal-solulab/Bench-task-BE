import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { TicketsService } from './tickets.service';

/** Hourly check for BRD 3.3's time-based "Automation" kind (e.g. "Pending 3 days -> auto-close") -
 * mirrors UnassignedAutomationTriggerService/TasksDueDateReminderService's own cron pattern. */
@Injectable()
export class TicketScheduledAutomationSweepService {
  constructor(
    private readonly ticketsService: TicketsService,
    @InjectPinoLogger(TicketScheduledAutomationSweepService.name)
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleScheduledAutomationSweep(): Promise<void> {
    try {
      await this.ticketsService.checkScheduledAutomations();
    } catch (err) {
      this.logger.warn({ err }, 'Ticket scheduled-automation sweep failed');
    }
  }
}
