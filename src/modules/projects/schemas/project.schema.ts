import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { BoardType } from '../../../common/enums/board-type.enum';
import { Role } from '../../../common/enums/role.enum';
import { MemberPermissions, MemberPermissionsSchema } from './member-permissions.schema';
import {
  CustomFieldDefinition,
  CustomFieldDefinitionSchema,
  CustomFieldOverrideByType,
  CustomFieldOverrideByTypeSchema,
} from './custom-field.schema';
import { AutomationRule, AutomationRuleSchema } from './automation-rule.schema';
import { Workflow, WorkflowSchema, WorkflowByType, WorkflowByTypeSchema } from './workflow.schema';
import { IssueTypeDefinition, IssueTypeDefinitionSchema } from './issue-type.schema';
import { NotificationSchemeRule, NotificationSchemeRuleSchema } from './notification-scheme.schema';
import { SlaPolicyEntry, SlaPolicyEntrySchema } from './sla-policy.schema';
import { ProjectRoleAssignment, ProjectRoleAssignmentSchema } from './role-assignment.schema';

export type ProjectDocument = HydratedDocument<Project>;

@Schema({ _id: false })
export class ProjectMember {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ required: true, default: () => new Date() })
  joinedAt!: Date;

  // Null means "no custom grants" - every existing member, and every newly-added member, is
  // completely unaffected until an Admin/owning Manager explicitly grants something via
  // ProjectsService.setMemberPermissions(). See member-permissions.schema.ts's resolveMemberPermissions.
  @Prop({ type: MemberPermissionsSchema, default: null })
  permissions?: MemberPermissions | null;
}

export const ProjectMemberSchema = SchemaFactory.createForClass(ProjectMember);

/** Module 6 gap-closure: which project member (if any) leads a given component - `name` is the
 * same identity `Project.components` already uses (not a separate id), so a lead is always looked
 * up by the component's own name. Kept as a SEPARATE side-list rather than upgrading `components`
 * itself from `string[]` to `{name, leadUserId}[]`, specifically because `components` is read as a
 * bare string array in a dozen+ places across this codebase (task validation, JQL filtering/
 * autocomplete, automation-rule conditions, CSV/JSON import-export) - changing its shape would
 * touch every one of those call sites for a feature that only needs one new fact per component. */
@Schema({ _id: false })
export class ComponentLead {
  @Prop({ required: true, trim: true, maxlength: 50 })
  name!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  leadUserId!: Types.ObjectId | null;
}

export const ComponentLeadSchema = SchemaFactory.createForClass(ComponentLead);

/**
 * Module 6 gap-closure: a project-wide fallback approver pool for Module 12's Approval Workflows.
 * Deliberately ADDITIVE, not a replacement for a transition's own approver fields: someone matching
 * this grant can approve ANY approval-gated transition in the project, on top of (never instead of)
 * whoever that specific transition's own `approverRoles`/`approverUserIds`/`approverTeamIds`/
 * `approverProjectRoleIds` name - see TasksService.getPendingApprovalOrThrow(). This is why
 * `assertValidWorkflowShape`'s existing "a requiresApproval transition needs at least one approver
 * configured" check is untouched here: this field never lets a transition skip that requirement,
 * it only ever adds more people who could approve one that already has real approvers. Same 4-
 * grantee-kind shape as SecurityLevel/WorkflowTransition's approver* fields (see GrantLike), all-
 * empty (every existing project) meaning "no project-wide default", identical to today.
 */
@Schema({ _id: false })
export class DefaultApprovers {
  @Prop({ type: [String], enum: Role, default: [] })
  allowedRoles!: Role[];

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  allowedUserIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Team', default: [] })
  allowedTeamIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'ProjectRoleDefinition', default: [] })
  allowedProjectRoleIds!: Types.ObjectId[];
}

