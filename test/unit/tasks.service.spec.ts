import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { TaskStatus } from 'src/common/enums/task-status.enum';
import { IssueType } from 'src/common/enums/issue-type.enum';
import { Workflow } from 'src/modules/projects/schemas/workflow.schema';
import { TaskActivityAction } from 'src/modules/tasks/schemas/task-activity.schema';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { TasksService } from 'src/modules/tasks/tasks.service';
import { TasksRepository } from 'src/modules/tasks/tasks.repository';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { SprintsService } from 'src/modules/sprints/sprints.service';
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
const STORY_ID = '507f1f77bcf86cd799439016';
const EPIC_ID = '507f1f77bcf86cd799439017';

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
    // Matches the real schema's default - every actual document defaults to this, so a fixture
    // that doesn't override it should behave the same way.
    issueType: IssueType.TASK,
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: ADMIN_ID, email: 'a@a.com', role: Role.ADMIN, organizationId: ORG_A, ...overrides };
}

const CUSTOM_WORKFLOW: Workflow = {
  statuses: [
    { name: 'Backlog', category: StatusCategory.TODO },
    { name: 'Building', category: StatusCategory.IN_PROGRESS },
    { name: 'Shipped', category: StatusCategory.DONE },
  ],
  transitions: [
    { from: 'Backlog', to: 'Building' },
    { from: 'Building', to: 'Shipped' },
  ],
  initialStatus: 'Backlog',
};

