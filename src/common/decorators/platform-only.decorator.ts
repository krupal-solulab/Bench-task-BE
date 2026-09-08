import { SetMetadata } from '@nestjs/common';

export const PLATFORM_ONLY_KEY = 'platformOnly';

/** Marks a route as reachable only by a PlatformAdmin (see OrganizationScopeGuard). */
export const PlatformOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PLATFORM_ONLY_KEY, true);
