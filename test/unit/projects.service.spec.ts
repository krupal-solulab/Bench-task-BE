import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Model } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { ProjectsRepository } from 'src/modules/projects/projects.repository';
import { ProjectActivityAction } from 'src/modules/projects/schemas/project-activity.schema';
import { DEFAULT_WORKFLOW } from 'src/modules/projects/schemas/workflow.schema';
import { CustomFieldType } from 'src/modules/projects/schemas/custom-field.schema';
import {
  AutomationActionType,
  AutomationConditionField,
  AutomationTriggerType,
} from 'src/modules/projects/schemas/automation-rule.schema';
import { UsersRepository } from 'src/modules/users/users.repository';
import { PermissionSchemesService } from 'src/permission-schemes/permission-schemes.service';
import { CacheService } from 'src/redis/cache.service';
import { TaskDocument } from 'src/modules/tasks/schemas/task.schema';
import { CommentDocument } from 'src/modules/comments/schemas/comment.schema';
import { SprintDocument } from 'src/modules/sprints/schemas/sprint.schema';

// Wrapped in `new Types.ObjectId(...)` by ProjectsService.create(), so this must be valid hex.
const ORG_A = '507f1f77bcf86cd799439099';
const PROJECT_ID = '507f1f77bcf86cd799439010';
const ADMIN_ID = '507f1f77bcf86cd799439011';
const MANAGER_ID = '507f1f77bcf86cd799439012';
const DEV_ID = '507f1f77bcf86cd799439013';
const OTHER_DEV_ID = '507f1f77bcf86cd799439014';

function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROJECT_ID,
    _id: PROJECT_ID,
    name: 'Project A',
    organizationId: { toString: () => ORG_A },
    owner: { toString: () => MANAGER_ID },
    members: [],
    status: ProjectStatus.IN_PROGRESS,
    startDate: new Date('2026-01-01'),
    dueDate: null,
    components: [],
    customFields: [],
    automationRules: [],
    permissionSchemeId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: ADMIN_ID, email: 'a@a.com', role: Role.ADMIN, organizationId: ORG_A, ...overrides };
}

const NO_PERMS = {
  canCreateTask: false,
  canEditAnyTask: false,
  canDeleteTask: false,
  canChangeAnyTaskStatus: false,
  canManageSprints: false,
};

function makeMember(userId: string, permissions: Partial<Record<string, boolean>> | null = null) {
  return {
    user: { toString: () => userId },
    joinedAt: new Date('2026-01-01'),
    permissions: permissions ? { ...NO_PERMS, ...permissions } : null,
  };
}

