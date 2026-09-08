import { Types } from 'mongoose';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AppConfig } from 'src/config/configuration';
import { Role } from 'src/common/enums/role.enum';
import { AuthService } from 'src/modules/auth/auth.service';
import { AuthRepository } from 'src/modules/auth/auth.repository';
import { UsersService } from 'src/modules/users/users.service';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'dev@example.com',
    role: Role.DEVELOPER,
    isActive: true,
    passwordHash: 'hashed',
    organizationId: 'org-1',
    ...overrides,
  };
}

describe('AuthService', () => {
  let usersService: jest.Mocked<
    Pick<
      UsersService,
      'findByEmailWithPassword' | 'validatePassword' | 'findByIdOrThrow' | 'setPassword'
    >
  >;
  let organizationsService: jest.Mocked<
    Pick<OrganizationsService, 'createWithAdmin' | 'assertActive'>
  >;
  let authRepository: jest.Mocked<
    Pick<
      AuthRepository,
      'create' | 'findByHash' | 'revokeById' | 'revokeFamily' | 'revokeAllForUser'
    >
  >;
  let jwtService: jest.Mocked<Pick<JwtService, 'sign'>>;
  let configService: ConfigService<AppConfig, true>;
  let service: AuthService;

  const CONFIG: Record<string, string> = {
    'jwt.accessSecret': 'access-secret',
    'jwt.accessExpiresIn': '15m',
    'jwt.refreshExpiresIn': '7d',
  };

  beforeEach(() => {
    usersService = {
      findByEmailWithPassword: jest.fn(),
      validatePassword: jest.fn(),
      findByIdOrThrow: jest.fn(),
      setPassword: jest.fn(),
    } as unknown as typeof usersService;

    organizationsService = {
      createWithAdmin: jest.fn(),
      assertActive: jest.fn().mockResolvedValue(undefined),
    } as unknown as typeof organizationsService;

    authRepository = {
      create: jest.fn(),
      findByHash: jest.fn(),
      revokeById: jest.fn(),
      revokeFamily: jest.fn(),
      revokeAllForUser: jest.fn(),
    } as unknown as typeof authRepository;

    jwtService = {
      sign: jest.fn().mockReturnValue('signed.jwt.token'),
    } as unknown as typeof jwtService;

    configService = {
      get: jest.fn((key: string) => CONFIG[key]),
    } as unknown as ConfigService<AppConfig, true>;

    service = new AuthService(
      usersService as unknown as UsersService,
      organizationsService as unknown as OrganizationsService,
      authRepository as unknown as AuthRepository,
      jwtService as unknown as JwtService,
      configService,
    );
  });

  describe('registerOrganization', () => {
    it('creates the organization and its admin, then issues a fresh token pair', async () => {
      const admin = makeUser({ role: Role.ADMIN });
      organizationsService.createWithAdmin.mockResolvedValue({
        organization: { id: 'org-1' } as never,
        admin: admin as never,
      });
      authRepository.create.mockResolvedValue({} as never);

      const dto = {
        organizationName: 'Acme',
        adminName: 'Dev One',
        adminEmail: 'dev@example.com',
        adminPassword: 'plain-password',
      };
      const result = await service.registerOrganization(dto);

      expect(organizationsService.createWithAdmin).toHaveBeenCalledWith(dto, null);
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toEqual(expect.any(String));
      expect(result.refreshToken).not.toBe('plain-password');
      expect(result.refreshToken.length).toBeGreaterThan(20);

      const createCall = authRepository.create.mock.calls[0][0];
      expect(createCall.tokenHash).not.toBe(result.refreshToken);
      expect(createCall.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('login', () => {
    it('rejects an unknown email without revealing which part was wrong', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(null);
      await expect(service.login('nobody@example.com', 'x')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a deactivated account even with the correct password', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(
        makeUser({ isActive: false }) as never,
      );
      await expect(service.login('dev@example.com', 'x')).rejects.toThrow(UnauthorizedException);
      expect(usersService.validatePassword).not.toHaveBeenCalled();
    });

    it('rejects a wrong password', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(makeUser() as never);
      usersService.validatePassword.mockResolvedValue(false);
      await expect(service.login('dev@example.com', 'wrong')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects a correct password when the account organization is suspended', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(makeUser() as never);
      usersService.validatePassword.mockResolvedValue(true);
      organizationsService.assertActive.mockRejectedValue(new Error('suspended'));

      await expect(service.login('dev@example.com', 'correct')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues tokens on a correct password', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(makeUser() as never);
      usersService.validatePassword.mockResolvedValue(true);
      authRepository.create.mockResolvedValue({} as never);

      const result = await service.login('dev@example.com', 'correct');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.refreshToken).toEqual(expect.any(String));
    });
  });

  describe('refresh', () => {
    function makeStoredToken(overrides: Record<string, unknown> = {}) {
      return {
        _id: new Types.ObjectId(),
        user: new Types.ObjectId('507f1f77bcf86cd799439011'),
        tokenHash: 'hash',
        familyId: 'family-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        ...overrides,
      };
    }

    it('rejects an unknown refresh token', async () => {
      authRepository.findByHash.mockResolvedValue(null);
      await expect(service.refresh('raw-token')).rejects.toThrow(UnauthorizedException);
    });

    it('detects reuse of an already-revoked token and revokes the whole family', async () => {
      const stored = makeStoredToken({ revokedAt: new Date() });
      authRepository.findByHash.mockResolvedValue(stored as never);

      await expect(service.refresh('raw-token')).rejects.toThrow(UnauthorizedException);
      expect(authRepository.revokeFamily).toHaveBeenCalledWith('family-1');
    });

    it('rejects an expired refresh token', async () => {
      const stored = makeStoredToken({ expiresAt: new Date(Date.now() - 1000) });
      authRepository.findByHash.mockResolvedValue(stored as never);

      await expect(service.refresh('raw-token')).rejects.toThrow(UnauthorizedException);
      expect(authRepository.revokeFamily).not.toHaveBeenCalled();
    });

    it('rejects when the owning account has since been deactivated', async () => {
      const stored = makeStoredToken();
      authRepository.findByHash.mockResolvedValue(stored as never);
      usersService.findByIdOrThrow.mockResolvedValue(makeUser({ isActive: false }) as never);

      await expect(service.refresh('raw-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when the owning account organization has since been suspended', async () => {
      const stored = makeStoredToken();
      authRepository.findByHash.mockResolvedValue(stored as never);
      usersService.findByIdOrThrow.mockResolvedValue(makeUser() as never);
      organizationsService.assertActive.mockRejectedValue(new Error('suspended'));

      await expect(service.refresh('raw-token')).rejects.toThrow(UnauthorizedException);
      expect(authRepository.revokeById).not.toHaveBeenCalled();
    });

    it('rotates the token: revokes the old one and issues a new pair under the same family', async () => {
      const stored = makeStoredToken();
      authRepository.findByHash.mockResolvedValue(stored as never);
      usersService.findByIdOrThrow.mockResolvedValue(makeUser() as never);
      authRepository.create.mockResolvedValue({} as never);

      const result = await service.refresh('raw-token');

      expect(authRepository.revokeById).toHaveBeenCalledWith(stored._id);
      expect(result.accessToken).toBe('signed.jwt.token');
      const createCall = authRepository.create.mock.calls[0][0];
      expect(createCall.familyId).toBe('family-1');
    });
  });

  describe('changePassword', () => {
    it('rejects when the current password does not match', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(makeUser() as never);
      usersService.validatePassword.mockResolvedValue(false);

      await expect(
        service.changePassword(makeUser() as never, 'wrong-current', 'new-pass'),
      ).rejects.toThrow(ConflictException);
      expect(usersService.setPassword).not.toHaveBeenCalled();
    });

    it('sets the new password and revokes all existing sessions on success', async () => {
      usersService.findByEmailWithPassword.mockResolvedValue(makeUser() as never);
      usersService.validatePassword.mockResolvedValue(true);

      await service.changePassword(makeUser() as never, 'correct-current', 'new-pass');

      expect(usersService.setPassword).toHaveBeenCalledWith('user-1', 'new-pass');
      expect(authRepository.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });
  });
});
