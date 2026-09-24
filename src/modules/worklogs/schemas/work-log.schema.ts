import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkLogDocument = HydratedDocument<WorkLog>;

/**
 * Module 3's "log hours against a task" (BRD: Time Tracking & Work Logs). Mirrors Comment's
 * shape (task ref, author-style ref, soft delete) with time-tracking-specific fields added:
 * `hours`, `workDate` (the day the work was actually done, not necessarily today), and
 * `billable`. `project` is denormalized from the task (same reasoning as Task.organizationId
 * being denormalized from Project) so the project-wide timesheet/report queries never need to
 * join through Task.
 */
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
export class WorkLog {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  // Who logged the time - always the acting user at creation (see WorkLogsService.create), never
  // client-supplied, mirroring Jira's default "you log your own work" behavior.
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true, min: 0.1, max: 24 })
  hours!: number;

  @Prop({ default: '', maxlength: 2000 })
  description!: string;

  // The day the work was actually performed - may differ from createdAt (logged after the fact).
  @Prop({ type: Date, required: true })
  workDate!: Date;

  @Prop({ default: true })
  billable!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkLogSchema = SchemaFactory.createForClass(WorkLog);

WorkLogSchema.index({ task: 1, workDate: -1 });
WorkLogSchema.index({ project: 1, workDate: 1 });
WorkLogSchema.index({ project: 1, user: 1 });
WorkLogSchema.index({ organizationId: 1 });
