import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { TicketPriority } from '../../../common/enums/ticket-priority.enum';
import { TicketStatus, TicketStatusCategory } from '../../../common/enums/ticket-status.enum';

export type TicketDocument = HydratedDocument<Ticket>;

// Only 'manual' is ever set until later channel batches (email-to-ticket, chat, WhatsApp/SMS/
// social) add real values - see the Phase 3 plan's batch roadmap.
export enum TicketChannel {
  MANUAL = 'manual',
}

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Ticket {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Customer', required: true })
  customer!: Types.ObjectId;

  // The staff member who filed the ticket - stands in as the "actor" for system/scheduled
  // automation actions that have no human actingUser (mirrors Task.createdBy's own role in
  // TasksService.checkUnassignedForDurationRules' systemActingUser).
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  // Individual staff only for v1 - no agent-group/team concept exists anywhere in this codebase
  // today, and inventing one prematurely was a documented simplification in the Phase 3 plan.
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignee!: Types.ObjectId | null;

  // "SUP-101" style, assigned once at creation via OrganizationsService's atomic counter - mirrors
  // Task.issueKey exactly, just org-scoped instead of project-scoped.
  @Prop({ type: String, required: true })
  ticketKey!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 200 })
  subject!: string;

  @Prop({ default: '', maxlength: 10000 })
  description!: string;

  @Prop({ type: String, enum: TicketStatus, default: TicketStatus.NEW })
  status!: TicketStatus;

  // Denormalized from `status` (see TicketsService) - Open/Paused/Terminal, so the SLA clock's
  // "is this paused" check is a category comparison, not a status-name comparison.
  @Prop({ type: String, enum: TicketStatusCategory, default: TicketStatusCategory.OPEN })
  statusCategory!: TicketStatusCategory;

  @Prop({ type: String, enum: TicketPriority, default: TicketPriority.NORMAL })
  priority!: TicketPriority;

  @Prop({ type: String, enum: TicketChannel, default: TicketChannel.MANUAL })
  channel!: TicketChannel;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  // Optional escalation link to a Task (engineering follow-up) - validated at write time
  // (TicketsService) that the linked Task's organizationId matches this Ticket's, closing the
  // cross-org leak the Phase 3 plan's security review flagged. Never populated on any
  // customer-reachable serializer.
  @Prop({ type: Types.ObjectId, ref: 'Task', default: null })
  linkedTaskId!: Types.ObjectId | null;

  // Set on the first isPublic:true STAFF comment - the SLA engine's first-response measurement.
  @Prop({ type: Date, default: null })
  firstRespondedAt!: Date | null;

  // Set when status transitions into the Terminal category (Solved/Closed).
  @Prop({ type: Date, default: null })
  solvedAt!: Date | null;

  // Accumulated milliseconds spent in the Paused category (status = Pending) - subtracted from
  // elapsed time by the SLA breach calculation once Batch 1 builds it, so a ticket parked waiting
  // on the customer doesn't count against the agent's SLA.
  @Prop({ type: Number, default: 0 })
  pausedAccumMs!: number;

  // Set when the current Paused period began (status just became Pending) - used to compute how
  // much to add to pausedAccumMs once the ticket leaves Pending. Null whenever not currently
  // paused.
  @Prop({ type: Date, default: null })
  pausedSince!: Date | null;

  // Business-hours-aware twin of pausedAccumMs (see calculateElapsedBusinessMs) - computed
  // incrementally at the same moment pausedAccumMs is (leaving the Paused category), so the SLA
  // breach calculation can subtract exactly the business-hours portion of paused time without
  // needing a full pause-interval log.
  @Prop({ type: Number, default: 0 })
  pausedAccumBusinessMs!: number;

  // Set at creation and on every status change (see TicketsService.updateStatus) - how long the
  // ticket has been in its CURRENT status, used by the scheduled Automation sweep's `afterHours`
  // check.
  @Prop({ type: Date, default: null })
  statusEnteredAt!: Date | null;

  // Scheduled-Automation ids already fired for the current status episode (see statusEnteredAt) -
  // prevents the hourly sweep from re-firing the same automation every run; cleared whenever
  // status changes, mirroring Task.firedTimeBasedRuleIds' own per-episode reset.
  @Prop({ type: [String], default: [] })
  firedScheduledAutomationIds!: string[];

  // Idempotency flag for the hard SLA-breach check (mirrors Task.slaBreachNotifiedAt) - null
  // means "not yet notified", independent per resolution-vs-first-response target isn't tracked
  // separately in v1 (one notification per ticket's overall SLA breach, same granularity BRD 3.4
  // asks for).
  @Prop({ type: Date, default: null })
  slaBreachNotifiedAt!: Date | null;

  // Idempotency flag for the pre-breach escalation-chain notification - distinct from
  // slaBreachNotifiedAt so both the "about to breach" warning and the hard breach can each fire
  // exactly once.
  @Prop({ type: Date, default: null })
  slaEscalatedAt!: Date | null;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);

TicketSchema.index({ organizationId: 1 });
TicketSchema.index({ organizationId: 1, status: 1 });
TicketSchema.index({ organizationId: 1, statusCategory: 1 });
TicketSchema.index({ organizationId: 1, assignee: 1 });
TicketSchema.index({ organizationId: 1, customer: 1 });
// Scoped per-org, not globally unique - mirrors Customer's {organizationId, email} compound index
// exactly, and for the same reason: two different orgs' generated ticketKey prefixes (derived from
// their names) can collide (e.g. "Support Inc" and "Sun Products" both -> "SU"-prefixed), and
// ticketKey is only ever looked up/displayed within its own org's context, never globally.
TicketSchema.index({ organizationId: 1, ticketKey: 1 }, { unique: true });
