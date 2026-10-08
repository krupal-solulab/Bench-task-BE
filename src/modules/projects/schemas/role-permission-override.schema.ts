import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { MemberPermissions, MemberPermissionsSchema } from './member-permissions.schema';

/**
 * A project-specific replacement for one role's organization-wide permissions (Jira-style): in
 * this project, holders of `roleId` (a custom role, or the built-in Manager/Developer row) get
 * exactly `permissions` instead of the role's defaults. Other projects are unaffected.
 */
@Schema({ _id: false })
export class RolePermissionOverride {
  @Prop({ type: Types.ObjectId, ref: 'CustomRole', required: true })
  roleId!: Types.ObjectId;

  @Prop({ type: MemberPermissionsSchema, required: true })
  permissions!: MemberPermissions;
}

export const RolePermissionOverrideSchema = SchemaFactory.createForClass(RolePermissionOverride);
