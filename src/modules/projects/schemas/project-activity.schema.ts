import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProjectActivityDocument = HydratedDocument<ProjectActivity>;

export enum ProjectActivityAction {
  CREATED = 'created',
  STATUS_CHANGED = 'status_changed',
  MEMBER_ADDED = 'member_added',
  MEMBER_REMOVED = 'member_removed',
  UPDATED = 'updated',
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
export class ProjectActivity {
  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor!: Types.ObjectId;

  @Prop({ type: String, enum: ProjectActivityAction, required: true })
  action!: ProjectActivityAction;

  @Prop({ type: String, default: null })
  from!: string | null;

  @Prop({ type: String, default: null })
  to!: string | null;

  createdAt!: Date;
}

export const ProjectActivitySchema = SchemaFactory.createForClass(ProjectActivity);

ProjectActivitySchema.index({ project: 1, createdAt: -1 });
