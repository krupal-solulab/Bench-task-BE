import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProjectCategoryDocument = HydratedDocument<ProjectCategory>;

/**
 * Module 8 gap-closure: an org-wide project category (e.g. "Client Work", "Internal") that Admins
 * maintain and any project can optionally point at via `Project.categoryId`. A real collection
 * rather than an embedded `Organization` array (unlike link types) so a project references a
 * category by a real ObjectId and "is it in use" is a plain `projectModel.countDocuments` query -
 * the same in-use convention every org-level scheme already follows.
 */
@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
})
export class ProjectCategory {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ default: '', maxlength: 500 })
  description!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProjectCategorySchema = SchemaFactory.createForClass(ProjectCategory);
// Case-insensitive uniqueness per org - "Internal" and "internal" are the same category.
ProjectCategorySchema.index(
  { organizationId: 1, name: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } },
);
