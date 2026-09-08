export enum Role {
  PLATFORM_ADMIN = 'PlatformAdmin',
  ADMIN = 'Admin',
  MANAGER = 'Manager',
  DEVELOPER = 'Developer',
}

/**
 * Every role that belongs to an organization - i.e. every role except PlatformAdmin. Used
 * anywhere a client picks a role for an org-scoped user (creating/updating a user within an
 * org): PlatformAdmin must never be assignable through those paths, since it would create an
 * account with `role: PlatformAdmin` but a non-null `organizationId`, breaking the invariant
 * OrganizationScopeGuard relies on (it grants platform access based on role alone).
 */
export const ORG_ROLES = [Role.ADMIN, Role.MANAGER, Role.DEVELOPER] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
