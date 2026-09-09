import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import { TaskActivityAction } from 'src/modules/tasks/schemas/task-activity.schema';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { TasksService } from 'src/modules/tasks/tasks.service';
import { TasksRepository } from 'src/modules/tasks/tasks.repository';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { CacheService } from 'src/redis/cache.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { EventsGateway } from 'src/events/events.gateway';

const ORG_A = 'org-a';
const PROJECT_ID = '507f1f77bcf86cd799439010';
const ADMIN_ID = '507f1f77bcf86cd799439011';
const MANAGER_ID = '507f1f77bcf86cd799439012';
const DEV_ID = '507f1f77bcf86cd799439013';
const OTHER_DEV_ID = '507f1f77bcf86cd799439014';
const ASSIGNEE_ID = '507f1f77bcf86cd799439015';

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROJECT_ID,
    organizationId: { toString: () => ORG_A },
    owner: { toString: () => MANAGER_ID },
    status: ProjectStatus.IN_PROGRESS,
    ...overrides,
  } as never;
}

function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'task-1',
    title: 'Fix the bug',
    project: { toString: () => PROJECT_ID },
    organizationId: { toString: () => ORG_A },
    assignee: { toString: () => DEV_ID },
    status: TaskStatus.TODO,
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: ADMIN_ID, email: 'a@a.com', role: Role.ADMIN, organizationId: ORG_A, ...overrides };
}

