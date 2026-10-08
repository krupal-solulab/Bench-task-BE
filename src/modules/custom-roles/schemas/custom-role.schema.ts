import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { PROJECT_MEMBER_ROLES, ProjectMemberRole, Role } from '../../../common/enums/role.enum';
import {
  MemberPermissions,
  MemberPermissionsSchema,
  NO_PERMISSIONS,
} from '../../projects/schemas/member-permissions.schema';

export type CustomRoleDocument = HydratedDocument<CustomRole>;

export const CUSTOM_ROLE_COLORS = [
  'slate',
  'blue',
  'violet',
  'emerald',
  'amber',
  'rose',
  'cyan',
  'orange',
] as const;
export type CustomRoleColor = (typeof CUSTOM_ROLE_COLORS)[number];

/**
 * An organization-defined job role (QA, DevOps, Designer, ...). It sits on top of the built-in
 * access level rather than replacing it: a user with a custom role keeps `user.role` = the role's
 * `accessLevel` (Developer or Manager), so every existing role-based rule applies to them exactly
 * as before, and the role's `permissions` are added on top - in every project they are a member
 * of - through the same capability check that per-project member grants use.
 */
@Schema({
  timestamps: true,
  toJSON: {
    virtuals: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    transform: (_doc: unknown, ret: any) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      delete ret.nameKey;
      return ret;
    },
  },
})
export class CustomRole {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 2, maxlength: 40 })
  name!: string;

  /** Lower-cased name - role names are unique per organization, ignoring case. */
  @Prop({ required: true })
  nameKey!: string;

  @Prop({ type: String, default: '', maxlength: 200 })
  description!: string;

  @Prop({ type: String, enum: CUSTOM_ROLE_COLORS, default: 'blue' })
  color!: CustomRoleColor;

  @Prop({ type: String, enum: PROJECT_MEMBER_ROLES, default: Role.DEVELOPER })
  accessLevel!: ProjectMemberRole;

  @Prop({ type: MemberPermissionsSchema, default: () => ({ ...NO_PERMISSIONS }) })
  permissions!: MemberPermissions;

  /**
   * Set on the two rows that hold the built-in Manager / Developer roles' permissions (editable
   * by Admins like any role, but never renamed, re-levelled or deleted). Null = a custom role.
   */
  @Prop({ type: String, enum: [...PROJECT_MEMBER_ROLES, null], default: null })
  builtInRole!: ProjectMemberRole | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const CustomRoleSchema = SchemaFactory.createForClass(CustomRole);
CustomRoleSchema.index({ organizationId: 1, nameKey: 1 }, { unique: true });

/** The built-in roles whose permissions an Admin can configure (Admin itself is always full). */
export const CONFIGURABLE_BUILT_IN_ROLES: ProjectMemberRole[] = [Role.MANAGER, Role.DEVELOPER];

/** Every organization starts with these (editable/deletable like any other role). */
export const DEFAULT_CUSTOM_ROLES: Array<
  Pick<CustomRole, 'name' | 'description' | 'color' | 'accessLevel' | 'permissions'>
> = [
  {
    name: 'QA',
    description: 'Tests work, files bugs and moves issues through verification.',
    color: 'violet',
    accessLevel: Role.DEVELOPER,
    permissions: { ...NO_PERMISSIONS, canCreateTask: true, canChangeAnyTaskStatus: true },
  },
  {
    name: 'DevOps',
    description: 'Builds, deploys and keeps environments running.',
    color: 'cyan',
    accessLevel: Role.DEVELOPER,
    permissions: { ...NO_PERMISSIONS, canCreateTask: true, canChangeAnyTaskStatus: true },
  },
  {
    name: 'Designer',
    description: 'UI/UX design work.',
    color: 'rose',
    accessLevel: Role.DEVELOPER,
    permissions: { ...NO_PERMISSIONS, canCreateTask: true },
  },
  {
    name: 'Business Analyst',
    description: 'Writes and refines requirements and acceptance criteria.',
    color: 'amber',
    accessLevel: Role.DEVELOPER,
    permissions: { ...NO_PERMISSIONS, canCreateTask: true, canEditAnyTask: true },
  },
];
