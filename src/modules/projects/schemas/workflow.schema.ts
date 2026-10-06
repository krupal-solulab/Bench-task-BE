import { BadRequestException } from '@nestjs/common';
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { TaskStatus } from '../../../common/enums/task-status.enum';
import { Role } from '../../../common/enums/role.enum';

@Schema({ _id: false })
export class WorkflowStatus {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 40 })
  name!: string;

  @Prop({ type: String, enum: StatusCategory, required: true })
  category!: StatusCategory;

  // WIP limit for this column on the Kanban board (BRD 6.1: "WIP limits per column with a visual
  // warning when exceeded"). Unset/undefined (every existing status) means no limit, identical to
  // today - this is purely a display warning, never enforced server-side as a hard block, since a
  // hard block would be a behavior change nobody asked for.
  @Prop({ type: Number, min: 1 })
  wipLimit?: number;
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

  // Validator: custom field ids (from the project's custom field definitions) that must already
  // have a value before this transition is allowed - the generalized form of `requireComment`,
  // reusing the same required-field convention as `CustomFieldOverrideByType.requiredFieldIds`
  // (see custom-field.schema.ts). Unset/empty means no requirement, identical to today.
  @Prop({ type: [String], default: [] })
  requiredCustomFieldIds?: string[];

  // Module 12's Approval Workflows - when true, this transition doesn't apply immediately: it
  // stamps `Task.pendingApproval` (a snapshot of the 4 approver-grantee fields below, taken at
  // request time) and waits for a separate approve/reject call from an eligible approver. Unset/
  // false (every existing transition) means immediate application, identical to today. Deliberately
  // a SEPARATE grantee set from `allowedRoles` above (which gates who may *request* the transition)
  // - the requester and the approver are meant to be different people; see TasksService.
  @Prop({ type: Boolean })
  requiresApproval?: boolean;

  // The 4 grantee kinds below mirror SecurityLevel/PermissionGrant's own shape exactly (see
  // grant-matching.util.ts's GrantLike) so approval eligibility is checked with the same
  // `granteeMatchesGrant` every other scheme already uses, rather than a third bespoke check.
  @Prop({ type: [String], enum: Role, default: [] })
  approverRoles?: Role[];

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  approverUserIds?: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Team', default: [] })
  approverTeamIds?: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'ProjectRoleDefinition', default: [] })
  approverProjectRoleIds?: Types.ObjectId[];

  // Module 12 gap-closure: how many DIFFERENT eligible approvers must approve before the
  // transition applies (any one rejection still rejects). Unset (every existing transition) = 1,
  // exactly the original any-one-approver behavior.
  @Prop({ type: Number, min: 1, max: 10 })
  requiredApprovals?: number;
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
    // A `requiresApproval` transition with nobody who could ever approve it would be permanently
    // stuck the first time it's requested - reject that misconfiguration up front rather than
    // discovering it only when a real task gets wedged.
    if (
      t.requiresApproval &&
      !t.approverRoles?.length &&
      !t.approverUserIds?.length &&
      !t.approverTeamIds?.length &&
      !t.approverProjectRoleIds?.length
    ) {
      throw new BadRequestException(
        `Transition ${t.from} -> ${t.to} requires approval but has no approver roles/users/teams/project roles configured`,
      );
    }
  }
}

/** A transition as it arrives over HTTP (PutWorkflowDto's shape - approver ids as plain strings)
 * - converts the 3 ObjectId-typed approver fields, shared by ProjectsService.updateWorkflow() and
 * WorkflowTemplatesService so the conversion can't drift between the two call sites. */
export interface WorkflowTransitionInput {
  from: string;
  to: string;
  allowedRoles?: Role[];
  requireComment?: boolean;
  requiredCustomFieldIds?: string[];
  requiresApproval?: boolean;
  approverRoles?: Role[];
  approverUserIds?: string[];
  approverTeamIds?: string[];
  approverProjectRoleIds?: string[];
  requiredApprovals?: number;
}

export function toWorkflowTransitions(inputs: WorkflowTransitionInput[]): WorkflowTransition[] {
  return inputs.map((t) => ({
    from: t.from,
    to: t.to,
    ...(t.allowedRoles !== undefined ? { allowedRoles: t.allowedRoles } : {}),
    ...(t.requireComment !== undefined ? { requireComment: t.requireComment } : {}),
    ...(t.requiredCustomFieldIds !== undefined
      ? { requiredCustomFieldIds: t.requiredCustomFieldIds }
      : {}),
    ...(t.requiresApproval !== undefined ? { requiresApproval: t.requiresApproval } : {}),
    ...(t.requiredApprovals !== undefined ? { requiredApprovals: t.requiredApprovals } : {}),
    ...(t.approverRoles !== undefined ? { approverRoles: t.approverRoles } : {}),
    ...(t.approverUserIds?.length
      ? { approverUserIds: t.approverUserIds.map((id) => new Types.ObjectId(id)) }
      : {}),
    ...(t.approverTeamIds?.length
      ? { approverTeamIds: t.approverTeamIds.map((id) => new Types.ObjectId(id)) }
      : {}),
    ...(t.approverProjectRoleIds?.length
      ? { approverProjectRoleIds: t.approverProjectRoleIds.map((id) => new Types.ObjectId(id)) }
      : {}),
  })) as WorkflowTransition[];
}
