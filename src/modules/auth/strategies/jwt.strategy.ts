import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfig } from '../../../config/configuration';
import { JwtPayload, AuthenticatedUser } from '../../../common/interfaces/jwt-payload.interface';
import { UsersService } from '../../users/users.service';
import { OrganizationsService } from '../../organizations/organizations.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findByIdOrThrow(payload.sub).catch(() => null);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }
    // Reloading the user fresh on every request (above) already means a deactivated user is
    // rejected immediately, not just at their next login - this extends the same guarantee to
    // organization suspension, so suspending an org kills every one of its members' active
    // sessions on their very next request, not only new logins.
    const organizationId = user.organizationId ? user.organizationId.toString() : null;
    await this.organizationsService.assertActive(organizationId).catch(() => {
      throw new UnauthorizedException('Organization is suspended');
    });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId ? user.organizationId.toString() : null,
    };
  }
}
