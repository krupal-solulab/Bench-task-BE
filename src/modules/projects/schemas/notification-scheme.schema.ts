import { BadRequestException } from '@nestjs/common';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ORG_ROLES, Role } from '../../../common/enums/role.enum';

/**
 * The BRD's "Notification Scheme" event catalog. SLA breach is deliberately excluded - no
 * SLA-tracking feature exists anywhere in this codebase yet, so there is nothing real for it to
 * trigger on; adding it here would be a configurable option that silently never fires.
 */
export enum NotificationSchemeEvent {
  ASSIGNED = 'Assigned',
  COMMENTED = 'Commented',
  TRANSITIONED = 'Transitioned',
  SPRINT_STARTED = 'SprintStarted',
  SPRINT_COMPLETED = 'SprintCompleted',
}

export const NOTIFICATION_SCHEME_EVENTS = Object.values(NotificationSchemeEvent);

/** WhatsApp has no provider configured anywhere in this codebase - selecting it logs a
 * "would send" message via NotificationsService, mirroring the Webhook automation action and the
 * LoggingEmailService's own existing stub treatment. */
export enum NotificationChannel {
  IN_APP = 'InApp',
  EMAIL = 'Email',
  WHATSAPP = 'WhatsApp',
}

export const NOTIFICATION_CHANNELS = Object.values(NotificationChannel);

@Schema({ _id: false })
export class NotificationSchemeRule {
  @Prop({ type: String, enum: NotificationSchemeEvent, required: true })
  event!: NotificationSchemeEvent;

  // Which roles get notified for this event - resolved per-project via
  // ProjectsService.membersWithRole, the same helper the Automation Engine's NotifyRole action
  // already uses. Empty (default) means "nobody extra" - the event's existing hardcoded behavior
  // (e.g. the assignee gets notified) is unaffected either way.
  @Prop({ type: [String], enum: ORG_ROLES, default: [] })
  notifyRoles!: Role[];

  @Prop({ type: [String], enum: NotificationChannel, default: [] })
  channels!: NotificationChannel[];
}

export const NotificationSchemeRuleSchema = SchemaFactory.createForClass(NotificationSchemeRule);

/**
 * Rejects a scheme that: names the same event twice, targets a non-org role, or selects roles
 * with no channel to notify them over. Pure and side-effect-free, mirroring
 * assertValidWorkflowShape/assertValidAutomationRule's style.
 */
export function assertValidNotificationScheme(rules: NotificationSchemeRule[]): void {
  const seenEvents = new Set<string>();
  for (const rule of rules) {
    if (!NOTIFICATION_SCHEME_EVENTS.includes(rule.event)) {
      throw new BadRequestException(`"${rule.event}" is not a configurable notification event`);
    }
    if (seenEvents.has(rule.event)) {
      throw new BadRequestException(
        `Duplicate notification scheme entry for event "${rule.event}"`,
      );
    }
    seenEvents.add(rule.event);

    for (const role of rule.notifyRoles) {
      if (!ORG_ROLES.includes(role as (typeof ORG_ROLES)[number])) {
        throw new BadRequestException(`"${role}" cannot be targeted by a notification scheme`);
      }
    }
    for (const channel of rule.channels) {
      if (!NOTIFICATION_CHANNELS.includes(channel)) {
        throw new BadRequestException(`"${channel}" is not a supported notification channel`);
      }
    }
    if (rule.notifyRoles.length > 0 && rule.channels.length === 0) {
      throw new BadRequestException(
        `Select at least one channel for the "${rule.event}" notification scheme entry`,
      );
    }
  }
}

/** The matching rule for an event, or undefined if unconfigured or configured with no roles
 * (an empty-roles rule is a harmless no-op, equivalent to not having one at all). */
export function resolveNotificationSchemeRule(
  project: { notificationScheme?: NotificationSchemeRule[] },
  event: NotificationSchemeEvent,
): NotificationSchemeRule | undefined {
  return project.notificationScheme?.find((r) => r.event === event && r.notifyRoles.length > 0);
}
