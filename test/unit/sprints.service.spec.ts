import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { SprintStatus } from 'src/common/enums/sprint-status.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { SprintsService } from 'src/modules/sprints/sprints.service';
import { SprintsRepository } from 'src/modules/sprints/sprints.repository';
import { SprintActivityAction } from 'src/modules/sprints/schemas/sprint-activity.schema';
import { ProjectsService } from 'src/modules/projects/projects.service';

const ORG_A = 'org-a';
const PROJECT_ID = '507f1f77bcf86cd799439010';
const SPRINT_ID = '507f1f77bcf86cd799439020';
const MANAGER_ID = '507f1f77bcf86cd799439012';

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROJECT_ID,
    organizationId: { toString: () => ORG_A },
    ...overrides,
  } as never;
}

function makeSprint(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: SPRINT_ID,
    name: 'Sprint 1',
    status: SprintStatus.PLANNED,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-01-14'),
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: MANAGER_ID,
    email: 'manager@a.com',
    role: Role.MANAGER,
    organizationId: ORG_A,
    ...overrides,
  };
}

describe('SprintsService', () => {
  let sprintsRepository: jest.Mocked<
    Pick<
      SprintsRepository,
      | 'create'
      | 'findByIdActive'
      | 'findByIdActiveInProject'
      | 'findActiveSprintForProject'
      | 'updateById'
      | 'softDelete'
      | 'logActivity'
      | 'paginate'
      | 'paginateActivity'
    >
  >;
  let projectsService: jest.Mocked<
    Pick<ProjectsService, 'getActiveProjectOrThrow' | 'assertUserCanManage' | 'assertUserCanView'>
  >;
  let taskModel: { updateMany: jest.Mock };
  let service: SprintsService;

  beforeEach(() => {
    sprintsRepository = {
      create: jest.fn(),
      findByIdActive: jest.fn(),
      findByIdActiveInProject: jest.fn(),
      findActiveSprintForProject: jest.fn(),
      updateById: jest.fn(),
      softDelete: jest.fn(),
      logActivity: jest.fn(),
      paginate: jest.fn(),
      paginateActivity: jest.fn(),
    };
    projectsService = {
      getActiveProjectOrThrow: jest.fn().mockResolvedValue(makeProject()),
      assertUserCanManage: jest.fn(),
      assertUserCanView: jest.fn(),
    };
    taskModel = {
      updateMany: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
    };
    service = new SprintsService(
      sprintsRepository as unknown as SprintsRepository,
      projectsService as unknown as ProjectsService,
      taskModel as never,
    );
  });

  describe('start', () => {
    it('rejects starting a sprint when another sprint is already Active', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.findActiveSprintForProject.mockResolvedValue(
        makeSprint({ id: 'other-sprint', name: 'Already Active' }),
      );

      await expect(service.start(PROJECT_ID, SPRINT_ID, makeUser())).rejects.toThrow(
        ConflictException,
      );
      expect(sprintsRepository.updateById).not.toHaveBeenCalled();
    });

    it('rejects starting a sprint that is not Planned', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({ status: SprintStatus.COMPLETED }),
      );

      await expect(service.start(PROJECT_ID, SPRINT_ID, makeUser())).rejects.toThrow(
        ConflictException,
      );
    });

    it('sets status Active and startedAt on success', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.findActiveSprintForProject.mockResolvedValue(null);
      sprintsRepository.updateById.mockResolvedValue(makeSprint({ status: SprintStatus.ACTIVE }));

      await service.start(PROJECT_ID, SPRINT_ID, makeUser());

      expect(sprintsRepository.updateById).toHaveBeenCalledWith(
        SPRINT_ID,
        expect.objectContaining({ status: SprintStatus.ACTIVE, startedAt: expect.any(Date) }),
      );
      expect(sprintsRepository.logActivity).toHaveBeenCalledWith(
        SPRINT_ID,
        MANAGER_ID,
        SprintActivityAction.STARTED,
        SprintStatus.PLANNED,
        SprintStatus.ACTIVE,
      );
    });

    it('delegates the permission check to ProjectsService.assertUserCanManage', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.findActiveSprintForProject.mockResolvedValue(null);
      sprintsRepository.updateById.mockResolvedValue(makeSprint({ status: SprintStatus.ACTIVE }));

      await service.start(PROJECT_ID, SPRINT_ID, makeUser());

      expect(projectsService.assertUserCanManage).toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('rejects completing a sprint that is not Active', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({ status: SprintStatus.PLANNED }),
      );

      await expect(service.complete(PROJECT_ID, SPRINT_ID, makeUser())).rejects.toThrow(
        ConflictException,
      );
      expect(taskModel.updateMany).not.toHaveBeenCalled();
    });

    it('moves only non-Done tasks back to the backlog', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({ status: SprintStatus.ACTIVE }),
      );
      taskModel.updateMany.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 3 }),
      });
      sprintsRepository.updateById.mockResolvedValue(
        makeSprint({ status: SprintStatus.COMPLETED }),
      );

      await service.complete(PROJECT_ID, SPRINT_ID, makeUser());

      expect(taskModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: null, status: { $ne: TaskStatus.DONE } }),
        { sprint: null },
      );
      expect(sprintsRepository.updateById).toHaveBeenCalledWith(
        SPRINT_ID,
        expect.objectContaining({ status: SprintStatus.COMPLETED, completedAt: expect.any(Date) }),
      );
    });
  });

  describe('remove', () => {
    it('rejects deleting a sprint that is not Planned', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({ status: SprintStatus.ACTIVE }),
      );

      await expect(service.remove(PROJECT_ID, SPRINT_ID, makeUser())).rejects.toThrow(
        ConflictException,
      );
      expect(sprintsRepository.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes a Planned sprint', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());

      await service.remove(PROJECT_ID, SPRINT_ID, makeUser());

      expect(sprintsRepository.softDelete).toHaveBeenCalledWith(SPRINT_ID);
    });
  });

  describe('update', () => {
    it('rejects editing a Completed sprint', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({ status: SprintStatus.COMPLETED }),
      );

      await expect(
        service.update(PROJECT_ID, SPRINT_ID, { name: 'New name' }, makeUser()),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects endDate before startDate', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());

      await expect(
        service.update(
          PROJECT_ID,
          SPRINT_ID,
          { startDate: '2026-02-01', endDate: '2026-01-01' },
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
