import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Model } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { ProjectsRepository } from 'src/modules/projects/projects.repository';
import { ProjectActivityAction } from 'src/modules/projects/schemas/project-activity.schema';
import { UsersRepository } from 'src/modules/users/users.repository';
import { CacheService } from 'src/redis/cache.service';
import { TaskDocument } from 'src/modules/tasks/schemas/task.schema';
import { CommentDocument } from 'src/modules/comments/schemas/comment.schema';

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
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return { id: ADMIN_ID, email: 'a@a.com', role: Role.ADMIN, organizationId: ORG_A, ...overrides };
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
    >
  >;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById' | 'findByIds'>>;
  let cacheService: jest.Mocked<Pick<CacheService, 'delByPattern'>>;
  let taskModel: {
    countDocuments: jest.Mock;
    find: jest.Mock;
    updateMany: jest.Mock;
    aggregate: jest.Mock;
  };
  let commentModel: { updateMany: jest.Mock };
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
    };
    usersRepository = { findById: jest.fn(), findByIds: jest.fn() };
    cacheService = { delByPattern: jest.fn().mockResolvedValue(0) };
    taskModel = {
      countDocuments: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
      aggregate: jest.fn(),
    };
    commentModel = {
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
    };

    service = new ProjectsService(
      projectsRepository as unknown as ProjectsRepository,
      usersRepository as unknown as UsersRepository,
      cacheService as unknown as CacheService,
      taskModel as unknown as Model<TaskDocument>,
      commentModel as unknown as Model<CommentDocument>,
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
});
