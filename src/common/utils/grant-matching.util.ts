import { Role } from '../enums/role.enum';

/** Everything about the acting user that a grant (Permission Scheme action, Security Scheme
 * level) might be scoped to - resolved once per check by the caller (ProjectsService/TasksService)
 * from the user's global role, their Team memberships, and their per-project Role Assignments. */
export interface GranteeContext {
  role: Role;
  userId: string;
  teamIds: string[];
  projectRoleIds: string[];
}

interface IdLike {
  toString(): string;
}

export interface GrantLike {
  allowedRoles: Role[];
  allowedUserIds: IdLike[];
  // Optional so a grant shape predating Module 6 (or a hand-built test double) still works -
  // treated as "grants nobody via this kind" rather than throwing.
  allowedTeamIds?: IdLike[];
  allowedProjectRoleIds?: IdLike[];
}

/** Whether `ctx` is covered by `grant` through any one of its 4 independent grantee kinds - global
 * role, individual user, Team membership, or Project Role membership (Module 6). Shared by both
 * Permission Scheme action-checking and Security Scheme level-checking so the "who does this grant
 * apply to" rule stays in exactly one place. */
export function granteeMatchesGrant(grant: GrantLike, ctx: GranteeContext): boolean {
  if (grant.allowedRoles.includes(ctx.role)) return true;
  if (grant.allowedUserIds.some((id) => id.toString() === ctx.userId)) return true;
  if ((grant.allowedTeamIds ?? []).some((id) => ctx.teamIds.includes(id.toString()))) return true;
  if (
    (grant.allowedProjectRoleIds ?? []).some((id) => ctx.projectRoleIds.includes(id.toString()))
  ) {
    return true;
  }
  return false;
}
