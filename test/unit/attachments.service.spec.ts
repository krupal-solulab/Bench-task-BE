import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';
import { AttachmentsService } from 'src/modules/attachments/attachments.service';
import { AttachmentsRepository } from 'src/modules/attachments/attachments.repository';
import { TasksRepository } from 'src/modules/tasks/tasks.repository';
import { ProjectsService } from 'src/modules/projects/projects.service';
import { IStorageService } from 'src/storage/storage.interface';

const ORG_A = 'org-a';
const ORG_B = 'org-b';
// upload() wraps both taskId and actingUser.id in `new Types.ObjectId(...)`.
const TASK_ID = '507f1f77bcf86cd799439001';
const UPLOADER_ID = '507f1f77bcf86cd799439002';
const OTHER_MEMBER_ID = '507f1f77bcf86cd799439003';
const ADMIN_A_ID = '507f1f77bcf86cd799439004';
const ADMIN_B_ID = '507f1f77bcf86cd799439005';
const MANAGER_ID = '507f1f77bcf86cd799439006';

function makeRawTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TASK_ID,
    project: { toString: () => 'project-1' },
    organizationId: { toString: () => ORG_A },
    ...overrides,
  } as never;
}

function makeAttachment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'attachment-1',
    task: TASK_ID,
    uploadedBy: { toString: () => UPLOADER_ID },
    storageKey: 'tasks/task-1/file.txt',
    filename: 'file.txt',
    ...overrides,
  } as never;
}

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: UPLOADER_ID,
    email: 'a@a.com',
    role: Role.DEVELOPER,
    organizationId: ORG_A,
    ...overrides,
  };
}

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: 'file.txt',
    mimetype: 'text/plain',
    size: 12,
    buffer: Buffer.from('hello world'),
    ...overrides,
  } as Express.Multer.File;
}

