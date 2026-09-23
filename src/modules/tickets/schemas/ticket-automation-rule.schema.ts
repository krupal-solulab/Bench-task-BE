import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/**
 * BRD 3.3's Zendesk-style "Triggers" - real-time, evaluated on every ticket event. Deliberately a
 * SEPARATE rule model from the Jira-style project Automation Engine (automation-rule.schema.ts) -
 * same overall shape (mirrored deliberately for consistency) but operating on Ticket fields, with
 * its own queue, log, and execution path.
 */
export enum TicketAutomationTriggerType {
  TICKET_CREATED = 'TicketCreated',
  STATUS_CHANGED = 'TicketStatusChanged',
  COMMENT_ADDED = 'TicketCommentAdded',
  REASSIGNED = 'TicketReassigned',
}

export enum TicketAutomationActionType {
  SET_STATUS = 'SetStatus',
  SET_PRIORITY = 'SetPriority',
  SET_ASSIGNEE = 'SetAssignee',
  ADD_TAGS = 'AddTags',
  ADD_COMMENT = 'AddComment',
  NOTIFY_ROLE = 'NotifyRole',
  // Logging stub for now, same treatment as the Task automation engine's own WEBHOOK action -
  // becomes a real outbound call once Batch 8 (Integrations Marketplace) builds real dispatch
  // infrastructure.
  WEBHOOK = 'Webhook',
}

export enum TicketAutomationConditionField {
  PRIORITY = 'Priority',
  CHANNEL = 'Channel',
  CUSTOMER_TIER = 'CustomerTier',
  TAG = 'Tag',
}

@Schema({ _id: false })
export class TicketAutomationCondition {
  @Prop({ type: String, enum: TicketAutomationConditionField, required: true })
  field!: TicketAutomationConditionField;

  @Prop({ required: true, trim: true, maxlength: 60 })
  value!: string;
}

export const TicketAutomationConditionSchema =
  SchemaFactory.createForClass(TicketAutomationCondition);

@Schema({ _id: false })
export class TicketAutomationAction {
  @Prop({ type: String, enum: TicketAutomationActionType, required: true })
  type!: TicketAutomationActionType;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  value!: string;
}

export const TicketAutomationActionSchema = SchemaFactory.createForClass(TicketAutomationAction);

@Schema({ _id: false })
export class TicketAutomationTrigger {
  @Prop({ type: String, enum: TicketAutomationTriggerType, required: true })
  type!: TicketAutomationTriggerType;

  // Only meaningful (and only ever set) for type === StatusChanged.
  @Prop({ type: String, default: null })
  toStatus!: string | null;

  @Prop({ type: String, default: null })
  fromStatus?: string | null;
}

export const TicketAutomationTriggerSchema = SchemaFactory.createForClass(TicketAutomationTrigger);

@Schema({ _id: false })
export class TicketAutomationRule {
  // Stable identity, assigned once and never reused - same convention as AutomationRule.id.
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ default: true })
  enabled!: boolean;

  @Prop({ type: TicketAutomationTriggerSchema, required: true })
  trigger!: TicketAutomationTrigger;

  // AND-combined; empty means "always match".
  @Prop({ type: [TicketAutomationConditionSchema], default: [] })
  conditions!: TicketAutomationCondition[];

  // Executed in array order.
  @Prop({ type: [TicketAutomationActionSchema], required: true })
  actions!: TicketAutomationAction[];
}

export const TicketAutomationRuleSchema = SchemaFactory.createForClass(TicketAutomationRule);

export interface TicketAutomationFiredAction {
  ruleId: string;
  ruleName: string;
  action: TicketAutomationAction;
}

export interface TicketAutomationTriggerEvent {
  type: TicketAutomationTriggerType;
  toStatus?: string;
  fromStatus?: string;
}

export interface TicketAutomationSnapshot {
  priority: string;
  channel: string;
  customerTier: string;
  tags: string[];
}

/**
 * Matches enabled rules against a fired trigger and flattens their actions in rule/array order.
 * Pure and side-effect-free, exactly mirroring evaluateAutomationRules's style so it's
 * exhaustively unit-testable in isolation.
 */
export function evaluateTicketAutomationRules(
  rules: TicketAutomationRule[],
  trigger: TicketAutomationTriggerEvent,
  ticket: TicketAutomationSnapshot,
): TicketAutomationFiredAction[] {
  const fired: TicketAutomationFiredAction[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.trigger.type !== trigger.type) continue;
    if (
      trigger.type === TicketAutomationTriggerType.STATUS_CHANGED &&
      rule.trigger.toStatus !== trigger.toStatus
    ) {
      continue;
    }
    if (
      trigger.type === TicketAutomationTriggerType.STATUS_CHANGED &&
      rule.trigger.fromStatus &&
      rule.trigger.fromStatus !== trigger.fromStatus
    ) {
      continue;
    }
    if (!matchesConditions(rule.conditions, ticket)) continue;

    for (const action of rule.actions) {
      fired.push({ ruleId: rule.id, ruleName: rule.name, action });
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
      case TicketAutomationConditionField.PRIORITY:
        return ticket.priority === condition.value;
      case TicketAutomationConditionField.CHANNEL:
        return ticket.channel === condition.value;
      case TicketAutomationConditionField.CUSTOMER_TIER:
        return ticket.customerTier === condition.value;
      case TicketAutomationConditionField.TAG:
        return ticket.tags.includes(condition.value);
    }
  });
}

/** Minimal literal placeholder substitution for an "Add Comment" action's text - mirrors
 * renderTemplate (Task-side) exactly. */
export function renderTicketTemplate(
  text: string,
  ticket: { subject: string; ticketKey: string; status: string },
): string {
  return text
    .replace(/\{\{\s*subject\s*\}\}/g, ticket.subject)
    .replace(/\{\{\s*ticketKey\s*\}\}/g, ticket.ticketKey)
    .replace(/\{\{\s*status\s*\}\}/g, ticket.status);
}