describe('TasksService', () => {
  let tasksRepository: jest.Mocked<
    Pick<
      TasksRepository,
      'create' | 'findByIdActive' | 'updateById' | 'logActivity' | 'softDelete' | 'paginate'
    >
  >;
  let projectsService: jest.Mocked<
    Pick<
      ProjectsService,
      | 'getActiveProjectOrThrow'
      | 'assertUserCanManage'
      | 'isProjectMember'
      | 'getAccessibleProjectIds'
    >
  >;
  let cacheService: jest.Mocked<Pick<CacheService, 'delByPattern'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifyTaskAssigned'>>;
  let eventsGateway: jest.Mocked<Pick<EventsGateway, 'emitTaskStatusChanged'>>;
  let service: TasksService;

  beforeEach(() => {
    tasksRepository = {
      create: jest.fn(),
      findByIdActive: jest.fn(),
      updateById: jest.fn(),
      logActivity: jest.fn(),
      softDelete: jest.fn(),
      paginate: jest.fn(),
    };
    projectsService = {
      getActiveProjectOrThrow: jest.fn(),
      assertUserCanManage: jest.fn(),
      isProjectMember: jest.fn(),
      getAccessibleProjectIds: jest.fn(),
    };
    cacheService = { delByPattern: jest.fn().mockResolvedValue(0) };
    notificationsService = { notifyTaskAssigned: jest.fn().mockResolvedValue(undefined) };
    eventsGateway = { emitTaskStatusChanged: jest.fn() };
    service = new TasksService(
      tasksRepository as unknown as TasksRepository,
      projectsService as unknown as ProjectsService,
      cacheService as unknown as CacheService,
      notificationsService as unknown as NotificationsService,
      eventsGateway as unknown as EventsGateway,
    );
  });

  describe('create', () => {
    it('rejects creating a task in a Completed project', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ status: ProjectStatus.COMPLETED }),
      );

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
          makeUser({ id: ADMIN_ID }),
        ),
      ).rejects.toThrow(ConflictException);
      expect(tasksRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an assignee who is not a project member', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(
        service.create(
          { title: 'x', project: PROJECT_ID, priority: 'P2', assignee: OTHER_DEV_ID } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('notifies the assignee when a task is created with one, but not when created unassigned', async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', assignee: ASSIGNEE_ID } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER, email: 'manager@a.com' }),
      );
      expect(notificationsService.notifyTaskAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: ASSIGNEE_ID, actorEmail: 'manager@a.com' }),
      );

      notificationsService.notifyTaskAssigned.mockClear();
      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );
      expect(notificationsService.notifyTaskAssigned).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus - permission matrix', () => {
    it('allows a same-org Admin to change status regardless of assignment', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });

    it('allows the project-owning Manager to change status', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).resolves.toBeDefined();
    });

    it('denies a Manager who does not own the project', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows the assigned Developer to change status', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
        ),
      ).resolves.toBeDefined();
    });

    it('denies a Developer who is not the assignee', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: OTHER_DEV_ID, role: Role.DEVELOPER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies a Developer on an unassigned task', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ assignee: null }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('denies an Admin from a different organization', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ role: Role.ADMIN, organizationId: 'org-b' }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects an illegal transition (e.g. Todo -> Done)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.TODO }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await expect(
        service.updateStatus('task-1', TaskStatus.DONE, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('is a no-op returning the task unchanged when the status is already the target status', async () => {
      const task = makeTask({ status: TaskStatus.IN_PROGRESS });
      tasksRepository.findByIdActive.mockResolvedValue(task);
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      const result = await service.updateStatus(
        'task-1',
        TaskStatus.IN_PROGRESS,
        makeUser({ role: Role.ADMIN }),
      );
      expect(result).toBe(task);
      expect(tasksRepository.updateById).not.toHaveBeenCalled();
    });

    it('stamps completedAt when moving to Done, and clears it when moving off Done', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.REVIEW }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.DONE }));

      await service.updateStatus('task-1', TaskStatus.DONE, makeUser({ role: Role.ADMIN }));
      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: TaskStatus.DONE, completedAt: expect.any(Date) }),
      );

      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.DONE }));
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));
      await service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN }));
      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ status: TaskStatus.IN_PROGRESS, completedAt: null }),
      );
    });

    it('broadcasts a task:statusChanged event on a successful transition', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.TODO }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await service.updateStatus(
        'task-1',
        TaskStatus.IN_PROGRESS,
        makeUser({ id: ADMIN_ID, role: Role.ADMIN }),
      );

      expect(eventsGateway.emitTaskStatusChanged).toHaveBeenCalledWith({
        taskId: 'task-1',
        projectId: PROJECT_ID,
        fromStatus: TaskStatus.TODO,
        toStatus: TaskStatus.IN_PROGRESS,
        actorId: ADMIN_ID,
      });
    });

    it('does not let a broadcast failure stop the status update from succeeding', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: TaskStatus.TODO }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));
      eventsGateway.emitTaskStatusChanged.mockImplementation(() => {
        throw new Error('socket server unavailable');
      });

      await expect(
        service.updateStatus('task-1', TaskStatus.IN_PROGRESS, makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
    });
  });

  describe('updateAssignee', () => {
    it('notifies the new assignee when reassigned to someone new', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ assignee: { toString: () => ASSIGNEE_ID } }),
      );

      await service.updateAssignee('task-1', ASSIGNEE_ID, makeUser({ email: 'admin@a.com' }));

      expect(notificationsService.notifyTaskAssigned).toHaveBeenCalledWith(
        expect.objectContaining({ assigneeId: ASSIGNEE_ID, actorEmail: 'admin@a.com' }),
      );
    });

    it('does not notify when the assignee is unchanged (re-saving the same assignee)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(true);
      tasksRepository.updateById.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );

      await service.updateAssignee('task-1', DEV_ID, makeUser());

      expect(notificationsService.notifyTaskAssigned).not.toHaveBeenCalled();
    });

    it('does not notify when unassigning (assignee set to null)', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ assignee: { toString: () => DEV_ID } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      tasksRepository.updateById.mockResolvedValue(makeTask({ assignee: null }));

      await service.updateAssignee('task-1', null, makeUser());

      expect(notificationsService.notifyTaskAssigned).not.toHaveBeenCalled();
    });

    it('rejects reassigning to a non-project-member', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(service.updateAssignee('task-1', OTHER_DEV_ID, makeUser())).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('softDelete', () => {
    it('deletes the task and logs a DELETED activity entry', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());

      await service.softDelete('task-1', makeUser());

      expect(tasksRepository.softDelete).toHaveBeenCalledWith('task-1');
      expect(tasksRepository.logActivity).toHaveBeenCalledWith(
        'task-1',
        ADMIN_ID,
        TaskActivityAction.DELETED,
      );
    });

    it('delegates the manage-permission check to ProjectsService and propagates its rejection', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.assertUserCanManage.mockImplementation(() => {
        throw new ForbiddenException('You do not have permission to manage this project');
      });

      await expect(service.softDelete('task-1', makeUser())).rejects.toThrow(ForbiddenException);
      expect(tasksRepository.softDelete).not.toHaveBeenCalled();
    });
  });
});