describe('TasksService', () => {
  let tasksRepository: jest.Mocked<
    Pick<
      TasksRepository,
      | 'create'
      | 'findByIdActive'
      | 'findRawById'
      | 'updateById'
      | 'logActivity'
      | 'softDelete'
      | 'paginate'
      | 'findMaxRank'
      | 'findRankInScope'
      | 'renumberScope'
      | 'countLinkedIssues'
    >
  >;
  let projectsService: jest.Mocked<
    Pick<
      ProjectsService,
      | 'getActiveProjectOrThrow'
      | 'assertUserCanManage'
      | 'assertUserCanManageOrGranted'
      | 'memberHasCapability'
      | 'isProjectMember'
      | 'getAccessibleProjectIds'
      | 'getOrAssignKey'
      | 'nextIssueNumber'
    >
  >;
  let sprintsService: jest.Mocked<Pick<SprintsService, 'getActiveOrThrow'>>;
  let cacheService: jest.Mocked<Pick<CacheService, 'delByPattern'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifyTaskAssigned'>>;
  let eventsGateway: jest.Mocked<Pick<EventsGateway, 'emitTaskStatusChanged'>>;
  let service: TasksService;

  beforeEach(() => {
    tasksRepository = {
      create: jest.fn(),
      findByIdActive: jest.fn(),
      findRawById: jest.fn(),
      updateById: jest.fn(),
      logActivity: jest.fn(),
      softDelete: jest.fn(),
      paginate: jest.fn(),
      findMaxRank: jest.fn().mockResolvedValue(null),
      findRankInScope: jest.fn(),
      renumberScope: jest.fn().mockResolvedValue(undefined),
      countLinkedIssues: jest.fn(),
    };
    projectsService = {
      getActiveProjectOrThrow: jest.fn(),
      assertUserCanManage: jest.fn(),
      assertUserCanManageOrGranted: jest.fn(),
      memberHasCapability: jest.fn().mockReturnValue(false),
      isProjectMember: jest.fn(),
      getAccessibleProjectIds: jest.fn(),
      getOrAssignKey: jest.fn().mockResolvedValue('PRJ'),
      nextIssueNumber: jest.fn().mockResolvedValue(1),
    };
    sprintsService = { getActiveOrThrow: jest.fn() };
    cacheService = { delByPattern: jest.fn().mockResolvedValue(0) };
    notificationsService = { notifyTaskAssigned: jest.fn().mockResolvedValue(undefined) };
    eventsGateway = { emitTaskStatusChanged: jest.fn() };
    service = new TasksService(
      tasksRepository as unknown as TasksRepository,
      projectsService as unknown as ProjectsService,
      sprintsService as unknown as SprintsService,
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

  describe('create - workflow-aware initial status', () => {
    it("uses the system default workflow's initial status/category when the project has no custom workflow (regression)", async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject({ workflow: null }));
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: TaskStatus.TODO, statusCategory: StatusCategory.TODO }),
      );
    });

    it("uses the project's custom workflow initial status/category when one is set", async () => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'Backlog', statusCategory: StatusCategory.TODO }),
      );
    });
  });

  describe('create - issue hierarchy validation', () => {
    beforeEach(() => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
    });

    it('rejects a Sub-task with no parent', async () => {
      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.SUBTASK,
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a Sub-task whose parent isn't a Story/Task/Bug", async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: 'epic-1', issueType: IssueType.EPIC }),
      );

      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.SUBTASK,
            parent: 'epic-1',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a Sub-task whose parent is a Story/Task/Bug in the same project', async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: STORY_ID, issueType: IssueType.STORY }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'sub-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'sub-1' }));

      await service.create(
        {
          title: 'x',
          project: PROJECT_ID,
          priority: 'P2',
          issueType: IssueType.SUBTASK,
          parent: STORY_ID,
        } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ issueType: IssueType.SUBTASK }),
      );
    });

    it('rejects an Epic given a parent', async () => {
      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.EPIC,
            parent: 'anything',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a Story/Task/Bug whose parent isn't an Epic", async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: 'story-1', issueType: IssueType.STORY }),
      );

      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.TASK,
            parent: 'story-1',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a Story/Task/Bug epic-linked to an Epic in the same project', async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({ id: EPIC_ID, issueType: IssueType.EPIC }),
      );
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'story-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'story-1' }));

      await service.create(
        {
          title: 'x',
          project: PROJECT_ID,
          priority: 'P2',
          issueType: IssueType.STORY,
          parent: EPIC_ID,
        } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ issueType: IssueType.STORY }),
      );
    });

    it('rejects a parent that belongs to a different project', async () => {
      tasksRepository.findRawById.mockResolvedValue(
        makeTask({
          id: 'story-1',
          issueType: IssueType.STORY,
          project: { toString: () => 'a-different-project' },
        }),
      );

      await expect(
        service.create(
          {
            title: 'x',
            project: PROJECT_ID,
            priority: 'P2',
            issueType: IssueType.SUBTASK,
            parent: 'story-1',
          } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns a sequential issueKey using the project key prefix', async () => {
      projectsService.getOrAssignKey.mockResolvedValue('SUP');
      projectsService.nextIssueNumber.mockResolvedValue(42);
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-42' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-42' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: 'SUP-42' }),
      );
    });

    it('skips the backlog-rank lookup for Epic/Sub-task issues (they never appear in the backlog)', async () => {
      tasksRepository.create.mockResolvedValue(
        makeTask({ id: 'epic-1', issueType: IssueType.EPIC }),
      );
      tasksRepository.findByIdActive.mockResolvedValue(
        makeTask({ id: 'epic-1', issueType: IssueType.EPIC }),
      );

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2', issueType: IssueType.EPIC } as never,
        makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
      );

      expect(tasksRepository.findMaxRank).not.toHaveBeenCalled();
      expect(tasksRepository.create).toHaveBeenCalledWith(expect.objectContaining({ rank: 0 }));
    });
  });

  describe('updateSprint - hierarchy guard', () => {
    beforeEach(() => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
    });

    it('rejects assigning an Epic to a sprint', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ issueType: IssueType.EPIC }));

      await expect(
        service.updateSprint(
          'task-1',
          { sprintId: 'sprint-1' } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects assigning a Sub-task to a sprint', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ issueType: IssueType.SUBTASK }));

      await expect(
        service.updateSprint(
          'task-1',
          { sprintId: 'sprint-1' } as never,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('permission-grant delegation (Phase 3: per-project member grants)', () => {
    beforeEach(() => {
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
    });

    it('create() checks canCreateTask', async () => {
      tasksRepository.create.mockResolvedValue(makeTask({ id: 'task-1' }));
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ id: 'task-1' }));

      await service.create(
        { title: 'x', project: PROJECT_ID, priority: 'P2' } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canCreateTask',
      );
    });

    it('update() checks canEditAnyTask', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      tasksRepository.updateById.mockResolvedValue(makeTask({ title: 'Updated' }));

      await service.update(
        'task-1',
        { title: 'Updated' } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canEditAnyTask',
      );
    });

    it('softDelete() checks canDeleteTask', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());

      await service.softDelete('task-1', makeUser({ id: DEV_ID, role: Role.DEVELOPER }));

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canDeleteTask',
      );
    });

    it('updateSprint() checks canManageSprints', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());

      await service.updateSprint(
        'task-1',
        { sprintId: null } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canManageSprints',
      );
    });

    it('updateRank() checks canManageSprints', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask());
      tasksRepository.findRankInScope.mockResolvedValue(100);
      tasksRepository.updateById.mockResolvedValue(makeTask());

      await service.updateRank(
        'task-1',
        { beforeTaskId: 'other-task' } as never,
        makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
      );

      expect(projectsService.assertUserCanManageOrGranted).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'canManageSprints',
      );
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

    it('allows a non-assigned Developer with a canChangeAnyTaskStatus grant', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ assignee: null }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(makeProject());
      projectsService.memberHasCapability.mockReturnValue(true);
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: TaskStatus.IN_PROGRESS }));

      await expect(
        service.updateStatus(
          'task-1',
          TaskStatus.IN_PROGRESS,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
        ),
      ).resolves.toBeDefined();
      expect(projectsService.memberHasCapability).toHaveBeenCalledWith(
        expect.anything(),
        DEV_ID,
        'canChangeAnyTaskStatus',
      );
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

  describe('updateStatus - custom workflow', () => {
    it("rejects a status name that isn't in the project's custom workflow", async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Backlog' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );

      await expect(
        service.updateStatus('task-1', 'Todo', makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a transition the custom workflow does not allow', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Backlog' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );

      await expect(
        service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('accepts a configured custom transition and stamps completedAt on reaching the Done category', async () => {
      tasksRepository.findByIdActive.mockResolvedValue(makeTask({ status: 'Building' }));
      projectsService.getActiveProjectOrThrow.mockResolvedValue(
        makeProject({ workflow: CUSTOM_WORKFLOW }),
      );
      tasksRepository.updateById.mockResolvedValue(makeTask({ status: 'Shipped' }));

      await service.updateStatus('task-1', 'Shipped', makeUser({ role: Role.ADMIN }));

      expect(tasksRepository.updateById).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          status: 'Shipped',
          statusCategory: StatusCategory.DONE,
          completedAt: expect.any(Date),
        }),
      );
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
      projectsService.assertUserCanManageOrGranted.mockImplementation(() => {
        throw new ForbiddenException('You do not have permission to manage this project');
      });

      await expect(service.softDelete('task-1', makeUser())).rejects.toThrow(ForbiddenException);
      expect(tasksRepository.softDelete).not.toHaveBeenCalled();
    });
  });
});
