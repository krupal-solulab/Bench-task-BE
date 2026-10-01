import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { IssueType } from '../../../common/enums/issue-type.enum';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { TaskPriority } from '../../../common/enums/task-priority.enum';
import { TaskStatus } from '../../../common/enums/task-status.enum';
import { Role } from '../../../common/enums/role.enum';

export type TaskDocument = HydratedDocument<Task>;

/**
 * Module 12's Approval Workflows - set by `TasksService.updateStatus()` instead of applying the
 * status change immediately, when the matched `WorkflowTransition.requiresApproval` is true. The
 * 4 approver-grantee fields are a SNAPSHOT of the transition rule at request time (not a live
 * reference back to the workflow), so editing the rule later never changes who can decide an
 * already-in-flight request - the same "resolved once, trusted after" convention this codebase
 * already uses for denormalized fields like Task.organizationId.
 */
@Schema({ _id: false })
export class PendingApproval {
  @Prop({ required: true, trim: true, maxlength: 40 })
  toStatus!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requestedBy!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  requestedAt!: Date;

  @Prop({ type: [String], enum: Role, default: [] })
  approverRoles!: Role[];

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  approverUserIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Team', default: [] })
  approverTeamIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'ProjectRoleDefinition', default: [] })
  approverProjectRoleIds!: Types.ObjectId[];
}

export const PendingApprovalSchema = SchemaFactory.createForClass(PendingApproval);

/**
 * Module 7 gap-closure: a manually-pasted external link (e.g. a GitHub/GitLab commit, PR, or
 * branch URL) - deliberately NOT a real GitHub/GitLab API connector (no OAuth/webhook/API-key
 * infrastructure exists anywhere in this codebase, the same constraint every "AI X" BRD line in
 * this engagement has hit). This closes the honest, always-available part of "link a task to your
 * VCS activity" - pasting a URL - without faking auto-detection or a live connection this
 * codebase has no way to actually make. Kept WITH a real `_id` (unlike most embedded subdocuments
 * in this codebase, which use `name` as identity) since label/url have no natural uniqueness to
 * key deletion off of.
 */
@Schema()
export class ExternalReference {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  label!: string;

  @Prop({ required: true, trim: true, maxlength: 2000 })
  url!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  addedBy!: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  addedAt!: Date;
}

export const ExternalReferenceSchema = SchemaFactory.createForClass(ExternalReference);

@Schema({
  timestamps: true,
  // Mongoose's default `minimize: true` strips empty-object fields (e.g. an unset
  // `customFieldValues: {}`) from what's persisted/returned entirely, so a task with no custom
  // field values would come back with the field missing instead of `{}`. Disabled so
  // `customFieldValues` is always a reliably-present object.
  minimize: false,
  toJSON: {
    virtuals: true,
    // Mongoose's transform typings don't carry the schema's field shape through; `any` is the
    // documented escape hatch for this callback.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      // externalReferences entries carry a real _id (see ExternalReference's own doc comment) -
      // converted to `id` here explicitly, same convention as the document's own _id above, since
      // this schema's toJSON transform doesn't recurse into embedded-array subdocuments on its own.
      if (Array.isArray(ret.externalReferences)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ret.externalReferences = ret.externalReferences.map((r: any) => {
          const { _id, ...rest } = r;
          return { id: _id?.toString?.() ?? _id, ...rest };
        });
      }
      return ret;
    },
  },
})
export class Task {
  @Prop({ required: true, trim: true, minlength: 3, maxlength: 200 })
  title!: string;

  @Prop({ default: '', maxlength: 5000 })
  description!: string;

  @Prop({ type: Types.ObjectId, ref: 'Project', required: true })
  project!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignee!: Types.ObjectId | null;

  // Set whenever assignee transitions to null, cleared when reassigned - the start of a "became
  // unassigned" episode for the UnassignedForDuration automation trigger (BRD 8). Not the same as
  // updatedAt, which changes on any field edit, not just assignee.
  @Prop({ type: Date, default: null })
  assigneeClearedAt!: Date | null;

