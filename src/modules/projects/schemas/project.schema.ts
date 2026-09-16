import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { MemberPermissions, MemberPermissionsSchema } from './member-permissions.schema';
import { CustomFieldDefinition, CustomFieldDefinitionSchema } from './custom-field.schema';
import { AutomationRule, AutomationRuleSchema } from './automation-rule.schema';
import { Workflow, WorkflowSchema, WorkflowByType, WorkflowByTypeSchema } from './workflow.schema';
import { IssueTypeDefinition, IssueTypeDefinitionSchema } from './issue-type.schema';

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

  // Admin-defined field definitions (Text/Number/Date/Dropdown/Checkbox) applied to every issue
  // in this project. Empty for every existing project until configured via
  // ProjectsService.updateCustomFields(). See custom-field.schema.ts.
  @Prop({ type: [CustomFieldDefinitionSchema], default: [] })
  customFields!: CustomFieldDefinition[];

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
