import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_DURING_IMPERSONATION_KEY } from '../decorators/allow-during-impersonation.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Module 8 gap-closure: impersonation ("view as") is strictly READ-ONLY. Any request carrying an
 * impersonation token that isn't a read is refused here, before any controller runs - so nothing
 * can ever be created, changed or deleted "as" someone else, and logout / password change can
 * never touch the real user's own sessions.
 */
@Injectable()
export class ImpersonationReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!request.user?.impersonatedBy || READ_METHODS.has(request.method)) return true;

    const allowed = this.reflector.get<boolean>(
      ALLOW_DURING_IMPERSONATION_KEY,
      context.getHandler(),
    );
    if (allowed) return true;
    throw new ForbiddenException(
      'You are viewing as another user (read-only) - exit "view as" to make changes',
    );
  }
}
