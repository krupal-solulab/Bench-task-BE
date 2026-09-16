import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Workflow, WorkflowSchema } from '../../modules/projects/schemas/workflow.schema';

export type WorkflowTemplateDocument = HydratedDocument<WorkflowTemplate>;

/**
 * A Platform-Admin-maintained, org-agnostic starter workflow (the BRD's "library of starter
 * workflows... that Org Admins clone and customize") - global, not scoped to any organization,
 * since one library serves every org. Cloning is client-side: the frontend takes a template's
 * `workflow` and feeds it into the existing update-workflow draft state for further editing, so
 * nothing here needs a "clone" endpoint or a link back to whichever project used it.
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
export class WorkflowTemplate {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 60 })
  name!: string;

  @Prop({ default: '', maxlength: 500 })
  description!: string;

  @Prop({ type: WorkflowSchema, required: true })
  workflow!: Workflow;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkflowTemplateSchema = SchemaFactory.createForClass(WorkflowTemplate);
