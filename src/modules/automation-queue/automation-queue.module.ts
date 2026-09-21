import { Global, Module } from '@nestjs/common';
import { AUTOMATION_QUEUE } from './automation-queue.constants';
import { BullmqAutomationQueueService } from './bullmq-automation-queue.service';

/** Global, like RedisModule/StorageModule (see their own file comments) - AUTOMATION_QUEUE is
 * injectable anywhere (in particular, TasksService) without this module needing to be imported
 * explicitly. Producer-only; the consumer (which needs TasksService) lives in TasksModule to
 * avoid a circular module dependency - see automation-queue.constants.ts's own comment. */
@Global()
@Module({
  providers: [{ provide: AUTOMATION_QUEUE, useClass: BullmqAutomationQueueService }],
  exports: [AUTOMATION_QUEUE],
})
export class AutomationQueueModule {}
