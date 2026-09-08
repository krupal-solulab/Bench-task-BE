import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AppConfig } from 'src/config/configuration';
import { Role } from 'src/common/enums/role.enum';
import { JwtStrategy } from 'src/modules/auth/strategies/jwt.strategy';
import { UsersService } from 'src/modules/users/users.service';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';

describe('JwtStrategy', () => {
  let usersService: { findByIdOrThrow: jest.Mock };
  let organizationsService: { assertActive: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    usersService = { findByIdOrThrow: jest.fn() };
    organizationsService = { assertActive: jest.fn().mockResolvedValue(undefined) };
    const configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService<AppConfig, true>;
    strategy = new JwtStrategy(
      configService,
      usersService as unknown as UsersService,
      organizationsService as unknown as OrganizationsService,
    );
  });

  const payload = {
    sub: 'user-1',
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: 'org-1',
  };

  it('returns a minimal AuthenticatedUser for an active user, carrying its organizationId', async () => {
    usersService.findByIdOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      role: Role.DEVELOPER,
      isActive: true,
      organizationId: { toString: () => 'org-1' },
    });

    const result = await strategy.validate(payload);

    expect(result).toEqual({
      id: 'user-1',
      email: 'a@a.com',
      role: Role.DEVELOPER,
      organizationId: 'org-1',
    });
  });

  it('returns a null organizationId for a PlatformAdmin', async () => {
    usersService.findByIdOrThrow.mockResolvedValue({
      id: 'platform-1',
      email: 'p@a.com',
      role: Role.PLATFORM_ADMIN,
      isActive: true,
      organizationId: null,
    });

    const result = await strategy.validate({ ...payload, sub: 'platform-1' });

    expect(result.organizationId).toBeNull();
    // A PlatformAdmin has no organization to check - assertActive must not be called with null
    // in a way that could ever throw for them.
    expect(organizationsService.assertActive).toHaveBeenCalledWith(null);
  });

  it('rejects when the user no longer exists', async () => {
    usersService.findByIdOrThrow.mockRejectedValue(new Error('not found'));

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a deactivated user even if the token itself is still valid', async () => {
    usersService.findByIdOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      role: Role.DEVELOPER,
      isActive: false,
      organizationId: { toString: () => 'org-1' },
    });

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a session whose organization has since been suspended', async () => {
    usersService.findByIdOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      role: Role.DEVELOPER,
      isActive: true,
      organizationId: { toString: () => 'org-1' },
    });
    organizationsService.assertActive.mockRejectedValue(new Error('suspended'));

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});
