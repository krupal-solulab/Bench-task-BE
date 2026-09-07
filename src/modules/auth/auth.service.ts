import { randomBytes, randomUUID, createHash } from 'crypto';
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from '../../config/configuration';
import { JwtPayload } from '../../common/interfaces/jwt-payload.interface';
import { UsersService } from '../users/users.service';
import { UserDocument } from '../users/schemas/user.schema';
import { AuthRepository } from './auth.repository';
import { parseDurationMs } from './utils/parse-duration.util';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly authRepository: AuthRepository,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async register(
    name: string,
    email: string,
    password: string,
  ): Promise<AuthTokens & { user: UserDocument }> {
    const user = await this.usersService.registerSelf(name, email, password);
    const tokens = await this.issueTokens(user);
    return { ...tokens, user };
  }

  async login(email: string, password: string): Promise<AuthTokens & { user: UserDocument }> {
    const user = await this.usersService.findByEmailWithPassword(email);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await this.usersService.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const tokens = await this.issueTokens(user, randomUUID());
    return { ...tokens, user };
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

  private async issueTokens(
    user: UserDocument,
    familyId: string = randomUUID(),
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
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
}
