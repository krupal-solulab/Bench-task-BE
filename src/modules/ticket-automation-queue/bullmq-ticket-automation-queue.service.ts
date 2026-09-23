import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Queue } from 'bullmq';
import { AppConfig } from '../../config/configuration';
import { createBullmqConnection } from '../automation-queue/bullmq-connection.util';
import { TICKET_AUTOMATION_QUEUE_NAME } from './ticket-automation-queue.constants';
import {
  ITicketAutomationQueue,
  TicketAutomationJobData,
} from './ticket-automation-queue.interface';

/** Real, BullMQ-backed producer for the ticket-side Triggers/Automations/Macros engine - reuses
 * the same createBullmqConnection factory the Task-side queue uses (generic, not Task-specific),
 * but on its own named queue. See TicketAutomationJobProcessor (TicketsModule) for the consumer. */
@Injectable()
export class BullmqTicketAutomationQueueService implements ITicketAutomationQueue, OnModuleDestroy {
  private readonly queue: Queue<TicketAutomationJobData>;

  constructor(
    configService: ConfigService<AppConfig, true>,
    @InjectPinoLogger(BullmqTicketAutomationQueueService.name) private readonly logger: PinoLogger,
  ) {
    this.queue = new Queue<TicketAutomationJobData>(TICKET_AUTOMATION_QUEUE_NAME, {
      connection: createBullmqConnection(configService),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }

  async enqueue(data: TicketAutomationJobData): Promise<void> {
    try {
      await this.queue.add('fire-actions', data);
    } catch (err) {
      this.logger.warn(
        { err, ruleId: data.ruleId, ticketId: data.ticketId },
        'Failed to enqueue ticket automation job',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
