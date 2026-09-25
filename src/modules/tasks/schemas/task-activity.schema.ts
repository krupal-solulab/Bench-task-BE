import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TaskActivityDocument = HydratedDocument<TaskActivity>;

export enum TaskActivityAction {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  REASSIGNED = 'reassigned',
  PRIORITY_CHANGED = 'priority_changed',
  DUE_DATE_CHANGED = 'due_date_changed',
  UPDATED = 'updated',
  DELETED = 'deleted',
  SPRINT_ASSIGNED = 'sprint_assigned',
  SPRINT_REMOVED = 'sprint_removed',
  // Module 7 - logged once per new comment (not on comment edit/delete, to keep the history
  // signal-heavy rather than noisy); watch/vote/mention are deliberately NOT logged here, mirroring
  // Jira's own History tab, which doesn't record those either.
  COMMENTED = 'commented',
}

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
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
export class TaskActivity {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor!: Types.ObjectId;

  @Prop({ type: String, enum: TaskActivityAction, required: true })
  action!: TaskActivityAction;

  @Prop({ type: String, default: null })
  from!: string | null;

  @Prop({ type: String, default: null })
  to!: string | null;

  // Set only when this entry was produced by an automation rule's action rather than directly by
  // `actor` - null for every entry logged before this feature and for every human-initiated change.
  @Prop({ type: String, default: null })
  viaAutomationRule!: string | null;

  createdAt!: Date;
}

export const TaskActivitySchema = SchemaFactory.createForClass(TaskActivity);

TaskActivitySchema.index({ task: 1, createdAt: -1 });
