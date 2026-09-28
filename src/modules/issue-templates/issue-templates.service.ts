import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { extractId } from '../../common/utils/mongo.util';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import { IssueTemplatesRepository } from './issue-templates.repository';
import { IssueTemplateDocument } from './schemas/issue-template.schema';
import { CreateIssueTemplateDto } from './dto/create-issue-template.dto';
import { UpdateIssueTemplateDto } from './dto/update-issue-template.dto';

@Injectable()
export class IssueTemplatesService {
  constructor(
    private readonly issueTemplatesRepository: IssueTemplatesRepository,
    @InjectModel(Project.name) private readonly projectModel: Model<ProjectDocument>,
  ) {}

  async create(
    dto: CreateIssueTemplateDto,
    actingUser: AuthenticatedUser,
  ): Promise<IssueTemplateDocument> {
    const organizationId = requireOrgId(actingUser);
    if (dto.projectId) await this.assertProjectInOrg(dto.projectId, organizationId);

    return this.issueTemplatesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      projectId: dto.projectId ? new Types.ObjectId(dto.projectId) : null,
      createdBy: new Types.ObjectId(actingUser.id),
      name: dto.name.trim(),
      issueType: dto.issueType ?? 'Task',
      // Deliberately NOT trimmed, unlike `name` above - a trailing space is often meaningful here
      // (e.g. "[Bug] " as a prefix the applied title continues from), not accidental input noise.
      titleTemplate: dto.titleTemplate ?? '',
      description: dto.description ?? '',
      priority: dto.priority ?? null,
      labels: dto.labels ?? [],
      customFieldValues: dto.customFieldValues ?? {},
    });
  }

  /** With `projectId`, returns org-wide templates plus the ones scoped to that project - the set
   * a New Task form for that project may offer. Without it, every template in the org (the
   * management page's own listing). */
  list(actingUser: AuthenticatedUser, projectId?: string): Promise<IssueTemplateDocument[]> {
    return this.issueTemplatesRepository.findForOrg(requireOrgId(actingUser), projectId);
  }

  async update(
    id: string,
    dto: UpdateIssueTemplateDto,
    actingUser: AuthenticatedUser,
  ): Promise<IssueTemplateDocument> {
    const organizationId = requireOrgId(actingUser);
    await this.getInOrgOrThrow(id, organizationId);
    if (dto.projectId) await this.assertProjectInOrg(dto.projectId, organizationId);

    const updated = await this.issueTemplatesRepository.updateById(id, {
      ...(dto.projectId !== undefined
        ? { projectId: dto.projectId ? new Types.ObjectId(dto.projectId) : null }
        : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.issueType !== undefined ? { issueType: dto.issueType } : {}),
      ...(dto.titleTemplate !== undefined ? { titleTemplate: dto.titleTemplate } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
      ...(dto.labels !== undefined ? { labels: dto.labels } : {}),
      ...(dto.customFieldValues !== undefined ? { customFieldValues: dto.customFieldValues } : {}),
    });
    return updated!;
  }

  async remove(id: string, actingUser: AuthenticatedUser): Promise<void> {
    await this.getInOrgOrThrow(id, requireOrgId(actingUser));
    await this.issueTemplatesRepository.deleteById(id);
  }

  findByIdOrNull(id: string): Promise<IssueTemplateDocument | null> {
    return this.issueTemplatesRepository.findById(id);
  }

  private async getInOrgOrThrow(
    id: string,
    organizationId: string,
  ): Promise<IssueTemplateDocument> {
    const template = await this.issueTemplatesRepository.findById(id);
    if (!template || extractId(template.organizationId) !== organizationId) {
      throw new NotFoundException('Issue template not found');
    }
    return template;
  }

  private async assertProjectInOrg(projectId: string, organizationId: string): Promise<void> {
    const exists = await this.projectModel.exists({
      _id: projectId,
      organizationId: new Types.ObjectId(organizationId),
      deletedAt: null,
    });
    if (!exists) {
      throw new BadRequestException('projectId does not reference a project in this organization');
    }
  }
}
