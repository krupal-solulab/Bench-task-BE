import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { OrganizationStatus } from '../../../common/enums/organization-status.enum';
import {
  BusinessHoursCalendar,
  BusinessHoursCalendarSchema,
} from '../../tickets/schemas/business-hours-calendar.schema';
import {
  TicketAutomationRule,
  TicketAutomationRuleSchema,
} from '../../tickets/schemas/ticket-automation-rule.schema';
import { TicketMacro, TicketMacroSchema } from '../../tickets/schemas/ticket-macro.schema';
import {
  TicketScheduledAutomation,
  TicketScheduledAutomationSchema,
} from '../../tickets/schemas/ticket-scheduled-automation.schema';
import {
  TicketSlaPolicyEntry,
  TicketSlaPolicyEntrySchema,
} from '../../tickets/schemas/ticket-sla-policy.schema';

export type OrganizationDocument = HydratedDocument<Organization>;

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Organization {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 120 })
  name!: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  slug!: string;

  @Prop({ type: String, enum: OrganizationStatus, default: OrganizationStatus.ACTIVE })
  status!: OrganizationStatus;

  @Prop({ type: Date, default: null })
  suspendedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  // IANA timezone name (e.g. "America/New_York") - the anchor a Business Hours calendar needs
  // for the support-ticketing SLA engine. Defaults to UTC so every existing org is unaffected
  // until it deliberately configures one.
  @Prop({ type: String, default: 'UTC' })
  timezone!: string;

  // Short, unique-enough prefix for human-readable ticket keys ("SUP-101") - assigned once on
  // first use, same lazy-assignment shape as Project.key (see getOrAssignTicketKeyPrefix).
  @Prop({ type: String, default: null })
  ticketKeyPrefix!: string | null;

  // Atomic per-org ticket-number sequence (see OrganizationsService.nextTicketNumber) - tickets
  // aren't project-scoped, so this lives on Organization rather than mirroring Project.issueSeq.
  @Prop({ type: Number, default: 0 })
  ticketKeySeq!: number;

  // BRD 3.3's Triggers/Automations/Macros + BRD 3.4's Advanced SLA/Business Hours - embedded
  // per-org config, mirroring how Project.automationRules/slaPolicy/notificationScheme work at
  // the project level. Tickets are org-scoped (not project-scoped), so Organization is their
  // natural parent container. All default to empty/null, so every existing org is unaffected
  // until it deliberately configures one.
  @Prop({ type: [TicketAutomationRuleSchema], default: [] })
  ticketAutomationRules!: TicketAutomationRule[];

  @Prop({ type: [TicketScheduledAutomationSchema], default: [] })
  ticketScheduledAutomations!: TicketScheduledAutomation[];

  @Prop({ type: [TicketMacroSchema], default: [] })
  ticketMacros!: TicketMacro[];

  @Prop({ type: [TicketSlaPolicyEntrySchema], default: [] })
  ticketSlaPolicy!: TicketSlaPolicyEntry[];

  @Prop({ type: BusinessHoursCalendarSchema, default: null })
  businessHoursCalendar!: BusinessHoursCalendar | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const OrganizationSchema = SchemaFactory.createForClass(Organization);

OrganizationSchema.index({ status: 1 });
