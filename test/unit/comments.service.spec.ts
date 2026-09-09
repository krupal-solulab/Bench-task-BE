import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { CommentsService } from 'src/modules/comments/comments.service';
import { CommentsRepository } from 'src/modules/comments/comments.repository';
import { TasksRepository } from 'src/modules/tasks/tasks.repository';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { EventsGateway } from 'src/events/events.gateway';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
// CommentsService wraps both the taskId argument and actingUser.id in `new Types.ObjectId(...)`
// inside create() (unlike update()/softDelete(), which pass ids straight through to the
// repository), so those two need to be real 24-char hex strings, not arbitrary labels.
const TASK_ID = '507f1f77bcf86cd799439001';
const MEMBER_ID = '507f1f77bcf86cd799439002';
const STRANGER_ID = '507f1f77bcf86cd799439003';
const ADMIN_A_ID = '507f1f77bcf86cd799439004';
const ADMIN_B_ID = '507f1f77bcf86cd799439005';

function makeRawTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    project: { toString: () => 'project-1' },
    organizationId: { toString: () => ORG_A },
    ...overrides,
  } as never;
}

function makeComment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'comment-1',
    task: 'task-1',
    author: { toString: () => 'author-1' },
    body: 'original',
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'author-1',
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: ORG_A,
    ...overrides,
  };
}

