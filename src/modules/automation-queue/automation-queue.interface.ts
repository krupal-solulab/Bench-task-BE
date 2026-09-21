import { Role } from '../../common/enums/role.enum';

/** The acting user is serialized (not passed by reference) since a queued job may execute long
 * after - and in a different process/tick from - the request that enqueued it. */
export interface AutomationJobActingUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
}

/** One job = one fired action - the same failure-isolation granularity the previous inline
 * per-action try/catch loop had (one bad action never blocks the others). */
export interface AutomationJobData {
  ruleId: string;
  ruleName: string;
  triggerType: string;
  projectId: string;
  taskId: string;
  actionType: string;
  actionValue: string;
  actingUser: AutomationJobActingUser;
}

/**
 * Producer-side abstraction for the automation job queue (BRD 8: "Rules run through the existing
 * background job queue"). Kept minimal (enqueue-only) so it can live in this small, dependency-
 * free global module - the consumer side (which needs TasksService to actually run a job) lives
 * in TasksModule instead, listening to the same named queue (AUTOMATION_QUEUE_NAME).
 */
export interface IAutomationQueue {
  enqueue(data: AutomationJobData): Promise<void>;
}