describe('ProjectsService', () => {
  let projectsRepository: jest.Mocked<
    Pick<
      ProjectsRepository,
      | 'create'
      | 'findByIdActive'
      | 'updateById'
      | 'addMembers'
      | 'removeMember'
      | 'isMember'
      | 'logActivity'
      | 'softDelete'
      | 'keyExistsInOrg'
      | 'incrementIssueSeq'
      | 'setMemberPermissions'
    >
  >;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById' | 'findByIds'>>;
  let cacheService: jest.Mocked<Pick<CacheService, 'delByPattern'>>;
  let permissionSchemesService: jest.Mocked<Pick<PermissionSchemesService, 'findByIdOrNull'>>;
  let taskModel: {
    countDocuments: jest.Mock;
    find: jest.Mock;
    updateMany: jest.Mock;
    aggregate: jest.Mock;
    distinct: jest.Mock;
  };
  let commentModel: { updateMany: jest.Mock };
  let sprintModel: { updateMany: jest.Mock };
  let service: ProjectsService;

  beforeEach(() => {
    projectsRepository = {
      create: jest.fn(),
      findByIdActive: jest.fn(),
      updateById: jest.fn(),
      addMembers: jest.fn(),
      removeMember: jest.fn(),
      isMember: jest.fn(),
      logActivity: jest.fn(),
      softDelete: jest.fn(),
      keyExistsInOrg: jest.fn().mockResolvedValue(false),
      incrementIssueSeq: jest.fn(),
      setMemberPermissions: jest.fn().mockResolvedValue(undefined),
    };
    usersRepository = { findById: jest.fn(), findByIds: jest.fn() };
    cacheService = { delByPattern: jest.fn().mockResolvedValue(0) };
    permissionSchemesService = { findByIdOrNull: jest.fn().mockResolvedValue(null) };
    taskModel = {
      countDocuments: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
      aggregate: jest.fn(),
      distinct: jest.fn().mockResolvedValue([]),
    };
    commentModel = {
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };
    sprintModel = {
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };

    service = new ProjectsService(
      projectsRepository as unknown as ProjectsRepository,
      usersRepository as unknown as UsersRepository,
      cacheService as unknown as CacheService,
      permissionSchemesService as unknown as PermissionSchemesService,
      taskModel as unknown as Model<TaskDocument>,
      commentModel as unknown as Model<CommentDocument>,
      sprintModel as unknown as Model<SprintDocument>,
    );
  });

  describe('assertUserCanView / assertUserCanManage / isProjectMember', () => {
    it('allows a same-org Admin to view and manage regardless of membership', () => {
      const project = makeProject();
      expect(() =>
        service.assertUserCanView(project, makeUser({ role: Role.ADMIN })),
      ).not.toThrow();
      expect(() =>
        service.assertUserCanManage(project, makeUser({ role: Role.ADMIN })),
      ).not.toThrow();
    });

    it('denies an Admin from a different organization', () => {
      const project = makeProject();
      const crossOrgAdmin = makeUser({ role: Role.ADMIN, organizationId: 'org-b' });
      expect(() => service.assertUserCanView(project, crossOrgAdmin)).toThrow(ForbiddenException);
    });

    it('allows the owning Manager to manage, but not a non-owning Manager', () => {
      const project = makeProject();
      expect(() =>
        service.assertUserCanManage(project, makeUser({ id: MANAGER_ID, role: Role.MANAGER })),
      ).not.toThrow();
      expect(() =>
        service.assertUserCanManage(project, makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER })),
      ).toThrow(ForbiddenException);
    });

    it('allows a member Developer to view but not manage', () => {
      projectsRepository.isMember.mockReturnValue(true);
      const project = makeProject();
      expect(() =>
        service.assertUserCanView(project, makeUser({ id: DEV_ID, role: Role.DEVELOPER })),
      ).not.toThrow();
      expect(() =>
        service.assertUserCanManage(project, makeUser({ id: DEV_ID, role: Role.DEVELOPER })),
      ).toThrow(ForbiddenException);
    });

    it('denies a non-member Developer from viewing', () => {
      projectsRepository.isMember.mockReturnValue(false);
      const project = makeProject();
      expect(() =>
        service.assertUserCanView(project, makeUser({ id: DEV_ID, role: Role.DEVELOPER })),
      ).toThrow(ForbiddenException);
    });
  });

  describe('create', () => {
    it('rejects a dueDate before the startDate', async () => {
      await expect(
        service.create(
          { name: 'x', startDate: '2026-06-01', dueDate: '2026-05-01' } as never,
          makeUser({ role: Role.MANAGER }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(projectsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an invalid owner override (not an Admin/Manager in the same org)', async () => {
      usersRepository.findById.mockResolvedValue({
        id: OTHER_DEV_ID,
        role: Role.DEVELOPER,
        organizationId: { toString: () => ORG_A },
      } as never);

      await expect(
        service.create({ name: 'x', owner: OTHER_DEV_ID } as never, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('lets an Admin assign a valid Manager as the project owner', async () => {
      usersRepository.findById.mockResolvedValue({
        id: MANAGER_ID,
        role: Role.MANAGER,
        organizationId: { toString: () => ORG_A },
      } as never);
      projectsRepository.create.mockResolvedValue(makeProject());
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());

      await service.create(
        { name: 'x', owner: MANAGER_ID } as never,
        makeUser({ role: Role.ADMIN }),
      );

      expect(projectsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ owner: expect.anything() }),
      );
    });

    it('rejects members who are not active Developers', async () => {
      usersRepository.findByIds.mockResolvedValue([
        { id: DEV_ID, role: Role.MANAGER, isActive: true } as never,
      ]);

      await expect(
        service.create(
          { name: 'x', memberIds: [DEV_ID] } as never,
          makeUser({ role: Role.MANAGER, id: MANAGER_ID }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an explicit key already used by another project in the org', async () => {
      projectsRepository.keyExistsInOrg.mockResolvedValue(true);

      await expect(
        service.create(
          { name: 'x', key: 'SUP' } as never,
          makeUser({ role: Role.MANAGER, id: MANAGER_ID }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(projectsRepository.create).not.toHaveBeenCalled();
    });

    it('accepts an available explicit key', async () => {
      projectsRepository.keyExistsInOrg.mockResolvedValue(false);
      projectsRepository.create.mockResolvedValue(makeProject({ key: 'SUP' }));
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ key: 'SUP' }));

      await service.create(
        { name: 'x', key: 'SUP' } as never,
        makeUser({ role: Role.MANAGER, id: MANAGER_ID }),
      );

      expect(projectsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'SUP' }),
      );
    });
  });

  describe('update', () => {
    it('rejects a dueDate before the (possibly-existing) startDate', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ startDate: new Date('2026-06-01') }),
      );

      await expect(
        service.update(
          'project-1',
          { dueDate: '2026-01-01' } as never,
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects changing a key that is already set (immutable once assigned)', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ key: 'OLD' }));

      await expect(
        service.update('project-1', { key: 'NEW' } as never, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('allows setting a key for the first time via update', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ key: null }));
      projectsRepository.keyExistsInOrg.mockResolvedValue(false);
      projectsRepository.updateById.mockResolvedValue(makeProject({ key: 'SUP' }));

      await service.update('project-1', { key: 'SUP' } as never, makeUser({ role: Role.ADMIN }));

      expect(projectsRepository.updateById).toHaveBeenCalledWith(
        'project-1',
        expect.objectContaining({ key: 'SUP' }),
      );
    });
  });

  describe('getOrAssignKey', () => {
    it('returns the existing key without touching the repository', async () => {
      const key = await service.getOrAssignKey(makeProject({ key: 'SUP' }));

      expect(key).toBe('SUP');
      expect(projectsRepository.updateById).not.toHaveBeenCalled();
    });

    it('derives a key from the project name when none is set', async () => {
      projectsRepository.keyExistsInOrg.mockResolvedValue(false);
      projectsRepository.updateById.mockResolvedValue(makeProject());

      const key = await service.getOrAssignKey(makeProject({ key: null, name: 'Support Desk' }));

      expect(key).toBe('SUPP');
      expect(projectsRepository.updateById).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ key: 'SUPP' }),
      );
    });

    it('falls back to "PRJ" when the name has no letters', async () => {
      projectsRepository.keyExistsInOrg.mockResolvedValue(false);
      projectsRepository.updateById.mockResolvedValue(makeProject());

      const key = await service.getOrAssignKey(makeProject({ key: null, name: '2026' }));

      expect(key).toBe('PRJ');
    });

    it('dedupes against an existing key in the org by appending a number', async () => {
      projectsRepository.keyExistsInOrg
        .mockResolvedValueOnce(true) // "SUPP" taken
        .mockResolvedValueOnce(false); // "SUPP2" free

      const key = await service.getOrAssignKey(makeProject({ key: null, name: 'Support Desk' }));

      expect(key).toBe('SUPP2');
    });
  });

  describe('updateStatus', () => {
    it('is a no-op when already at the target status', async () => {
      const project = makeProject({ status: ProjectStatus.IN_PROGRESS });
      projectsRepository.findByIdActive.mockResolvedValue(project);

      const result = await service.updateStatus(
        'project-1',
        ProjectStatus.IN_PROGRESS,
        makeUser({ role: Role.ADMIN }),
      );
      expect(result.id).toBe(PROJECT_ID);
      expect(projectsRepository.updateById).not.toHaveBeenCalled();
    });

    it('rejects an illegal transition (Planning -> Completed)', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ status: ProjectStatus.PLANNING }),
      );

      await expect(
        service.updateStatus('project-1', ProjectStatus.COMPLETED, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks completing a project with open (non-Done) tasks', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ status: ProjectStatus.IN_PROGRESS }),
      );
      taskModel.countDocuments.mockResolvedValue(2);

      await expect(
        service.updateStatus('project-1', ProjectStatus.COMPLETED, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
      expect(projectsRepository.updateById).not.toHaveBeenCalled();
    });

    it('allows completing a project once every task is Done, and logs the transition', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ status: ProjectStatus.IN_PROGRESS }),
      );
      taskModel.countDocuments.mockResolvedValue(0);
      projectsRepository.updateById.mockResolvedValue(
        makeProject({ status: ProjectStatus.COMPLETED }),
      );

      await service.updateStatus(
        'project-1',
        ProjectStatus.COMPLETED,
        makeUser({ role: Role.ADMIN }),
      );

      expect(projectsRepository.logActivity).toHaveBeenCalledWith(
        'project-1',
        ADMIN_ID,
        ProjectActivityAction.STATUS_CHANGED,
        ProjectStatus.IN_PROGRESS,
        ProjectStatus.COMPLETED,
      );
    });
  });

  describe('addMembers', () => {
    it('logs one MEMBER_ADDED activity per genuinely-new member', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      usersRepository.findByIds.mockResolvedValue([
        { id: DEV_ID, role: Role.DEVELOPER, isActive: true } as never,
      ]);
      projectsRepository.addMembers.mockResolvedValue([DEV_ID]);

      await service.addMembers('project-1', [DEV_ID], makeUser({ role: Role.ADMIN }));

      expect(projectsRepository.logActivity).toHaveBeenCalledWith(
        'project-1',
        ADMIN_ID,
        ProjectActivityAction.MEMBER_ADDED,
        null,
        DEV_ID,
      );
    });

    it('logs no activity when every requested member is already a member (idempotent)', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      usersRepository.findByIds.mockResolvedValue([
        { id: DEV_ID, role: Role.DEVELOPER, isActive: true } as never,
      ]);
      projectsRepository.addMembers.mockResolvedValue([]);

      await service.addMembers('project-1', [DEV_ID], makeUser({ role: Role.ADMIN }));

      expect(projectsRepository.logActivity).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('blocks removal when the member has open tasks and no reassignTo is given', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      taskModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ _id: 'task-1' }]),
      });

      await expect(
        service.removeMember('project-1', DEV_ID, undefined, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
      expect(projectsRepository.removeMember).not.toHaveBeenCalled();
    });

    it('rejects a reassignTo target who is not the owner or a member', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      projectsRepository.isMember.mockReturnValue(false);
      taskModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ _id: 'task-1' }]),
      });

      await expect(
        service.removeMember('project-1', DEV_ID, OTHER_DEV_ID, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('reassigns open tasks and removes the member when reassignTo is valid', async () => {
      const project = makeProject();
      projectsRepository.findByIdActive.mockResolvedValue(project);
      projectsRepository.isMember.mockReturnValue(true);
      taskModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ _id: 'task-1' }]),
      });

      await service.removeMember('project-1', DEV_ID, OTHER_DEV_ID, makeUser({ role: Role.ADMIN }));

      expect(taskModel.updateMany).toHaveBeenCalled();
      expect(projectsRepository.removeMember).toHaveBeenCalledWith('project-1', DEV_ID);
      expect(projectsRepository.logActivity).toHaveBeenCalledWith(
        'project-1',
        ADMIN_ID,
        ProjectActivityAction.MEMBER_REMOVED,
        DEV_ID,
        null,
      );
    });

    it('removes a member with no open tasks without requiring reassignTo', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      taskModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.removeMember('project-1', DEV_ID, undefined, makeUser({ role: Role.ADMIN }));

      expect(projectsRepository.removeMember).toHaveBeenCalledWith('project-1', DEV_ID);
    });
  });

  describe('softDelete', () => {
    it("cascades soft-deletion to the project's tasks and their comments", async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      taskModel.find.mockReturnValue({
        exec: jest.fn().mockResolvedValue([{ _id: 'task-1' }, { _id: 'task-2' }]),
      });

      await service.softDelete('project-1', makeUser({ role: Role.ADMIN }));

      expect(taskModel.updateMany).toHaveBeenCalledWith(
        { _id: { $in: ['task-1', 'task-2'] } },
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      );
      expect(commentModel.updateMany).toHaveBeenCalledWith(
        { task: { $in: ['task-1', 'task-2'] } },
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      );
    });

    it('skips the cascade entirely when the project has no tasks', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      taskModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });

      await service.softDelete('project-1', makeUser({ role: Role.ADMIN }));

      expect(taskModel.updateMany).not.toHaveBeenCalled();
      expect(commentModel.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getWorkflow', () => {
    it('returns the system default when the project has no custom workflow', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ workflow: null }));

      const workflow = await service.getWorkflow('project-1', makeUser({ role: Role.ADMIN }));

      expect(workflow).toEqual(DEFAULT_WORKFLOW);
    });

    it("returns the project's own custom workflow when set", async () => {
      const custom = {
        statuses: [{ name: 'Backlog', category: StatusCategory.TODO }],
        transitions: [],
        initialStatus: 'Backlog',
      };
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ workflow: custom }));

      const workflow = await service.getWorkflow('project-1', makeUser({ role: Role.ADMIN }));

      expect(workflow).toEqual(custom);
    });
  });

  describe('updateWorkflow', () => {
    const validDto = {
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

    it('rejects a non-owning, non-Admin caller', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateWorkflow(
          'project-1',
          validDto,
          makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate status names', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      const dto = {
        ...validDto,
        statuses: [...validDto.statuses, { name: 'Backlog', category: StatusCategory.TODO }],
      };
      await expect(
        service.updateWorkflow('project-1', dto, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an initialStatus that is not one of the statuses', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      const dto = { ...validDto, initialStatus: 'Nonexistent' };
      await expect(
        service.updateWorkflow('project-1', dto, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a transition that references an unknown status', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      const dto = {
        ...validDto,
        transitions: [...validDto.transitions, { from: 'Building', to: 'Ghost' }],
      };
      await expect(
        service.updateWorkflow('project-1', dto, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dropping a status still held by an active task', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      taskModel.distinct.mockResolvedValue(['Todo']);

      await expect(
        service.updateWorkflow('project-1', validDto, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
      expect(projectsRepository.updateById).not.toHaveBeenCalled();
    });

    it('saves a valid workflow and returns it', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      taskModel.distinct.mockResolvedValue([]);
      projectsRepository.updateById.mockResolvedValue(makeProject({ workflow: validDto }));

      const result = await service.updateWorkflow(
        'project-1',
        validDto,
        makeUser({ role: Role.ADMIN }),
      );

      expect(result).toEqual(validDto);
      expect(projectsRepository.updateById).toHaveBeenCalledWith('project-1', {
        workflow: validDto,
      });
    });
  });

  describe('resetWorkflow', () => {
    it('is a no-op returning the default when the project already has no custom workflow', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ workflow: null }));

      const result = await service.resetWorkflow('project-1', makeUser({ role: Role.ADMIN }));

      expect(result).toEqual(DEFAULT_WORKFLOW);
      expect(projectsRepository.updateById).not.toHaveBeenCalled();
    });

    it('rejects when an active task holds a status the default workflow does not have', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({
          workflow: {
            statuses: [{ name: 'Backlog', category: StatusCategory.TODO }],
            transitions: [],
            initialStatus: 'Backlog',
          },
        }),
      );
      taskModel.distinct.mockResolvedValue(['Backlog']);

      await expect(
        service.resetWorkflow('project-1', makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
    });

    it('clears the custom workflow when every active task already matches a default status', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({
          workflow: {
            statuses: [{ name: 'Todo', category: StatusCategory.TODO }],
            transitions: [],
            initialStatus: 'Todo',
          },
        }),
      );
      taskModel.distinct.mockResolvedValue([]);
      projectsRepository.updateById.mockResolvedValue(makeProject({ workflow: null }));

      const result = await service.resetWorkflow('project-1', makeUser({ role: Role.ADMIN }));

      expect(result).toEqual(DEFAULT_WORKFLOW);
      expect(projectsRepository.updateById).toHaveBeenCalledWith('project-1', { workflow: null });
    });
  });

  describe('assertUserCanManageOrGranted / memberHasCapability', () => {
    it('passes for a same-org Admin regardless of grants', async () => {
      const project = makeProject({ members: [] });
      await expect(
        service.assertUserCanManageOrGranted(
          project,
          makeUser({ role: Role.ADMIN }),
          'canDeleteTask',
        ),
      ).resolves.toBeUndefined();
    });

    it('passes for the owning Manager regardless of grants', async () => {
      const project = makeProject({ members: [] });
      await expect(
        service.assertUserCanManageOrGranted(
          project,
          makeUser({ id: MANAGER_ID, role: Role.MANAGER }),
          'canDeleteTask',
        ),
      ).resolves.toBeUndefined();
    });

    it('passes for a non-owning member who holds the matching grant', async () => {
      const project = makeProject({ members: [makeMember(DEV_ID, { canCreateTask: true })] });
      await expect(
        service.assertUserCanManageOrGranted(
          project,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
          'canCreateTask',
        ),
      ).resolves.toBeUndefined();
    });

    it('rejects a non-owning member who holds a DIFFERENT grant than the one being checked', async () => {
      const project = makeProject({ members: [makeMember(DEV_ID, { canCreateTask: true })] });
      await expect(
        service.assertUserCanManageOrGranted(
          project,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
          'canDeleteTask',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a non-member regardless of any stray permissions data', async () => {
      const project = makeProject({ members: [makeMember(DEV_ID, { canCreateTask: true })] });
      await expect(
        service.assertUserCanManageOrGranted(
          project,
          makeUser({ id: OTHER_DEV_ID, role: Role.DEVELOPER }),
          'canCreateTask',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('memberHasCapability returns false for a member with no permissions set', () => {
      const project = makeProject({ members: [makeMember(DEV_ID, null)] });
      expect(service.memberHasCapability(project, DEV_ID, 'canCreateTask')).toBe(false);
    });

    it('a scheme grant lets a Developer with no member flag pass, when the project has a scheme assigned', async () => {
      const project = makeProject({
        members: [],
        permissionSchemeId: { toString: () => 'scheme-1' },
      });
      permissionSchemesService.findByIdOrNull.mockResolvedValue({
        grants: [{ action: 'CreateIssue', allowedRoles: [Role.DEVELOPER], allowedUserIds: [] }],
      } as never);
      await expect(
        service.assertUserCanManageOrGranted(
          project,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
          'canCreateTask',
        ),
      ).resolves.toBeUndefined();
    });

    it('a project with no scheme assigned is unaffected by this feature (regression)', async () => {
      const project = makeProject({ members: [], permissionSchemeId: null });
      await expect(
        service.assertUserCanManageOrGranted(
          project,
          makeUser({ id: DEV_ID, role: Role.DEVELOPER }),
          'canCreateTask',
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(permissionSchemesService.findByIdOrNull).not.toHaveBeenCalled();
    });
  });

  describe('setMemberPermissions', () => {
    it('rejects a non-owning, non-Admin caller', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ members: [makeMember(DEV_ID)] }),
      );
      await expect(
        service.setMemberPermissions(
          'project-1',
          DEV_ID,
          { canCreateTask: true },
          makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects targeting the project owner', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ members: [makeMember(DEV_ID)] }),
      );
      await expect(
        service.setMemberPermissions(
          'project-1',
          MANAGER_ID,
          { canCreateTask: true },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects targeting a non-member', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ members: [] }));
      await expect(
        service.setMemberPermissions(
          'project-1',
          DEV_ID,
          { canCreateTask: true },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it("merges a partial patch onto the member's existing permissions rather than replacing wholesale", async () => {
      projectsRepository.findByIdActive
        .mockResolvedValueOnce(
          makeProject({ members: [makeMember(DEV_ID, { canCreateTask: true })] }),
        )
        .mockResolvedValueOnce(makeProject({ members: [makeMember(DEV_ID)] }));

      await service.setMemberPermissions(
        'project-1',
        DEV_ID,
        { canManageSprints: true },
        makeUser({ role: Role.ADMIN }),
      );

      expect(projectsRepository.setMemberPermissions).toHaveBeenCalledWith('project-1', DEV_ID, {
        canCreateTask: true,
        canEditAnyTask: false,
        canDeleteTask: false,
        canChangeAnyTaskStatus: false,
        canManageSprints: true,
      });
    });

    it('a same-org Admin can grant on a project they do not own', async () => {
      projectsRepository.findByIdActive
        .mockResolvedValueOnce(makeProject({ members: [makeMember(DEV_ID)] }))
        .mockResolvedValueOnce(makeProject({ members: [makeMember(DEV_ID)] }));

      await expect(
        service.setMemberPermissions(
          'project-1',
          DEV_ID,
          { canCreateTask: true },
          makeUser({ role: Role.ADMIN }),
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('listLabels', () => {
    it('returns the distinct labels already in use on the project (view access only)', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      taskModel.distinct.mockResolvedValue(['bug', 'urgent']);

      const labels = await service.listLabels('project-1', makeUser({ role: Role.ADMIN }));

      expect(labels).toEqual(['bug', 'urgent']);
    });

    it('denies a non-member Developer', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      projectsRepository.isMember.mockReturnValue(false);

      await expect(
        service.listLabels('project-1', makeUser({ id: DEV_ID, role: Role.DEVELOPER })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('updateComponents', () => {
    it('rejects a non-owning, non-Admin caller', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateComponents(
          'project-1',
          { names: ['Frontend'] },
          makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects duplicate names', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateComponents(
          'project-1',
          { names: ['Frontend', 'Frontend'] },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects removing a component still used by an active task', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ components: ['Frontend', 'API'] }),
      );
      taskModel.distinct.mockResolvedValue(['API']);

      await expect(
        service.updateComponents(
          'project-1',
          { names: ['Frontend'] },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(ConflictException);
      expect(projectsRepository.updateById).not.toHaveBeenCalled();
    });

    it('saves a valid component list', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ components: [] }));
      taskModel.distinct.mockResolvedValue([]);
      projectsRepository.updateById.mockResolvedValue(
        makeProject({ components: ['Frontend', 'API'] }),
      );

      await service.updateComponents(
        'project-1',
        { names: ['Frontend', 'API'] },
        makeUser({ role: Role.ADMIN }),
      );

      expect(projectsRepository.updateById).toHaveBeenCalledWith('project-1', {
        components: ['Frontend', 'API'],
      });
    });
  });

  describe('updateCustomFields', () => {
    it('rejects a non-owning, non-Admin caller', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateCustomFields(
          'project-1',
          { fields: [{ name: 'Severity', type: CustomFieldType.TEXT, required: false }] },
          makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('assigns a fresh id to a new field definition', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ customFields: [] }));
      taskModel.countDocuments.mockResolvedValue(0);
      projectsRepository.updateById.mockResolvedValue(makeProject());

      await service.updateCustomFields(
        'project-1',
        { fields: [{ name: 'Severity', type: CustomFieldType.TEXT, required: false }] },
        makeUser({ role: Role.ADMIN }),
      );

      const [, patch] = projectsRepository.updateById.mock.calls[0]!;
      expect(patch.customFields).toHaveLength(1);
      expect(patch.customFields![0]).toMatchObject({
        name: 'Severity',
        type: CustomFieldType.TEXT,
      });
      expect(patch.customFields![0]!.id).toEqual(expect.any(String));
    });

    it("rejects changing an existing field's type", async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({
          customFields: [
            {
              id: 'f-1',
              name: 'Severity',
              type: CustomFieldType.TEXT,
              required: false,
              options: null,
            },
          ],
        }),
      );

      await expect(
        service.updateCustomFields(
          'project-1',
          {
            fields: [
              { id: 'f-1', name: 'Severity', type: CustomFieldType.NUMBER, required: false },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an id that does not exist on the project', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ customFields: [] }));

      await expect(
        service.updateCustomFields(
          'project-1',
          {
            fields: [
              {
                id: 'does-not-exist',
                name: 'Severity',
                type: CustomFieldType.TEXT,
                required: false,
              },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate field names', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ customFields: [] }));

      await expect(
        service.updateCustomFields(
          'project-1',
          {
            fields: [
              { name: 'Severity', type: CustomFieldType.TEXT, required: false },
              { name: 'Severity', type: CustomFieldType.NUMBER, required: false },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects removing a field still holding a value on an active task', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({
          customFields: [
            {
              id: 'f-1',
              name: 'Severity',
              type: CustomFieldType.TEXT,
              required: false,
              options: null,
            },
          ],
        }),
      );
      taskModel.countDocuments.mockResolvedValue(1);

      await expect(
        service.updateCustomFields('project-1', { fields: [] }, makeUser({ role: Role.ADMIN })),
      ).rejects.toThrow(ConflictException);
      expect(projectsRepository.updateById).not.toHaveBeenCalled();
    });

    it('allows removing a field nobody has a value for', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({
          customFields: [
            {
              id: 'f-1',
              name: 'Severity',
              type: CustomFieldType.TEXT,
              required: false,
              options: null,
            },
          ],
        }),
      );
      taskModel.countDocuments.mockResolvedValue(0);
      projectsRepository.updateById.mockResolvedValue(makeProject({ customFields: [] }));

      await expect(
        service.updateCustomFields('project-1', { fields: [] }, makeUser({ role: Role.ADMIN })),
      ).resolves.toBeDefined();
      expect(projectsRepository.updateById).toHaveBeenCalledWith('project-1', { customFields: [] });
    });

    it("preserves an existing field's id when only its name/required is edited", async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({
          customFields: [
            {
              id: 'f-1',
              name: 'Severity',
              type: CustomFieldType.TEXT,
              required: false,
              options: null,
            },
          ],
        }),
      );
      taskModel.countDocuments.mockResolvedValue(0);
      projectsRepository.updateById.mockResolvedValue(makeProject());

      await service.updateCustomFields(
        'project-1',
        {
          fields: [
            { id: 'f-1', name: 'Severity Level', type: CustomFieldType.TEXT, required: true },
          ],
        },
        makeUser({ role: Role.ADMIN }),
      );

      const [, patch] = projectsRepository.updateById.mock.calls[0]!;
      expect(patch.customFields![0]).toMatchObject({
        id: 'f-1',
        name: 'Severity Level',
        required: true,
      });
    });
  });

  describe('updateAutomationRules', () => {
    const VALID_RULE = {
      name: 'Auto-label bugs',
      enabled: true,
      trigger: { type: AutomationTriggerType.ISSUE_CREATED },
      conditions: [],
      actions: [{ type: AutomationActionType.ADD_LABELS, value: 'triage' }],
    };

    it('rejects a non-owning, non-Admin caller', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateAutomationRules(
          'project-1',
          { rules: [VALID_RULE] },
          makeUser({ id: OTHER_DEV_ID, role: Role.MANAGER }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a StatusChanged trigger with a status not in the workflow', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateAutomationRules(
          'project-1',
          {
            rules: [
              {
                ...VALID_RULE,
                trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Nope' },
              },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a StatusChanged trigger targeting a real workflow status', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      projectsRepository.updateById.mockResolvedValue(makeProject());

      await expect(
        service.updateAutomationRules(
          'project-1',
          {
            rules: [
              {
                ...VALID_RULE,
                trigger: { type: AutomationTriggerType.STATUS_CHANGED, toStatus: 'Done' },
              },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a condition referencing an unknown component', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ components: ['API'] }));
      await expect(
        service.updateAutomationRules(
          'project-1',
          {
            rules: [
              {
                ...VALID_RULE,
                conditions: [{ field: AutomationConditionField.COMPONENT, value: 'Frontend' }],
              },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a SetAssignee action targeting a non-member', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateAutomationRules(
          'project-1',
          {
            rules: [
              {
                ...VALID_RULE,
                actions: [{ type: AutomationActionType.SET_ASSIGNEE, value: 'not-a-member' }],
              },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a SetAssignee action targeting a real project member', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({ members: [makeMember(DEV_ID)] }),
      );
      projectsRepository.updateById.mockResolvedValue(makeProject());

      await expect(
        service.updateAutomationRules(
          'project-1',
          {
            rules: [
              {
                ...VALID_RULE,
                actions: [{ type: AutomationActionType.SET_ASSIGNEE, value: DEV_ID }],
              },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).resolves.toBeDefined();
    });

    it('rejects a SetStatus action targeting a status not in the workflow', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateAutomationRules(
          'project-1',
          {
            rules: [
              {
                ...VALID_RULE,
                actions: [{ type: AutomationActionType.SET_STATUS, value: 'Nope' }],
              },
            ],
          },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects duplicate rule names', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject());
      await expect(
        service.updateAutomationRules(
          'project-1',
          { rules: [VALID_RULE, VALID_RULE] },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an id that does not exist on the project', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ automationRules: [] }));
      await expect(
        service.updateAutomationRules(
          'project-1',
          { rules: [{ ...VALID_RULE, id: 'does-not-exist' }] },
          makeUser({ role: Role.ADMIN }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('assigns a fresh id to a new rule', async () => {
      projectsRepository.findByIdActive.mockResolvedValue(makeProject({ automationRules: [] }));
      projectsRepository.updateById.mockResolvedValue(makeProject());

      await service.updateAutomationRules(
        'project-1',
        { rules: [VALID_RULE] },
        makeUser({ role: Role.ADMIN }),
      );

      const [, patch] = projectsRepository.updateById.mock.calls[0]!;
      expect(patch.automationRules).toHaveLength(1);
      expect(patch.automationRules![0]!.id).toEqual(expect.any(String));
    });

    it("preserves an existing rule's id when only its name is edited", async () => {
      projectsRepository.findByIdActive.mockResolvedValue(
        makeProject({
          automationRules: [{ id: 'r-1', ...VALID_RULE }],
        }),
      );
      projectsRepository.updateById.mockResolvedValue(makeProject());

      await service.updateAutomationRules(
        'project-1',
        { rules: [{ ...VALID_RULE, id: 'r-1', name: 'Auto-label bugs v2' }] },
        makeUser({ role: Role.ADMIN }),
      );

      const [, patch] = projectsRepository.updateById.mock.calls[0]!;
      expect(patch.automationRules![0]).toMatchObject({ id: 'r-1', name: 'Auto-label bugs v2' });
    });
  });
});
