import { Global, Module } from '@nestjs/common';
import { TICKET_AUTOMATION_QUEUE } from './ticket-automation-queue.constants';
import { BullmqTicketAutomationQueueService } from './bullmq-ticket-automation-queue.service';

/** Global, like AutomationQueueModule (see its own file comment) - TICKET_AUTOMATION_QUEUE is
 * injectable anywhere without this module needing to be imported explicitly. Producer-only; the
 * consumer lives in TicketsModule to avoid a circular module dependency. */
@Global()
@Module({
  providers: [{ provide: TICKET_AUTOMATION_QUEUE, useClass: BullmqTicketAutomationQueueService }],
  exports: [TICKET_AUTOMATION_QUEUE],
})
export class TicketAutomationQueueModule {}
