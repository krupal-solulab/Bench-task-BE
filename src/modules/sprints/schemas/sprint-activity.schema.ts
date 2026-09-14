import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SprintActivityDocument = HydratedDocument<SprintActivity>;

export enum SprintActivityAction {
  CREATED = 'created',
  UPDATED = 'updated',
  STARTED = 'started',
  COMPLETED = 'completed',
  DELETED = 'deleted',
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
export class SprintActivity {
  @Prop({ type: Types.ObjectId, ref: 'Sprint', required: true })
  sprint!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor!: Types.ObjectId;

  @Prop({ type: String, enum: SprintActivityAction, required: true })
  action!: SprintActivityAction;

  @Prop({ type: String, default: null })
  from!: string | null;

  @Prop({ type: String, default: null })
  to!: string | null;

  createdAt!: Date;
}

export const SprintActivitySchema = SchemaFactory.createForClass(SprintActivity);

SprintActivitySchema.index({ sprint: 1, createdAt: -1 });
