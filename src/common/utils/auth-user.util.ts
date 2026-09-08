import { InternalServerErrorException } from '@nestjs/common';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Every org-scoped route is guarded by OrganizationScopeGuard, which never lets a
 * PlatformAdmin (the only role with a null organizationId) reach a service method that calls
 * this - so a null here means the guard has a bug, not that the caller needs to handle it.
 */
export function requireOrgId(user: AuthenticatedUser): string {
  if (!user.organizationId) {
    throw new InternalServerErrorException(
      'Expected an org-scoped user but organizationId was null',
    );
  }
  return user.organizationId;
}
