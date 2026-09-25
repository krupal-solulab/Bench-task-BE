import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type CommentDocument = HydratedDocument<Comment>;

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
      return ret;
    },
  },
})
export class Comment {
  @Prop({ type: Types.ObjectId, ref: 'Task', required: true })
  task!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  author!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 2000 })
  body!: string;

  // Module 7's @mentions - derived server-side from `body`'s `@[Name](userId)` markup at
  // create/update time (see mention.util.ts), never trusted as a separately client-supplied
  // field. Empty for every comment written before this feature existed, and for any comment
  // whose body contains no mention markup.
  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  mentionedUserIds!: Types.ObjectId[];

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CommentSchema = SchemaFactory.createForClass(Comment);

CommentSchema.index({ task: 1, createdAt: -1 });
