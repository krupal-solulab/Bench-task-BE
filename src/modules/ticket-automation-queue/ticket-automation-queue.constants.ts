export const TICKET_AUTOMATION_QUEUE = 'TICKET_AUTOMATION_QUEUE';

/** BullMQ queue name shared between the producer (BullmqTicketAutomationQueueService, this
 * module) and the consumer (TicketAutomationJobProcessor, in TicketsModule - it needs
 * TicketAutomationService, so it can't live here without a circular module dependency). Deliberately
 * a SEPARATE queue from AUTOMATION_QUEUE_NAME (the Task-side automation queue) - the BRD frames
 * ticket Triggers/Automations/Macros as a distinct engine from the Jira-style Automation Engine,
 * and this keeps the two domains fully independent (no shared job schema, no cross-domain outage
 * risk). */
export const TICKET_AUTOMATION_QUEUE_NAME = 'ticket-automation-jobs';