describe('AttachmentsService', () => {
  let attachmentsRepository: jest.Mocked<
    Pick<AttachmentsRepository, 'create' | 'findByIdActive' | 'paginateForTask' | 'softDelete'>
  >;
  let tasksRepository: jest.Mocked<Pick<TasksRepository, 'findRawById'>>;
  let projectsService: jest.Mocked<
    Pick<ProjectsService, 'getActiveProjectOrThrow' | 'isProjectMember'>
  >;
  let storageService: jest.Mocked<IStorageService>;
  let service: AttachmentsService;

  beforeEach(() => {
    attachmentsRepository = {
      create: jest.fn(),
      findByIdActive: jest.fn(),
      paginateForTask: jest.fn(),
      softDelete: jest.fn(),
    };
    tasksRepository = { findRawById: jest.fn() };
    projectsService = { getActiveProjectOrThrow: jest.fn(), isProjectMember: jest.fn() };
    storageService = {
      upload: jest.fn().mockResolvedValue(undefined),
      getDownloadUrl: jest.fn().mockResolvedValue('https://fake-storage.test/signed-url'),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new AttachmentsService(
      attachmentsRepository as unknown as AttachmentsRepository,
      tasksRepository as unknown as TasksRepository,
      projectsService as unknown as ProjectsService,
      storageService,
    );
  });

  describe('upload', () => {
    it('lets a project member upload a file', async () => {
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(true);
      attachmentsRepository.create.mockResolvedValue({ id: 'attachment-1' } as never);
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());

      const result = await service.upload(TASK_ID, makeFile(), makeUser({ id: UPLOADER_ID }));

      expect(result.id).toBe('attachment-1');
      expect(storageService.upload).toHaveBeenCalledWith(
        expect.stringContaining(`tasks/${TASK_ID}/`),
        expect.any(Buffer),
        'text/plain',
      );
    });

    it('rejects a non-member from uploading', async () => {
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(
        service.upload(TASK_ID, makeFile(), makeUser({ id: OTHER_MEMBER_ID })),
      ).rejects.toThrow(ForbiddenException);
      expect(storageService.upload).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent task', async () => {
      tasksRepository.findRawById.mockResolvedValue(null);
      await expect(service.upload(TASK_ID, makeFile(), makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets a same-org Admin upload without a membership check', async () => {
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      attachmentsRepository.create.mockResolvedValue({ id: 'attachment-1' } as never);
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());

      await service.upload(
        TASK_ID,
        makeFile(),
        makeUser({ id: ADMIN_A_ID, role: Role.ADMIN, organizationId: ORG_A }),
      );

      expect(projectsService.getActiveProjectOrThrow).not.toHaveBeenCalled();
    });

    it('SECURITY: rejects an Admin from a different organization', async () => {
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(
        service.upload(
          TASK_ID,
          makeFile(),
          makeUser({ id: ADMIN_B_ID, role: Role.ADMIN, organizationId: ORG_B }),
        ),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getDownloadUrl', () => {
    it('returns a presigned URL for a project member', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(true);

      const url = await service.getDownloadUrl('attachment-1', makeUser());
      expect(url).toBe('https://fake-storage.test/signed-url');
    });

    it('rejects a non-member from downloading', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());
      projectsService.getActiveProjectOrThrow.mockResolvedValue({ id: 'project-1' } as never);
      projectsService.isProjectMember.mockReturnValue(false);

      await expect(
        service.getDownloadUrl('attachment-1', makeUser({ id: OTHER_MEMBER_ID })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException for a nonexistent attachment', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(null);
      await expect(service.getDownloadUrl('missing', makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('remove', () => {
    it('lets the uploader delete their own attachment', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());
      await service.remove('attachment-1', makeUser({ id: UPLOADER_ID }));
      expect(attachmentsRepository.softDelete).toHaveBeenCalledWith('attachment-1');
      expect(storageService.delete).toHaveBeenCalledWith('tasks/task-1/file.txt');
    });

    it('lets a same-org Admin delete any attachment', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());

      await service.remove(
        'attachment-1',
        makeUser({ id: ADMIN_A_ID, role: Role.ADMIN, organizationId: ORG_A }),
      );
      expect(attachmentsRepository.softDelete).toHaveBeenCalledWith('attachment-1');
    });

    it('lets a same-org Manager delete any attachment', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());
      tasksRepository.findRawById.mockResolvedValue(makeRawTask());

      await service.remove(
        'attachment-1',
        makeUser({ id: MANAGER_ID, role: Role.MANAGER, organizationId: ORG_A }),
      );
      expect(attachmentsRepository.softDelete).toHaveBeenCalledWith('attachment-1');
    });

    it('rejects a non-uploader Developer from deleting the attachment', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());

      await expect(
        service.remove('attachment-1', makeUser({ id: OTHER_MEMBER_ID, role: Role.DEVELOPER })),
      ).rejects.toThrow(ForbiddenException);
      expect(attachmentsRepository.softDelete).not.toHaveBeenCalled();
    });

    it('SECURITY: rejects an Admin from a different organization from deleting the attachment', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());
      tasksRepository.findRawById.mockResolvedValue(
        makeRawTask({ organizationId: { toString: () => ORG_A } }),
      );

      await expect(
        service.remove(
          'attachment-1',
          makeUser({ id: ADMIN_B_ID, role: Role.ADMIN, organizationId: ORG_B }),
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(attachmentsRepository.softDelete).not.toHaveBeenCalled();
    });

    it('does not let a storage-delete failure stop the attachment from being removed', async () => {
      attachmentsRepository.findByIdActive.mockResolvedValue(makeAttachment());
      storageService.delete.mockRejectedValue(new Error('bucket unreachable'));

      await expect(
        service.remove('attachment-1', makeUser({ id: UPLOADER_ID })),
      ).resolves.toBeUndefined();
      expect(attachmentsRepository.softDelete).toHaveBeenCalledWith('attachment-1');
    });
  });
});
