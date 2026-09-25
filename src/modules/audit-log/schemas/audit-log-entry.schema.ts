import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogEntryDocument = HydratedDocument<AuditLogEntry>;

/**
 * Module 8's Admin Audit Log - a genuinely new concept (confirmed by research: `platform/logs` is
 * a raw HTTP request/response log, not a semantic "who changed what" trail; there was no audit
 * log, at any level, anywhere in this codebase before this). Deliberately scoped to
 * ADMIN-CONSOLE-SURFACE changes (user lifecycle, org settings, and the 4 reusable org-wide scheme/
 * team/role config types) - NOT a duplicate of the existing per-task/per-project/per-sprint
 * business-activity feeds, which already cover day-to-day work item changes.
 */
export enum AuditAction {
  USER_CREATED = 'UserCreated',
  USER_UPDATED = 'UserUpdated',
  USER_ROLE_CHANGED = 'UserRoleChanged',
  USER_STATUS_CHANGED = 'UserStatusChanged',
  ORGANIZATION_SETTINGS_UPDATED = 'OrganizationSettingsUpdated',
  PERMISSION_SCHEME_CREATED = 'PermissionSchemeCreated',
  PERMISSION_SCHEME_UPDATED = 'PermissionSchemeUpdated',
  PERMISSION_SCHEME_DELETED = 'PermissionSchemeDeleted',
  SECURITY_SCHEME_CREATED = 'SecuritySchemeCreated',
  SECURITY_SCHEME_UPDATED = 'SecuritySchemeUpdated',
  SECURITY_SCHEME_DELETED = 'SecuritySchemeDeleted',
  TEAM_CREATED = 'TeamCreated',
  TEAM_UPDATED = 'TeamUpdated',
  TEAM_DELETED = 'TeamDeleted',
  PROJECT_ROLE_CREATED = 'ProjectRoleCreated',
  PROJECT_ROLE_UPDATED = 'ProjectRoleUpdated',
  PROJECT_ROLE_DELETED = 'ProjectRoleDeleted',
}

export const AUDIT_ACTIONS = Object.values(AuditAction);

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  // Mongoose's default `minimize: true` strips empty-object fields entirely on save - most
  // actions (team/scheme/role create/delete) never pass metadata, so `record()`'s `?? {}`
  // default would otherwise be dropped before it ever reaches the database, breaking the
  // documented "metadata is always an object" API contract.
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
export class AuditLogEntry {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  actor!: Types.ObjectId;

  @Prop({ type: String, enum: AuditAction, required: true })
  action!: AuditAction;

  // e.g. "User", "PermissionScheme" - a plain descriptive label, not a Mongoose ref (the target
  // may since have been deleted, which is exactly the case this log needs to keep working for).
  @Prop({ required: true })
  targetType!: string;

  @Prop({ type: String, default: null })
  targetId!: string | null;

  // A human-readable snapshot of the target's name/label AT THE TIME of the action (e.g. the
  // user's name, the scheme's name) - kept even if the target is later renamed or deleted, so the
  // log entry stays meaningful on its own.
  @Prop({ type: String, default: null })
  targetLabel!: string | null;

  // Small extra context (e.g. {from: 'Developer', to: 'Manager'}) - deliberately loose/untyped
  // per-action, mirroring TaskActivity's simple from/to string pair but generalized since these
  // actions vary more in shape than a task's status/priority/assignee changes.
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
}

export const AuditLogEntrySchema = SchemaFactory.createForClass(AuditLogEntry);

AuditLogEntrySchema.index({ organizationId: 1, createdAt: -1 });
AuditLogEntrySchema.index({ organizationId: 1, action: 1 });
