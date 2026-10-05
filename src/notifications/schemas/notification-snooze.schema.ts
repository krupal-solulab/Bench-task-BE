import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationSnoozeDocument = HydratedDocument<NotificationSnooze>;

/**
 * Module 11 gap-closure: per-issue notification snooze. While `until` is in the future, the
 * owner's notifications about `task` are left out of their list and unread count; nothing is
 * deleted, so they simply reappear once the snooze ends (or is cancelled). Personal to the owner -
 * it never affects anyone else's notifications.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    virtuals: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      ret.taskId = ret.task?.toString?.() ?? ret.task;
      delete ret._id;
      delete ret.__v;
      delete ret.task;
      return ret;
    },
  },
})
export class NotificationSnooze {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  owner!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  until!: Date;

  createdAt!: Date;
}

export const NotificationSnoozeSchema = SchemaFactory.createForClass(NotificationSnooze);
NotificationSnoozeSchema.index({ owner: 1, task: 1 }, { unique: true });
NotificationSnoozeSchema.index({ owner: 1, until: 1 });
