import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DISALLOW_API_TOKEN_KEY } from '../decorators/disallow-api-token.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

/**
 * Module 11 gap-closure: refuses `@DisallowApiToken()` routes when the request was authenticated
 * with a personal API token rather than a normal sign-in. Normal sessions are never affected.
 */
@Injectable()
export class ApiTokenRestrictionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user?.viaApiToken) return true;
    const disallowed = this.reflector.getAllAndOverride<boolean>(DISALLOW_API_TOKEN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!disallowed) return true;
    throw new ForbiddenException("This action can't be done with an API token - sign in instead");
  }
}
