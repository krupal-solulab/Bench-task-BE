import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';

export type FieldPermissionSchemeDocument = HydratedDocument<FieldPermissionScheme>;

/** Every built-in Task field `TasksService.update()` can change - the fields a Field Permission
 * Scheme rule can target besides a project's own custom field ids. Deliberately excludes
 * `assignee` and `status`, which already have their own dedicated access mechanisms (Permission
 * Schemes' ASSIGN/TRANSITION actions, Approval Workflows) - this scheme only ever narrows what
 * those two already govern separately, so it stays out of their way rather than overlapping. */
export const BUILT_IN_TASK_FIELD_IDS = [
  'title',
  'description',
  'priority',
  'dueDate',
  'labels',
  'components',
  'fixVersions',
  'affectsVersions',
  'storyPoints',
  'originalEstimateHours',
  'securityLevel',
] as const;
export type BuiltInTaskFieldId = (typeof BUILT_IN_TASK_FIELD_IDS)[number];

/**
 * Module 12's Field-Level Permissions - confirmed entirely absent before this (Security Schemes
 * restrict who can view a whole *issue*; Permission Schemes restrict who can perform a whole
 * *action type*; neither goes field-by-field). Deliberately ROLE-ONLY (not the full role/user/
 * team/project-role grant tuple Security/Permission Schemes use) - this mirrors real Jira's own
 * Field Configuration Scheme model (permission-scheme-role-based) and matches the simpler shape
 * `WorkflowTransition.allowedRoles` already uses right next to it conceptually, rather than adding
 * a fourth grant dimension a field-visibility rule doesn't obviously need. `fieldId` is either one
 * of `BUILT_IN_TASK_FIELD_IDS` or a project's own custom field id - never validated against a
 * specific project's fields at the scheme level, since one scheme is reused across many projects
 * with different custom fields (the same reason CustomFieldOverrideByType's ids are only
 * validated at project-assignment time, not here).
 */
@Schema({ _id: false })
export class FieldPermissionRule {
  @Prop({ required: true, trim: true, maxlength: 60 })
  fieldId!: string;

  // Cannot view this field's value at all - TasksService redacts it from the single-task read.
  @Prop({ type: [String], enum: Role, default: [] })
  hiddenFromRoles!: Role[];

  // Can view, cannot edit - TasksService.update() rejects any attempt to change it.
  @Prop({ type: [String], enum: Role, default: [] })
  readOnlyForRoles!: Role[];
}

export const FieldPermissionRuleSchema = SchemaFactory.createForClass(FieldPermissionRule);

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
export class FieldPermissionScheme {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ type: [FieldPermissionRuleSchema], default: [] })
  rules!: FieldPermissionRule[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const FieldPermissionSchemeSchema = SchemaFactory.createForClass(FieldPermissionScheme);

FieldPermissionSchemeSchema.index({ organizationId: 1 });

/** No rule for a field means fully open (view + edit) - this only ever narrows, identical to
 * every other scheme in this codebase. */
export function canViewField(
  scheme: Pick<FieldPermissionScheme, 'rules'> | null,
  fieldId: string,
  role: Role,
): boolean {
  if (!scheme) return true;
  const rule = scheme.rules.find((r) => r.fieldId === fieldId);
  if (!rule) return true;
  return !rule.hiddenFromRoles.includes(role);
}

/** A field you can't view, you also can't edit - checked first so a role in both lists is still
 * correctly blocked from editing even if `readOnlyForRoles` was left empty by mistake. */
export function canEditField(
  scheme: Pick<FieldPermissionScheme, 'rules'> | null,
  fieldId: string,
  role: Role,
): boolean {
  if (!scheme) return true;
  const rule = scheme.rules.find((r) => r.fieldId === fieldId);
  if (!rule) return true;
  if (rule.hiddenFromRoles.includes(role)) return false;
  return !rule.readOnlyForRoles.includes(role);
}
