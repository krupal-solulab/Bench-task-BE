import { randomUUID } from 'crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { Role } from '../../common/enums/role.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TasksRepository } from '../tasks/tasks.repository';
import { ProjectsService } from '../projects/projects.service';
import { IStorageService } from '../../storage/storage.interface';
import { STORAGE_SERVICE } from '../../storage/storage.constants';
import { AttachmentsRepository } from './attachments.repository';
import { AttachmentDocument } from './schemas/attachment.schema';

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly attachmentsRepository: AttachmentsRepository,
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
    @Inject(STORAGE_SERVICE) private readonly storageService: IStorageService,
  ) {}

  async upload(
    taskId: string,
    file: Express.Multer.File,
    actingUser: AuthenticatedUser,
  ): Promise<AttachmentDocument> {
    await this.assertTaskMember(taskId, actingUser);
    const storageKey = `tasks/${taskId}/${randomUUID()}-${file.originalname}`;
    await this.storageService.upload(storageKey, file.buffer, file.mimetype);
    const attachment = await this.attachmentsRepository.create({
      task: new Types.ObjectId(taskId),
      uploadedBy: new Types.ObjectId(actingUser.id),
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storageKey,
    });
    return this.attachmentsRepository.findByIdActive(attachment.id) as Promise<AttachmentDocument>;
  }

  async paginateForTask(
    taskId: string,
    page: number,
    limit: number,
    actingUser: AuthenticatedUser,
  ) {
    await this.assertTaskMember(taskId, actingUser);
    const { data, total } = await this.attachmentsRepository.paginateForTask(taskId, page, limit);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async getDownloadUrl(id: string, actingUser: AuthenticatedUser): Promise<string> {
    const attachment = await this.getActiveOrThrow(id);
    await this.assertTaskMember(extractId(attachment.task), actingUser);
    return this.storageService.getDownloadUrl(attachment.storageKey);
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    const attachment = await this.getActiveOrThrow(id);
    await this.assertCanModify(attachment, actingUser);
    await this.attachmentsRepository.softDelete(id);
    try {
      await this.storageService.delete(attachment.storageKey);
    } catch {
      // Metadata is already soft-deleted and will no longer surface via the API; a failure to
      // remove the underlying object is not worth failing the request over (same
      // best-effort-cleanup philosophy as the rest of this codebase's cache invalidation).
    }
  }

  private async assertCanModify(
    attachment: AttachmentDocument,
    actingUser: AuthenticatedUser,
  ): Promise<void> {
    if (extractId(attachment.uploadedBy) === actingUser.id) return;
    if (actingUser.role === Role.ADMIN || actingUser.role === Role.MANAGER) {
      const task = await this.tasksRepository.findRawById(extractId(attachment.task));
      if (task && extractId(task.organizationId) === requireOrgId(actingUser)) return;
    }
    throw new ForbiddenException('You can only delete your own attachments');
  }

  private async assertTaskMember(taskId: string, actingUser: AuthenticatedUser): Promise<void> {
    const task = await this.tasksRepository.findRawById(taskId);
    if (!task) throw new NotFoundException('Task not found');
    if (
      actingUser.role === Role.ADMIN &&
      extractId(task.organizationId) === requireOrgId(actingUser)
    ) {
      return;
    }
    const project = await this.projectsService.getActiveProjectOrThrow(task.project.toString());
    if (!this.projectsService.isProjectMember(project, actingUser.id)) {
      throw new ForbiddenException('You must be a member of this project to view attachments');
    }
  }

  private async getActiveOrThrow(id: string): Promise<AttachmentDocument> {
    const attachment = await this.attachmentsRepository.findByIdActive(id);
    if (!attachment) throw new NotFoundException('Attachment not found');
    return attachment;
  }
}