export const DefaultApproversSchema = SchemaFactory.createForClass(DefaultApprovers);

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

  // BRD 6.3's Kanban-vs-Scrum toggle - defaults to Scrum, matching every existing project's
  // current unconditional Backlog/Sprint-board/Calendar tabs. Switching to Kanban hides those
  // tabs client-side only (Board/List stay); no server-side gating of sprint endpoints, since a
  // Kanban project simply choosing not to use them is equivalent to never creating a sprint.
  @Prop({ type: String, enum: BoardType, default: BoardType.SCRUM })
  boardType!: BoardType;

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

  // Short issue-key prefix (e.g. "SUP") used to build issue keys like "SUP-101". Lazily
  // assigned by ProjectsService.getOrAssignKey() the first time a task/issue is created on this
  // project, rather than backfilled - existing projects are untouched until then.
  @Prop({ type: String, default: null })
  key!: string | null;

  // Per-project atomic counter feeding issue-key numbering (see ProjectsRepository.incrementIssueSeq).
  @Prop({ type: Number, default: 0 })
  issueSeq!: number;

  // Null means "use the system default workflow" (see workflow.schema.ts's DEFAULT_WORKFLOW /
  // resolveWorkflow) - every existing project, and any new one that never opens the workflow
  // settings, is completely unaffected by this feature until an Admin/owning Manager configures one.
  @Prop({ type: WorkflowSchema, default: null })
  workflow!: Workflow | null;

  // Per-issue-type workflow overrides - empty for every existing project until an Admin/owning
  // Manager configures one for a specific issue type via ProjectsService.updateWorkflow(id, dto,
  // user, issueType). A type with no entry here falls back to `workflow` above (see
  // workflow.schema.ts's resolveWorkflow).
  @Prop({ type: [WorkflowByTypeSchema], default: [] })
  workflowsByType!: WorkflowByType[];

  // Project-defined pick-list (e.g. "Frontend", "API") - names are the identity, same convention
  // as WorkflowStatus.name. Empty for every existing project until an Admin/owning Manager
  // configures one via ProjectsService.updateComponents().
  @Prop({ type: [String], default: [] })
  components!: string[];

  // Module 6 gap-closure: which member (if any) leads each component, keyed by component name -
  // see ComponentLead's own doc comment for why this is a separate side-list rather than a change
  // to `components` itself. Empty for every existing project until an Admin/owning Manager assigns
  // one via ProjectsService.updateComponentLead(); pruned automatically for any name removed via
  // updateComponents().
  @Prop({ type: [ComponentLeadSchema], default: [] })
  componentLeads!: ComponentLead[];

  // Admin-defined field definitions (Text/Number/Date/Dropdown/Checkbox) applied to every issue
  // in this project. Empty for every existing project until configured via
  // ProjectsService.updateCustomFields(). See custom-field.schema.ts.
  @Prop({ type: [CustomFieldDefinitionSchema], default: [] })
  customFields!: CustomFieldDefinition[];

  // Per-issue-type overrides of which custom fields are hidden, or forced required/optional.
  // Empty for every existing project until an Admin/owning Manager configures one for a specific
  // issue type via ProjectsService.updateCustomFieldOverride(). See
  // custom-field.schema.ts's resolveCustomFields.
  @Prop({ type: [CustomFieldOverrideByTypeSchema], default: [] })
  customFieldOverridesByType!: CustomFieldOverrideByType[];

  // Project-scoped "WHEN trigger [IF conditions] THEN actions" rules. Empty for every existing
  // project until configured via ProjectsService.updateAutomationRules(). See automation-rule.schema.ts.
  @Prop({ type: [AutomationRuleSchema], default: [] })
  automationRules!: AutomationRule[];

  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  // Empty means "use the 5 built-in issue types" (see issue-type.schema.ts's resolveIssueTypes) -
  // every existing project, and any new one that never opens the Issue Types settings, is
  // completely unaffected by this feature until an Admin/owning Manager configures one via
  // ProjectsService.updateIssueTypes().
  @Prop({ type: [IssueTypeDefinitionSchema], default: [] })
  issueTypes!: IssueTypeDefinition[];

  // Null means "use the legacy per-member permission flags" (see member-permissions.schema.ts) -
  // every existing project, and any new one that never opens the permission-scheme settings, is
  // completely unaffected by this feature until an Admin/owning Manager assigns a scheme via
  // ProjectsService.assignPermissionScheme(). See permission-schemes/schemas/permission-scheme.schema.ts.
  @Prop({ type: Types.ObjectId, ref: 'PermissionScheme', default: null })
  permissionSchemeId!: Types.ObjectId | null;

  // Additive on top of today's hardcoded assignee-targeted notifications - an empty list (every
  // existing project) means no extra recipients for any event, identical to today. See
  // notification-scheme.schema.ts.
  @Prop({ type: [NotificationSchemeRuleSchema], default: [] })
  notificationScheme!: NotificationSchemeRule[];

  // Empty for every existing project until an Admin/owning Manager configures one via
  // ProjectsService.updateSlaPolicy() - resolveSlaPolicy() falls back to DEFAULT_SLA_POLICY, so
  // nothing changes for anyone who doesn't opt in. See sla-policy.schema.ts.
  @Prop({ type: [SlaPolicyEntrySchema], default: [] })
  slaPolicy!: SlaPolicyEntry[];

  // Module 6's per-project Role Assignments - empty for every existing project until an Admin/
  // owning Manager assigns users/teams to an org-wide Project Role via
  // ProjectsService.setRoleAssignment(). See role-assignment.schema.ts.
  @Prop({ type: [ProjectRoleAssignmentSchema], default: [] })
  roleAssignments!: ProjectRoleAssignment[];

  // Module 6 gap-closure: see DefaultApprovers' own doc comment - an additive fallback approver
  // pool for Module 12's Approval Workflows. Null (every existing project) means "no project-wide
  // default configured" until an Admin/owning Manager sets one via
  // ProjectsService.updateDefaultApprovers() - same "null means not configured" convention as
  // `workflow`/`permissionSchemeId`/`securitySchemeId` above.
  @Prop({ type: DefaultApproversSchema, default: null })
  defaultApprovers!: DefaultApprovers | null;

  // Null means "no issue-level view restriction" - every existing project, and any new one that
  // never opens the security-scheme settings, is completely unaffected until an Admin/owning
  // Manager assigns one via ProjectsService.assignSecurityScheme(). See
  // security-schemes/schemas/security-scheme.schema.ts.
  @Prop({ type: Types.ObjectId, ref: 'SecurityScheme', default: null })
  securitySchemeId!: Types.ObjectId | null;

  // Module 12's Field-Level Permissions - null (every existing project, and any new one that
  // never opens the field-permission-scheme settings) means no field is view/edit-restricted
  // beyond what Security/Permission Schemes already cover. See
  // field-permission-schemes/schemas/field-permission-scheme.schema.ts.
  @Prop({ type: Types.ObjectId, ref: 'FieldPermissionScheme', default: null })
  fieldPermissionSchemeId!: Types.ObjectId | null;

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

// DB-level backstop for key uniqueness within an org (the service layer dedupes too, but only this
// partial unique index makes it race-safe). Partial so the many projects with no key yet (null)
// never collide with each other.
ProjectSchema.index(
  { organizationId: 1, key: 1 },
  { unique: true, partialFilterExpression: { key: { $type: 'string' } } },
);
