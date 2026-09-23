import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { TicketsService } from './tickets.service';

/** Hourly check for BRD 3.4's Advanced SLA breach + pre-breach escalation-chain notification -
 * mirrors SlaBreachTriggerService's own cron pattern. */
@Injectable()
export class TicketSlaCheckService {
  constructor(
    private readonly ticketsService: TicketsService,
    @InjectPinoLogger(TicketSlaCheckService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleSlaCheck(): Promise<void> {
    try {
      await this.ticketsService.checkSlaBreachesAndEscalations();
    } catch (err) {
      this.logger.warn({ err }, 'Ticket SLA breach/escalation check failed');
    }
  }
}
