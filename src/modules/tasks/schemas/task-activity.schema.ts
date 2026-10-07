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
  // Module 12's Approval Workflows - a transition whose rule has `requiresApproval` doesn't apply
  // immediately; it logs APPROVAL_REQUESTED and waits for a separate approve/reject call to log
  // one of the other two. `from`/`to` on all three carry the task's current status and the
  // requested target status, exactly like STATUS_CHANGED.
  APPROVAL_REQUESTED = 'approval_requested',
  APPROVAL_GRANTED = 'approval_granted',
  APPROVAL_REJECTED = 'approval_rejected',
  // Module 5 gap-closure - `from`/`to` carry the old/new issueKey (the most visible thing that
  // changed), not the project ids.
  MOVED_PROJECT = 'moved_project',
  // Module 12 gap-closure: one approver approved a multi-approver request that still needs more.
  APPROVAL_RECORDED = 'approval_recorded',
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

  // Module 12 gap-closure: field-level audit trail - for an `updated` entry, which field changed
  // (a built-in field id such as "labels", or a custom field id); from/to hold its old/new value.
  // Null on every entry written before this existed (shown as a generic "updated").
  @Prop({ type: String, default: null })
  field!: string | null;

  // Gap-closure: for fixVersions/affectsVersions changes, the release ids before and after (from/to
  // hold display names, which can be renamed). Lets a release comparison find issues that were
  // later moved OUT of a release. Unset on every other entry.
  @Prop({ type: [String], default: undefined })
  fromRefs?: string[];

  @Prop({ type: [String], default: undefined })
  toRefs?: string[];

  createdAt!: Date;
}

export const TaskActivitySchema = SchemaFactory.createForClass(TaskActivity);

TaskActivitySchema.index({ task: 1, createdAt: -1 });
TaskActivitySchema.index({ field: 1, fromRefs: 1 });
