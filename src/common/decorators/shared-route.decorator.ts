import { SetMetadata } from '@nestjs/common';

export const IS_SHARED_KEY = 'isSharedRoute';

/**
 * Marks a route as usable by both a PlatformAdmin and an org-scoped user (e.g. GET /auth/me,
 * logout) - see OrganizationScopeGuard.
 */
export const SharedRoute = (): MethodDecorator & ClassDecorator => SetMetadata(IS_SHARED_KEY, true);
