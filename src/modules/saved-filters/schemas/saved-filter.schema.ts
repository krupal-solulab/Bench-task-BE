import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SavedFilterDocument = HydratedDocument<SavedFilter>;

export enum SavedFilterScope {
  PROJECT = 'project',
  MY_TASKS = 'myTasks',
}

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
export class SavedFilter {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  owner!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ type: String, enum: SavedFilterScope, required: true })
  scope!: SavedFilterScope;

  // Required (and only meaningful) when scope === PROJECT.
  @Prop({ type: Types.ObjectId, ref: 'Project', default: null })
  projectId!: Types.ObjectId | null;

  // The raw TaskListQuery (minus `page`) this filter replays - validated once already when the
  // frontend built it, and only ever re-applied through the real, fully-validated list endpoints,
  // so it's stored as an opaque object rather than re-validated field-by-field here.
  @Prop({ type: Object, required: true })
  query!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SavedFilterSchema = SchemaFactory.createForClass(SavedFilter);

SavedFilterSchema.index({ owner: 1, scope: 1, projectId: 1 });
