import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum AutomationTriggerType {
  ISSUE_CREATED = 'IssueCreated',
  STATUS_CHANGED = 'StatusChanged',
}

export enum AutomationActionType {
  SET_STATUS = 'SetStatus',
  SET_PRIORITY = 'SetPriority',
  SET_ASSIGNEE = 'SetAssignee',
  ADD_LABELS = 'AddLabels',
  ADD_COMMENT = 'AddComment',
}

export enum AutomationConditionField {
  ISSUE_TYPE = 'IssueType',
  PRIORITY = 'Priority',
  COMPONENT = 'Component',
}

@Schema({ _id: false })
export class AutomationCondition {
  @Prop({ type: String, enum: AutomationConditionField, required: true })
  field!: AutomationConditionField;

  @Prop({ required: true, trim: true, maxlength: 60 })
  value!: string;
}

export const AutomationConditionSchema = SchemaFactory.createForClass(AutomationCondition);

@Schema({ _id: false })
export class AutomationAction {
  @Prop({ type: String, enum: AutomationActionType, required: true })
  type!: AutomationActionType;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  value!: string;
}

export const AutomationActionSchema = SchemaFactory.createForClass(AutomationAction);

@Schema({ _id: false })
export class AutomationTrigger {
  @Prop({ type: String, enum: AutomationTriggerType, required: true })
  type!: AutomationTriggerType;

  // Only meaningful (and only ever set) for type === StatusChanged.
  @Prop({ type: String, default: null })
  toStatus!: string | null;
}

export const AutomationTriggerSchema = SchemaFactory.createForClass(AutomationTrigger);

@Schema({ _id: false })
export class AutomationRule {
  // Stable identity, assigned once and never reused - same convention as
  // CustomFieldDefinition.id, so renaming a rule never loses its identity.
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ default: true })
  enabled!: boolean;

  @Prop({ type: AutomationTriggerSchema, required: true })
  trigger!: AutomationTrigger;

  // AND-combined; empty means "always match".
  @Prop({ type: [AutomationConditionSchema], default: [] })
  conditions!: AutomationCondition[];

  // Executed in array order.
  @Prop({ type: [AutomationActionSchema], required: true })
  actions!: AutomationAction[];
}

export const AutomationRuleSchema = SchemaFactory.createForClass(AutomationRule);

export interface AutomationFiredAction {
  ruleId: string;
  ruleName: string;
  action: AutomationAction;
}

export interface AutomationTriggerEvent {
  type: AutomationTriggerType;
  toStatus?: string;
}

export interface AutomationTaskSnapshot {
  issueType: string;
  priority: string;
  components: string[];
}

/**
 * Matches enabled rules against a fired trigger and flattens their actions in rule/array order.
 *
 * Pure and side-effect-free (no DB, no DI) so it's exhaustively unit-testable in isolation -
 * mirrors task-status.rules.ts / custom-field.schema.ts's validateCustomFieldValues style.
 */
export function evaluateAutomationRules(
  rules: AutomationRule[],
  trigger: AutomationTriggerEvent,
  task: AutomationTaskSnapshot,
): AutomationFiredAction[] {
  const fired: AutomationFiredAction[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.trigger.type !== trigger.type) continue;
    if (
      trigger.type === AutomationTriggerType.STATUS_CHANGED &&
      rule.trigger.toStatus !== trigger.toStatus
    ) {
      continue;
    }
    if (!matchesConditions(rule.conditions, task)) continue;

    for (const action of rule.actions) {
      fired.push({ ruleId: rule.id, ruleName: rule.name, action });
    }
  }

  return fired;
}

function matchesConditions(
  conditions: AutomationCondition[],
  task: AutomationTaskSnapshot,
): boolean {
  return conditions.every((condition) => {
    switch (condition.field) {
      case AutomationConditionField.ISSUE_TYPE:
        return task.issueType === condition.value;
      case AutomationConditionField.PRIORITY:
        return task.priority === condition.value;
      case AutomationConditionField.COMPONENT:
        return task.components.includes(condition.value);
    }
  });
}

/**
 * Minimal literal placeholder substitution for an "Add Comment" action's text - intentionally not
 * a templating library, just `{{title}}` / `{{issueKey}}` / `{{status}}`.
 */
export function renderTemplate(
  text: string,
  task: { title: string; issueKey: string | null; status: string },
): string {
  return text
    .replace(/\{\{\s*title\s*\}\}/g, task.title)
    .replace(/\{\{\s*issueKey\s*\}\}/g, task.issueKey ?? '')
    .replace(/\{\{\s*status\s*\}\}/g, task.status);
}
