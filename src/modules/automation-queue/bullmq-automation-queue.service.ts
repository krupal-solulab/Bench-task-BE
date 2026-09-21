import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { Queue } from 'bullmq';
import { AppConfig } from '../../config/configuration';
import { AUTOMATION_QUEUE_NAME } from './automation-queue.constants';
import { AutomationJobData, IAutomationQueue } from './automation-queue.interface';
import { createBullmqConnection } from './bullmq-connection.util';

/** Real, BullMQ-backed producer (BRD 8: "Rules run through the existing background job queue").
 * Jobs are retried with backoff on failure rather than the previous behavior of a single inline
 * attempt whose failure was only logged - see AutomationJobProcessor (TasksModule) for the
 * consumer side that actually runs them. */
@Injectable()
export class BullmqAutomationQueueService implements IAutomationQueue, OnModuleDestroy {
  private readonly queue: Queue<AutomationJobData>;

  constructor(
    configService: ConfigService<AppConfig, true>,
    @InjectPinoLogger(BullmqAutomationQueueService.name) private readonly logger: PinoLogger,
  ) {
    this.queue = new Queue<AutomationJobData>(AUTOMATION_QUEUE_NAME, {
      connection: createBullmqConnection(configService),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }

  async enqueue(data: AutomationJobData): Promise<void> {
    try {
      await this.queue.add('fire-actions', data);
    } catch (err) {
      // Enqueueing itself failing (e.g. Redis briefly unreachable) must never fail the request
      // that triggered it - the same tolerance every other best-effort side effect in this
      // codebase (notifications, webhooks) already has.
      this.logger.warn(
        { err, ruleId: data.ruleId, taskId: data.taskId },
        'Failed to enqueue automation job',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
