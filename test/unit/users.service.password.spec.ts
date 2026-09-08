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

  const ORG_ID = '507f1f77bcf86cd799439011';
  const OTHER_ORG_ID = '507f1f77bcf86cd799439022';
  const dto = {
    name: 'Dev One',
    email: 'dev@example.com',
    password: 'super-secret-plain',
    role: Role.DEVELOPER as const,
  };

  it('never persists the plaintext password: passwordHash is a bcrypt digest, not the raw value', async () => {
    usersRepository.create.mockResolvedValue({ id: 'user-1' } as never);

    await service.create(dto, ORG_ID);

    const createArg = usersRepository.create.mock.calls[0][0] as { passwordHash: string };
    expect(createArg.passwordHash).not.toBe('super-secret-plain');
    expect(createArg.passwordHash).toMatch(/^\$2[aby]\$/);
    await expect(bcrypt.compare('super-secret-plain', createArg.passwordHash)).resolves.toBe(true);
  });

  it('rejects creation when the email is already taken, without hashing anything', async () => {
    usersRepository.findByEmail.mockResolvedValue({ id: 'existing' } as never);
    await expect(service.create({ ...dto, email: 'taken@example.com' }, ORG_ID)).rejects.toThrow(
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

  it('stamps the given organizationId onto the created user, regardless of the acting org', async () => {
    usersRepository.create.mockResolvedValue({ id: 'user-1' } as never);
    await service.create(dto, OTHER_ORG_ID);
    const createArg = usersRepository.create.mock.calls[0][0] as { organizationId: unknown };
    expect(createArg.organizationId?.toString()).toBe(OTHER_ORG_ID);
  });
});
