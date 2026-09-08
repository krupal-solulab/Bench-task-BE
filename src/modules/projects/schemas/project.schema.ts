import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProjectStatus } from '../../../common/enums/project-status.enum';

export type ProjectDocument = HydratedDocument<Project>;

@Schema({ _id: false })
export class ProjectMember {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  joinedAt!: Date;
}

export const ProjectMemberSchema = SchemaFactory.createForClass(ProjectMember);

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
export class Project {
  @Prop({ required: true, trim: true, minlength: 3, maxlength: 120 })
  name!: string;

  @Prop({ default: '', maxlength: 2000 })
  description!: string;

  @Prop({ type: String, enum: ProjectStatus, default: ProjectStatus.PLANNING })
  status!: ProjectStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  owner!: Types.ObjectId;

  @Prop({ type: [ProjectMemberSchema], default: [] })
  members!: ProjectMember[];

  @Prop({ required: true, default: () => new Date() })
  startDate!: Date;

  @Prop({ type: Date })
  dueDate!: Date;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

ProjectSchema.index({ owner: 1 });
ProjectSchema.index({ status: 1 });
ProjectSchema.index({ 'members.user': 1 });
ProjectSchema.index({ deletedAt: 1 });
ProjectSchema.index({ name: 'text' });
ProjectSchema.index({ organizationId: 1 });
ProjectSchema.index({ organizationId: 1, status: 1 });
