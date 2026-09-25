import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { GranteeContext, granteeMatchesGrant } from '../../common/utils/grant-matching.util';

export type PermissionSchemeDocument = HydratedDocument<PermissionScheme>;

/**
 * The 6 project actions the BRD's Permission Scheme model names explicitly. "Transition" is
 * deliberately one blanket action (matching today's single `canChangeAnyTaskStatus` granularity)
 * rather than a distinct grant per named status value - true per-status granularity depends on a
 * configurable per-project status list (Workflow Engine v2), a later roadmap step.
 */
export enum SchemeAction {
  CREATE_ISSUE = 'CreateIssue',
  ASSIGN = 'Assign',
  TRANSITION = 'Transition',
  DELETE = 'Delete',
  EDIT_CUSTOM_FIELDS = 'EditCustomFields',
  MANAGE_SPRINT = 'ManageSprint',
}

export const SCHEME_ACTIONS = Object.values(SchemeAction);

@Schema({ _id: false })
export class PermissionGrant {
  @Prop({ type: String, enum: SchemeAction, required: true })
  action!: SchemeAction;

  @Prop({ type: [String], enum: Role, default: [] })
  allowedRoles!: Role[];

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  allowedUserIds!: Types.ObjectId[];

  // Module 6: a whole Team, or every user currently filling a given (org-wide) Project Role on
  // the project this scheme is assigned to - both resolved at check time, see
  // ProjectsService.resolveGranteeContext.
  @Prop({ type: [Types.ObjectId], ref: 'Team', default: [] })
  allowedTeamIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'ProjectRoleDefinition', default: [] })
  allowedProjectRoleIds!: Types.ObjectId[];
}

export const PermissionGrantSchema = SchemaFactory.createForClass(PermissionGrant);

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
export class PermissionScheme {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ type: [PermissionGrantSchema], default: [] })
  grants!: PermissionGrant[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const PermissionSchemeSchema = SchemaFactory.createForClass(PermissionScheme);

PermissionSchemeSchema.index({ organizationId: 1 });

/** Whether `ctx` is granted `action` by this scheme - by global role, individual user id, Team
 * membership, or Project Role membership (see grant-matching.util.ts). */
export function schemeGrants(
  scheme: PermissionScheme,
  action: SchemeAction,
  ctx: GranteeContext,
): boolean {
  const grant = scheme.grants.find((g) => g.action === action);
  if (!grant) return false;
  return granteeMatchesGrant(grant, ctx);
}
