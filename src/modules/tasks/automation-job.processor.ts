import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Job, Worker } from 'bullmq';
import { AppConfig } from '../../config/configuration';
import { AUTOMATION_QUEUE_NAME } from '../automation-queue/automation-queue.constants';
import { AutomationJobData } from '../automation-queue/automation-queue.interface';
import { createBullmqConnection } from '../automation-queue/bullmq-connection.util';
import { TasksService } from './tasks.service';

/**
 * The consumer side of the automation job queue (BRD 8) - lives in TasksModule, not
 * AutomationQueueModule, because it needs TasksService and importing TasksModule back into that
 * small global module would create a circular module dependency (see
 * automation-queue.constants.ts's own comment). Listens on the same named queue the producer
 * (BullmqAutomationQueueService) writes to.
 */
@Injectable()
export class AutomationJobProcessor implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<AutomationJobData>;

  constructor(
    private readonly tasksService: TasksService,
    private readonly configService: ConfigService<AppConfig, true>,
    @InjectPinoLogger(AutomationJobProcessor.name) private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    // Integration tests use FakeAutomationQueue (executes jobs synchronously, in-process - see
    // test/integration/setup/fake-automation-queue.ts) precisely so they never need a real Redis
    // connection; a real Worker here would open one regardless of that override (nothing else
    // injects this class, so there's no DI token to swap the way AUTOMATION_QUEUE is swapped for
    // the producer side), so it's skipped outright in the test environment instead.
    if (this.configService.get('nodeEnv', { infer: true }) === 'test') return;

    this.worker = new Worker<AutomationJobData>(
      AUTOMATION_QUEUE_NAME,
      async (job: Job<AutomationJobData>) => {
        await this.tasksService.executeAutomationJob(job.data);
      },
      { connection: createBullmqConnection(this.configService) },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn({ err, jobId: job?.id }, 'Automation job failed after all retries');
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