  // Rule ids already fired for the CURRENT "became unassigned" episode (see assigneeClearedAt) -
  // prevents the hourly checker from re-firing the same rule every run; cleared alongside
  // assigneeClearedAt when the task is reassigned, so a future unassigned episode can fire again.
  @Prop({ type: [String], default: [] })
  firedTimeBasedRuleIds!: string[];

  @Prop({ type: String, enum: TaskPriority, default: TaskPriority.P2 })
  priority!: TaskPriority;

  // Free-form status name once a project has a custom workflow (see workflow.schema.ts); still
  // defaults to "Todo" for every project on the system default workflow, so every pre-existing
  // document (and every task created without a custom workflow in play) is unaffected. Legality is
  // enforced in TasksService against the project's resolved workflow, not by a fixed schema enum.
  @Prop({ type: String, default: TaskStatus.TODO })
  status!: string;

  // Denormalized from `status` via the project's resolved workflow on every write, so cross-cutting
  // aggregations (sprint completion, dashboards) can cheaply check "is this done" without joining
  // through Project on every query. Never independently settable by a client.
  @Prop({ type: String, enum: StatusCategory, default: StatusCategory.TODO })
  statusCategory!: StatusCategory;

  @Prop({ type: Date, default: null })
  dueDate!: Date | null;

  // Stamped by the hourly due-date reminder cron once a notification has gone out, so a task
  // is only ever notified once. Null until then; unrelated to `dueDate` itself changing.
  @Prop({ type: Date, default: null })
  dueDateNotifiedAt!: Date | null;

  // Stamped by the hourly SLA-breach checker (BRD 8's SlaBreach notification scheme event) once
  // fired, so a task is only ever notified once per breach - same idempotency shape as
  // dueDateNotifiedAt above.
  @Prop({ type: Date, default: null })
  slaBreachNotifiedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  completedAt!: Date | null;

  // null means "in the backlog". Set only via TasksService.updateSprint(); untouched by ordinary
  // task create/update, so every task not deliberately put in a sprint behaves exactly as before.
  @Prop({ type: Types.ObjectId, ref: 'Sprint', default: null })
  sprint!: Types.ObjectId | null;

  // Fractional backlog/sprint ordering position - see modules/tasks/utils/rank.util.ts. Defaults
  // to 0 for every task created before this field existed; a secondary `createdAt` sort key keeps
  // those legacy same-rank tasks in a stable order (see TasksRepository.paginate).
  @Prop({ type: Number, default: 0 })
  rank!: number;

  // Defaults to TASK so every pre-existing document (and every task created without specifying
  // this) is completely unaffected - Epic/Story/Bug/Sub-task are opt-in. Not a Mongoose `enum:` -
  // a project can configure additional Standard-level issue type names (see
  // projects/schemas/issue-type.schema.ts), so the allowed set is project-scoped and validated at
  // the service layer (TasksService.assertValidHierarchy), not fixed at the schema level.
  @Prop({ type: String, default: IssueType.TASK })
  issueType!: string;

  // Self-referential: an Epic-link for Story/Task/Bug, or the required parent for Sub-task. Never
  // set for an Epic itself. See TasksService.create()'s hierarchy validation for the exact rules.
  @Prop({ type: Types.ObjectId, ref: 'Task', default: null })
  parent!: Types.ObjectId | null;

  @Prop({ type: Number, default: null })
  storyPoints!: number | null;

  // Module 3's "Original Estimate" (BRD: Time Tracking & Work Logs) - hours, kept separate from
  // storyPoints (an agile sizing unit, not a time unit). Actual time is the sum of this task's
  // WorkLog entries, computed on read by WorkLogsService, not denormalized here.
  @Prop({ type: Number, default: null })
  originalEstimateHours!: number | null;

  // "SUP-101" style, assigned once at creation (TasksService.create()) and never changed after -
  // null for every task created before this field existed (no backfill, purely historical gap).
  @Prop({ type: String, default: null })
  issueKey!: string | null;

