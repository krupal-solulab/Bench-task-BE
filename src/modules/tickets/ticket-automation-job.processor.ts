import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Job, Worker } from 'bullmq';
import { AppConfig } from '../../config/configuration';
import { TICKET_AUTOMATION_QUEUE_NAME } from '../ticket-automation-queue/ticket-automation-queue.constants';
import { TicketAutomationJobData } from '../ticket-automation-queue/ticket-automation-queue.interface';
import { createBullmqConnection } from '../automation-queue/bullmq-connection.util';
import { TicketsService } from './tickets.service';

/**
 * The consumer side of the ticket automation job queue (BRD 3.3) - lives in TicketsModule, not
 * TicketAutomationQueueModule, for the exact same reason AutomationJobProcessor lives in
 * TasksModule rather than AutomationQueueModule (needs TicketsService; importing TicketsModule
 * back into that small global module would create a circular module dependency). Listens on the
 * same named queue the producer (BullmqTicketAutomationQueueService) writes to.
 */
@Injectable()
export class TicketAutomationJobProcessor implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<TicketAutomationJobData>;

  constructor(
    private readonly ticketsService: TicketsService,
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectPinoLogger(TicketAutomationJobProcessor.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    // Integration tests use FakeTicketAutomationQueue (executes jobs synchronously, in-process)
    // precisely so they never need a real Redis connection; a real Worker here would open one
    // regardless of that override, so it's skipped outright in the test environment instead -
    // mirrors AutomationJobProcessor's own guard exactly.
    if (this.configService.get('nodeEnv', { infer: true }) === 'test') return;

    this.worker = new Worker<TicketAutomationJobData>(
      TICKET_AUTOMATION_QUEUE_NAME,
      async (job: Job<TicketAutomationJobData>) => {
        await this.ticketsService.executeTicketAutomationJob(job.data);
      },
      { connection: createBullmqConnection(this.configService) },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn({ err, jobId: job?.id }, 'Ticket automation job failed after all retries');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
