import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ALLOW_PENDING_PASSWORD_CHANGE_KEY } from '../decorators/allow-pending-password-change.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';

export const PASSWORD_CHANGE_REQUIRED_MESSAGE = 'You must set a new password before continuing';

/**
 * A user signed in with a project invite's temporary password can do nothing but set their own
 * password (and sign out) - enforced here, server-side, not just by the client redirecting them.
 * Read-only "view as" sessions are exempt: they are the Admin's, not the user's.
 */
@Injectable()
export class PasswordChangeRequiredGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user?.mustChangePassword || user.impersonatedBy) return true;

    const allowed = this.reflector.get<boolean>(
      ALLOW_PENDING_PASSWORD_CHANGE_KEY,
      context.getHandler(),
    );
    if (allowed) return true;
    throw new ForbiddenException(PASSWORD_CHANGE_REQUIRED_MESSAGE);
  }
}
