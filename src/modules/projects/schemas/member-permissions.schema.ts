import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class MemberPermissions {
  @Prop({ default: false })
  canCreateTask!: boolean;

  @Prop({ default: false })
  canEditAnyTask!: boolean;

  @Prop({ default: false })
  canDeleteTask!: boolean;

  @Prop({ default: false })
  canChangeAnyTaskStatus!: boolean;

  @Prop({ default: false })
  canManageSprints!: boolean;
}

export const MemberPermissionsSchema = SchemaFactory.createForClass(MemberPermissions);

export const NO_PERMISSIONS: MemberPermissions = {
  canCreateTask: false,
  canEditAnyTask: false,
  canDeleteTask: false,
  canChangeAnyTaskStatus: false,
  canManageSprints: false,
};

export type GrantableCapability = keyof MemberPermissions;

export interface PermissionsCarrier {
  permissions?: MemberPermissions | null;
}

/**
 * A member's effective per-project grants - their own custom set, or "nothing" when unset.
 * Reads each field explicitly (rather than returning `member.permissions` directly) because that
 * value is often a live Mongoose subdocument, not a plain object - spreading one directly (e.g.
 * `{ ...resolveMemberPermissions(member), ...patch }`) would pull in Mongoose's internal
 * bookkeeping properties instead of the schema fields. This always returns a genuinely plain,
 * safely-spreadable object.
 */
export function resolveMemberPermissions(member: PermissionsCarrier): MemberPermissions {
  const p = member.permissions;
  if (!p) return NO_PERMISSIONS;
  return {
    canCreateTask: p.canCreateTask,
    canEditAnyTask: p.canEditAnyTask,
    canDeleteTask: p.canDeleteTask,
    canChangeAnyTaskStatus: p.canChangeAnyTaskStatus,
    canManageSprints: p.canManageSprints,
  };
}
