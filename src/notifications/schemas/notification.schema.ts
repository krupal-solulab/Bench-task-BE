import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  TASK_ASSIGNED = 'TaskAssigned',
  STATUS_CHANGED = 'StatusChanged',
  COMMENT_ADDED = 'CommentAdded',
  DUE_SOON = 'DueSoon',
  // Sent by an automation rule's NotifyRole post-function action (Workflow Engine v2).
  AUTOMATION = 'Automation',
}

export const NOTIFICATION_TYPES = Object.values(NotificationType);

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      ret.read = !!ret.readAt;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipient!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: String, enum: NotificationType, required: true })
  type!: NotificationType;

  @Prop({ required: true, maxlength: 200 })
  title!: string;

  @Prop({ required: true, maxlength: 500 })
  message!: string;

  @Prop({ type: Types.ObjectId, ref: 'Task', default: null })
  taskId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Project', default: null })
  projectId!: Types.ObjectId | null;

  // null = unread. Set once, to the time it was marked read.
  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  createdAt!: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ recipient: 1, createdAt: -1 });
NotificationSchema.index({ recipient: 1, readAt: 1 });
