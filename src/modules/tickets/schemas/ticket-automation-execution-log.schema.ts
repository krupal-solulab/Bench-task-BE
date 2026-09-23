import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TicketAutomationExecutionLogDocument = HydratedDocument<TicketAutomationExecutionLog>;

export enum TicketAutomationExecutionOutcome {
  SUCCESS = 'success',
  FAILURE = 'failure',
}

/**
 * Ticket-side mirror of AutomationExecutionLog (task-automation's own audit trail) - a dedicated,
 * queryable record of every ticket Trigger/Automation/Macro firing, written by
 * TicketAutomationJobProcessor's consumer for every job it handles, success or failure.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
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
export class TicketAutomationExecutionLog {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticket!: Types.ObjectId;

  @Prop({ required: true })
  ruleId!: string;

  @Prop({ required: true, trim: true, maxlength: 60 })
  ruleName!: string;

  @Prop({ required: true, trim: true, maxlength: 40 })
  triggerType!: string;

  // A short human-readable summary per action fired (e.g. "SetStatus: Solved"), not the full
  // action objects - this is an audit trail, not a replay log.
  @Prop({ type: [String], default: [] })
  actionSummaries!: string[];

  @Prop({ type: String, enum: TicketAutomationExecutionOutcome, required: true })
  outcome!: TicketAutomationExecutionOutcome;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  createdAt!: Date;
}

export const TicketAutomationExecutionLogSchema = SchemaFactory.createForClass(
  TicketAutomationExecutionLog,
);

TicketAutomationExecutionLogSchema.index({ organizationId: 1, createdAt: -1 });
