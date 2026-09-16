import { BadRequestException } from '@nestjs/common';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { TaskStatus } from '../../../common/enums/task-status.enum';
import { Role } from '../../../common/enums/role.enum';

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

  // Condition: who's allowed to trigger this specific transition. Unset/empty (every existing
  // transition) means "anyone with the base status-change permission" - identical to today; this
  // only ever narrows a transition further, never widens who can change status at all.
  @Prop({ type: [String], enum: Role })
  allowedRoles?: Role[];

  // Validator: the task must already have at least one comment before this transition is allowed
  // (e.g. "no move to Done without a resolution comment"). Unset/false means no requirement,
  // identical to today.
  @Prop({ type: Boolean })
  requireComment?: boolean;
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

// A per-issue-type workflow override - the BRD's "Epics, Stories/Tasks/Bugs, and Sub-tasks can
// each have their own workflow." `issueType` is the type's name (e.g. "Bug", or a custom
// Standard-level name an Admin added - see issue-type.schema.ts).
@Schema({ _id: false })
export class WorkflowByType {
  @Prop({ required: true, trim: true, maxlength: 40 })
  issueType!: string;

  @Prop({ type: WorkflowSchema, required: true })
  workflow!: Workflow;
}

export const WorkflowByTypeSchema = SchemaFactory.createForClass(WorkflowByType);

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
  workflowsByType?: WorkflowByType[];
}

/**
 * A project's effective workflow - optionally scoped to a specific issue type. If `issueType` is
 * given and that type has its own override in `workflowsByType`, that wins; otherwise (and for
 * every call that omits `issueType`, which is every call site that existed before this feature)
 * this falls back to the project's single legacy workflow, or the system default - byte-identical
 * to `resolveWorkflow`'s behavior before per-issue-type workflows existed.
 */
export function resolveWorkflow(project: WorkflowCarrier, issueType?: string): Workflow {
  if (issueType) {
    const override = project.workflowsByType?.find((w) => w.issueType === issueType);
    if (override) return override.workflow;
  }
  return project.workflow ?? DEFAULT_WORKFLOW;
}

export function categoryOf(workflow: Workflow, statusName: string): StatusCategory | undefined {
  return workflow.statuses.find((s) => s.name === statusName)?.category;
}

/**
 * The structural validity checks every workflow (a project's own, a per-issue-type override, or a
 * Platform-Admin workflow template) must pass, regardless of where it's being saved - extracted
 * so `ProjectsService`/`WorkflowTemplatesService` share one implementation rather than risking two
 * validators drifting apart. Does not check for orphaned tasks - that requires a DB query and
 * stays in `ProjectsService`, which is the only place that has tasks to check against.
 */
export function assertValidWorkflowShape(workflow: Workflow): void {
  if (workflow.statuses.length === 0) {
    throw new BadRequestException('A workflow needs at least one status');
  }
  const names = workflow.statuses.map((s) => s.name);
  if (new Set(names).size !== names.length) {
    throw new BadRequestException('Status names must be unique');
  }
  if (!names.includes(workflow.initialStatus)) {
    throw new BadRequestException("initialStatus must be one of the workflow's statuses");
  }
  for (const t of workflow.transitions) {
    if (!names.includes(t.from) || !names.includes(t.to)) {
      throw new BadRequestException(
        `Transition ${t.from} -> ${t.to} references a status that isn't in this workflow`,
      );
    }
  }
}
