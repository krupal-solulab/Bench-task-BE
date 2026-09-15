import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { TaskStatus } from '../../../common/enums/task-status.enum';

@Schema({ _id: false })
export class WorkflowStatus {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 40 })
  name!: string;

  @Prop({ type: String, enum: StatusCategory, required: true })
  category!: StatusCategory;
}

export const WorkflowStatusSchema = SchemaFactory.createForClass(WorkflowStatus);

@Schema({ _id: false })
export class WorkflowTransition {
  @Prop({ required: true, trim: true, maxlength: 40 })
  from!: string;

  @Prop({ required: true, trim: true, maxlength: 40 })
  to!: string;
}

export const WorkflowTransitionSchema = SchemaFactory.createForClass(WorkflowTransition);

@Schema({ _id: false })
export class Workflow {
  @Prop({ type: [WorkflowStatusSchema], required: true })
  statuses!: WorkflowStatus[];

  @Prop({ type: [WorkflowTransitionSchema], required: true })
  transitions!: WorkflowTransition[];

  @Prop({ required: true, trim: true, maxlength: 40 })
  initialStatus!: string;
}

export const WorkflowSchema = SchemaFactory.createForClass(Workflow);

/**
 * The system default workflow - byte-for-byte today's hardcoded Todo/In Progress/Review/Done
 * statuses and transitions. Used for every project whose `workflow` field is null (i.e. every
 * pre-existing project, and any new project that never opens the workflow settings), so nothing
 * changes for anyone who doesn't deliberately opt in to a custom workflow.
 */
export const DEFAULT_WORKFLOW: Workflow = {
  statuses: [
    { name: TaskStatus.TODO, category: StatusCategory.TODO },
    { name: TaskStatus.IN_PROGRESS, category: StatusCategory.IN_PROGRESS },
    { name: TaskStatus.REVIEW, category: StatusCategory.IN_PROGRESS },
    { name: TaskStatus.DONE, category: StatusCategory.DONE },
  ],
  transitions: [
    { from: TaskStatus.TODO, to: TaskStatus.IN_PROGRESS },
    { from: TaskStatus.IN_PROGRESS, to: TaskStatus.REVIEW },
    { from: TaskStatus.IN_PROGRESS, to: TaskStatus.TODO },
    { from: TaskStatus.REVIEW, to: TaskStatus.DONE },
    { from: TaskStatus.REVIEW, to: TaskStatus.IN_PROGRESS },
    { from: TaskStatus.DONE, to: TaskStatus.IN_PROGRESS },
  ],
  initialStatus: TaskStatus.TODO,
};

export interface WorkflowCarrier {
  workflow?: Workflow | null;
}

/** A project's effective workflow - its own custom one, or the system default when unset. */
export function resolveWorkflow(project: WorkflowCarrier): Workflow {
  return project.workflow ?? DEFAULT_WORKFLOW;
}

export function categoryOf(workflow: Workflow, statusName: string): StatusCategory | undefined {
  return workflow.statuses.find((s) => s.name === statusName)?.category;
}
