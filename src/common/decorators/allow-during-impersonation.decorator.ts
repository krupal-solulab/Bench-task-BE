import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_IMPERSONATION_KEY = 'allowDuringImpersonation';

/**
 * Exempts a non-GET route from ImpersonationReadOnlyGuard - only for routes that are part of the
 * impersonation flow itself (e.g. ending it), never for anything that changes data.
 */
export const AllowDuringImpersonation = (): MethodDecorator =>
  SetMetadata(ALLOW_DURING_IMPERSONATION_KEY, true);
