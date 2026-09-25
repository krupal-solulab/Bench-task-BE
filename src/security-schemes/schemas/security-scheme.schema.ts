import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { Role } from '../../common/enums/role.enum';
import { GranteeContext, granteeMatchesGrant } from '../../common/utils/grant-matching.util';

export type SecuritySchemeDocument = HydratedDocument<SecurityScheme>;

/**
 * Module 6's issue-level Security Schemes - confirmed entirely absent before this (grep for
 * "security" across the whole backend returned zero matches). Restricts who can *view* a specific
 * issue, independent of the Permission Scheme's edit/transition/delete actions: today, anyone who
 * can see a project can see every issue in it (`ProjectsService.assertCanView`/`isProjectMember`);
 * a Security Scheme adds a second, optional gate on top for issues explicitly marked with a level.
 *
 * Shape deliberately mirrors PermissionScheme almost exactly (org-scoped, referenced by id from
 * `Project.securitySchemeId`, one grant-shape per row) - the same 4 grantee kinds (role/user/team/
 * project role) apply here via the shared `granteeMatchesGrant`, just keyed by level *name* (like
 * Task.status/issueType are name-based) rather than by a fixed action enum.
 */
@Schema({ _id: false })
export class SecurityLevel {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ type: [String], enum: Role, default: [] })
  allowedRoles!: Role[];

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  allowedUserIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Team', default: [] })
  allowedTeamIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'ProjectRoleDefinition', default: [] })
  allowedProjectRoleIds!: Types.ObjectId[];
}

export const SecurityLevelSchema = SchemaFactory.createForClass(SecurityLevel);

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
export class SecurityScheme {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name!: string;

  @Prop({ type: [SecurityLevelSchema], default: [] })
  levels!: SecurityLevel[];

  createdAt!: Date;
  updatedAt!: Date;
}

export const SecuritySchemeSchema = SchemaFactory.createForClass(SecurityScheme);

SecuritySchemeSchema.index({ organizationId: 1 });

/** Every level name in `scheme` that `ctx` may view. A task with no securityLevel set is always
 * viewable to any project member regardless of scheme (mirrors Jira's own default: "no level set"
 * means "visible to everyone with project access") - this only concerns level-restricted issues. */
export function viewableLevelNames(scheme: SecurityScheme, ctx: GranteeContext): string[] {
  return scheme.levels
    .filter((level) => granteeMatchesGrant(level, ctx))
    .map((level) => level.name);
}
