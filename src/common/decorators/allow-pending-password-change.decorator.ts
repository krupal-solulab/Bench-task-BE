import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_CHANGE_KEY = 'allowPendingPasswordChange';

/**
 * Exempts a route from PasswordChangeRequiredGuard - only for what a user who signed in with an
 * invite's temporary password needs to finish setting their own (read themselves, set the new
 * password, sign out).
 */
export const AllowPendingPasswordChange = (): MethodDecorator =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE_KEY, true);
