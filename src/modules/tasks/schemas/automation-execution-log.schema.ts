import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AutomationExecutionLogDocument = HydratedDocument<AutomationExecutionLog>;

export enum AutomationExecutionOutcome {
  SUCCESS = 'success',
  FAILURE = 'failure',
}

/**
 * A dedicated, queryable record of every automation rule firing - which rule, when, on which
 * task/project, what it did, and whether it succeeded. Distinct from `TaskActivity` (a per-task
 * activity feed entry, not org/project-wide queryable) and from `ApiLogsModule` (an unrelated
 * HTTP-request audit log). Written by the automation queue's processor for every job it handles,
 * success or failure (BRD 8's "Automation audit trail - which rule fired, when, on which issue").
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
export class AutomationExecutionLog {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task!: Types.ObjectId;

  @Prop({ required: true })
  ruleId!: string;

  @Prop({ required: true, trim: true, maxlength: 60 })
  ruleName!: string;

  @Prop({ required: true, trim: true, maxlength: 40 })
  triggerType!: string;

  // A short human-readable summary per action fired (e.g. "SetStatus: Done"), not the full
  // action objects - this is an audit trail, not a replay log.
  @Prop({ type: [String], default: [] })
  actionSummaries!: string[];

  @Prop({ type: String, enum: AutomationExecutionOutcome, required: true })
  outcome!: AutomationExecutionOutcome;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  createdAt!: Date;
}

export const AutomationExecutionLogSchema = SchemaFactory.createForClass(AutomationExecutionLog);

AutomationExecutionLogSchema.index({ project: 1, createdAt: -1 });
