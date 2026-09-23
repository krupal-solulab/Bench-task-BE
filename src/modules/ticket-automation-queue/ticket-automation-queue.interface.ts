import { Role } from '../../common/enums/role.enum';

/** The acting user is serialized (not passed by reference) since a queued job may execute long
 * after - and in a different process/tick from - the request that enqueued it. Mirrors
 * AutomationJobActingUser (Task-side) exactly. */
export interface TicketAutomationJobActingUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
}

/** One job = one fired action - same failure-isolation granularity as the Task-side queue. */
export interface TicketAutomationJobData {
  ruleId: string;
  ruleName: string;
  triggerType: string;
  organizationId: string;
  ticketId: string;
  actionType: string;
  actionValue: string;
  actingUser: TicketAutomationJobActingUser;
}

/** Producer-side abstraction for the ticket automation job queue - mirrors IAutomationQueue
 * exactly, kept as a fully separate interface/token/queue from the Task-side one. */
export interface ITicketAutomationQueue {
  enqueue(data: TicketAutomationJobData): Promise<void>;
}
