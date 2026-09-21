export const AUTOMATION_QUEUE = 'AUTOMATION_QUEUE';

/** The BullMQ queue name shared between the producer (RealAutomationQueue, in this module) and
 * the consumer (AutomationJobProcessor, in TasksModule - it needs TasksService, so it can't live
 * here without a circular module dependency; sharing just this name constant avoids that). */
export const AUTOMATION_QUEUE_NAME = 'automation-jobs';
