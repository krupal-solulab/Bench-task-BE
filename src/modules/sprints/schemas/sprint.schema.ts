import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SprintStatus } from '../../../common/enums/sprint-status.enum';

export type SprintDocument = HydratedDocument<Sprint>;

@Schema({
  timestamps: true,
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
export class Sprint {
  @Prop({ required: true, trim: true, minlength: 3, maxlength: 100 })
  name!: string;

  @Prop({ default: '', maxlength: 1000 })
  goal!: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  @Prop({ type: String, enum: SprintStatus, default: SprintStatus.PLANNED })
  status!: SprintStatus;

  @Prop({ type: Date, required: true })
  startDate!: Date;

  @Prop({ type: Date, required: true })
  endDate!: Date;

  // Kept separate from startDate/endDate (the editable, plannable dates) the same way
  // Task.completedAt is kept separate from status - these are only ever set by the Start/Complete
  // lifecycle actions themselves, never by an ordinary edit.
  @Prop({ type: Date, default: null })
  startedAt!: Date | null;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SprintSchema = SchemaFactory.createForClass(Sprint);

// A compound index's prefix ({ project: 1 }) already serves plain project-scoped queries, so no
// separate single-field { project: 1 } index is declared here (Mongoose warns on the duplicate key
// pattern otherwise).
SprintSchema.index({ project: 1, status: 1 });
SprintSchema.index({ organizationId: 1 });

// DB-level backstop for "at most one Active sprint per project" - the service layer checks this
// too, but only this partial unique index makes the invariant race-safe under concurrent requests.
SprintSchema.index(
  { project: 1 },
  { unique: true, partialFilterExpression: { status: SprintStatus.ACTIVE, deletedAt: null } },
);
