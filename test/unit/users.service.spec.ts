import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model } from 'mongoose';
import { AppConfig } from 'src/config/configuration';
import { Role } from 'src/common/enums/role.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import { UsersService } from 'src/modules/users/users.service';
import { UsersRepository } from 'src/modules/users/users.repository';
import { TaskDocument } from 'src/modules/tasks/schemas/task.schema';

const ORG_ID = '507f1f77bcf86cd799439011';
const OTHER_ORG_ID = '507f1f77bcf86cd799439022';

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-1',
    name: 'Dev One',
    email: 'dev@example.com',
    role: Role.DEVELOPER,
    isActive: true,
    organizationId: { toString: () => ORG_ID },
    ...overrides,
  } as never;
}

describe('UsersService', () => {
  let usersRepository: jest.Mocked<
    Pick<UsersRepository, 'findByEmail' | 'findById' | 'updateById' | 'create'>
  >;
  let taskModel: { aggregate: jest.Mock };
  let service: UsersService;

  beforeEach(() => {
    usersRepository = {
      findByEmail: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
      updateById: jest.fn(),
      create: jest.fn(),
    };
    taskModel = { aggregate: jest.fn() };
    const configService = { get: jest.fn().mockReturnValue(4) } as unknown as ConfigService<
      AppConfig,
      true
    >;
    service = new UsersService(
      usersRepository as unknown as UsersRepository,
      configService,
      taskModel as unknown as Model<TaskDocument>,
    );
  });

  describe('findByIdInOrgOrThrow', () => {
    it('returns the user when it belongs to the given organization', async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      const result = await service.findByIdInOrgOrThrow('user-1', ORG_ID);
      expect(result.id).toBe('user-1');
    });

    it('throws NotFoundException (not Forbidden) for a user in a different organization', async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      await expect(service.findByIdInOrgOrThrow('user-1', OTHER_ORG_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the user does not exist at all', async () => {
      usersRepository.findById.mockResolvedValue(null);
      await expect(service.findByIdInOrgOrThrow('missing', ORG_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('rejects changing to an email already used by someone else', async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      usersRepository.findByEmail.mockResolvedValue(makeUser({ id: 'someone-else' }));

      await expect(
        service.update('user-1', { email: 'taken@example.com' }, ORG_ID),
      ).rejects.toThrow(ConflictException);
    });

    it('allows a user to keep their own current email unchanged', async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      usersRepository.findByEmail.mockResolvedValue(makeUser({ id: 'user-1' }));
      usersRepository.updateById.mockResolvedValue(makeUser({ email: 'dev@example.com' }));

      await expect(
        service.update('user-1', { email: 'dev@example.com' }, ORG_ID),
      ).resolves.toBeDefined();
    });
  });

  describe('updateRole', () => {
    it('rejects an Admin trying to change their own role', async () => {
      await expect(service.updateRole('user-1', Role.MANAGER, 'user-1', ORG_ID)).rejects.toThrow(
        'Admins cannot change their own role',
      );
      expect(usersRepository.findById).not.toHaveBeenCalled();
    });

    it("changes another user's role in the same organization", async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      usersRepository.updateById.mockResolvedValue(makeUser({ role: Role.MANAGER }));

      const result = await service.updateRole('user-1', Role.MANAGER, 'admin-1', ORG_ID);

      expect(result.role).toBe(Role.MANAGER);
      expect(usersRepository.updateById).toHaveBeenCalledWith('user-1', { role: Role.MANAGER });
    });

    it('rejects changing the role of a user in a different organization (masked as 404)', async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      await expect(
        service.updateRole('user-1', Role.MANAGER, 'admin-1', OTHER_ORG_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('rejects an Admin trying to deactivate themselves', async () => {
      await expect(service.updateStatus('user-1', false, 'user-1', ORG_ID)).rejects.toThrow(
        'Admins cannot deactivate themselves',
      );
      expect(usersRepository.findById).not.toHaveBeenCalled();
    });

    it('allows an Admin to reactivate themselves (only self-deactivation is blocked)', async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      usersRepository.updateById.mockResolvedValue(makeUser({ isActive: true }));

      await expect(service.updateStatus('user-1', true, 'user-1', ORG_ID)).resolves.toBeDefined();
    });

    it('deactivates another user in the same organization', async () => {
      usersRepository.findById.mockResolvedValue(makeUser());
      usersRepository.updateById.mockResolvedValue(makeUser({ isActive: false }));

      const result = await service.updateStatus('user-1', false, 'admin-1', ORG_ID);

      expect(result.isActive).toBe(false);
    });
  });

  describe('getWorkload', () => {
    const VALID_USER_ID = '507f1f77bcf86cd799439033';

    it('shapes the aggregation facets into a workload summary with a computed completion rate', async () => {
      usersRepository.findById.mockResolvedValue(makeUser({ id: VALID_USER_ID, name: 'Dev One' }));
      taskModel.aggregate.mockResolvedValue([
        {
          byStatus: [
            { _id: TaskStatus.TODO, count: 2 },
            { _id: TaskStatus.DONE, count: 3 },
          ],
          total: [{ count: 5 }],
          overdue: [{ count: 1 }],
        },
      ]);

      const result = await service.getWorkload(VALID_USER_ID, ORG_ID);

      expect(result).toEqual({
        userId: VALID_USER_ID,
        name: 'Dev One',
        total: 5,
        todo: 2,
        inProgress: 0,
        review: 0,
        done: 3,
        overdue: 1,
        completionRate: 60,
      });
    });

    it('returns a 0% completion rate when the user has no tasks at all', async () => {
      usersRepository.findById.mockResolvedValue(makeUser({ id: VALID_USER_ID }));
      taskModel.aggregate.mockResolvedValue([{ byStatus: [], total: [], overdue: [] }]);

      const result = await service.getWorkload(VALID_USER_ID, ORG_ID);

      expect(result.total).toBe(0);
      expect(result.completionRate).toBe(0);
    });
  });
});
