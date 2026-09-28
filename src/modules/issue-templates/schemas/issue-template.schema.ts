import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { IssueType } from '../../../common/enums/issue-type.enum';
import { TaskPriority } from '../../../common/enums/task-priority.enum';

export type IssueTemplateDocument = HydratedDocument<IssueTemplate>;

/**
 * Module 12's Issue Templates - a reusable set of default field values that pre-fills the New
 * Task form. Deliberately NOT a server-side "apply" endpoint: like WorkflowTemplate's own
 * "apply" action (workflow-templates.service.ts), applying is 100% client-side - the frontend
 * fetches the template and calls react-hook-form's `setValue(...)` for each field, reusing the
 * exact mechanic TaskForm's suggested-fields "Apply" banner already established (Module 10).
 * `customFieldValues` is an opaque blob (the same convention SavedFilter's `query` field uses) -
 * never validated here, only re-validated by the real `POST tasks` path once actually submitted.
 */
@Schema({
  timestamps: true,
  minimize: false,
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
export class IssueTemplate {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  // Null means usable when creating an issue in any of the org's projects; set means scoped to
  // one specific project (e.g. a project with its own distinct intake structure).
  @Prop({ type: Types.ObjectId, ref: 'Project', default: null })
  projectId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ type: String, default: IssueType.TASK, trim: true, maxlength: 40 })
  issueType!: string;

  // Deliberately NOT `trim: true` (unlike name/issueType above) - a trailing space is often
  // meaningful here (e.g. "[Bug] " as a prefix the applied title continues from), not accidental
  // input noise Mongoose should silently strip.
  @Prop({ default: '', maxlength: 200 })
  titleTemplate!: string;

  @Prop({ default: '', maxlength: 5000 })
  description!: string;

  @Prop({ type: String, enum: TaskPriority, default: null })
  priority!: TaskPriority | null;

  @Prop({ type: [String], default: [] })
  labels!: string[];

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  customFieldValues!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const IssueTemplateSchema = SchemaFactory.createForClass(IssueTemplate);

IssueTemplateSchema.index({ organizationId: 1, projectId: 1 });