describe('CommentsService', () => {
  let commentsRepository: jest.Mocked<
    Pick<
      CommentsRepository,
      'create' | 'findByIdActive' | 'paginateForTask' | 'updateById' | 'softDelete'
    >
  >;
  let tasksRepository: jest.Mocked<Pick<TasksRepository, 'findRawById'>>;
  let projectsService: jest.Mocked<
    Pick<ProjectsService, 'getActiveProjectOrThrow' | 'isProjectMember'>
  >;
  let eventsGateway: jest.Mocked<Pick<EventsGateway, 'emitCommentCreated'>>;
  let service: CommentsService;

  beforeEach(() => {
    commentsRepository = {
      create: jest.fn(),
      findByIdActive: jest.fn(),
      paginateForTask: jest.fn(),
      updateById: jest.fn(),
      softDelete: jest.fn(),
    };
    tasksRepository = { findRawById: jest.fn() };
    projectsService = { getActiveProjectOrThrow: jest.fn(), isProjectMember: jest.fn() };
    eventsGateway = { emitCommentCreated: jest.fn() };
    service = new CommentsService(
      commentsRepository as unknown as CommentsRepository,
      tasksRepository as unknown as TasksRepository,
      projectsService as unknown as ProjectsService,
      eventsGateway as unknown as EventsGateway,
    );
  });

  describe('create', () => {
    it('lets a project member comment on the task, and broadcasts the event to the right room', async () => {
      const member = makeUser({ id: MEMBER_ID });
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(true);
      commentsRepository.create.mockResolvedValue({ id: 'comment-1' } as never);
      commentsRepository.findByIdActive.mockResolvedValue(makeComment({ id: 'comment-1' }));

      const result = await service.create(TASK_ID, 'hello', member);

      expect(result.id).toBe('comment-1');
      expect(eventsGateway.emitCommentCreated).toHaveBeenCalledWith({
        taskId: TASK_ID,
        projectId: 'project-1',
        commentId: 'comment-1',
        authorId: MEMBER_ID,
      });
    });

    it('rejects a non-member from commenting', async () => {
      const nonMember = makeUser({ id: STRANGER_ID });
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(service.create(TASK_ID, 'hello', nonMember)).rejects.toThrow(ForbiddenException);
      expect(commentsRepository.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent task', async () => {
      tasksRepository.findRawById.mockResolvedValue(null);
      await expect(service.create(TASK_ID, 'hello', makeUser())).rejects.toThrow(NotFoundException);
    });

    it('lets a same-organization Admin comment without a membership check', async () => {
      const admin = makeUser({ id: ADMIN_A_ID, role: Role.ADMIN, organizationId: ORG_A });
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      commentsRepository.create.mockResolvedValue({ id: 'comment-1' } as never);
      commentsRepository.findByIdActive.mockResolvedValue(makeComment());

      await service.create(TASK_ID, 'hello', admin);

      expect(projectsService.getActiveProjectOrThrow).not.toHaveBeenCalled();
      expect(commentsRepository.create).toHaveBeenCalled();
    });

    it('SECURITY: rejects an Admin from a different organization, even for a valid task id', async () => {
      const crossOrgAdmin = makeUser({ id: ADMIN_B_ID, role: Role.ADMIN, organizationId: ORG_B });
      tasksRepository.findRawById.mockResolvedValue(
        makeRawTask({ organizationId: { toString: () => ORG_A } }),
      );
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(service.create(TASK_ID, 'hello', crossOrgAdmin)).rejects.toThrow(
        ForbiddenException,
      );
      expect(commentsRepository.create).not.toHaveBeenCalled();
    });

    it('does not let a broadcast failure stop the comment from being created', async () => {
      const member = makeUser({ id: MEMBER_ID });
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(true);
      commentsRepository.create.mockResolvedValue({ id: 'comment-1' } as never);
      commentsRepository.findByIdActive.mockResolvedValue(makeComment({ id: 'comment-1' }));
      eventsGateway.emitCommentCreated.mockImplementation(() => {
        throw new Error('socket server unavailable');
      });

      const result = await service.create(TASK_ID, 'hello', member);
      expect(result.id).toBe('comment-1');
    });
  });

  describe('paginateForTask', () => {
    it('rejects a non-member from listing comments', async () => {
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(
        service.paginateForTask(TASK_ID, 1, 20, 'desc', makeUser({ id: STRANGER_ID })),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update / softDelete (assertCanModify)', () => {
    it('lets the author edit their own comment', async () => {
      commentsRepository.findByIdActive.mockResolvedValue(makeComment());
      commentsRepository.updateById.mockResolvedValue(makeComment({ body: 'edited' }));

      const result = await service.update('comment-1', 'edited', makeUser({ id: 'author-1' }));
      expect(result.body).toBe('edited');
    });

    it("rejects a non-author, non-admin from editing someone else's comment", async () => {
      commentsRepository.findByIdActive.mockResolvedValue(makeComment());
      await expect(
        service.update('comment-1', 'edited', makeUser({ id: 'other-dev' })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets a same-organization Admin edit any comment', async () => {
      commentsRepository.findByIdActive.mockResolvedValue(makeComment());
      tasksRepository.findRawById.mockResolvedValue(
        makeRawTask({ organizationId: { toString: () => ORG_A } }),
      );
      commentsRepository.updateById.mockResolvedValue(makeComment({ body: 'edited by admin' }));

      const result = await service.update(
        'comment-1',
        'edited by admin',
        makeUser({ id: 'admin-1', role: Role.ADMIN, organizationId: ORG_A }),
      );
      expect(result.body).toBe('edited by admin');
    });

    it('SECURITY: rejects an Admin from a different organization from editing the comment', async () => {
      commentsRepository.findByIdActive.mockResolvedValue(makeComment());
      tasksRepository.findRawById.mockResolvedValue(
        makeRawTask({ organizationId: { toString: () => ORG_A } }),
      );

      await expect(
        service.update(
          'comment-1',
          'edited',
          makeUser({ id: 'admin-2', role: Role.ADMIN, organizationId: ORG_B }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(commentsRepository.updateById).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the comment does not exist (or is already deleted)', async () => {
      commentsRepository.findByIdActive.mockResolvedValue(null);
      await expect(service.update('missing', 'x', makeUser())).rejects.toThrow(NotFoundException);
      await expect(service.softDelete('missing', makeUser())).rejects.toThrow(NotFoundException);
    });

    it('lets the author soft-delete their own comment', async () => {
      commentsRepository.findByIdActive.mockResolvedValue(makeComment());
      await service.softDelete('comment-1', makeUser({ id: 'author-1' }));
      expect(commentsRepository.softDelete).toHaveBeenCalledWith('comment-1');
    });

    it("rejects a non-author, non-admin from deleting someone else's comment", async () => {
      commentsRepository.findByIdActive.mockResolvedValue(makeComment());
      await expect(service.softDelete('comment-1', makeUser({ id: 'other-dev' }))).rejects.toThrow(
        ForbiddenException,
      );
      expect(commentsRepository.softDelete).not.toHaveBeenCalled();
    });
  });
});