  // Free-form tags. No project-level registry - ProjectsService.listLabels() just returns the
  // distinct values already in use, for autocomplete.
  @Prop({ type: [String], default: [] })
  labels!: string[];

  // A subset of the project's Project.components list - validated in TasksService against the
  // project's current component names at create/update time.
  @Prop({ type: [String], default: [] })
  components!: string[];

  // Module 2's "Fix Version" - the release(s) this issue targets. Validated in TasksService
  // against ReleasesService (must exist, active, and belong to the task's project).
  @Prop({ type: [Types.ObjectId], ref: 'Release', default: [] })
  fixVersions!: Types.ObjectId[];

  // Module 2's "Affects Version" - the release(s) this issue affects (e.g. a bug reported against
  // an older shipped version). Same validation as fixVersions.
  @Prop({ type: [Types.ObjectId], ref: 'Release', default: [] })
  affectsVersions!: Types.ObjectId[];

  // Keyed by Project.customFields[].id (not name, so renaming a field never orphans its stored
  // values). Validated against the project's field definitions by
  // custom-field.schema.ts's validateCustomFieldValues - never trusted as-is from the client.
  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  customFieldValues!: Record<string, unknown>;

  // Module 6's issue-level view restriction - a level *name* from the project's assigned
  // SecurityScheme (same name-based convention as status/issueType), validated against it at
  // create/update time. Null (every existing task, and any new one on a project with no scheme
  // assigned) means "no restriction" - visible to any project member, completely unaffected.
  @Prop({ type: String, default: null })
  securityLevel!: string | null;

  // Module 7's Watchers - who gets notified of activity on this issue beyond the assignee. The
  // reporter (creator) and the current assignee are auto-added (TasksService.create()/
  // updateAssignee()) but never auto-removed, so a user can always deliberately stop watching.
  // Empty for every task created before this feature existed.
  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  watcherIds!: Types.ObjectId[];

  // Module 7's Voting - self-service only (TasksService.addVoter/removeVoter), purely a signal of
  // interest with no permission effect. Empty for every existing task.
  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  voterIds!: Types.ObjectId[];

  // Module 7 gap-closure - see ExternalReference's own doc comment. Empty for every existing task.
  @Prop({ type: [ExternalReferenceSchema], default: [] })
  externalReferences!: ExternalReference[];

  // Module 12's Approval Workflows - null (every existing task, and any task never attempting a
  // `requiresApproval` transition) means no transition is currently awaiting a decision. See
  // PendingApproval's own doc comment above.
  @Prop({ type: PendingApprovalSchema, default: null })
  pendingApproval!: PendingApproval | null;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  // Denormalized from the parent project (not the acting user) at creation time so it's
  // always in sync, and so org-scoped queries against Task don't need to join through Project.
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task);

TaskSchema.index({ project: 1 });
TaskSchema.index({ assignee: 1 });
TaskSchema.index({ status: 1 });
TaskSchema.index({ dueDate: 1 });
TaskSchema.index({ project: 1, status: 1 });
TaskSchema.index({ assignee: 1, status: 1 });
TaskSchema.index({ title: 'text', description: 'text' });
TaskSchema.index({ organizationId: 1 });
TaskSchema.index({ organizationId: 1, assignee: 1 });
TaskSchema.index({ sprint: 1 });
TaskSchema.index({ project: 1, sprint: 1 });
TaskSchema.index({ project: 1, issueType: 1 });
TaskSchema.index({ parent: 1 });
TaskSchema.index({ statusCategory: 1 });
TaskSchema.index({ project: 1, statusCategory: 1 });
TaskSchema.index({ sprint: 1, statusCategory: 1 });
TaskSchema.index({ project: 1, labels: 1 });
TaskSchema.index({ project: 1, components: 1 });
TaskSchema.index({ fixVersions: 1 });
TaskSchema.index({ affectsVersions: 1 });
