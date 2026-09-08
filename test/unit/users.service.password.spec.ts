import * as bcrypt from 'bcrypt';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { AppConfig } from 'src/config/configuration';
import { Role } from 'src/common/enums/role.enum';
import { UsersService } from 'src/modules/users/users.service';
import { UsersRepository } from 'src/modules/users/users.repository';
import { TaskDocument } from 'src/modules/tasks/schemas/task.schema';

describe('UsersService password handling', () => {
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findByEmail' | 'create'>>;
  let configService: ConfigService<AppConfig, true>;
  let service: UsersService;

  beforeEach(() => {
    usersRepository = {
      findByEmail: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    } as unknown as typeof usersRepository;

    configService = {
      get: jest.fn().mockReturnValue(4), // low bcrypt cost for fast tests
    } as unknown as ConfigService<AppConfig, true>;

    service = new UsersService(
      usersRepository as unknown as UsersRepository,
      configService,
      {} as unknown as Model<TaskDocument>,
    );
  });

  it('never persists the plaintext password: passwordHash is a bcrypt digest, not the raw value', async () => {
    usersRepository.create.mockResolvedValue({ id: 'user-1' } as never);

    await service.registerSelf('Dev One', 'dev@example.com', 'super-secret-plain');

    const createArg = usersRepository.create.mock.calls[0][0] as { passwordHash: string };
    expect(createArg.passwordHash).not.toBe('super-secret-plain');
    expect(createArg.passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(bcrypt.compare('super-secret-plain', createArg.passwordHash)).resolves.toBe(true);
  });

  it('rejects registration when the email is already taken, without hashing anything', async () => {
    usersRepository.findByEmail.mockResolvedValue({ id: 'existing' } as never);
    await expect(service.registerSelf('Dev Two', 'taken@example.com', 'whatever')).rejects.toThrow(
      ConflictException,
    );
    expect(usersRepository.create).not.toHaveBeenCalled();
  });

  describe('validatePassword', () => {
    it('accepts the correct plaintext against its bcrypt hash', async () => {
      const hash = await bcrypt.hash('correct-horse', 4);
      const result = await service.validatePassword(
        { passwordHash: hash } as never,
        'correct-horse',
      );
      expect(result).toBe(true);
    });

    it('rejects an incorrect plaintext', async () => {
      const hash = await bcrypt.hash('correct-horse', 4);
      const result = await service.validatePassword({ passwordHash: hash } as never, 'wrong-guess');
      expect(result).toBe(false);
    });
  });

  it('gives Developer role to self-registered users regardless of anything else', async () => {
    usersRepository.create.mockResolvedValue({ id: 'user-1' } as never);
    await service.registerSelf('Dev One', 'dev@example.com', 'password123');
    const createArg = usersRepository.create.mock.calls[0][0] as { role: Role };
    expect(createArg.role).toBe(Role.DEVELOPER);
  });
});
