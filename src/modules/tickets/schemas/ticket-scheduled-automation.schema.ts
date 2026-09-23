import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { TicketStatus } from '../../../common/enums/ticket-status.enum';
import {
  TicketAutomationAction,
  TicketAutomationActionSchema,
  TicketAutomationCondition,
  TicketAutomationConditionSchema,
  TicketAutomationFiredAction,
  TicketAutomationSnapshot,
} from './ticket-automation-rule.schema';

/**
 * BRD 3.3's Zendesk-style "Automations" - run on a time basis via a scheduled sweep (e.g. "ticket
 * in Pending for 3 days -> auto-close with a notice"), rather than firing on an immediate event
 * like a Trigger. Checked by the hourly ticket-automation-sweep cron against every ticket
 * currently in `matchStatus`, using `Ticket.statusEnteredAt` to compute elapsed time.
 */
@Schema({ _id: false })
export class TicketScheduledAutomation {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ default: true })
  enabled!: boolean;

  @Prop({ type: String, enum: TicketStatus, required: true })
  matchStatus!: TicketStatus;

  @Prop({ type: Number, required: true, min: 1 })
  afterHours!: number;

  @Prop({ type: [TicketAutomationConditionSchema], default: [] })
  conditions!: TicketAutomationCondition[];

  @Prop({ type: [TicketAutomationActionSchema], required: true })
  actions!: TicketAutomationAction[];
}

export const TicketScheduledAutomationSchema =
  SchemaFactory.createForClass(TicketScheduledAutomation);

export interface ScheduledAutomationCandidate extends TicketAutomationSnapshot {
  status: TicketStatus;
  statusHours: number;
  firedScheduledAutomationIds: string[];
}

/**
 * Matches enabled scheduled Automations against one ticket's current status/elapsed-time/
 * conditions, skipping any already fired for this status episode (see
 * Ticket.firedScheduledAutomationIds). Pure and side-effect-free, mirroring
 * evaluateTicketAutomationRules's style.
 */
export function evaluateScheduledAutomations(
  automations: TicketScheduledAutomation[],
  candidate: ScheduledAutomationCandidate,
): TicketAutomationFiredAction[] {
  const fired: TicketAutomationFiredAction[] = [];

  for (const automation of automations) {
    if (!automation.enabled) continue;
    if (automation.matchStatus !== candidate.status) continue;
    if (candidate.statusHours < automation.afterHours) continue;
    if (candidate.firedScheduledAutomationIds.includes(automation.id)) continue;
    if (!matchesConditions(automation.conditions, candidate)) continue;

    for (const action of automation.actions) {
      fired.push({ ruleId: automation.id, ruleName: automation.name, action });
    }
  }

  return fired;
}

function matchesConditions(
  conditions: TicketAutomationCondition[],
  ticket: TicketAutomationSnapshot,
): boolean {
  return conditions.every((condition) => {
    switch (condition.field) {
      case 'Priority':
        return ticket.priority === condition.value;
      case 'Channel':
        return ticket.channel === condition.value;
      case 'CustomerTier':
        return ticket.customerTier === condition.value;
      case 'Tag':
        return ticket.tags.includes(condition.value);
      default:
        return false;
    }
  });
}
