import { randomBytes, randomUUID, createHash } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/configuration';
import { AuthenticatedUser, JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { Role } from '../../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import { OrganizationsService } from '../organizations/organizations.service';
import { CreateOrganizationDto } from '../organizations/dto/create-organization.dto';
import { ProjectInvitesService } from '../project-invites/project-invites.service';
import { AuthRepository } from './auth.repository';
import { parseDurationMs } from './utils/parse-duration.util';

/** Module 8 gap-closure: how long a read-only "view as" token lives (no refresh, by design). */
export const IMPERSONATION_TTL_SECONDS = 15 * 60;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly organizationsService: OrganizationsService,
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly projectInvitesService: ProjectInvitesService,
  ) {}

  async registerOrganization(
    dto: CreateOrganizationDto,
  ): Promise<AuthTokens & { user: UserDocument }> {
    const { admin } = await this.organizationsService.createWithAdmin(dto, null);
    const tokens = await this.issueTokens(admin);
    return { ...tokens, user: admin };
  }

  async login(email: string, password: string): Promise<AuthTokens & { user: UserDocument }> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user) {
      // No account yet: the email + temporary password from a project invite accepts it here
      // too, not only through the invitation link.
      const invited = await this.projectInvitesService.acceptByEmail(email, password);
      if (!invited) throw new UnauthorizedException('Invalid email or password');
      return { ...(await this.issueTokens(invited, randomUUID())), user: invited };
    }
    if (!user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await this.usersService.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // Checked after credentials so a suspended org's user gets the same generic response as a
    // wrong password would - not a distinct error that would confirm the org exists/is suspended.
    await this.assertOrgActiveOrThrow(user);
    const tokens = await this.issueTokens(user, randomUUID());
    return { ...tokens, user };
  }

  /** Accepts a project invite through its link, creating the account and signing it in. */
  async acceptInvite(
    token: string,
    temporaryPassword: string,
  ): Promise<AuthTokens & { user: UserDocument }> {
    const user = await this.projectInvitesService.acceptWithToken(token, temporaryPassword);
    return { ...(await this.issueTokens(user, randomUUID())), user };
  }

  /**
   * Completes an invite account: the invitee's own name and first password - no current password
   * asked (they just signed in with the temporary one). Every older session is revoked and a fresh one
   * issued, so the user carries straight on.
   */
  async setInitialPassword(
    userId: string,
    newPassword: string,
    name: string,
  ): Promise<AuthTokens & { user: UserDocument }> {
    const current = await this.usersService.findByIdOrThrow(userId);
    if (!current.mustChangePassword) {
      throw new ConflictException('No password change is pending - use change password instead');
    }
    const withHash = await this.usersService.findByEmailWithPassword(current.email);
    if (withHash && (await this.usersService.validatePassword(withHash, newPassword))) {
      throw new BadRequestException('Choose a password different from your temporary one');
    }
    await this.usersService.setPassword(userId, newPassword);
    await this.usersService.setName(userId, name.trim());
    await this.authRepository.revokeAllForUser(userId);
    const user = await this.usersService.findByIdOrThrow(userId);
    return { ...(await this.issueTokens(user, randomUUID())), user };
  }

  async refresh(rawToken: string): Promise<AuthTokens> {
    const tokenHash = this.hashToken(rawToken);
    const stored = await this.authRepository.findByHash(tokenHash);

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      await this.authRepository.revokeFamily(stored.familyId);
      throw new UnauthorizedException('Refresh token has already been used');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token has expired');
    }

    const user = await this.usersService.findByIdOrThrow(stored.user.toString());
    if (!user.isActive) {
      throw new UnauthorizedException('Account is deactivated');
    }
    await this.assertOrgActiveOrThrow(user);

    await this.authRepository.revokeById(stored._id);
    return this.issueTokens(user, stored.familyId);
  }

  async logoutAllForUser(userId: string): Promise<void> {
    await this.authRepository.revokeAllForUser(userId);
  }

  async changePassword(
    user: UserDocument,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const withHash = await this.usersService.findByEmailWithPassword(user.email);
    const valid = withHash && (await this.usersService.validatePassword(withHash, currentPassword));
    if (!valid) {
      throw new ConflictException('Current password is incorrect');
    }
    await this.usersService.setPassword(user.id, newPassword);
    await this.authRepository.revokeAllForUser(user.id);
  }

  /**
   * Module 8 gap-closure: a read-only "view as" session. An org Admin may view as any ACTIVE,
   * NON-Admin user of their own org (never themselves, another Admin, or anyone cross-org). The
   * token is access-only (no refresh token, so it simply expires) and short-lived; every request
   * made with it is re-validated in JwtStrategy and refused by ImpersonationReadOnlyGuard unless
   * it's a read.
   */
  async startImpersonation(
    actingUser: AuthenticatedUser,
    targetUserId: string,
  ): Promise<{ accessToken: string; expiresInSeconds: number; user: UserDocument }> {
    if (actingUser.impersonatedBy) {
      throw new ForbiddenException('Exit the current "view as" session first');
    }
    const organizationId = actingUser.organizationId;
    if (!organizationId) {
      throw new ForbiddenException('Only an organization Admin can view as a user');
    }
    if (targetUserId === actingUser.id) {
      throw new BadRequestException('You cannot view as yourself');
    }
    const target = await this.usersService.findByIdInOrgOrThrow(targetUserId, organizationId);
    if (target.role === Role.ADMIN || target.role === Role.PLATFORM_ADMIN) {
      throw new ForbiddenException('Admins cannot be viewed as');
    }
    if (!target.isActive) {
      throw new BadRequestException('Cannot view as a deactivated user');
    }

    const payload: JwtPayload = {
      sub: target.id,
      email: target.email,
      role: target.role,
      organizationId,
      impersonatedBy: actingUser.id,
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: IMPERSONATION_TTL_SECONDS,
    });
    return { accessToken, expiresInSeconds: IMPERSONATION_TTL_SECONDS, user: target };
  }

  private async issueTokens(
    user: UserDocument,
    familyId: string = randomUUID(),
  ): Promise<AuthTokens> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId ? user.organizationId.toString() : null,
    };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get('jwt.accessSecret', { infer: true }),
      expiresIn: this.configService.get('jwt.accessExpiresIn', { infer: true }),
    });

    const refreshExpiresIn = this.configService.get('jwt.refreshExpiresIn', { infer: true });
    const rawRefreshToken = randomBytes(48).toString('hex');
    await this.authRepository.create({
      user: user.id,
      tokenHash: this.hashToken(rawRefreshToken),
      familyId,
      expiresAt: new Date(Date.now() + parseDurationMs(refreshExpiresIn)),
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Login/refresh both fail closed with 401 (not 403) so a suspended org isn't distinguishable
   * from any other authentication failure. */
  private async assertOrgActiveOrThrow(user: UserDocument): Promise<void> {
    try {
      await this.organizationsService.assertActive(
        user.organizationId ? user.organizationId.toString() : null,
      );
    } catch {
      throw new UnauthorizedException('Organization is suspended');
    }
  }
}
