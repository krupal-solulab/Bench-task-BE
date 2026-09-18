import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { SprintStatus } from 'src/common/enums/sprint-status.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { SprintsService } from 'src/modules/sprints/sprints.service';
import { SprintsRepository } from 'src/modules/sprints/sprints.repository';
import { SprintActivityAction } from 'src/modules/sprints/schemas/sprint-activity.schema';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { NotificationsService } from 'src/notifications/notifications.service';

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
      | 'findCompletedForProject'
    >
  >;
  let projectsService: jest.Mocked<
    Pick<
      ProjectsService,
      | 'getActiveProjectOrThrow'
      | 'assertUserCanManage'
      | 'assertUserCanManageOrGranted'
      | 'assertUserCanView'
      | 'membersWithRole'
    >
  >;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifySchemeEvent'>>;
  let taskModel: { updateMany: jest.Mock; aggregate: jest.Mock; find: jest.Mock };
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
      findCompletedForProject: jest.fn().mockResolvedValue([]),
    };
    projectsService = {
      getActiveProjectOrThrow: jest.fn().mockResolvedValue(makeProject()),
      assertUserCanManage: jest.fn(),
      assertUserCanManageOrGranted: jest.fn(),
      assertUserCanView: jest.fn(),
      membersWithRole: jest.fn().mockResolvedValue([]),
    };
    notificationsService = { notifySchemeEvent: jest.fn().mockResolvedValue(undefined) };
    taskModel = {
      updateMany: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
      aggregate: jest.fn().mockResolvedValue([]),
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    };
    service = new SprintsService(
      sprintsRepository as unknown as SprintsRepository,
      projectsService as unknown as ProjectsService,
      notificationsService as unknown as NotificationsService,
      taskModel as never,
    );
  });

  describe('permission-grant delegation (Phase 3: per-project member grants)', () => {
    const dev = makeUser({ id: '507f1f77bcf86cd799439013', role: Role.DEVELOPER });

    it('create() checks canManageSprints', async () => {
      sprintsRepository.create.mockResolvedValue(makeSprint());
      sprintsRepository.findByIdActive.mockResolvedValue(makeSprint());

      await service.create(
        PROJECT_ID,
        { name: 'Sprint 1', startDate: '2026-01-01', endDate: '2026-01-14' } as never,
        dev,
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        dev,
        'canManageSprints',
      );
    });

    it('update() checks canManageSprints', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.updateById.mockResolvedValue(makeSprint({ name: 'Renamed' }));

      await service.update(PROJECT_ID, SPRINT_ID, { name: 'Renamed' }, dev);

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        dev,
        'canManageSprints',
      );
    });

    it('start() checks canManageSprints', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.findActiveSprintForProject.mockResolvedValue(null);
      sprintsRepository.updateById.mockResolvedValue(makeSprint({ status: SprintStatus.ACTIVE }));

      await service.start(PROJECT_ID, SPRINT_ID, dev);

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        dev,
        'canManageSprints',
      );
    });

    it('complete() checks canManageSprints', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({ status: SprintStatus.ACTIVE }),
      );
      sprintsRepository.updateById.mockResolvedValue(
        makeSprint({ status: SprintStatus.COMPLETED }),
      );

      await service.complete(PROJECT_ID, SPRINT_ID, dev);

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        dev,
        'canManageSprints',
      );
    });

    it('remove() checks canManageSprints', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());

      await service.remove(PROJECT_ID, SPRINT_ID, dev);

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        dev,
        'canManageSprints',
      );
    });
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

    it('delegates the permission check to ProjectsService.assertUserCanManageOrGranted', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.findActiveSprintForProject.mockResolvedValue(null);
      sprintsRepository.updateById.mockResolvedValue(makeSprint({ status: SprintStatus.ACTIVE }));

      await service.start(PROJECT_ID, SPRINT_ID, makeUser());

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canManageSprints',
      );
    });

    it('a project with no notification scheme fires no notification at all (regression: sprint start fires zero notifications today)', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.findActiveSprintForProject.mockResolvedValue(null);
      sprintsRepository.updateById.mockResolvedValue(makeSprint({ status: SprintStatus.ACTIVE }));

      await service.start(PROJECT_ID, SPRINT_ID, makeUser());

      expect(notificationsService.notifySchemeEvent).not.toHaveBeenCalled();
    });

    it('notifies a scheme-configured role on SprintStarted', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          notificationScheme: [
            { event: 'SprintStarted', notifyRoles: [Role.MANAGER], channels: ['InApp'] },
          ],
        }),
      );
      projectsService.membersWithRole.mockResolvedValue([
        { id: MANAGER_ID, email: 'manager@a.com' } as never,
      ]);
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint());
      sprintsRepository.findActiveSprintForProject.mockResolvedValue(null);
      sprintsRepository.updateById.mockResolvedValue(makeSprint({ status: SprintStatus.ACTIVE }));

      await service.start(PROJECT_ID, SPRINT_ID, makeUser());

      expect(projectsService.membersWithRole).toHaveBeenCalledWith(expect.anything(), Role.MANAGER);
      expect(notificationsService.notifySchemeEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: expect.objectContaining({ id: MANAGER_ID }),
          event: 'SprintStarted',
          channels: ['InApp'],
        }),
      );
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
        expect.objectContaining({
          deletedAt: null,
          statusCategory: { $ne: StatusCategory.DONE },
        }),
        { sprint: null },
      );
      expect(sprintsRepository.updateById).toHaveBeenCalledWith(
        SPRINT_ID,
        expect.objectContaining({ status: SprintStatus.COMPLETED, completedAt: expect.any(Date) }),
      );
    });

    it('notifies a scheme-configured role on SprintCompleted', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({
          notificationScheme: [
            { event: 'SprintCompleted', notifyRoles: [Role.MANAGER], channels: ['Email'] },
          ],
        }),
      );
      projectsService.membersWithRole.mockResolvedValue([
        { id: MANAGER_ID, email: 'manager@a.com' } as never,
      ]);
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({ status: SprintStatus.ACTIVE }),
      );
      sprintsRepository.updateById.mockResolvedValue(
        makeSprint({ status: SprintStatus.COMPLETED }),
      );

      await service.complete(PROJECT_ID, SPRINT_ID, makeUser());

      expect(notificationsService.notifySchemeEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'SprintCompleted', channels: ['Email'] }),
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

  describe('velocity', () => {
    it('returns an empty array when the project has no completed sprints (regression)', async () => {
      sprintsRepository.findCompletedForProject.mockResolvedValue([]);

      await expect(service.velocity(PROJECT_ID, makeUser())).resolves.toEqual([]);
      expect(taskModel.aggregate).not.toHaveBeenCalled();
    });

    it('zero-fills a completed sprint with no Done tasks', async () => {
      sprintsRepository.findCompletedForProject.mockResolvedValue([
        makeSprint({ id: 'sprint-a', name: 'Sprint A', completedAt: new Date('2026-01-14') }),
      ]);
      taskModel.aggregate.mockResolvedValue([]);

      const result = await service.velocity(PROJECT_ID, makeUser());

      expect(result).toEqual([
        {
          sprintId: 'sprint-a',
          name: 'Sprint A',
          completedAt: new Date('2026-01-14'),
          completedPoints: 0,
          completedCount: 0,
        },
      ]);
    });

    it('reports completed points/count per sprint from the aggregation', async () => {
      sprintsRepository.findCompletedForProject.mockResolvedValue([
        makeSprint({ id: 'sprint-a', name: 'Sprint A' }),
        makeSprint({ id: 'sprint-b', name: 'Sprint B' }),
      ]);
      taskModel.aggregate.mockResolvedValue([
        { _id: { toString: () => 'sprint-a' }, completedPoints: 13, completedCount: 4 },
      ]);

      const result = await service.velocity(PROJECT_ID, makeUser());

      expect(result).toEqual([
        expect.objectContaining({ sprintId: 'sprint-a', completedPoints: 13, completedCount: 4 }),
        expect.objectContaining({ sprintId: 'sprint-b', completedPoints: 0, completedCount: 0 }),
      ]);
    });

    it('clamps an out-of-range limit and ignores a non-numeric one', async () => {
      await service.velocity(PROJECT_ID, makeUser(), 999);
      expect(sprintsRepository.findCompletedForProject).toHaveBeenCalledWith(PROJECT_ID, 20);

      await service.velocity(PROJECT_ID, makeUser(), Number('not-a-number'));
      expect(sprintsRepository.findCompletedForProject).toHaveBeenCalledWith(PROJECT_ID, 5);
    });
  });

  describe('burndown', () => {
    it('returns an empty result for a sprint that has never been started', async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(makeSprint({ startedAt: null }));

      await expect(service.burndown(PROJECT_ID, SPRINT_ID, makeUser())).resolves.toEqual({
        points: [],
        hasStoryPoints: false,
      });
      expect(taskModel.find).not.toHaveBeenCalled();
    });

    it("computes remaining work from the sprint's currently-referenced tasks", async () => {
      sprintsRepository.findByIdActiveInProject.mockResolvedValue(
        makeSprint({
          _id: SPRINT_ID,
          startedAt: new Date('2026-01-01T00:00:00.000Z'),
          endDate: new Date('2026-01-05T00:00:00.000Z'),
          completedAt: new Date('2026-01-03T00:00:00.000Z'),
        }),
      );
      taskModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { storyPoints: 3, completedAt: null },
          { storyPoints: 2, completedAt: new Date('2026-01-02T00:00:00.000Z') },
        ]),
      });

      const result = await service.burndown(PROJECT_ID, SPRINT_ID, makeUser());

      expect(taskModel.find).toHaveBeenCalledWith(
        { sprint: SPRINT_ID, deletedAt: null },
        { storyPoints: 1, completedAt: 1 },
      );
      expect(result.hasStoryPoints).toBe(true);
      expect(result.points[0]).toMatchObject({ date: '2026-01-01', remainingPoints: 5 });
      expect(result.points[result.points.length - 1]).toMatchObject({ date: '2026-01-03' });
    });
  });
});
