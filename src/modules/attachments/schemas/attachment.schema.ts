import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AttachmentDocument = HydratedDocument<Attachment>;

@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      ret.taskId = ret.task?.toString?.() ?? ret.task;
      delete ret._id;
      delete ret.__v;
      delete ret.task;
      delete ret.storageKey;
      return ret;
    },
  },
})
export class Attachment {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 255 })
  filename!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ required: true })
  size!: number;

  @Prop({ required: true })
  storageKey!: string;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

AttachmentSchema.index({ task: 1, createdAt: -1 });
