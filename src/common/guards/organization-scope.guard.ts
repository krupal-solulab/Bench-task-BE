import { ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PLATFORM_ONLY_KEY } from '../decorators/platform-only.decorator';
import { IS_SHARED_KEY } from '../decorators/shared-route.decorator';
import { Role } from '../enums/role.enum';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Enforces the platform/org split: a PlatformAdmin can only reach routes marked @PlatformOnly()
 * (or @SharedRoute()/@Public()), and every other role can never reach a @PlatformOnly() route.
 * This is a fail-closed allowlist - a new org route that forgets to think about tenancy is still
 * automatically blocked for platform admins by default, since it isn't marked @PlatformOnly().
 *
 * RolesGuard (registered after this one) still separately enforces the fine-grained
 * Admin/Manager/Developer split within whichever side this guard lets through - the two are
 * complementary, not redundant: this decides "which app", RolesGuard decides "which role in it".
 */
@Injectable()
export class OrganizationScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const isSharedRoute = this.reflector.getAllAndOverride<boolean>(IS_SHARED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isSharedRoute) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const isPlatformAdmin = request.user?.role === Role.PLATFORM_ADMIN;

    const isPlatformOnlyRoute = this.reflector.getAllAndOverride<boolean>(PLATFORM_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPlatformOnlyRoute) return isPlatformAdmin;
    return !isPlatformAdmin;
  }
}
