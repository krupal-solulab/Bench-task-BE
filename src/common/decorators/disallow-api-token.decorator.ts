import { SetMetadata } from '@nestjs/common';

export const DISALLOW_API_TOKEN_KEY = 'disallowApiToken';

/**
 * Module 11 gap-closure: marks a route (or whole controller) that must never be reached with a
 * personal API token - managing tokens themselves, password/profile changes, logout and
 * impersonation. Enforced by ApiTokenRestrictionGuard.
 */
export const DisallowApiToken = (): MethodDecorator & ClassDecorator =>
  SetMetadata(DISALLOW_API_TOKEN_KEY, true);
