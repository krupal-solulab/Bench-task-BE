import { ExecutionContext, Injectable, Optional, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedUser } from '../interfaces/jwt-payload.interface';
import { API_TOKEN_PREFIX, ApiTokensService } from '../../modules/api-tokens/api-tokens.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    // Module 11 gap-closure - optional so this guard still constructs on its own (unit tests).
    @Optional() private readonly apiTokensService?: ApiTokensService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Module 11 gap-closure: `Bearer pat_...` is a personal API token, not a JWT. Everything
    // else goes through passport's JWT strategy exactly as before.
    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const header = request?.headers?.authorization;
    if (this.apiTokensService && header?.startsWith(`Bearer ${API_TOKEN_PREFIX}`)) {
      return this.authenticateApiToken(request, header.slice('Bearer '.length));
    }
    return super.canActivate(context);
  }

  private async authenticateApiToken(
    request: Request & { user?: AuthenticatedUser },
    raw: string,
  ): Promise<boolean> {
    const user = await this.apiTokensService!.authenticate(raw);
    if (!user) throw new UnauthorizedException('Invalid, expired or revoked API token');
    request.user = user;
    return true;
  }
}
