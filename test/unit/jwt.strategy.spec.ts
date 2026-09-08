import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AppConfig } from 'src/config/configuration';
import { Role } from 'src/common/enums/role.enum';
import { JwtStrategy } from 'src/modules/auth/strategies/jwt.strategy';
import { UsersService } from 'src/modules/users/users.service';

describe('JwtStrategy', () => {
  let usersService: { findByIdOrThrow: jest.Mock };
  let strategy: JwtStrategy;

  beforeEach(() => {
    usersService = { findByIdOrThrow: jest.fn() };
    const configService = {
      get: jest.fn().mockReturnValue('test-secret'),
    } as unknown as ConfigService<AppConfig, true>;
    strategy = new JwtStrategy(configService, usersService as unknown as UsersService);
  });

  const payload = { sub: 'user-1', email: 'a@a.com', role: Role.DEVELOPER };

  it('returns a minimal AuthenticatedUser for an active user', async () => {
    usersService.findByIdOrThrow.mockResolvedValue({
      id: 'user-1',
      email: 'a@a.com',
      role: Role.DEVELOPER,
      isActive: true,
    });

    const result = await strategy.validate(payload);

    expect(result).toEqual({ id: 'user-1', email: 'a@a.com', role: Role.DEVELOPER });
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
    });

    await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
  });
});
