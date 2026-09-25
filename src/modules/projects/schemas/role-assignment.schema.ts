import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

/**
 * Module 6's per-project Role Assignment: "for THIS project, who fills the org-wide Project Role
 * named `projectRoleId`" (see project-roles/schemas/project-role-definition.schema.ts for why the
 * role's *name* is org-wide/reusable while its *membership* is per-project). Both individual users
 * and whole Teams can fill a role - a Team member counts as filling the role via team membership,
 * resolved at check time (see resolveUserProjectRoleIds below), not flattened into userIds here.
 */
@Schema({ _id: false })
export class ProjectRoleAssignment {
  @Prop({ type: Types.ObjectId, ref: 'ProjectRoleDefinition', required: true })
  projectRoleId!: Types.ObjectId;

  @Prop({ type: [Types.ObjectId], ref: 'User', default: [] })
  userIds!: Types.ObjectId[];

  @Prop({ type: [Types.ObjectId], ref: 'Team', default: [] })
  teamIds!: Types.ObjectId[];
}

export const ProjectRoleAssignmentSchema = SchemaFactory.createForClass(ProjectRoleAssignment);

interface RoleAssignmentLike {
  projectRoleId: Types.ObjectId | string;
  userIds: Array<Types.ObjectId | string>;
  teamIds: Array<Types.ObjectId | string>;
}

/** Every Project Role id `userId` fills on this project, either directly (`userIds`) or through
 * membership in one of `userTeamIds` (their current team memberships, resolved by the caller via
 * TeamsService.findTeamIdsForUser before calling this pure function). */
export function resolveUserProjectRoleIds(
  roleAssignments: RoleAssignmentLike[],
  userId: string,
  userTeamIds: string[],
): string[] {
  const teamIdSet = new Set(userTeamIds);
  return roleAssignments
    .filter(
      (assignment) =>
        assignment.userIds.some((id) => id.toString() === userId) ||
        assignment.teamIds.some((id) => teamIdSet.has(id.toString())),
    )
    .map((assignment) => assignment.projectRoleId.toString());
}
